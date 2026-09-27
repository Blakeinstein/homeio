"use client";

import { formatBytesCompact, formatUptimeShort } from "@/lib/client/format";
import { hasAnyValue, seriesStats } from "@/lib/client/metrics-history";
import {
  calculateDockerTotals,
  containerToProcess,
  getStatusBadgeColor,
} from "@/lib/client/monitor-utils";
import type { MetricsHistoryRange } from "@/lib/shared/contracts/system";
import {
  METRICS_HISTORY_RANGE_MS,
  METRICS_HISTORY_SAMPLE_MS,
  toHistoryPoint,
} from "@/lib/shared/metrics-history";
import { useMetricsHistory } from "@/modules/system/hooks/useMetricsHistory";
import {
  MetricHistoryChart,
  type ChartSeries,
} from "@/modules/system/components/metric-history-chart";
import { useDockerStats } from "@/modules/system/hooks/useDockerStats";
import { useSystemMetrics } from "@/modules/system/hooks/useSystemMetrics";
import { DiskManager } from "@/modules/system/components/disk-manager";
import {
  Activity,
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  Container,
  Cpu,
  Gauge,
  HardDrive,
  MemoryStick,
  Network,
  Search,
  Thermometer,
} from "@/components/icons/platform-icons";
import { PANEL_INSET } from "@/lib/ui/surface-tokens";
import { useMemo, useState } from "react";
import { cn } from "@/lib/utils";

type MonitorTab = "processes" | "network" | "disks";
type SortKey = "cpu" | "memory" | "network" | "disk";

const TABS: { id: MonitorTab; label: string }[] = [
  { id: "processes", label: "Processes" },
  { id: "network", label: "Network" },
  { id: "disks", label: "Disks" },
];

// ── Metric card ───────────────────────────────────────────────────────────────

function MetricCard({
  label,
  icon: Icon,
  value,
  sub,
  color,
}: {
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  value: string;
  sub: string;
  color: string;
}) {
  return (
    <div className={cn(PANEL_INSET, "flex flex-col gap-2 px-4 py-3")}>
      <div className="flex items-center justify-between">
        <span className="text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground/50">
          {label}
        </span>
        <div className={cn("flex size-6 items-center justify-center rounded-md border border-glass-border/60 bg-background/55", color)}>
          <Icon className="size-3" />
        </div>
      </div>
      <div className="font-mono text-2xl font-bold tabular-nums text-foreground">{value}</div>
      <div className="text-[11px] text-muted-foreground/70">{sub}</div>
    </div>
  );
}

// ── History card ──────────────────────────────────────────────────────────────

const RANGE_OPTIONS: { id: MetricsHistoryRange; label: string }[] = [
  { id: "15m", label: "15m" },
  { id: "1h", label: "1h" },
  { id: "24h", label: "24h" },
];

function formatPercent(value: number) {
  return `${value.toFixed(1)}%`;
}

function formatMbps(value: number) {
  return `${value < 10 ? value.toFixed(2) : value.toFixed(1)} Mbps`;
}

function formatCelsius(value: number) {
  return `${value.toFixed(0)} °C`;
}

function HistoryCard({
  icon: Icon,
  title,
  iconColor,
  rows,
  children,
}: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  iconColor: string;
  rows: { label: string; value: string }[];
  children: React.ReactNode;
}) {
  return (
    <div className={cn(PANEL_INSET, "flex flex-col gap-2 p-3")}>
      <div className="flex items-center gap-2">
        <Icon className={cn("size-3.5", iconColor)} />
        <span className="text-xs font-semibold text-foreground">{title}</span>
      </div>
      {children}
      <div className="divide-y divide-glass-border/40">
        {rows.map((r) => (
          <InfoRow key={r.label} label={r.label} value={r.value} mono />
        ))}
      </div>
    </div>
  );
}

// ── Info row ──────────────────────────────────────────────────────────────────

function InfoRow({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-center justify-between py-2">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className={cn("text-xs font-medium text-foreground", mono && "font-mono")}>{value}</span>
    </div>
  );
}

// ── Monitor ───────────────────────────────────────────────────────────────────

