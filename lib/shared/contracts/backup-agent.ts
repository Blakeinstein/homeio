/**
 * homelab-backup (https://github.com/Blakeinstein/homelab-backup) is a
 * standalone backup agent that runs as its own systemd service alongside
 * Homeio rather than as a container. Homeio doesn't drive it: once enabled in
 * Settings, it only recognizes that it's configured and links out to its own
 * dashboard.
 */
export type BackupAgentConfig = {
  enabled: boolean;
  /** Dashboard URL override; null uses HOMELAB_BACKUP_URL, then the agent's own default. */
  url: string | null;
  /** backup-services.yaml path override; null auto-detects under QUADLET_SERVICES_ROOT/homelab-backup/. */
  configPath: string | null;
};

export type BackupAgentConfigResponse = {
  data: BackupAgentConfig;
};

export type BackupAgentStatus = {
  enabled: boolean;
  /** Whether a backup-services.yaml was found at the resolved config path; null when disabled or no path could be resolved. */
  configFound: boolean | null;
  /** The agent's own dashboard/stats URL, null when disabled. */
  dashboardUrl: string | null;
  /** Whether that URL answered just now; null when disabled. */
  reachable: boolean | null;
};

export type BackupAgentStatusResponse = {
  data: BackupAgentStatus;
};
