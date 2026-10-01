import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/server/modules/system/service", () => ({
  getSystemMetricsSnapshot: vi.fn(),
}));

import {
  HISTORY_SAMPLE_MS,
  createMetricsHistory,
  toHistoryPoint,
} from "@/lib/server/modules/system/metrics-history";
import type { MetricsHistoryPoint, SystemMetricsSnapshot } from "@/lib/shared/contracts/system";

const MINUTE = 60_000;
const START = Date.UTC(2026, 8, 27, 10, 0, 0);

function point(t: number, cpu: number | null, temperature: number | null = null): MetricsHistoryPoint {
  return {
    t,
    cpuPercent: cpu,
    memoryPercent: 50,
    temperatureCelsius: temperature,
    downloadMbps: 1,
    uploadMbps: 0.5,
    diskReadMBps: 2,
    diskWriteMBps: 1,
  };
}

describe("metrics history", () => {
  it("keeps one hour of 5 s samples and drops older ones", () => {
    const history = createMetricsHistory();
    const samples = (2 * 60 * 60 * 1000) / HISTORY_SAMPLE_MS;
    for (let i = 0; i < samples; i += 1) history.record(point(START + i * HISTORY_SAMPLE_MS, i % 100));

    const now = START + (samples - 1) * HISTORY_SAMPLE_MS;
    const hour = history.get("1h", now);

    expect(hour.intervalSeconds).toBe(5);
    expect(hour.points).toHaveLength(720);
    expect(hour.points[0].t).toBeGreaterThan(now - 60 * MINUTE);
    expect(hour.points.at(-1)?.t).toBe(now);
  });

  it("serves the last 15 minutes of the hour at the same 5 s resolution", () => {
    const history = createMetricsHistory();
    for (let i = 0; i < 720; i += 1) history.record(point(START + i * HISTORY_SAMPLE_MS, 1));

    const now = START + 719 * HISTORY_SAMPLE_MS;
    const quarter = history.get("15m", now);

    expect(quarter.intervalSeconds).toBe(5);
    expect(quarter.points).toHaveLength(180);
    expect(quarter.points[0].t).toBeGreaterThan(now - 15 * MINUTE);
  });

  it("averages each minute for the 24 h view and includes the minute in progress", () => {
    const history = createMetricsHistory();
    // First minute: 10, 20, 30. Second minute (in progress): 70.
    history.record(point(START, 10));
    history.record(point(START + 5_000, 20));
    history.record(point(START + 10_000, 30));
    history.record(point(START + MINUTE, 70));

    const day = history.get("24h", START + MINUTE + 1_000);

    expect(day.intervalSeconds).toBe(60);
    expect(day.points.map((p) => [p.t, p.cpuPercent])).toEqual([
      [START, 20],
      [START + MINUTE, 70],
    ]);
  });

  it("averages only the readings a host has, and keeps null when it has none", () => {
    const history = createMetricsHistory();
    history.record(point(START, null, 40));
    history.record(point(START + 5_000, 30, null));
    history.record(point(START + 10_000, 60, 50));

    const [minute] = history.get("24h", START + 20_000).points;

    expect(minute.cpuPercent).toBe(45);
    expect(minute.temperatureCelsius).toBe(45);

    const noSensor = createMetricsHistory();
    noSensor.record(point(START, 10, null));
    expect(noSensor.get("24h", START + 1_000).points[0].temperatureCelsius).toBeNull();
  });

  it("forgets minutes older than 24 hours", () => {
    const history = createMetricsHistory();
    for (let minute = 0; minute < 25 * 60; minute += 1) history.record(point(START + minute * MINUTE, 1));

    const now = START + (25 * 60 - 1) * MINUTE;
    const points = history.get("24h", now).points;

    expect(points.length).toBeLessThanOrEqual(24 * 60);
    expect(points[0].t).toBeGreaterThan(now - 24 * 60 * MINUTE);
  });

  it("maps a metrics snapshot and turns missing or invalid readings into null", () => {
    const snapshot = {
      cpu: { normalizedPercent: 12.5 },
      memory: { usedPercent: 40 },
      temperature: { mainCelsius: null },
      wifi: { downloadMbps: Number.NaN, uploadMbps: 2 },
      diskIo: { readMBps: 12, writeMBps: null },
    } as unknown as SystemMetricsSnapshot;

    expect(toHistoryPoint(snapshot, START)).toEqual({
      t: START,
      cpuPercent: 12.5,
      memoryPercent: 40,
      temperatureCelsius: null,
      downloadMbps: null,
      uploadMbps: 2,
      diskReadMBps: 12,
      diskWriteMBps: null,
    });
  });
});
