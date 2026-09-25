import type * as ChildProcess from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { execFileMock, spawnMock } = vi.hoisted(() => ({
  execFileMock: vi.fn(),
  spawnMock: vi.fn(),
}));

const { serverEnvMock } = vi.hoisted(() => ({
  serverEnvMock: {
    DATABASE_URL: "postgres://postgres:postgres@localhost:5432/homeio",
    STORE_APP_DATA_ROOT: "",
    FILES_ROOT: "",
    NODE_ENV: "test",
  },
}));

vi.mock("node:child_process", () => ({
  execFile: execFileMock,
  spawn: spawnMock,
}));

const tempRoots = {
  dataRoot: "",
  stacksRoot: "",
};

vi.mock("@/lib/server/storage/data-root", () => ({
  resolveDataRootDirectory: () => tempRoots.dataRoot,
  resolveStoreStacksRoot: () => tempRoots.stacksRoot,
}));

vi.mock("@/lib/server/env", () => ({
  serverEnv: serverEnvMock,
}));

import {
    buildRestoreShellCommand,
    getSystemBackupAvailability,
    getSystemBackupsSnapshot,
    parseSystemRestoreOutcome,
    resolveManagedBackupRoot,
    runSystemBackupNow,
    scheduleSystemBackupRestore,
} from "@/lib/server/modules/system/backup-service";

function resolveExecFileCallback(args: unknown[]) {
  const maybeCallback = args.at(-1);
  if (typeof maybeCallback !== "function") {
    throw new Error("Expected execFile callback");
  }

  return maybeCallback as (
    error: Error | null,
    stdout?: string,
    stderr?: string,
  ) => void;
}

function mockExecFileForBackup() {
  execFileMock.mockImplementation(
    (command: string, args: string[], ...rest: unknown[]) => {
      const callback = resolveExecFileCallback(rest);

      if (command === "systemctl") {
        callback(new Error("disabled"));
        return;
      }

      if (command === "pg_dump") {
        const dumpIndex = args.indexOf("--file");
        void writeFile(args[dumpIndex + 1]!, "db-dump").then(() => {
          callback(null, "", "");
        });
        return;
      }

      if (command === "tar") {
        void writeFile(args[1]!, "archive").then(() => {
          callback(null, "", "");
        });
        return;
      }

      callback(null, "", "");
    },
  );
}

