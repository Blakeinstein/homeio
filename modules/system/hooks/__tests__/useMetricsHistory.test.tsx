/* @vitest-environment jsdom */

import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { MetricsHistory, MetricsHistoryPoint } from "@/lib/shared/contracts/system";
import { createTestQueryClient, createWrapper } from "@/test/query-client-wrapper";
import { useMetricsHistory } from "@/modules/system/hooks/useMetricsHistory";

const NOW = Date.UTC(2026, 8, 27, 12, 0, 0);

function point(t: number, cpu: number): MetricsHistoryPoint {
  return { t, cpuPercent: cpu, memoryPercent: 1, temperatureCelsius: null, downloadMbps: 0, uploadMbps: 0, diskReadMBps: null, diskWriteMBps: null };
}

function historyOf(range: MetricsHistory["range"], points: MetricsHistoryPoint[]): MetricsHistory {
  return { range, intervalSeconds: range === "24h" ? 60 : 5, points };
}

describe("useMetricsHistory", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("keeps the current points on a range switch until the new range arrives", async () => {
    const quarter = [point(NOW - 10_000, 10), point(NOW - 5_000, 11)];
    const hour = [point(NOW - 30 * 60_000, 20), point(NOW - 5_000, 21)];
    let releaseHour: (() => void) | null = null;

    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const range = new URL(String(input), "http://localhost").searchParams.get("range");
      if (range === "1h") {
        await new Promise<void>((resolve) => {
          releaseHour = resolve;
        });
        return new Response(JSON.stringify({ data: historyOf("1h", hour) }));
      }
      return new Response(JSON.stringify({ data: historyOf("15m", quarter) }));
    });

    const wrapper = createWrapper(createTestQueryClient());
    const { result, rerender } = renderHook(
      ({ range, live }: { range: MetricsHistory["range"]; live: MetricsHistoryPoint | null }) =>
        useMetricsHistory(range, live),
      { wrapper, initialProps: { range: "15m", live: null } },
    );

    await waitFor(() => expect(result.current.points).toEqual(quarter));

    // Switch while a live frame arrives: no blank chart, no lone live dot.
    rerender({ range: "1h", live: point(NOW + 5_000, 99) });
    expect(result.current.points).toEqual(quarter);

    await act(async () => {
      releaseHour?.();
    });
    // Once the hour has loaded, the newer live frame is appended to it.
    await waitFor(() => expect(result.current.points.map((p) => p.cpuPercent)).toEqual([20, 21, 99]));
  });
});
