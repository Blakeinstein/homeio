import type {
  MetricsHistoryPoint,
  MetricsHistoryRange,
  SystemMetricsSnapshot,
} from "@/lib/shared/contracts/system";

export const METRICS_HISTORY_SAMPLE_MS = 5_000;

export const METRICS_HISTORY_RANGE_MS: Record<MetricsHistoryRange, number> = {
  "15m": 15 * 60 * 1000,
  "1h": 60 * 60 * 1000,
  "24h": 24 * 60 * 60 * 1000,
};

function finiteOrNull(value: number | null | undefined) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/** The part of a metrics snapshot the Monitor's history charts keep. */
export function toHistoryPoint(snapshot: SystemMetricsSnapshot, t: number): MetricsHistoryPoint {
  return {
    t,
    cpuPercent: finiteOrNull(snapshot.cpu.normalizedPercent),
    memoryPercent: finiteOrNull(snapshot.memory.usedPercent),
    temperatureCelsius: finiteOrNull(snapshot.temperature.mainCelsius),
    downloadMbps: finiteOrNull(snapshot.wifi.downloadMbps),
    uploadMbps: finiteOrNull(snapshot.wifi.uploadMbps),
    diskReadMBps: finiteOrNull(snapshot.diskIo?.readMBps),
    diskWriteMBps: finiteOrNull(snapshot.diskIo?.writeMBps),
  };
}