describe("backup-service", () => {
  beforeEach(async () => {
    execFileMock.mockReset();
    spawnMock.mockReset();

    const root = await mkdtemp(path.join(os.tmpdir(), "homeio-backup-"));
    tempRoots.dataRoot = path.join(root, "DATA");
    tempRoots.stacksRoot = path.join(tempRoots.dataRoot, "Apps");
    await mkdir(tempRoots.stacksRoot, { recursive: true });
    await writeFile(
      path.join(root, "package.json"),
      JSON.stringify({ version: "0.1.72" }),
    );
    process.chdir(root);
    serverEnvMock.STORE_APP_DATA_ROOT = path.join(
      tempRoots.dataRoot,
      "AppData",
    );
    serverEnvMock.FILES_ROOT = tempRoots.dataRoot;
    serverEnvMock.NODE_ENV = "test";
  });

  it("pins the managed backup root to /DATA in production", () => {
    serverEnvMock.NODE_ENV = "production";

    expect(resolveManagedBackupRoot()).toBe("/DATA/Backups/homeio");
  });

  it("creates an archive manifest and prunes old backups beyond retention", async () => {
    mockExecFileForBackup();

    const backupRoot = resolveManagedBackupRoot();
    await mkdir(backupRoot, { recursive: true });

    for (let index = 0; index < 8; index += 1) {
      const id = `backup-old-${index}`;
      await writeFile(path.join(backupRoot, `${id}.tar.gz`), "old");
      await writeFile(
        path.join(backupRoot, `${id}.manifest.json`),
        JSON.stringify({
          id,
          createdAt: `2026-03-0${index + 1}T09:00:00.000Z`,
          sizeBytes: 3,
          appVersion: "0.1.71",
          hostname: "old-host",
          backupPath: path.join(backupRoot, `${id}.tar.gz`),
          dbDumpIncluded: true,
          dataRootIncluded: true,
          stacksRootIncluded: true,
          storeConfigIncluded: true,
          status: "completed",
        }),
      );
    }

    const backup = await runSystemBackupNow();

    expect(backup.id).toContain("backup-");
    const manifestRaw = await readFile(
      path.join(backupRoot, `${backup.id}.manifest.json`),
      "utf8",
    );
    const manifest = JSON.parse(manifestRaw);
    expect(manifest.backupPath).toBe(
      path.join(backupRoot, `${backup.id}.tar.gz`),
    );
    // stacks root is inside data root — should NOT be marked as separately archived
    expect(manifest.stacksRootIncluded).toBe(false);
    await expect(
      stat(path.join(backupRoot, "backup-old-0.tar.gz")),
    ).rejects.toBeTruthy();
  });

  it("marks stacksRootIncluded true only when stacks root is external and exists", async () => {
    const externalStacksRoot = path.join(tempRoots.dataRoot, "..", "ext-stacks");
    tempRoots.stacksRoot = externalStacksRoot;
    await mkdir(externalStacksRoot, { recursive: true });
    mockExecFileForBackup();

    const backupRoot = resolveManagedBackupRoot();
    await mkdir(backupRoot, { recursive: true });

    const backup = await runSystemBackupNow();

    const manifestRaw = await readFile(
      path.join(backupRoot, `${backup.id}.manifest.json`),
      "utf8",
    );
    expect(JSON.parse(manifestRaw).stacksRootIncluded).toBe(true);
  });

  it("lists settings and backups from the managed backup root", async () => {
    const backupRoot = resolveManagedBackupRoot();
    await mkdir(backupRoot, { recursive: true });
    await writeFile(
      path.join(backupRoot, "backup-1.manifest.json"),
      JSON.stringify({
        id: "backup-1",
        createdAt: "2026-03-08T09:00:00.000Z",
        sizeBytes: 10,
        appVersion: "0.1.72",
        hostname: "home-node",
        backupPath: path.join(backupRoot, "backup-1.tar.gz"),
        dbDumpIncluded: true,
        dataRootIncluded: true,
        stacksRootIncluded: true,
        storeConfigIncluded: true,
        status: "completed",
      }),
    );
    execFileMock.mockImplementation((...rest: unknown[]) => {
      const callback = resolveExecFileCallback(rest);
      callback(new Error("disabled"));
    });

    const snapshot = await getSystemBackupsSnapshot();

    expect(snapshot.backups).toHaveLength(1);
    expect(snapshot.backupRoot).toBe(backupRoot);
  });

  it("builds a restore command and schedules it for valid backups", async () => {
    const backupRoot = resolveManagedBackupRoot();
    await mkdir(backupRoot, { recursive: true });
    await writeFile(path.join(backupRoot, "backup-1.tar.gz"), "archive");
    await writeFile(
      path.join(backupRoot, "backup-1.manifest.json"),
      JSON.stringify({
        id: "backup-1",
        createdAt: "2026-03-08T09:00:00.000Z",
        sizeBytes: 10,
        appVersion: "0.1.72",
        hostname: "home-node",
        backupPath: path.join(backupRoot, "backup-1.tar.gz"),
        dbDumpIncluded: true,
        dataRootIncluded: true,
        stacksRootIncluded: true,
        storeConfigIncluded: true,
        status: "completed",
      }),
    );
    // All execFile calls fail EXCEPT systemd-run (which schedules the restore).
    execFileMock.mockImplementation((...rest: unknown[]) => {
      const cmd = rest[0] as string;
      const callback = resolveExecFileCallback(rest);
      if (cmd === "systemd-run") {
        callback(null);
      } else {
        callback(new Error("disabled"));
      }
    });

    const accepted = await scheduleSystemBackupRestore("backup-1");

    expect(accepted.backupId).toBe("backup-1");
    const command = buildRestoreShellCommand({
      id: "backup-1",
      createdAt: "2026-03-08T09:00:00.000Z",
      sizeBytes: 10,
      appVersion: "0.1.72",
      hostname: "home-node",
      backupPath: path.join(backupRoot, "backup-1.tar.gz"),
      dbDumpIncluded: true,
      dataRootIncluded: true,
      stacksRootIncluded: true,
      storeConfigIncluded: true,
      status: "completed",
    });
    expect(command).toContain("docker compose -f");
    expect(command).toContain("set -Eeuo pipefail");
    expect(command).toContain("systemctl stop home-server.service || true");
    expect(command).toContain("DROP SCHEMA IF EXISTS public CASCADE");
    expect(command).toContain("psql");
    expect(command).toContain("systemctl reboot");
  });

  it("restores without being able to destroy what it cannot replace", async () => {
    const command = buildRestoreShellCommand({
      id: "backup-guard",
      createdAt: "2026-03-08T09:00:00.000Z",
      sizeBytes: 10,
      appVersion: "0.1.72",
      hostname: "home-node",
      backupPath: "/DATA/Backups/homeio/backup-guard.tar.gz",
      dbDumpIncluded: true,
      dataRootIncluded: true,
      stacksRootIncluded: true,
      storeConfigIncluded: true,
      status: "completed",
    });

    const restoreRoot = "/var/tmp/homeio-restore-backup-guard";

    // The dump has to be there before anything is deleted; an archive without
    // one used to take the database with it.
    expect(command).toContain(`test -s '${restoreRoot}/db/database.sql'`);
    expect(command.indexOf("test -s")).toBeLessThan(command.indexOf("rm -rf {} +"));

    // drizzle holds the migration journal outside `public`; leaving it behind
    // made the dump's own CREATE SCHEMA fail 25 lines in.
    expect(command).toContain("DROP SCHEMA IF EXISTS drizzle CASCADE");

    // Reset and reload as one transaction, so a failure rolls back rather than
    // leaving an empty database.
    expect(command).toContain("--single-transaction");

    // Backups live under the data root but are excluded from the archive, so
    // wiping it wholesale destroyed every backup, including this one.
    expect(command).toContain("! -name 'Backups'");

    // And the reset has to come before the dump in the same file, or the
    // transaction would load into a schema it is about to drop.
    const combined = command.indexOf("printf '%s");
    expect(combined).toBeGreaterThan(-1);
    expect(combined).toBeLessThan(command.indexOf("--single-transaction"));
  });

  it("uses FILES_ROOT as the managed data snapshot root when it differs from stacks", async () => {
    const root = await mkdtemp(
      path.join(os.tmpdir(), "homeio-backup-files-root-"),
    );
    tempRoots.dataRoot = path.join(root, "fallback-DATA");
    tempRoots.stacksRoot = "/var/lib/home-server/stacks";
    serverEnvMock.STORE_APP_DATA_ROOT = "/DATA/AppData";
    serverEnvMock.FILES_ROOT = "/wrong-files-root";
    const restoreRoot = path.join("/var/tmp", "homeio-restore-backup-2");

    const command = buildRestoreShellCommand({
      id: "backup-2",
      createdAt: "2026-03-08T09:00:00.000Z",
      sizeBytes: 10,
      appVersion: "0.1.72",
      hostname: "home-node",
      backupPath: "/DATA/Backups/homeio/backup-2.tar.gz",
      dbDumpIncluded: true,
      dataRootIncluded: true,
      stacksRootIncluded: true,
      storeConfigIncluded: true,
      status: "completed",
    });

    // Backups sit outside this data root here, so there is nothing to spare
    // and the wipe stays unguarded.
    expect(command).toContain(
      "find '/DATA' -mindepth 1 -maxdepth 1 -exec rm -rf {} +",
    );
    expect(command).toContain(`cp -a '${restoreRoot}/data-root/.' '/DATA/'`);
    expect(command).toContain(
      `cp -a '${restoreRoot}/stacks-root' '/var/lib/home-server/stacks'`,
    );
  });

  it("derives the restore root from STORE_APP_DATA_ROOT even for legacy /DATA/AppData installs", () => {
    tempRoots.stacksRoot = "/var/lib/home-server/stacks";
    serverEnvMock.STORE_APP_DATA_ROOT = "/DATA/AppData";
    serverEnvMock.FILES_ROOT = "/DATA/data-root";
    const restoreRoot = path.join("/var/tmp", "homeio-restore-backup-legacy");

    const command = buildRestoreShellCommand({
      id: "backup-legacy",
      createdAt: "2026-03-08T09:00:00.000Z",
      sizeBytes: 10,
      appVersion: "0.1.72",
      hostname: "home-node",
      backupPath: "/DATA/Backups/homeio/backup-legacy.tar.gz",
      dbDumpIncluded: true,
      dataRootIncluded: true,
      stacksRootIncluded: true,
      storeConfigIncluded: true,
      status: "completed",
    });

    expect(command).toContain(
      "find '/DATA' -mindepth 1 -maxdepth 1 -exec rm -rf {} +",
    );
    expect(command).toContain(`cp -a '${restoreRoot}/data-root/.' '/DATA/'`);
  });

  it("archives the store registry when it sits outside the data root", async () => {
    // Mirrors a real install: files under /DATA, store sources under
    // /var/lib/home-server/AppStore. Restoring used to bring the files and the
    // database back while dropping every catalog source the user had added.
    const filesRoot = path.join(tempRoots.dataRoot, "..", "DATA2");
    serverEnvMock.STORE_APP_DATA_ROOT = path.join(filesRoot, "AppData");
    await mkdir(path.join(tempRoots.dataRoot, "AppStore"), { recursive: true });
    mockExecFileForBackup();

    const backupRoot = resolveManagedBackupRoot();
    await mkdir(backupRoot, { recursive: true });

    const backup = await runSystemBackupNow();

    const tarArgs = execFileMock.mock.calls.find(
      ([command]) => command === "tar",
    )?.[1] as string[];
    expect(tarArgs).toContain("store-config");

    const manifestRaw = await readFile(
      path.join(backupRoot, `${backup.id}.manifest.json`),
      "utf8",
    );
    expect(JSON.parse(manifestRaw).storeConfigIncluded).toBe(true);

    const command = buildRestoreShellCommand(backup);
    const restoreRoot = `/var/tmp/homeio-restore-${backup.id}`;
    expect(command).toContain(
      `cp -a '${restoreRoot}/store-config' '${path.join(tempRoots.dataRoot, "AppStore")}'`,
    );
  });

  it("leaves the store registry alone for archives that predate it", async () => {
    const command = buildRestoreShellCommand({
      id: "backup-legacy",
      createdAt: "2026-03-08T09:00:00.000Z",
      sizeBytes: 10,
      appVersion: "0.1.72",
      hostname: "home-node",
      backupPath: "/DATA/Backups/homeio/backup-legacy.tar.gz",
      dbDumpIncluded: true,
      dataRootIncluded: true,
      stacksRootIncluded: true,
      storeConfigIncluded: false,
      status: "completed",
    });

    // The copy is guarded on the archive actually carrying the member, so an
    // older backup must not wipe the sources that are on disk today.
    expect(command).toContain(
      "if [ -d '/var/tmp/homeio-restore-backup-legacy/store-config' ]; then",
    );
  });

  it("brings the stacks back up before rebooting", async () => {
    const command = buildRestoreShellCommand({
      id: "backup-stacks",
      createdAt: "2026-03-08T09:00:00.000Z",
      sizeBytes: 10,
      appVersion: "0.1.72",
      hostname: "home-node",
      backupPath: "/DATA/Backups/homeio/backup-stacks.tar.gz",
      dbDumpIncluded: true,
      dataRootIncluded: true,
      stacksRootIncluded: true,
      storeConfigIncluded: true,
      status: "completed",
    });

    // `docker compose down` removes the containers, so without this a
    // successful restore left no container for a restart policy to revive.
    const restartIndex = command.lastIndexOf("restart_existing_stacks");
    const rebootIndex = command.indexOf("systemctl reboot");
    const downIndex = command.indexOf("compose_stacks down");
    expect(downIndex).toBeGreaterThan(-1);
    expect(restartIndex).toBeGreaterThan(downIndex);
    expect(restartIndex).toBeLessThan(rebootIndex);
  });

  it("says which tools this host lacks before anyone presses a button", async () => {
    // The Docker image: tar is there, pg_dump, psql and systemd-run are not.
    const installed = new Set(["tar"]);
    execFileMock.mockImplementation((command: string, args: string[], ...rest: unknown[]) => {
      const callback = resolveExecFileCallback(rest);
      if (command === "which" && installed.has(args[0]!)) {
        callback(null, `/usr/bin/${args[0]}\n`, "");
        return;
      }
      // `which` says "not found" by exiting 1 with nothing on stdout.
      callback(Object.assign(new Error("which failed"), { code: 1 }), "", "");
    });

    const availability = await getSystemBackupAvailability();

    expect(availability.runNow).toEqual({
      available: false,
      reason: "Backing up needs pg_dump, which is not installed on this host.",
    });
    expect(availability.restore).toEqual({
      available: false,
      reason: "Restoring needs systemd-run and psql, which are not installed on this host.",
    });

    installed.add("pg_dump").add("psql").add("systemd-run");
    expect(await getSystemBackupAvailability()).toEqual({
      runNow: { available: true, reason: null },
      restore: { available: true, reason: null },
    });
  });

  describe("running the restore script", () => {
    // These run the generated script under bash, against real directories, with
    // docker, psql and systemctl replaced by stubs that record what they were
    // asked. Asserting on the text of the script is what let a restore that
    // wiped the database pass 1327 tests; this asserts on what it does.
    type Run = {
      status: number | null;
      calls: string[];
      /** What the script wrote for the server to read back, as the server reads it. */
      outcome: ReturnType<typeof parseSystemRestoreOutcome>;
      dataRoot: string;
      stacksRoot: string;
      composePath: string;
    };

    async function runRestore(options: {
      dump: string | null;
      knownStacks: (stacksRoot: string) => string[];
    }): Promise<Run> {
      const { spawnSync } = await vi.importActual<typeof ChildProcess>("node:child_process");
      const root = await mkdtemp(path.join(os.tmpdir(), "homeio-restore-run-"));
      const bin = path.join(root, "bin");
      const callLog = path.join(root, "calls.log");
      const restoreLog = path.join(root, "restore.log");
      const archiveSource = path.join(root, "archive");
      tempRoots.stacksRoot = path.join(root, "stacks");
      serverEnvMock.STORE_APP_DATA_ROOT = path.join(tempRoots.dataRoot, "AppData");
      const composePath = path.join(tempRoots.stacksRoot, "uptimekuma", "docker-compose.yml");

      // Today's machine: a file the archive does not have, one stack Homeio
      // runs under a project name its file does not carry, and one with no row.
      await mkdir(path.join(tempRoots.dataRoot, "Documents"), { recursive: true });
      await writeFile(path.join(tempRoots.dataRoot, "Documents", "today.txt"), "today");
      await mkdir(path.dirname(composePath), { recursive: true });
      await writeFile(composePath, "name: uptimekuma\n");
      await mkdir(path.join(tempRoots.stacksRoot, "unlisted"), { recursive: true });
      await writeFile(path.join(tempRoots.stacksRoot, "unlisted", "docker-compose.yml"), "services: {}\n");

      await mkdir(path.join(archiveSource, "db"), { recursive: true });
      if (options.dump !== null) {
        await writeFile(path.join(archiveSource, "db", "database.sql"), options.dump);
      }
      await mkdir(path.join(archiveSource, "data-root", "Documents"), { recursive: true });
      await writeFile(path.join(archiveSource, "data-root", "Documents", "archived.txt"), "archived");

      const backupRoot = resolveManagedBackupRoot();
      await mkdir(backupRoot, { recursive: true });
      const id = `backup-run-${path.basename(root)}`;
      const backupPath = path.join(backupRoot, `${id}.tar.gz`);
      spawnSync("tar", ["-czf", backupPath, "-C", archiveSource, "db", "data-root"]);

      const known = options.knownStacks(tempRoots.stacksRoot).join("\\n");
      const stubs: Record<string, string> = {
        // Every stub records its arguments, one call per line.
        docker: `echo "docker $*" >> ${callLog}`,
        systemctl: `echo "systemctl $*" >> ${callLog}`,
        // A stub psql that answers the stack query, and fails any file that
        // carries the word BROKEN the way a real one fails a syntax error.
        psql: [
          `echo "psql $*" >> ${callLog}`,
          `for arg in "$@"; do case "$arg" in *"SELECT compose_path"*) printf '${known}\\n'; exit 0;; esac; done`,
          `prev=""; for arg in "$@"; do if [ "$prev" = "-f" ] && grep -q BROKEN "$arg"; then echo "syntax error at or near BROKEN" >&2; exit 3; fi; prev="$arg"; done`,
        ].join("\n"),
        sleep: "exit 0",
        date: "echo 2026-09-25T00:00:00+00:00",
      };
      await mkdir(bin, { recursive: true });
      for (const [name, body] of Object.entries(stubs)) {
        await writeFile(path.join(bin, name), `#!/bin/bash\n${body}\n`, { mode: 0o755 });
      }

      const command = buildRestoreShellCommand({
        id,
        createdAt: "2026-09-24T22:18:11.000Z",
        sizeBytes: 1,
        appVersion: "2.0.90",
        hostname: "home-node",
        backupPath,
        dbDumpIncluded: true,
        dataRootIncluded: true,
        stacksRootIncluded: false,
        storeConfigIncluded: false,
        status: "completed",
      }, "restore-under-test")
        .replace("/var/log/homeio-restore.log", restoreLog)
        .replaceAll("/var/lib/homeio", path.join(root, "state"));

      const result = spawnSync("bash", ["-c", command], {
        env: { ...process.env, PATH: `${bin}:${process.env.PATH}` },
        encoding: "utf8",
      });
      const calls = await readFile(callLog, "utf8").then((raw) => raw.trim().split("\n"), () => []);
      // A failed restore leaves its extraction behind; do not leave it on the
      // machine running the tests.
      await rm(path.join("/var/tmp", `homeio-restore-${id}`), { recursive: true, force: true });

      const outcome = await readFile(path.join(root, "state", "restore-status.json"), "utf8").then(
        parseSystemRestoreOutcome,
        () => null,
      );

      return {
        status: result.status,
        calls,
        outcome,
        dataRoot: tempRoots.dataRoot,
        stacksRoot: tempRoots.stacksRoot,
        composePath,
      };
    }

    async function exists(file: string) {
      return stat(file).then(() => true, () => false);
    }

    it("stops and restarts a stack under the project name Homeio runs it as", async () => {
      const run = await runRestore({
        dump: "CREATE TABLE t ();\n",
        knownStacks: (stacksRoot) => [
          `${path.join(stacksRoot, "uptimekuma", "docker-compose.yml")}|uptime-kuma`,
        ],
      });

      expect(run.status).toBe(0);
      const unlisted = path.join(run.stacksRoot, "unlisted", "docker-compose.yml");
      const down = run.calls.indexOf(`docker compose -p uptime-kuma -f ${run.composePath} down`);
      const up = run.calls.indexOf(`docker compose -p uptime-kuma -f ${run.composePath} up -d`);
      expect(down).toBeGreaterThan(-1);
      expect(up).toBeGreaterThan(down);
      // A stack the database does not know keeps the file's own project name.
      expect(run.calls).toContain(`docker compose -f ${unlisted} down`);
      expect(run.calls).toContain(`docker compose -f ${unlisted} up -d`);
      expect(run.calls.at(-1)).toBe("systemctl reboot");
    });

    it("refuses a dump that does not load before touching anything on disk", async () => {
      const run = await runRestore({
        dump: "CREATE TABLE t ();\nBROKEN half a statement\n",
        knownStacks: () => [],
      });

      expect(run.status).not.toBe(0);
      // Today's files are still there and the archive's never arrived.
      expect(await exists(path.join(run.dataRoot, "Documents", "today.txt"))).toBe(true);
      expect(await exists(path.join(run.dataRoot, "Documents", "archived.txt"))).toBe(false);
      // The real load never ran, and the machine was not rebooted.
      expect(run.calls.some((call) => call.includes("--single-transaction"))).toBe(false);
      expect(run.calls).not.toContain("systemctl reboot");
      // The recovery trap brought the service and the stacks back.
      expect(run.calls).toContain("systemctl start home-server.service");
      expect(run.calls.some((call) => call.endsWith("up -d"))).toBe(true);
      // And it says so, in a form the server reads back after it restarts.
      expect(run.outcome).toMatchObject({
        restoreId: "restore-under-test",
        status: "failed",
        step: "rehearsing",
        exitCode: 3,
      });
      expect(run.outcome?.message).toContain("Nothing was changed");
    });

    it("records an archive without a dump as failing before any change", async () => {
      const run = await runRestore({ dump: null, knownStacks: () => [] });

      expect(run.status).not.toBe(0);
      expect(await exists(path.join(run.dataRoot, "Documents", "today.txt"))).toBe(true);
      expect(run.outcome).toMatchObject({ status: "failed", step: "checking-dump" });
      expect(run.outcome?.message).toContain("has no database dump");
    });

    it("replaces the files and loads the dump when it does load", async () => {
      const run = await runRestore({ dump: "CREATE TABLE t ();\n", knownStacks: () => [] });

      expect(run.status).toBe(0);
      expect(await exists(path.join(run.dataRoot, "Documents", "today.txt"))).toBe(false);
      expect(await exists(path.join(run.dataRoot, "Documents", "archived.txt"))).toBe(true);
      // The rehearsal comes first and loads nothing; the real load comes after
      // the files, as one transaction.
      const rehearsal = run.calls.findIndex((call) => call.endsWith("rehearsal.sql"));
      const load = run.calls.findIndex((call) => call.includes("--single-transaction"));
      expect(rehearsal).toBeGreaterThan(-1);
      expect(load).toBeGreaterThan(rehearsal);
      expect(run.calls).toContain("systemctl reboot");
      expect(run.outcome).toMatchObject({ status: "completed", step: "restarting-apps", exitCode: 0 });
    });
  });

  it("skips copying an external stacks root when it does not exist", async () => {
    tempRoots.stacksRoot = path.join(
      tempRoots.dataRoot,
      "..",
      "missing-stacks",
    );

    mockExecFileForBackup();

    await runSystemBackupNow();

    const tarInvocation = execFileMock.mock.calls.find(
      ([command]) => command === "tar",
    );
    expect(tarInvocation).toBeDefined();

    const tarArgs = tarInvocation?.[1] as string[];
    expect(tarArgs).not.toContain("stacks-root");
  });
});
