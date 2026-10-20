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

async function loadBackupAgentStatus(): Promise<BackupAgentStatus> {
  const config = await getBackupAgentConfig();
  if (!config.enabled) {
    return { enabled: false, configFound: null, dashboardUrl: null, relativePort: null };
  }

  const configPath = config.configPath ?? defaultConfigPath();
  const configFound = configPath ? await fileExists(configPath) : false;

  // An absolute URL always wins; a relative port only applies when no
  // absolute URL is set. Reachability isn't checked here: whether a browser
  // viewing Homeio over a LAN IP, Tailscale, or a tunnel can reach the
  // dashboard is not something the Homeio server process can answer for it
  // (least of all for a relative port, which has no fixed host at all) --
  // the client resolves the link and probes it itself.
  if (config.url) {
    return { enabled: true, configFound, dashboardUrl: config.url, relativePort: null };
  }

  if (config.port !== null) {
    return { enabled: true, configFound, dashboardUrl: null, relativePort: config.port };
  }

  return {
    enabled: true,
    configFound,
    dashboardUrl: serverEnv.HOMELAB_BACKUP_URL ?? DEFAULT_BACKUP_AGENT_URL,
    relativePort: null,
  };
}

const getBackupAgentStatusCached = memoizeAsync(loadBackupAgentStatus, STATUS_TTL_MS);

export function getBackupAgentStatus(): Promise<BackupAgentStatus> {
  return getBackupAgentStatusCached();
}

/** Called right after Settings saves the config, so the widget doesn't wait out the cache TTL. */
export function invalidateBackupAgentStatusCache() {
  getBackupAgentStatusCached.invalidate();
}
