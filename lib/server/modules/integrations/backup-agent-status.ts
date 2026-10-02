import "server-only";

import { access } from "node:fs/promises";
import path from "node:path";
import { memoizeAsync } from "@/lib/server/cache/memoize-async";
import { serverEnv } from "@/lib/server/env";
import { getBackupAgentConfig } from "@/lib/server/modules/integrations/backup-agent-config";
import type { BackupAgentStatus } from "@/lib/shared/contracts/backup-agent";

// homelab-backup's own README has it live at <QUADLET_SERVICES_ROOT>/homelab-backup,
// alongside the podman quadlet service folders, even though it isn't one itself.
const BACKUP_AGENT_DIR_NAME = "homelab-backup";
const BACKUP_AGENT_CONFIG_FILE = "backup-services.yaml";
// From homelab-backup's README: `bin/homelab-backup serve` defaults to this.
const DEFAULT_BACKUP_AGENT_URL = "http://127.0.0.1:3095";
const REACHABILITY_TIMEOUT_MS = 2_000;
const STATUS_TTL_MS = 10_000;

function defaultConfigPath(): string | null {
  const servicesRoot = serverEnv.QUADLET_SERVICES_ROOT;
  if (!servicesRoot) return null;
  return path.join(servicesRoot, BACKUP_AGENT_DIR_NAME, BACKUP_AGENT_CONFIG_FILE);
}

async function fileExists(filePath: string): Promise<boolean> {
  return access(filePath)
    .then(() => true)
    .catch(() => false);
}

async function checkReachable(url: string): Promise<boolean> {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(REACHABILITY_TIMEOUT_MS) });
    return response.ok;
  } catch {
    return false;
  }
}

async function loadBackupAgentStatus(): Promise<BackupAgentStatus> {
  const config = await getBackupAgentConfig();
  if (!config.enabled) {
    return { enabled: false, configFound: null, dashboardUrl: null, reachable: null };
  }

  const configPath = config.configPath ?? defaultConfigPath();
  const dashboardUrl = config.url ?? serverEnv.HOMELAB_BACKUP_URL ?? DEFAULT_BACKUP_AGENT_URL;

  const [configFound, reachable] = await Promise.all([
    configPath ? fileExists(configPath) : Promise.resolve(false),
    checkReachable(dashboardUrl),
  ]);

  return { enabled: true, configFound, dashboardUrl, reachable };
}

const getBackupAgentStatusCached = memoizeAsync(loadBackupAgentStatus, STATUS_TTL_MS);

export function getBackupAgentStatus(): Promise<BackupAgentStatus> {
  return getBackupAgentStatusCached();
}

/** Called right after Settings saves the config, so the widget doesn't wait out the cache TTL. */
export function invalidateBackupAgentStatusCache() {
  getBackupAgentStatusCached.invalidate();
}
