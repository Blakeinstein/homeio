"use client";

import { ExternalLink, FileArchive } from "@/components/icons/platform-icons";
import { resolveBackupAgentDashboardUrl } from "@/lib/shared/backup-agent-url";
import type { BackupAgentWidgetData } from "@/modules/system/components/system-widgets/types";
import { WidgetCard } from "@/modules/system/components/system-widgets/widget-card";
import { useUrlReachability } from "@/modules/system/hooks/useUrlReachability";

type BackupsCardProps = {
  backupAgent: BackupAgentWidgetData;
};

/**
 * homelab-backup (https://github.com/Blakeinstein/homelab-backup) runs as its
 * own systemd service, not a container Homeio drives, so there's nothing here
 * to start/stop -- just a link out to its own dashboard and whether it
 * answered just now. Renders nothing when no backup-services.yaml was found.
 */
export function BackupsCard({ backupAgent }: BackupsCardProps) {
  const dashboardUrl = backupAgent.enabled ? resolveBackupAgentDashboardUrl(backupAgent) : null;
  const reachable = useUrlReachability(dashboardUrl);

  if (!backupAgent.enabled || !dashboardUrl) return null;

  const isReachable = reachable === true;

  return (
    <WidgetCard title="Backups" icon={FileArchive}>
      <div className="flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <span className="text-xs text-muted-foreground">homelab-backup</span>
          <span
            className={`inline-flex items-center gap-1.5 text-xs font-medium ${
              reachable === null
                ? "text-muted-foreground"
                : isReachable
                  ? "text-status-green"
                  : "text-status-red"
            }`}
          >
            <span
              className={`size-1.5 rounded-full ${
                reachable === null ? "bg-muted-foreground" : isReachable ? "bg-status-green" : "bg-status-red"
              }`}
            />
            {reachable === null ? "Checking…" : isReachable ? "Reachable" : "Unreachable"}
          </span>
        </div>

        <a
          href={dashboardUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center justify-center gap-1.5 rounded-xl border border-white/[0.07] bg-white/[0.04] py-2 text-xs font-medium text-foreground/80 transition-colors hover:bg-white/[0.08]"
        >
          View backup stats
          <ExternalLink className="size-3" />
        </a>
      </div>
    </WidgetCard>
  );
}