export function Monitor() {
  const [tab, setTab] = useState<MonitorTab>("processes");
  const [query, setQuery] = useState("");
  const [sortBy, setSortBy] = useState<SortKey>("cpu");
  const [range, setRange] = useState<MetricsHistoryRange>("15m");

  const { data: systemMetrics } = useSystemMetrics();
  const { stats: dockerStats, daemonAvailable, isConnected: dockerConnected } = useDockerStats();

  const dockerTotals = useMemo(() => calculateDockerTotals(dockerStats), [dockerStats]);

  const livePoint = useMemo(
    () =>
      systemMetrics ? toHistoryPoint(systemMetrics, Date.parse(systemMetrics.timestamp)) : null,
    [systemMetrics],
  );
  const history = useMetricsHistory(range, livePoint);
  // Re-rendered with every live frame, so the time axis keeps sliding.
  const now = livePoint?.t ?? Date.now();
  const rangeMs = METRICS_HISTORY_RANGE_MS[range];
  const chartProps = {
    points: history.points,
    rangeMs,
    now,
    gapMs: Math.max(3 * history.intervalSeconds * 1000, 3 * METRICS_HISTORY_SAMPLE_MS),
    rangeLabel: range === "15m" ? "15 min" : range === "1h" ? "1 h" : "24 h",
    formatTime: (t: number) =>
      new Date(t).toLocaleTimeString([], range === "24h"
        ? { hour: "2-digit", minute: "2-digit" }
        : { hour: "2-digit", minute: "2-digit", second: "2-digit" }),
  };
  const cpuStats = seriesStats(history.points, "cpuPercent");
  const memoryStats = seriesStats(history.points, "memoryPercent");
  const temperatureStats = seriesStats(history.points, "temperatureCelsius");
  const downloadStats = seriesStats(history.points, "downloadMbps");
  const liveTemperature = livePoint?.temperatureCelsius ?? null;
  // A VM or a board without a sensor never reports one: leave the card out.
  const showTemperature =
    liveTemperature !== null || hasAnyValue(history.points, "temperatureCelsius");
  const cpuSeries: ChartSeries[] = [{ key: "cpuPercent", label: "CPU", className: "text-primary" }];
  const memorySeries: ChartSeries[] = [
    { key: "memoryPercent", label: "Memory", className: "text-chart-2" },
  ];
  const temperatureSeries: ChartSeries[] = [
    { key: "temperatureCelsius", label: "Temperature", className: "text-status-amber" },
  ];
  const networkSeries: ChartSeries[] = [
    { key: "downloadMbps", label: "Down", className: "text-status-green" },
    { key: "uploadMbps", label: "Up", className: "text-sky-400" },
  ];
  const orDash = (value: number | null, format: (v: number) => string) =>
    value === null ? "--" : format(value);

  const dockerProcesses = useMemo(() => dockerStats.map(containerToProcess), [dockerStats]);

  const filteredProcesses = useMemo(() => {
    const q = query.trim().toLowerCase();
    const filtered = q ? dockerProcesses.filter((p) => p.name.toLowerCase().includes(q)) : dockerProcesses;
    return [...filtered].sort((a, b) => b[sortBy] - a[sortBy]);
  }, [dockerProcesses, query, sortBy]);

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="flex shrink-0 items-center gap-3 border-b border-glass-border/60 px-4 py-2.5">
        <div className="flex items-center gap-0.5">
          {TABS.map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={cn(
                "rounded-lg px-3 py-1.5 text-[13px] font-medium transition-colors",
                tab === t.id
                  ? "bg-primary/15 text-primary"
                  : "text-muted-foreground hover:bg-background/50 hover:text-foreground",
              )}
            >
              {t.label}
            </button>
          ))}
        </div>

        <div className="flex-1" />

        {tab === "processes" && (
          <div className="relative w-52">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground/60" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search containers…"
              className="w-full rounded-lg border border-glass-border bg-background/55 py-1.5 pl-8 pr-3 text-xs text-foreground outline-none placeholder:text-muted-foreground/50 focus:border-primary/40"
            />
          </div>
        )}
      </div>

      {/* ── Processes tab ── */}
      {tab === "processes" && (
        <div className="flex-1 overflow-y-auto p-3">
          {/* Metric summary */}
          <div className="mb-3 grid grid-cols-5 gap-2">
            <MetricCard
              label="CPU"
              icon={Cpu}
              value={`${systemMetrics?.cpu.normalizedPercent?.toFixed(1) ?? "--"}%`}
              sub="System average"
              color="text-primary"
            />
            <MetricCard
              label="Memory"
              icon={MemoryStick}
              value={`${systemMetrics?.memory.usedPercent?.toFixed(1) ?? "--"}%`}
              sub={
                systemMetrics?.memory.usedBytes && systemMetrics?.memory.totalBytes
                  ? `${(systemMetrics.memory.usedBytes / 1024 ** 3).toFixed(1)} / ${(systemMetrics.memory.totalBytes / 1024 ** 3).toFixed(1)} GB`
                  : "--"
              }
              color="text-chart-2"
            />
            <MetricCard
              label="Containers"
              icon={Container}
              value={`${dockerStats.length}`}
              sub={
                daemonAvailable === false
                  ? "daemon unreachable"
                  : `${dockerStats.filter((c) => c.state === "running").length} running`
              }
              color={daemonAvailable === false ? "text-status-amber" : "text-chart-4"}
            />
            <MetricCard
              label="Net RX"
              icon={ArrowDown}
              value={`${(dockerTotals.totalNetworkRx / 1024 ** 2).toFixed(1)}`}
              sub="MB received"
              color="text-status-green"
            />
            <MetricCard
              label="Net TX"
              icon={ArrowUp}
              value={`${(dockerTotals.totalNetworkTx / 1024 ** 2).toFixed(1)}`}
              sub="MB sent"
              color="text-sky-400"
            />
          </div>

          {/* Resource charts */}
          <div className="mb-2 flex items-center justify-between">
            <span className="text-[11px] font-medium uppercase tracking-[0.12em] text-muted-foreground/70">
              History
            </span>
            <div className="flex items-center gap-0.5" role="group" aria-label="History range">
              {RANGE_OPTIONS.map((option) => (
                <button
                  key={option.id}
                  type="button"
                  onClick={() => setRange(option.id)}
                  aria-pressed={range === option.id}
                  className={cn(
                    "rounded-md px-2.5 py-1 text-[11px] font-medium transition-colors",
                    range === option.id
                      ? "bg-primary/15 text-primary"
                      : "text-muted-foreground hover:bg-background/50 hover:text-foreground",
                  )}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </div>
          <div className="mb-3 grid grid-cols-2 gap-2">
            <HistoryCard
              icon={Cpu}
              title="CPU"
              iconColor="text-primary"
              rows={[
                { label: "Current", value: orDash(livePoint?.cpuPercent ?? null, formatPercent) },
                { label: "Average", value: orDash(cpuStats.average, formatPercent) },
                { label: "Peak", value: orDash(cpuStats.peak, formatPercent) },
              ]}
            >
              <MetricHistoryChart {...chartProps} series={cpuSeries} max={100} formatValue={formatPercent} />
            </HistoryCard>
            <HistoryCard
              icon={MemoryStick}
              title="Memory"
              iconColor="text-chart-2"
              rows={[
                { label: "Used", value: orDash(livePoint?.memoryPercent ?? null, formatPercent) },
                { label: "Peak", value: orDash(memoryStats.peak, formatPercent) },
                { label: "In use", value: systemMetrics?.memory.usedBytes ? `${(systemMetrics.memory.usedBytes / 1024 ** 3).toFixed(1)} GB` : "--" },
              ]}
            >
              <MetricHistoryChart {...chartProps} series={memorySeries} max={100} formatValue={formatPercent} />
            </HistoryCard>
            {showTemperature ? (
              <HistoryCard
                icon={Thermometer}
                title="Temperature"
                iconColor="text-status-amber"
                rows={[
                  { label: "Current", value: orDash(liveTemperature, formatCelsius) },
                  { label: "Average", value: orDash(temperatureStats.average, formatCelsius) },
                  { label: "Max", value: orDash(temperatureStats.peak, formatCelsius) },
                ]}
              >
                <MetricHistoryChart {...chartProps} series={temperatureSeries} fitMin formatValue={formatCelsius} />
              </HistoryCard>
            ) : null}
            <HistoryCard
              icon={Network}
              title="Network"
              iconColor="text-status-green"
              rows={[
                { label: "Download", value: orDash(livePoint?.downloadMbps ?? null, formatMbps) },
                { label: "Upload", value: orDash(livePoint?.uploadMbps ?? null, formatMbps) },
                { label: "Peak download", value: orDash(downloadStats.peak, formatMbps) },
              ]}
            >
              <MetricHistoryChart {...chartProps} series={networkSeries} formatValue={formatMbps} />
            </HistoryCard>

            <div className={cn(PANEL_INSET, "flex flex-col gap-2 p-3")}>
              <div className="flex items-center gap-2">
                <HardDrive className="size-3.5 text-chart-4" />
                <span className="text-xs font-semibold text-foreground">Disk Usage</span>
              </div>
              {systemMetrics?.storage ? (
                <>
                  <div className="h-1.5 overflow-hidden rounded-full bg-background/65">
                    <div className="h-full rounded-full bg-chart-4 transition-all duration-300" style={{ width: `${systemMetrics.storage.usedPercent.toFixed(1)}%` }} />
                  </div>
                  <div className="divide-y divide-glass-border/40">
                    <InfoRow label="Used" value={formatBytesCompact(systemMetrics.storage.usedBytes)} mono />
                    <InfoRow label="Total" value={formatBytesCompact(systemMetrics.storage.totalBytes)} mono />
                    <InfoRow label="Usage" value={`${systemMetrics.storage.usedPercent.toFixed(1)}%`} mono />
                  </div>
                </>
              ) : (
                <p className="py-4 text-center text-xs text-muted-foreground/60">Storage data unavailable</p>
              )}
            </div>

            <div className={cn(PANEL_INSET, "flex flex-col gap-2 p-3")}>
              <div className="flex items-center gap-2">
                <Gauge className="size-3.5 text-status-amber" />
                <span className="text-xs font-semibold text-foreground">Load Average</span>
              </div>
              <div className="grid grid-cols-3 gap-2">
                {[
                  { label: "1m", value: systemMetrics?.cpu.oneMinute?.toFixed(2) },
                  { label: "5m", value: systemMetrics?.cpu.fiveMinute?.toFixed(2) },
                  { label: "15m", value: systemMetrics?.cpu.fifteenMinute?.toFixed(2) },
                ].map(({ label, value }) => (
                  <div key={label} className={cn(PANEL_INSET, "flex flex-col items-center gap-1 py-3")}>
                    <span className="font-mono text-sm font-bold text-foreground">{value ?? "--"}</span>
                    <span className="text-[11px] text-muted-foreground/60">{label}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Container table */}
          <div className={cn(PANEL_INSET, "overflow-hidden")}>
            <div className="flex items-center justify-between border-b border-glass-border/50 px-4 py-2.5">
              <div className="flex items-center gap-2">
                <Container className="size-3.5 text-primary" />
                <span className="text-xs font-semibold text-foreground">Docker Containers</span>
                {dockerConnected && daemonAvailable !== false && (
                  <span className="flex items-center gap-1 text-[11px] text-status-green">
                    <span className="size-1.5 rounded-full bg-status-green" />
                    Live
                  </span>
                )}
              </div>
              {daemonAvailable === false && (
                <span className="flex items-center gap-1.5 text-xs text-status-amber">
                  <AlertTriangle className="size-3.5" />
                  Docker daemon unreachable
                </span>
              )}
              {daemonAvailable !== false && dockerStats.length === 0 && (
                <span className="text-xs text-muted-foreground/60">No containers running</span>
              )}
            </div>

            <div className="grid grid-cols-[2.2fr_0.7fr_0.8fr_0.8fr_0.8fr_0.8fr] gap-2 border-b border-glass-border/40 px-4 py-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground/50">
              <span>Container</span>
              <span>Status</span>
              {(["cpu", "memory", "network", "disk"] as SortKey[]).map((key, i) => (
                <button
                  key={key}
                  onClick={() => setSortBy(key)}
                  className={cn(
                    "text-left transition-colors hover:text-foreground",
                    sortBy === key ? "text-primary" : "",
                  )}
                >
                  {["CPU %", "Mem MB", "Net MB", "Disk MB"][i]}
                </button>
              ))}
            </div>

            {filteredProcesses.length === 0 ? (
              <div className="px-4 py-8 text-center text-sm text-muted-foreground">
                {daemonAvailable === false
                  ? "Cannot connect to Docker daemon"
                  : query
                    ? "No containers match your search"
                    : "No containers running"}
              </div>
            ) : (
              <div className="divide-y divide-glass-border/40">
                {filteredProcesses.map((p) => (
                  <div
                    key={`${p.name}-${p.pid}`}
                    className="grid grid-cols-[2.2fr_0.7fr_0.8fr_0.8fr_0.8fr_0.8fr] gap-2 px-4 py-2.5 text-xs transition-colors hover:bg-background/30"
                  >
                    <div className="flex min-w-0 items-center gap-2.5">
                      <div className="flex size-7 shrink-0 items-center justify-center rounded-lg border border-glass-border bg-background/55 text-xs font-bold text-primary">
                        {p.name[0]?.toUpperCase() ?? "C"}
                      </div>
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium text-foreground">{p.name}</p>
                        <p className="font-mono text-[11px] text-muted-foreground/60">{p.pid}</p>
                      </div>
                    </div>
                    <span className={cn("flex items-center")}>
                      <span className={cn("rounded-md px-2 py-0.5 text-[11px] font-medium", getStatusBadgeColor(p.status))}>
                        {p.status}
                      </span>
                    </span>
                    <span className="flex items-center font-mono text-foreground">{p.cpu.toFixed(1)}%</span>
                    <span className="flex items-center font-mono text-foreground">{Math.round(p.memory)} MB</span>
                    <span className="flex items-center font-mono text-foreground">{p.network.toFixed(1)} MB</span>
                    <span className="flex items-center font-mono text-foreground">{p.disk.toFixed(1)} MB</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Disks tab ── */}
      {tab === "disks" && <DiskManager />}

      {/* ── Network tab ── */}
      {tab === "network" && (
        <div className="flex-1 overflow-y-auto p-3">
          <div className="flex flex-col gap-2">
            {systemMetrics?.wifi.connected ? (
              <div className={cn(PANEL_INSET, "overflow-hidden")}>
                <div className="flex items-center justify-between px-4 py-3">
                  <div className="flex items-center gap-2.5">
                    <div className="flex size-7 shrink-0 items-center justify-center rounded-lg border border-glass-border bg-background/55">
                      <Network className="size-3.5 text-primary" />
                    </div>
                    <div>
                      <p className="text-sm font-medium text-foreground">{systemMetrics.wifi.iface ?? "Network"}</p>
                      <p className="text-[11px] text-muted-foreground/70">
                        {systemMetrics.wifi.ssid ?? "Connected"} · {systemMetrics.wifi.ipv4 ?? "No IP"}
                      </p>
                    </div>
                  </div>
                  <span className="rounded-md bg-status-green/12 px-2 py-0.5 text-xs font-medium text-status-green">
                    Connected
                  </span>
                </div>
                <div className="divide-y divide-glass-border/40 border-t border-glass-border/50 px-4">
                  <InfoRow label="Download" value={`${systemMetrics.wifi.downloadMbps?.toFixed(1) ?? "--"} Mbps`} mono />
                  <InfoRow label="Upload" value={`${systemMetrics.wifi.uploadMbps?.toFixed(1) ?? "--"} Mbps`} mono />
                  <InfoRow label="Signal" value={`${systemMetrics.wifi.signalPercent ?? "--"}%`} mono />
                  <InfoRow label="TX Rate" value={`${systemMetrics.wifi.txRateMbps?.toFixed(0) ?? "--"} Mbps`} mono />
                </div>
              </div>
            ) : (
              <div className={cn(PANEL_INSET, "flex flex-col items-center gap-2 py-8 text-center")}>
                <Network className="size-7 text-muted-foreground/30" />
                <p className="text-sm text-muted-foreground">No active network connection</p>
              </div>
            )}

            <div className={cn(PANEL_INSET, "overflow-hidden")}>
              <div className="flex items-center gap-2 border-b border-glass-border/50 px-4 py-3">
                <Container className="size-3.5 text-primary" />
                <span className="text-xs font-semibold text-foreground">Container Network Activity</span>
              </div>
              {daemonAvailable === false ? (
                <p className="px-4 py-4 text-xs text-muted-foreground/60">Docker daemon unreachable</p>
              ) : (
                <div className="grid grid-cols-2 divide-x divide-glass-border/50">
                  {[
                    { label: "MB Received", value: (dockerTotals.totalNetworkRx / 1024 ** 2).toFixed(1) },
                    { label: "MB Sent", value: (dockerTotals.totalNetworkTx / 1024 ** 2).toFixed(1) },
                  ].map(({ label, value }) => (
                    <div key={label} className="flex flex-col items-center gap-1 py-4">
                      <span className="font-mono text-2xl font-bold tabular-nums text-foreground">{value}</span>
                      <span className="text-[11px] text-muted-foreground/60">{label}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className={cn(PANEL_INSET, "overflow-hidden")}>
              <div className="flex items-center gap-2 border-b border-glass-border/50 px-4 py-3">
                <Activity className="size-3.5 text-primary" />
                <span className="text-xs font-semibold text-foreground">System Info</span>
              </div>
              <div className="divide-y divide-glass-border/40 px-4">
                <InfoRow label="Hostname" value={systemMetrics?.hostname ?? "--"} mono />
                <InfoRow label="Platform" value={systemMetrics?.platform ?? "--"} mono />
                <InfoRow
                  label="Uptime"
                  value={systemMetrics?.uptimeSeconds ? formatUptimeShort(systemMetrics.uptimeSeconds) : "--"}
                  mono
                />
                <InfoRow
                  label="Containers"
                  value={daemonAvailable === false ? "unavailable" : `${dockerStats.length} total`}
                  mono
                />
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
