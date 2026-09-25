import "server-only";

import { randomUUID } from "node:crypto";
import { cp, mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { serverEnv } from "@/lib/server/env";
import { resolveStoreConfigDirectory } from "@/lib/server/modules/store/catalog-config";
import { resolveDataRootDirectory, resolveStoreStacksRoot } from "@/lib/server/storage/data-root";
import * as systemd from "@/lib/server/platform/systemd";
import * as backup from "@/lib/server/platform/backup";
import {
  isAvailable as isBinaryAvailable,
  type AllowedBinary,
  type ScriptOnlyBinary,
} from "@/lib/server/platform/process";
import type {
  SystemBackupDayOfWeek,
  SystemBackupListResponse,
  SystemBackupSettings,
  SystemBackupSummary,
  SystemFeatureAvailability,
  SystemRestoreOutcome,
  SystemRestoreStep,
} from "@/lib/shared/contracts/system";


const BACKUP_CONFIG_PATH = "/etc/homeio/backup-schedule.json";
const SYSTEMD_TIMER_PATH = "/etc/systemd/system/homeio-scheduled-backup.timer";
const SYSTEMD_SERVICE_PATH = "/etc/systemd/system/homeio-scheduled-backup.service";
const BACKUP_LOG_PATH = "/var/log/homeio-backup.log";
const RESTORE_LOG_PATH = "/var/log/homeio-restore.log";
// Outside the data root, which a restore empties, and on disk rather than
// under /run, because the success path ends in a reboot.
const RESTORE_STATUS_PATH = "/var/lib/homeio/restore-status.json";

const BACKUP_DAY_OPTIONS: SystemBackupDayOfWeek[] = [
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
  "sunday",
];

const DAY_TO_ON_CALENDAR: Record<SystemBackupDayOfWeek, string> = {
  monday: "Mon",
  tuesday: "Tue",
  wednesday: "Wed",
  thursday: "Thu",
  friday: "Fri",
  saturday: "Sat",
  sunday: "Sun",
};

const DEFAULT_SETTINGS: SystemBackupSettings = {
  enabled: false,
  frequency: "weekly",
  dayOfWeek: "sunday",
  time: "03:00",
  retentionCount: 7,
};

function resolveConfiguredPath(inputPath: string) {
  return path.isAbsolute(inputPath)
    ? inputPath
    : path.resolve(process.cwd(), inputPath);
}

function shellEscape(value: string) {
  return `'${value.replace(/'/g, `'"'"'`)}'`;
}

function escapeTarTransformPattern(value: string) {
  return value.replace(/[\\^$.*+?()[\]{}|]/g, "\\$&");
}

function normalizeTarPath(value: string) {
  return value.split(path.sep).join("/");
}

/**
 * Directories under the data root ride along in its tar member; only the ones
 * outside it need to be archived separately.
 */
function isOutsideDataRoot(candidate: string, dataRoot: string) {
  const normalizedCandidate = normalizeTarPath(candidate);
  const normalizedDataRoot = normalizeTarPath(dataRoot);

  return (
    normalizedCandidate !== normalizedDataRoot &&
    !normalizedCandidate.startsWith(`${normalizedDataRoot}/`)
  );
}

async function directoryExists(target: string) {
  return stat(target)
    .then(() => true)
    .catch((error) => {
      const err = error as NodeJS.ErrnoException;
      if (err.code === "ENOENT") {
        return false;
      }

      throw error;
    });
}

function validateBackupSettings(input: SystemBackupSettings) {
  if (input.frequency !== "daily" && input.frequency !== "weekly") {
    throw new Error("Backup frequency must be daily or weekly");
  }

  if (!BACKUP_DAY_OPTIONS.includes(input.dayOfWeek)) {
    throw new Error("Backup day must be a valid weekday");
  }

  if (!/^\d{2}:\d{2}$/.test(input.time)) {
    throw new Error("Backup time must use HH:MM format");
  }

  const [hour, minute] = input.time.split(":").map(Number);
  if (!Number.isInteger(hour) || !Number.isInteger(minute) || hour < 0 || hour > 23 || minute < 0 || minute > 59) {
    throw new Error("Backup time must use a valid 24-hour clock value");
  }

  if (!Number.isInteger(input.retentionCount) || input.retentionCount < 1 || input.retentionCount > 365) {
    throw new Error("Retention count must be between 1 and 365");
  }
}

function parseBackupSettings(rawValue: string | null): SystemBackupSettings {
  if (!rawValue) return DEFAULT_SETTINGS;

  try {
    const parsed = JSON.parse(rawValue) as Partial<SystemBackupSettings>;
    const settings: SystemBackupSettings = {
      enabled: typeof parsed.enabled === "boolean" ? parsed.enabled : DEFAULT_SETTINGS.enabled,
      frequency: parsed.frequency === "daily" || parsed.frequency === "weekly"
        ? parsed.frequency
        : DEFAULT_SETTINGS.frequency,
      dayOfWeek: parsed.dayOfWeek && BACKUP_DAY_OPTIONS.includes(parsed.dayOfWeek)
        ? parsed.dayOfWeek
        : DEFAULT_SETTINGS.dayOfWeek,
      time: typeof parsed.time === "string" ? parsed.time : DEFAULT_SETTINGS.time,
      retentionCount: typeof parsed.retentionCount === "number" ? parsed.retentionCount : DEFAULT_SETTINGS.retentionCount,
    };

    validateBackupSettings(settings);
    return settings;
  } catch {
    return DEFAULT_SETTINGS;
  }
}

function createBackupId(date = new Date()) {
  const iso = date.toISOString().replace(/[:]/g, "-").replace(/\.\d{3}Z$/, "Z");
  return `backup-${iso}`;
}

async function readPackageVersion() {
  try {
    const raw = await readFile(path.join(process.cwd(), "package.json"), "utf8");
    const parsed = JSON.parse(raw) as { version?: string };
    return parsed.version ?? "unknown";
  } catch {
    return "unknown";
  }
}

function getBackupManifestPath(backupRoot: string, backupId: string) {
  return path.join(backupRoot, `${backupId}.manifest.json`);
}

function getBackupArchivePath(backupRoot: string, backupId: string) {
  return path.join(backupRoot, `${backupId}.tar.gz`);
}

export function resolveManagedBackupRoot() {
  const backupBaseRoot =
    serverEnv.NODE_ENV === "production"
      ? "/DATA"
      : resolveDataRootDirectory();

  return path.join(backupBaseRoot, "Backups", "homeio");
}

function resolveManagedRestoreDataRoot() {
  const configuredAppDataRoot = serverEnv.STORE_APP_DATA_ROOT;

  if (typeof configuredAppDataRoot === "string" && configuredAppDataRoot.trim().length > 0) {
    return path.dirname(resolveConfiguredPath(configuredAppDataRoot));
  }

  const configuredFilesRoot = serverEnv.FILES_ROOT;

  if (typeof configuredFilesRoot === "string" && configuredFilesRoot.trim().length > 0) {
    return resolveConfiguredPath(configuredFilesRoot);
  }

  return resolveDataRootDirectory();
}

/**
 * Run a shell command in a dedicated transient systemd unit so it outlives
 * the home-server.service process group (which is killed when the service stops).
 *
 * Using `spawn(..., { detached: true })` is NOT sufficient — detached only creates
 * a new process group, but the process still lives inside the same cgroup as the
 * calling service. systemd's default KillMode=control-group will terminate every
 * process in that cgroup when the service is stopped, including detached children.
 *
 * `systemd-run` launches the script as a fresh transient unit with its own isolated
 * cgroup, so it survives the service stop that happens inside the restore flow itself.
 */
async function scheduleDetachedShellCommand(command: string, unitSuffix: string) {
  const unitName = `homeio-${unitSuffix}-${Date.now()}`;
  await systemd.runDetachedCommand(command, {
    unit: unitName,
    description: "Homeio restore operation",
  });
}

function buildOnCalendar(settings: SystemBackupSettings) {
  const [hour, minute] = settings.time.split(":");
  if (!hour || !minute) {
    throw new Error("Backup time must use HH:MM format");
  }

  if (settings.frequency === "daily") {
    return `*-*-* ${hour}:${minute}:00`;
  }

  return `${DAY_TO_ON_CALENDAR[settings.dayOfWeek]} *-*-* ${hour}:${minute}:00`;
}

function buildScheduledBackupServiceFile() {
  const workdir = process.cwd();
  const runnerPath = path.join(workdir, "dist-server/lib/server/modules/system/backup-runner.js");
  const command = [
    `cd ${shellEscape(workdir)}`,
    `export NODE_ENV=production`,
    `export DATABASE_URL=${shellEscape(serverEnv.DATABASE_URL)}`,
    `exec /usr/bin/env node ${shellEscape(runnerPath)} >> ${shellEscape(BACKUP_LOG_PATH)} 2>&1`,
  ].join("; ");

  return `[Unit]\nDescription=Homeio scheduled backup\n\n[Service]\nType=oneshot\nExecStart=/usr/bin/env bash -lc ${shellEscape(command)}\n`;
}

function buildScheduledBackupTimerFile(settings: SystemBackupSettings) {
  return `[Unit]\nDescription=Homeio scheduled backup timer\n\n[Timer]\nOnCalendar=${buildOnCalendar(settings)}\nPersistent=true\nUnit=homeio-scheduled-backup.service\n\n[Install]\nWantedBy=timers.target\n`;
}

async function readStoredBackupSettings() {
  try {
    const raw = await readFile(BACKUP_CONFIG_PATH, "utf8");
    return parseBackupSettings(raw);
  } catch (error) {
    const err = error as NodeJS.ErrnoException;
    if (err.code === "ENOENT") {
      return DEFAULT_SETTINGS;
    }
    throw error;
  }
}

export async function getSystemBackupSettings(): Promise<SystemBackupSettings> {
  const stored = await readStoredBackupSettings();

  try {
    const stdout = await systemd.isEnabled("homeio-scheduled-backup.timer");
    return {
      ...stored,
      enabled: stdout.trim() === "enabled",
    };
  } catch {
    return {
      ...stored,
      enabled: false,
    };
  }
}

export async function clearSystemBackupSchedule() {
  await systemd.disable("homeio-scheduled-backup.timer", { now: true }).catch(
    () => undefined,
  );
  await rm(SYSTEMD_TIMER_PATH, { force: true }).catch(() => undefined);
  await rm(SYSTEMD_SERVICE_PATH, { force: true }).catch(() => undefined);
  await systemd.reload().catch(() => undefined);
}

export async function updateSystemBackupSettings(settings: SystemBackupSettings) {
  validateBackupSettings(settings);

  await mkdir(path.dirname(BACKUP_CONFIG_PATH), { recursive: true });
  await writeFile(BACKUP_CONFIG_PATH, `${JSON.stringify(settings, null, 2)}\n`, "utf8");

  if (!settings.enabled) {
    await clearSystemBackupSchedule();
    await writeFile(
      BACKUP_CONFIG_PATH,
      `${JSON.stringify({ ...settings, enabled: false }, null, 2)}\n`,
      "utf8",
    );
    return {
      ...settings,
      enabled: false,
    };
  }

  await writeFile(SYSTEMD_SERVICE_PATH, buildScheduledBackupServiceFile(), "utf8");
  await writeFile(SYSTEMD_TIMER_PATH, buildScheduledBackupTimerFile(settings), "utf8");
  await systemd.reload();
  await systemd.enable("homeio-scheduled-backup.timer", { now: true });

  return settings;
}

async function parseBackupManifest(manifestPath: string): Promise<SystemBackupSummary | null> {
  try {
    const raw = await readFile(manifestPath, "utf8");
    const parsed = JSON.parse(raw) as Partial<SystemBackupSummary>;
    if (
      typeof parsed.id !== "string" ||
      typeof parsed.createdAt !== "string" ||
      typeof parsed.sizeBytes !== "number" ||
      typeof parsed.backupPath !== "string" ||
      typeof parsed.hostname !== "string" ||
      typeof parsed.appVersion !== "string"
    ) {
      return null;
    }

    return {
      id: parsed.id,
      createdAt: parsed.createdAt,
      sizeBytes: parsed.sizeBytes,
      appVersion: parsed.appVersion,
      hostname: parsed.hostname,
      backupPath: parsed.backupPath,
      dbDumpIncluded: parsed.dbDumpIncluded !== false,
      dataRootIncluded: parsed.dataRootIncluded !== false,
      stacksRootIncluded: parsed.stacksRootIncluded !== false,
      // Backups taken before the store registry was archived genuinely lack
      // it, so absence means false here rather than the usual "assume true".
      storeConfigIncluded: parsed.storeConfigIncluded === true,
      status: parsed.status === "failed" ? "failed" : "completed",
    };
  } catch {
    return null;
  }
}

export async function listSystemBackups(): Promise<SystemBackupSummary[]> {
  const backupRoot = resolveManagedBackupRoot();

  try {
    const entries = await readdir(backupRoot);
    const manifests = await Promise.all(
      entries
        .filter((entry) => entry.endsWith(".manifest.json"))
        .map((entry) => parseBackupManifest(path.join(backupRoot, entry))),
    );

    return manifests
      .filter((entry): entry is SystemBackupSummary => entry !== null)
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
  } catch (error) {
    const err = error as NodeJS.ErrnoException;
    if (err.code === "ENOENT") {
      return [];
    }
    throw error;
  }
}

// What each action runs on the host. The Docker image carries none of pg_dump,
// psql or systemd-run, so both buttons were offered there and failed every
// time with a 500 that said nothing about why.
const RUN_NOW_BINARIES = ["pg_dump", "tar"] as const;
const RESTORE_BINARIES = ["systemd-run", "psql", "tar"] as const;

async function describeAvailability(
  binaries: readonly (AllowedBinary | ScriptOnlyBinary)[],
  action: string,
): Promise<SystemFeatureAvailability> {
  const present = await Promise.all(binaries.map((binary) => isBinaryAvailable(binary)));
  const missing = binaries.filter((_, index) => !present[index]);

  if (missing.length === 0) return { available: true, reason: null };

  const list = missing.join(" and ");
  return {
    available: false,
    reason: `${action} needs ${list}, which ${missing.length === 1 ? "is" : "are"} not installed on this host.`,
  };
}

export async function getSystemBackupAvailability(): Promise<SystemBackupListResponse["availability"]> {
  const [runNow, restore] = await Promise.all([
    describeAvailability(RUN_NOW_BINARIES, "Backing up"),
    describeAvailability(RESTORE_BINARIES, "Restoring"),
  ]);
  return { runNow, restore };
}

export async function getSystemBackupsSnapshot(): Promise<SystemBackupListResponse> {
  const [settings, backups, availability] = await Promise.all([
    getSystemBackupSettings(),
    listSystemBackups(),
    getSystemBackupAvailability(),
  ]);

  return {
    settings,
    backups,
    backupRoot: resolveManagedBackupRoot(),
    availability,
  };
}

async function pruneStoredBackups(retentionCount: number) {
  const backups = await listSystemBackups();
  const removals = backups.slice(Math.max(0, retentionCount));
  const backupRoot = resolveManagedBackupRoot();

  await Promise.all(
    removals.flatMap((backup) => [
      rm(backup.backupPath, { force: true }).catch(() => undefined),
      rm(getBackupManifestPath(backupRoot, backup.id), { force: true }).catch(() => undefined),
    ]),
  );
}

export async function runSystemBackupNow(): Promise<SystemBackupSummary> {
  const settings = await getSystemBackupSettings();
  validateBackupSettings(settings);

  const backupRoot = resolveManagedBackupRoot();
  const dataRoot = resolveManagedRestoreDataRoot();
  const stacksRoot = resolveStoreStacksRoot();
  const backupId = createBackupId();
  const archivePath = getBackupArchivePath(backupRoot, backupId);
  const manifestPath = getBackupManifestPath(backupRoot, backupId);

  await mkdir(backupRoot, { recursive: true });
  const workRoot = await mkdtemp(path.join(backupRoot, ".tmp-"));

  const dumpPath = path.join(workRoot, "database.sql");
  const dataRootBase = path.basename(dataRoot);
  const dataRootParent = path.dirname(dataRoot);
  const backupRootRelative = path.relative(dataRootParent, backupRoot);
  const tarArgs = [
    "-czf",
    archivePath,
    "--exclude",
    normalizeTarPath(backupRootRelative),
    "-C",
    workRoot,
    "--transform",
    "s,^database.sql,db/database.sql,",
    "database.sql",
    "-C",
    dataRootParent,
    "--transform",
    `s,^${escapeTarTransformPattern(dataRootBase)},data-root,`,
    dataRootBase,
  ];
  const stacksRootOutsideDataRoot = isOutsideDataRoot(stacksRoot, dataRoot);
  const stacksRootExists = await directoryExists(stacksRoot);
  // The store registry (added catalog sources and their checkouts) lives
  // beside the stacks, not under the data root, so a restore used to bring
  // the files and the database back while silently dropping every app store
  // the user had added.
  const storeConfigRoot = resolveStoreConfigDirectory();
  const storeConfigOutsideDataRoot = isOutsideDataRoot(storeConfigRoot, dataRoot);
  const storeConfigExists = await directoryExists(storeConfigRoot);
  const storeConfigArchived = storeConfigOutsideDataRoot && storeConfigExists;

  try {
    await backup.dumpDatabase(serverEnv.DATABASE_URL, dumpPath);

    if (stacksRootOutsideDataRoot && stacksRootExists) {
      await cp(stacksRoot, path.join(workRoot, "stacks-root"), { recursive: true });
      tarArgs.push("-C", workRoot, "stacks-root");
    }

    if (storeConfigArchived) {
      await cp(storeConfigRoot, path.join(workRoot, "store-config"), { recursive: true });
      tarArgs.push("-C", workRoot, "store-config");
    }

    await backup.createArchive(tarArgs, { archivePath });

    const archiveStats = await stat(archivePath);
    const summary: SystemBackupSummary = {
      id: backupId,
      createdAt: new Date().toISOString(),
      sizeBytes: archiveStats.size,
      appVersion: await readPackageVersion(),
      hostname: os.hostname(),
      backupPath: archivePath,
      dbDumpIncluded: true,
      dataRootIncluded: true,
      stacksRootIncluded: stacksRootOutsideDataRoot && stacksRootExists,
      storeConfigIncluded: storeConfigArchived,
      status: "completed",
    };

    await writeFile(manifestPath, `${JSON.stringify(summary, null, 2)}\n`, "utf8");
    await pruneStoredBackups(settings.retentionCount);

    return summary;
  } finally {
    await rm(workRoot, { recursive: true, force: true }).catch(() => undefined);
  }
}

export function buildRestoreShellCommand(
  backup: SystemBackupSummary,
  restoreId: string = randomUUID(),
) {
  const dataRoot = resolveManagedRestoreDataRoot();
  const stacksRoot = resolveStoreStacksRoot();
  const restoreRoot = path.join("/var/tmp", `homeio-restore-${backup.id}`);
  const restoredDataRootContents = `${path.join(restoreRoot, "data-root")}/.`;
  const restoredExternalStacksRoot = path.join(restoreRoot, "stacks-root");
  const storeConfigRoot = resolveStoreConfigDirectory();
  const restoredStoreConfigRoot = path.join(restoreRoot, "store-config");
  const dumpFile = path.join(restoreRoot, "db", "database.sql");
  const combinedSqlFile = path.join(restoreRoot, "db", "restore.sql");
  // Kill all existing DB connections before dropping the schema.
  // Needed because Restart=always may have restarted home-server while the
  // restore is still in progress, leaving live pg connections that would
  // cause "DROP SCHEMA … CASCADE" to fail with "other sessions using schema".
  const terminateConnectionsSql =
    "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = current_database() AND pid <> pg_backend_pid()";

  // `drizzle` holds the migration journal and lives outside `public`, so
  // resetting only `public` left it standing — and the dump's own
  // `CREATE SCHEMA drizzle` then failed, aborting the restore 25 lines in with
  // the database already wiped.
  const resetSchemasSql = [
    "DROP SCHEMA IF EXISTS public CASCADE;",
    "DROP SCHEMA IF EXISTS drizzle CASCADE;",
    "CREATE SCHEMA public;",
    "GRANT ALL ON SCHEMA public TO CURRENT_USER;",
    "GRANT ALL ON SCHEMA public TO public;",
  ].join("\n");

  // Stored backups live under the data root but are deliberately excluded from
  // the archive, so wiping the data root wholesale destroyed every backup —
  // including the one being restored, leaving nothing to retry with.
  const backupRootRelativeToData = path.relative(dataRoot, resolveManagedBackupRoot());
  const backupDirName =
    backupRootRelativeToData &&
    !backupRootRelativeToData.startsWith("..") &&
    !path.isAbsolute(backupRootRelativeToData)
      ? backupRootRelativeToData.split(path.sep)[0]
      : null;
  // Nothing to spare when the backups live outside the data root.
  const keepBackups = backupDirName ? `! -name ${shellEscape(backupDirName)} ` : "";

  // Homeio runs every stack as `-p <stack_name>`, and that name is not always
  // the one compose derives from the file: an app whose file says
  // `name: uptimekuma` runs as project `uptime-kuma`. Deriving it from the file
  // made `down` find nothing and `up` collide with the container still
  // running, so the restore replaced an app's data underneath it. The names
  // are read from the database each time rather than once, because after the
  // load it is the restored database that says which stacks exist. A stack
  // with no row, or a database that cannot answer, falls back to the file.
  const stackProjectsSql = "SELECT compose_path, stack_name FROM app_stacks";
  const rehearsalSqlFile = path.join(restoreRoot, "db", "rehearsal.sql");

  // The browser cannot tell a restore that failed from one that worked: both
  // end with the server answering again, and the screen used to clear itself
  // in silence either way. Only this script knows, so it writes down how it
  // ended, and which step it was in, where the server can read it back after
  // the reboot. The part that comes from outside (the backup id, from a
  // manifest) is encoded here; the shell only fills in values it owns.
  const statusFields = JSON.stringify({ restoreId, backupId: backup.id }).slice(0, -1);
  const statusTmp = `${RESTORE_STATUS_PATH}.tmp`;

  return [
    `set -Eeuo pipefail`,
    `step=starting`,
    `write_restore_status() { mkdir -p ${shellEscape(path.dirname(RESTORE_STATUS_PATH))} && printf '%s,"status":"%s","step":"%s","exitCode":%s,"at":"%s"}\\n' ${shellEscape(statusFields)} "$1" "$step" "$2" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" > ${shellEscape(statusTmp)} && mv ${shellEscape(statusTmp)} ${shellEscape(RESTORE_STATUS_PATH)}; }`,
    `compose_stacks() { if [ -d ${shellEscape(stacksRoot)} ]; then known=$(psql ${shellEscape(serverEnv.DATABASE_URL)} -At -F '|' -c ${shellEscape(stackProjectsSql)} 2>/dev/null || true); find ${shellEscape(stacksRoot)} -name docker-compose.yml -print0 | while IFS= read -r -d '' compose; do project=$(printf '%s\\n' "$known" | awk -F'|' -v f="$compose" '$1 == f { print $2; exit }'); if [ -n "$project" ]; then docker compose -p "$project" -f "$compose" "$@" || true; else docker compose -f "$compose" "$@" || true; fi; done; fi; }`,
    `restart_existing_stacks() { compose_stacks up -d; }`,
    `restore_failed() { status=$?; trap - ERR; write_restore_status failed "$status" || true; echo "[$(date -Is)] Restore failed with exit $status during $step; attempting service recovery"; systemctl unmask home-server.service || true; systemctl start home-server.service || true; restart_existing_stacks; exit $status; }`,
    `trap restore_failed ERR`,
    `sleep 2`,
    `exec >> ${shellEscape(RESTORE_LOG_PATH)} 2>&1`,
    `echo \"[$(date -Is)] Starting Homeio restore for ${backup.id}\"`,
    `write_restore_status running null`,
    `rm -rf ${shellEscape(restoreRoot)}`,
    `mkdir -p ${shellEscape(restoreRoot)}`,
    `step=stopping`,
    // Stop the service, then immediately mask it at runtime so systemd's
    // Restart=always cannot bring it back up while the restore is in progress.
    // --runtime means the mask lives only until the next reboot, which is fine
    // because the restore ends with `systemctl reboot`.
    `systemctl stop home-server.service || true`,
    `systemctl mask --runtime home-server.service || true`,
    `compose_stacks down`,
    `step=extracting`,
    `tar -xzf ${shellEscape(backup.backupPath)} -C ${shellEscape(restoreRoot)}`,
    `step=checking-dump`,
    // Refuse to touch anything until the archive has proven it carries a
    // database dump. `set -e` sends a failure here to the recovery trap with
    // the server still intact.
    `test -s ${shellEscape(dumpFile)}`,
    `step=rehearsing`,
    `{ printf '%s\n' ${shellEscape(resetSchemasSql)}; cat ${shellEscape(dumpFile)}; } > ${shellEscape(combinedSqlFile)}`,
    `psql ${shellEscape(serverEnv.DATABASE_URL)} -v ON_ERROR_STOP=1 -c ${shellEscape(terminateConnectionsSql)} || true`,
    // A dump that is present is not a dump that loads. The load below rolls
    // itself back on failure, but by then the data root, the stacks and the
    // store registry have already been replaced, so a broken dump left the
    // files of the archive under the database of today. Play the whole load
    // once and throw it away before anything on disk is touched.
    `{ printf '%s\n' 'BEGIN;'; cat ${shellEscape(combinedSqlFile)}; printf '\n%s\n' 'ROLLBACK;'; } > ${shellEscape(rehearsalSqlFile)}`,
    `psql ${shellEscape(serverEnv.DATABASE_URL)} -v ON_ERROR_STOP=1 -f ${shellEscape(rehearsalSqlFile)}`,
    `step=replacing-files`,
    `if [ -d ${shellEscape(dataRoot)} ]; then find ${shellEscape(dataRoot)} -mindepth 1 -maxdepth 1 ${keepBackups}-exec rm -rf {} +; else mkdir -p ${shellEscape(dataRoot)}; fi`,
    `mkdir -p ${shellEscape(dataRoot)}`,
    `cp -a ${shellEscape(restoredDataRootContents)} ${shellEscape(`${dataRoot}/`)}`,
    `if [ -d ${shellEscape(restoredExternalStacksRoot)} ]; then rm -rf ${shellEscape(stacksRoot)}; mkdir -p ${shellEscape(path.dirname(stacksRoot))}; cp -a ${shellEscape(restoredExternalStacksRoot)} ${shellEscape(stacksRoot)}; fi`,
    // Archives predating the store registry carry no store-config member; the
    // guard leaves whatever is on disk alone rather than wiping the sources.
    `if [ -d ${shellEscape(restoredStoreConfigRoot)} ]; then rm -rf ${shellEscape(storeConfigRoot)}; mkdir -p ${shellEscape(path.dirname(storeConfigRoot))}; cp -a ${shellEscape(restoredStoreConfigRoot)} ${shellEscape(storeConfigRoot)}; fi`,
    `step=loading-database`,
    // Terminate any stale DB connections (e.g. from an auto-restarted server)
    // before wiping the schema to avoid "other sessions using the schema" errors.
    `psql ${shellEscape(serverEnv.DATABASE_URL)} -v ON_ERROR_STOP=1 -c ${shellEscape(terminateConnectionsSql)} || true`,
    // One transaction: if any statement fails the whole thing rolls back and
    // the existing database survives. Previously the wipe was committed before
    // the dump ran, so a failure left nothing behind.
    `psql ${shellEscape(serverEnv.DATABASE_URL)} -v ON_ERROR_STOP=1 --single-transaction -f ${shellEscape(combinedSqlFile)}`,
    `rm -rf ${shellEscape(restoreRoot)}`,
    // `docker compose down` above removed the containers, so nothing is left
    // for a restart policy to bring back at boot: without this the restore
    // succeeds and every app is gone. Recreating them before the reboot both
    // restores them now and re-arms their restart policies for the reboot.
    `step=restarting-apps`,
    `restart_existing_stacks`,
    `write_restore_status completed 0`,
    `echo \"[$(date -Is)] Restore complete; rebooting\"`,
    `trap - ERR`,
    `systemctl reboot`,
  ].join("; ");
}

const RESTORE_STEPS: readonly SystemRestoreStep[] = [
  "starting",
  "stopping",
  "extracting",
  "checking-dump",
  "rehearsing",
  "replacing-files",
  "loading-database",
  "restarting-apps",
];

// Up to and including the rehearsal, nothing on disk or in the database has
// been touched: the apps were stopped and the recovery trap starts them again.
const STEP_BEFORE_ANY_CHANGE: Partial<Record<SystemRestoreStep, string>> = {
  starting: "while starting",
  stopping: "while stopping Homeio and the apps",
  extracting: "while reading the archive",
  "checking-dump": "because the archive has no database dump",
  rehearsing: "because the database dump in the archive does not load",
};

function describeRestoreOutcome(
  outcome: Omit<SystemRestoreOutcome, "message">,
): string {
  const from = `from ${outcome.backupId}`;
  const log = `The details are in ${RESTORE_LOG_PATH}.`;

  if (outcome.status === "completed") {
    return `Restored ${from}.`;
  }

  if (outcome.status === "running") {
    // The server only answers once the script has stopped it and started it
    // again, so a restore still marked running did not get to say how it ended.
    return `The restore ${from} did not finish: Homeio came back while it was still marked as running, at the step "${outcome.step}". ${log}`;
  }

  const beforeAnyChange = STEP_BEFORE_ANY_CHANGE[outcome.step];
  if (beforeAnyChange) {
    return `The restore ${from} failed ${beforeAnyChange}. Nothing was changed: your files and your database are as they were. ${log}`;
  }

  if (outcome.step === "replacing-files") {
    return `The restore ${from} failed while replacing your files. Some of them may already be from the backup; the database was not changed. ${log}`;
  }

  if (outcome.step === "loading-database") {
    return `The restore ${from} failed while loading the database, after your files had been replaced. Your files are from the backup and your database is not. ${log}`;
  }

  return `The restore ${from} failed while restarting the apps, after your files and your database had been restored. ${log}`;
}

export async function readSystemRestoreOutcome(): Promise<SystemRestoreOutcome | null> {
  let raw: string;
  try {
    raw = await readFile(RESTORE_STATUS_PATH, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }

  return parseSystemRestoreOutcome(raw);
}

/** Reads what the restore script wrote; anything else reads as no record. */
export function parseSystemRestoreOutcome(raw: string): SystemRestoreOutcome | null {
  try {
    const parsed = JSON.parse(raw) as Partial<SystemRestoreOutcome>;
    if (
      typeof parsed.restoreId !== "string" ||
      typeof parsed.backupId !== "string" ||
      (parsed.status !== "running" && parsed.status !== "failed" && parsed.status !== "completed") ||
      !RESTORE_STEPS.includes(parsed.step as SystemRestoreStep) ||
      typeof parsed.at !== "string"
    ) {
      return null;
    }

    const outcome = {
      restoreId: parsed.restoreId,
      backupId: parsed.backupId,
      status: parsed.status,
      step: parsed.step as SystemRestoreStep,
      exitCode: typeof parsed.exitCode === "number" ? parsed.exitCode : null,
      at: parsed.at,
    };

    return { ...outcome, message: describeRestoreOutcome(outcome) };
  } catch {
    return null;
  }
}

export async function scheduleSystemBackupRestore(backupId: string) {
  const backups = await listSystemBackups();
  const backup = backups.find((entry) => entry.id === backupId);

  if (!backup) {
    throw new Error("Backup not found");
  }

  await stat(backup.backupPath);
  await mkdir(path.dirname(RESTORE_LOG_PATH), { recursive: true });
  const restoreId = randomUUID();
  await scheduleDetachedShellCommand(buildRestoreShellCommand(backup, restoreId), "restore");

  return {
    action: "restore" as const,
    accepted: true as const,
    backupId: backup.id,
    restoreId,
  };
}
