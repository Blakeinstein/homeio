/**
 * homelab-backup (https://github.com/Blakeinstein/homelab-backup) is a
 * standalone backup agent that runs as its own systemd service alongside
 * Homeio rather than as a container. Homeio doesn't drive it: once enabled in
 * Settings, it only recognizes that it's configured and links out to its own
 * dashboard.
 */
export type BackupAgentConfig = {
  enabled: boolean;
  /** Absolute dashboard URL override; wins over `port` when both are set. Null uses HOMELAB_BACKUP_URL, then the agent's own default. */
  url: string | null;
  /**
   * Reach the dashboard on this port using whatever host/protocol the
   * browser is already viewing Homeio on, instead of a fixed URL -- the
   * right choice whenever Homeio is reached over Tailscale, a tunnel, or a
   * LAN IP rather than 127.0.0.1. Ignored when `url` is set.
   */
  port: number | null;
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
  /** Absolute dashboard URL; null when `relativePort` should be used to build one instead, or when disabled. */
  dashboardUrl: string | null;
  /** Port to combine with the browser's own protocol and hostname; null when `dashboardUrl` is already absolute, or when disabled. */
  relativePort: number | null;
};

export type BackupAgentStatusResponse = {
  data: BackupAgentStatus;
};
