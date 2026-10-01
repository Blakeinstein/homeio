import type { MetricsHistoryPoint } from "@/lib/shared/contracts/system";
import {
  METRICS_HISTORY_RANGE_MS,
  METRICS_HISTORY_SAMPLE_MS,
} from "@/lib/shared/metrics-history";

export type HistoryMetricKey = Exclude<keyof MetricsHistoryPoint, "t">;

/**
 * Adds a live point to a 15 min or 1 h history at the server's 5 s cadence
 * (the live stream ticks every 2 s) and drops what has fallen out of the range.
 */
export function appendLivePoint(
  points: MetricsHistoryPoint[],
  point: MetricsHistoryPoint,
  rangeMs: number = METRICS_HISTORY_RANGE_MS["1h"],
): MetricsHistoryPoint[] {
  const last = points.at(-1);
  if (last && point.t - last.t < METRICS_HISTORY_SAMPLE_MS - 500) return points;

  const since = point.t - rangeMs;
  return [...points.filter((existing) => existing.t > since), point];
}

export type SeriesStats = {
  current: number | null;
  average: number | null;
  peak: number | null;
};

export function seriesStats(points: MetricsHistoryPoint[], key: HistoryMetricKey): SeriesStats {
  let sum = 0;
  let count = 0;
  let peak: number | null = null;
  let current: number | null = null;

  for (const point of points) {
    const value = point[key];
    if (typeof value !== "number") continue;
    sum += value;
    count += 1;
    peak = peak === null ? value : Math.max(peak, value);
    current = value;
  }

  return { current, average: count > 0 ? sum / count : null, peak };
}

export function hasAnyValue(points: MetricsHistoryPoint[], key: HistoryMetricKey) {
  return points.some((point) => typeof point[key] === "number");
}
