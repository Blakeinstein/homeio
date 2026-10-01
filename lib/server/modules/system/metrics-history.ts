import "server-only";

import { logServerAction } from "@/lib/server/logging/logger";
import { getSystemMetricsSnapshot } from "@/lib/server/modules/system/service";
import type {
  MetricsHistory,
  MetricsHistoryPoint,
  MetricsHistoryRange,
} from "@/lib/shared/contracts/system";
import { METRICS_HISTORY_SAMPLE_MS, toHistoryPoint } from "@/lib/shared/metrics-history";

export const HISTORY_SAMPLE_MS = METRICS_HISTORY_SAMPLE_MS;
export { toHistoryPoint };
const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;
const HOUR_CAPACITY = HOUR_MS / HISTORY_SAMPLE_MS;
const DAY_CAPACITY = DAY_MS / MINUTE_MS;
const ERROR_LOG_COOLDOWN_MS = 5 * MINUTE_MS;

type MetricKey = Exclude<keyof MetricsHistoryPoint, "t">;
const METRIC_KEYS: MetricKey[] = [
  "cpuPercent",
  "memoryPercent",
  "temperatureCelsius",
  "downloadMbps",
  "uploadMbps",
  "diskReadMBps",
  "diskWriteMBps",
];

type MinuteBucket = {
  start: number;
  sums: Record<MetricKey, number>;
  counts: Record<MetricKey, number>;
};

function emptyBucket(start: number): MinuteBucket {
  const zeros = () =>
    Object.fromEntries(METRIC_KEYS.map((key) => [key, 0])) as Record<MetricKey, number>;
  return { start, sums: zeros(), counts: zeros() };
}

function averageOf(bucket: MinuteBucket): MetricsHistoryPoint {
  const point = { t: bucket.start } as MetricsHistoryPoint;
  for (const key of METRIC_KEYS) {
    const count = bucket.counts[key];
    point[key] = count > 0 ? bucket.sums[key] / count : null;
  }
  return point;
}

/**
 * The last hour at full resolution plus 24 hours of one-minute averages, all in
 * memory: the charts survive a page refresh and closing the Monitor, not a
 * Homeio restart.
 */
export function createMetricsHistory() {
  const hour: MetricsHistoryPoint[] = [];
  const day: MetricsHistoryPoint[] = [];
  let bucket: MinuteBucket | null = null;

  function record(point: MetricsHistoryPoint) {
    hour.push(point);
    if (hour.length > HOUR_CAPACITY) hour.shift();

    const minuteStart = point.t - (point.t % MINUTE_MS);
    if (bucket && bucket.start !== minuteStart) {
      day.push(averageOf(bucket));
      if (day.length > DAY_CAPACITY) day.shift();
      bucket = null;
    }
    bucket ??= emptyBucket(minuteStart);
    for (const key of METRIC_KEYS) {
      const value = point[key];
      if (typeof value !== "number") continue;
      bucket.sums[key] += value;
      bucket.counts[key] += 1;
    }
  }

  function get(range: MetricsHistoryRange, now: number): MetricsHistory {
    if (range !== "24h") {
      // 15 min is the tail of the hour, at the same 5 s resolution.
      const since = now - (range === "15m" ? 15 * MINUTE_MS : HOUR_MS);
      return {
        range,
        intervalSeconds: HISTORY_SAMPLE_MS / 1000,
        points: hour.filter((point) => point.t > since),
      };
    }

    // The minute in progress is included so the last point is never stale.
    const points = day.filter((point) => point.t > now - DAY_MS);
    if (bucket) points.push(averageOf(bucket));
    return { range, intervalSeconds: MINUTE_MS / 1000, points };
  }

  return { record, get };
}

type MetricsHistoryStore = ReturnType<typeof createMetricsHistory>;

declare global {
  var __homeioMetricsHistory: MetricsHistoryStore | undefined;
  var __homeioMetricsHistoryStarted: boolean | undefined;
}

// instrumentation.ts (which starts the sampler) and the API route are bundled
// separately, so each gets its own copy of this module. Keep one buffer on
// globalThis, in production too, or the route would read an empty history.
const history = (globalThis.__homeioMetricsHistory ??= createMetricsHistory());
let lastErrorLoggedAt = 0;

async function sample() {
  try {
    const snapshot = await getSystemMetricsSnapshot();
    history.record(toHistoryPoint(snapshot, Date.now()));
  } catch (error) {
    const now = Date.now();
    if (now - lastErrorLoggedAt < ERROR_LOG_COOLDOWN_MS) return;
    lastErrorLoggedAt = now;
    logServerAction({
      level: "warn",
      layer: "service",
      action: "system.metrics.history.sample",
      status: "error",
      message: "Could not record a metrics history sample",
      error,
    });
  }
}

export function startMetricsHistory() {
  if (globalThis.__homeioMetricsHistoryStarted) return;
  globalThis.__homeioMetricsHistoryStarted = true;
  void sample();
  setInterval(() => void sample(), HISTORY_SAMPLE_MS).unref();
}

export function getMetricsHistory(range: MetricsHistoryRange): MetricsHistory {
  return history.get(range, Date.now());
}
