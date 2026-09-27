import { describe, expect, it } from "vitest";
import { appendLivePoint, hasAnyValue, seriesStats } from "@/lib/client/metrics-history";
import type { MetricsHistoryPoint } from "@/lib/shared/contracts/system";

const T0 = Date.UTC(2026, 8, 27, 12, 0, 0);

function point(t: number, cpu: number | null, temperature: number | null = null): MetricsHistoryPoint {
  return { t, cpuPercent: cpu, memoryPercent: 40, temperatureCelsius: temperature, downloadMbps: 1, uploadMbps: 1 };
}

describe("appendLivePoint", () => {
  it("adds a live frame only at the 5 s cadence", () => {
    const start = [point(T0, 10)];
    expect(appendLivePoint(start, point(T0 + 2_000, 20))).toBe(start);
    expect(appendLivePoint(start, point(T0 + 5_000, 20)).map((p) => p.cpuPercent)).toEqual([10, 20]);
  });

  it("keeps only the chosen range for the 15 min view", () => {
    const points = [point(T0, 1), point(T0 + 10 * 60_000, 2)];
    const next = appendLivePoint(points, point(T0 + 16 * 60_000, 3), 15 * 60_000);
    expect(next.map((p) => p.cpuPercent)).toEqual([2, 3]);
  });

  it("drops points that fall out of the hour", () => {
    const points = [point(T0, 1), point(T0 + 30 * 60_000, 2)];
    const next = appendLivePoint(points, point(T0 + 60 * 60_000 + 1_000, 3));
    expect(next.map((p) => p.cpuPercent)).toEqual([2, 3]);
  });
});

describe("seriesStats", () => {
  it("reports current, average and peak and skips missing readings", () => {
    const points = [point(T0, 10), point(T0 + 5_000, null), point(T0 + 10_000, 40), point(T0 + 15_000, 25)];
    expect(seriesStats(points, "cpuPercent")).toEqual({ current: 25, average: 25, peak: 40 });
  });

  it("returns nulls and no value when a host has no reading", () => {
    const points = [point(T0, 10), point(T0 + 5_000, 20)];
    expect(seriesStats(points, "temperatureCelsius")).toEqual({ current: null, average: null, peak: null });
    expect(hasAnyValue(points, "temperatureCelsius")).toBe(false);
    expect(hasAnyValue([point(T0, 1, 55)], "temperatureCelsius")).toBe(true);
  });
});
