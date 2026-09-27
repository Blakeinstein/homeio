"use client";

import { useEffect, useState } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { appendLivePoint } from "@/lib/client/metrics-history";
import { METRICS_HISTORY_RANGE_MS } from "@/lib/shared/metrics-history";
import type {
  MetricsHistory,
  MetricsHistoryPoint,
  MetricsHistoryRange,
} from "@/lib/shared/contracts/system";
import { queryKeys } from "@/lib/shared/query-keys";

async function fetchMetricsHistory(range: MetricsHistoryRange): Promise<MetricsHistory> {
  const response = await fetch(`/api/v1/system/metrics/history?range=${range}`, {
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error(`Failed to load the metrics history (${response.status})`);
  }

  const json = (await response.json()) as { data: MetricsHistory };
  return json.data;
}

/**
 * The server keeps the history, so opening or refreshing the Monitor shows the
 * last 15 minutes, hour or day straight away. The 15 min and 1 h views then
 * grow from the live metrics stream; the 24 h view, made of one-minute
 * averages, refetches.
 */
export function useMetricsHistory(
  range: MetricsHistoryRange,
  livePoint: MetricsHistoryPoint | null,
) {
  const query = useQuery({
    queryKey: queryKeys.systemMetricsHistory(range),
    queryFn: () => fetchMetricsHistory(range),
    refetchInterval: range === "24h" ? 60_000 : 5 * 60_000,
    refetchOnWindowFocus: false,
    // On a range switch, keep the current chart on screen until the new range
    // arrives, rather than blanking it or drawing one live dot on its own.
    placeholderData: keepPreviousData,
  });
  const loaded = query.data !== undefined && !query.isPlaceholderData;

  const [points, setPoints] = useState<MetricsHistoryPoint[]>([]);

  useEffect(() => {
    if (loaded) setPoints(query.data.points);
  }, [loaded, query.data]);

  useEffect(() => {
    if (range === "24h" || !livePoint || !loaded) return;
    setPoints((current) => appendLivePoint(current, livePoint, METRICS_HISTORY_RANGE_MS[range]));
  }, [livePoint, range, loaded]);

  return {
    points,
    intervalSeconds: query.data?.intervalSeconds ?? (range === "24h" ? 60 : 5),
    isLoading: query.isLoading,
    error: query.error,
  };
}
