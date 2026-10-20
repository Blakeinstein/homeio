import type { BackupAgentStatus } from "@/lib/shared/contracts/backup-agent";

/**
 * The actual link to open for homelab-backup's dashboard. An absolute URL
 * always wins; otherwise, a relative port is combined with whatever
 * host/protocol the browser is using right now, the same way a regular
 * app's `webUiPort` becomes a link (see `resolveAppActionTarget`). Resolving
 * this on the client, rather than once on the server, is what makes a
 * relative port work at all when Homeio itself is reached over Tailscale, a
 * tunnel, or a LAN IP instead of 127.0.0.1.
 */
export function resolveBackupAgentDashboardUrl(
  status: Pick<BackupAgentStatus, "dashboardUrl" | "relativePort">,
): string | null {
  if (status.dashboardUrl) return status.dashboardUrl;

  if (status.relativePort !== null) {
    const protocol = typeof window !== "undefined" ? window.location.protocol : "http:";
    const hostname = typeof window !== "undefined" ? window.location.hostname : "localhost";
    return `${protocol}//${hostname}:${status.relativePort}`;
  }

  return null;
}
