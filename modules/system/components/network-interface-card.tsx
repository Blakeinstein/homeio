"use client";

import { Network, Router, Shield, Wifi } from "@/components/icons/platform-icons";
import { formatBytesCompact } from "@/lib/client/format";
import type { NetworkInterfaceKind, NetworkInterfaceOverview } from "@/lib/shared/contracts/network";
import { PANEL_INSET } from "@/lib/ui/surface-tokens";
import { cn } from "@/lib/utils";

const KIND_LABEL: Record<NetworkInterfaceKind, string> = {
  wired: "Wired",
  wireless: "Wi-Fi",
  vpn: "VPN",
  other: "Other",
};

const KIND_ICON: Record<NetworkInterfaceKind, React.ComponentType<{ className?: string }>> = {
  wired: Router,
  wireless: Wifi,
  vpn: Shield,
  other: Network,
};

export function formatMbps(value: number) {
  return `${value < 10 ? value.toFixed(2) : value.toFixed(1)} Mbps`;
}

function Row({ label, value, warn }: { label: string; value: string; warn?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-3 py-1.5">
      <span className="shrink-0 text-xs text-muted-foreground">{label}</span>
      <span
        className={cn("truncate font-mono text-xs text-foreground", warn && "text-status-amber")}
        title={value}
      >
        {value}
      </span>
    </div>
  );
}

type NetworkInterfaceCardProps = {
  iface: NetworkInterfaceOverview;
  /** Wi-Fi details, when this interface is the connected wireless one. */
  wifi?: { ssid: string | null; signalPercent: number | null } | null;
};

export function NetworkInterfaceCard({ iface, wifi }: NetworkInterfaceCardProps) {
  const Icon = KIND_ICON[iface.kind];
  const errors = (iface.rxErrors ?? 0) + (iface.txErrors ?? 0);
  const dropped = (iface.rxDropped ?? 0) + (iface.txDropped ?? 0);

  const rows: { label: string; value: string; warn?: boolean }[] = [];
  if (wifi?.ssid) rows.push({ label: "Network", value: wifi.ssid });
  if (wifi?.signalPercent !== undefined && wifi?.signalPercent !== null) {
    rows.push({ label: "Signal", value: `${wifi.signalPercent}%` });
  }
  if (iface.ip4) {
    rows.push({ label: "IPv4", value: iface.ip4Subnet ? `${iface.ip4} / ${iface.ip4Subnet}` : iface.ip4 });
  }
  if (iface.ip6) rows.push({ label: "IPv6", value: iface.ip6 });
  if (iface.mac) rows.push({ label: "MAC", value: iface.mac });
  if (iface.speedMbps !== null) {
    rows.push({ label: "Link", value: `${iface.speedMbps} Mbps${iface.duplex ? ` · ${iface.duplex}` : ""}` });
  }
  if (iface.ip4) rows.push({ label: "Address", value: iface.dhcp ? "DHCP" : "Static" });
  if (iface.rxBytes !== null) rows.push({ label: "Received", value: formatBytesCompact(iface.rxBytes) });
  if (iface.txBytes !== null) rows.push({ label: "Sent", value: formatBytesCompact(iface.txBytes) });
  if (iface.rxErrors !== null || iface.txErrors !== null) {
    rows.push({ label: "Errors / dropped", value: `${errors} / ${dropped}`, warn: errors > 0 });
  }

  return (
    <div className={cn(PANEL_INSET, "flex flex-col gap-2 p-3")}>
      <div className="flex items-center gap-2">
        <div className="flex size-7 shrink-0 items-center justify-center rounded-lg border border-glass-border bg-background/55">
          <Icon className="size-3.5 text-primary" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <span className="truncate font-mono text-sm font-medium text-foreground">{iface.iface}</span>
            {iface.isDefault ? (
              <span className="rounded bg-primary/15 px-1.5 py-px text-[10px] font-medium text-primary">Default</span>
            ) : null}
          </div>
          <span className="text-[11px] text-muted-foreground/70">{KIND_LABEL[iface.kind]}</span>
        </div>
        <span
          className={cn(
            "flex items-center gap-1.5 rounded-md px-2 py-0.5 text-[11px] font-medium",
            iface.up === true
              ? "bg-status-green/12 text-status-green"
              : iface.up === false
                ? "bg-muted/40 text-muted-foreground"
                : "bg-muted/30 text-muted-foreground/70",
          )}
        >
          <span className="size-1.5 rounded-full bg-current" />
          {iface.up === true ? "Up" : iface.up === false ? "Down" : "Unknown"}
        </span>
      </div>

      {iface.up !== false ? (
        <div className="grid grid-cols-2 gap-2">
          {[
            { label: "Download", value: iface.downloadMbps, color: "text-status-green" },
            { label: "Upload", value: iface.uploadMbps, color: "text-sky-400" },
          ].map(({ label, value, color }) => (
            <div key={label} className={cn(PANEL_INSET, "flex flex-col gap-0.5 px-3 py-2")}>
              <span className="text-[10px] uppercase tracking-[0.12em] text-muted-foreground/60">{label}</span>
              <span className={cn("font-mono text-sm font-semibold tabular-nums", color)}>
                {value === null ? "--" : formatMbps(value)}
              </span>
            </div>
          ))}
        </div>
      ) : null}

      <div className="divide-y divide-glass-border/40">
        {rows.map((row) => (
          <Row key={row.label} {...row} />
        ))}
      </div>
    </div>
  );
}
