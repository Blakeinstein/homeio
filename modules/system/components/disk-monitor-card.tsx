"use client";

import { HardDrive } from "@/components/icons/platform-icons";
import { formatBytesCompact } from "@/lib/client/format";
import type { DiskMediaType, DiskMonitorEntry } from "@/lib/shared/contracts/disks";
import { PANEL_INSET } from "@/lib/ui/surface-tokens";
import { cn } from "@/lib/utils";

const MEDIA_LABEL: Record<DiskMediaType, string> = {
  ssd: "SSD",
  hdd: "HDD",
  nvme: "NVMe",
  removable: "Removable",
  unknown: "Disk",
};

export function formatMegabytesPerSecond(value: number) {
  return `${value < 10 ? value.toFixed(2) : value.toFixed(1)} MB/s`;
}

function formatPowerOn(hours: number) {
  return hours >= 48 ? `${Math.round(hours / 24).toLocaleString()} days` : `${hours} h`;
}

function Badge({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <span className={cn("rounded px-1.5 py-px text-[10px] font-medium", className ?? "bg-muted/40 text-muted-foreground")}>
      {children}
    </span>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3 py-1.5">
      <span className="shrink-0 text-xs text-muted-foreground">{label}</span>
      <span className="truncate font-mono text-xs text-foreground" title={value}>
        {value}
      </span>
    </div>
  );
}

// VM disks report a PCI id such as 0x1af4 instead of a vendor or model name.
function readableName(value: string | null) {
  return value && !/^0x[0-9a-f]+$/i.test(value) ? value : null;
}

export function DiskMonitorCard({ disk, inContainer = false }: { disk: DiskMonitorEntry; inContainer?: boolean }) {
  const health =
    disk.health === "healthy"
      ? { label: "Healthy", className: "bg-status-green/12 text-status-green" }
      : disk.health === "degraded"
        ? { label: "Failing", className: "bg-status-red/12 text-status-red" }
        : null;

  return (
    <div className={cn(PANEL_INSET, "flex flex-col gap-2 p-3")}>
      <div className="flex items-center gap-2">
        <div className="flex size-7 shrink-0 items-center justify-center rounded-lg border border-glass-border bg-background/55">
          <HardDrive className="size-3.5 text-chart-4" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <span className="truncate font-mono text-sm font-medium text-foreground">{disk.device}</span>
            <Badge>{MEDIA_LABEL[disk.mediaType]}</Badge>
            {/* NVMe disks report nvme as their bus too; one badge is enough. */}
            {disk.transport && disk.transport.toUpperCase() !== MEDIA_LABEL[disk.mediaType].toUpperCase() ? (
              <Badge>{disk.transport.toUpperCase()}</Badge>
            ) : null}
          </div>
          <span className="block truncate text-[11px] text-muted-foreground/70">
            {[readableName(disk.vendor), readableName(disk.model)].filter(Boolean).join(" ") || "Unknown model"}
          </span>
        </div>
        {health ? <Badge className={health.className}>{health.label}</Badge> : null}
      </div>

      <div className="grid grid-cols-2 gap-2">
        {[
          { label: "Read", value: disk.readBytesPerSec, color: "text-chart-4" },
          { label: "Write", value: disk.writeBytesPerSec, color: "text-status-amber" },
        ].map(({ label, value, color }) => (
          <div key={label} className={cn(PANEL_INSET, "flex flex-col gap-0.5 px-3 py-2")}>
            <span className="text-[10px] uppercase tracking-[0.12em] text-muted-foreground/60">{label}</span>
            <span className={cn("font-mono text-sm font-semibold tabular-nums", color)}>
              {value === null ? "--" : formatMegabytesPerSecond(value / 1_000_000)}
            </span>
          </div>
        ))}
      </div>

      <div className="divide-y divide-glass-border/40">
        <Row label="Size" value={disk.sizeBytes === null ? "--" : formatBytesCompact(disk.sizeBytes)} />
        <Row
          label="Temperature"
          value={disk.temperatureCelsius === null ? "Not reported" : `${disk.temperatureCelsius} °C`}
        />
        {disk.powerOnHours !== null ? <Row label="Powered on" value={formatPowerOn(disk.powerOnHours)} /> : null}
        {disk.partitions.map((partition) => (
          <Row
            key={partition.name}
            label={partition.name}
            value={[
              // The container cannot see where the host mounts it.
              inContainer ? null : (partition.mountpoint ?? "not mounted"),
              partition.fstype,
              partition.sizeBytes === null ? null : formatBytesCompact(partition.sizeBytes),
            ]
              .filter(Boolean)
              .join(" · ")}
          />
        ))}
      </div>
    </div>
  );
}
