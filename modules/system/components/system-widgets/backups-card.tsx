import { ExternalLink, FileArchive } from "@/components/icons/platform-icons";
import type { BackupAgentWidgetData } from "@/modules/system/components/system-widgets/types";
import { WidgetCard } from "@/modules/system/components/system-widgets/widget-card";

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
  if (!backupAgent.enabled || !backupAgent.dashboardUrl) return null;

  const reachable = backupAgent.reachable === true;

  return (
    <WidgetCard title="Backups" icon={FileArchive}>
      <div className="flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <span className="text-xs text-muted-foreground">homelab-backup</span>
          <span
            className={`inline-flex items-center gap-1.5 text-xs font-medium ${
              reachable ? "text-status-green" : "text-status-red"
            }`}
          >
            <span
              className={`size-1.5 rounded-full ${reachable ? "bg-status-green" : "bg-status-red"}`}
            />
            {reachable ? "Reachable" : "Unreachable"}
          </span>
        </div>

        <a
          href={backupAgent.dashboardUrl}
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
