/* @vitest-environment jsdom */

import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { MetricsHistoryPoint } from "@/lib/shared/contracts/system";
import { MetricHistoryChart } from "@/modules/system/components/metric-history-chart";

const HOUR = 60 * 60 * 1000;
const NOW = Date.UTC(2026, 8, 27, 12, 0, 0);

function point(t: number, cpu: number | null): MetricsHistoryPoint {
  return { t, cpuPercent: cpu, memoryPercent: null, temperatureCelsius: null, downloadMbps: null, uploadMbps: null };
}

function renderChart(points: MetricsHistoryPoint[]) {
  return render(
    <MetricHistoryChart
      points={points}
      series={[{ key: "cpuPercent", label: "CPU", className: "text-primary" }]}
      rangeMs={HOUR}
      now={NOW}
      gapMs={15_000}
      max={100}
      rangeLabel="1 h"
      formatValue={(v) => `${v.toFixed(1)}%`}
      formatTime={(t) => new Date(t).toISOString().slice(11, 19)}
    />,
  );
}

describe("MetricHistoryChart", () => {
  it("says it is collecting until there is a reading", () => {
    renderChart([point(NOW - 5_000, null)]);
    expect(screen.getByText("Collecting…")).toBeTruthy();
    expect(screen.queryByRole("img")).toBeNull();
  });

  it("draws a full hour and labels its span", () => {
    const points = Array.from({ length: 720 }, (_, i) => point(NOW - HOUR + (i + 1) * 5_000, i % 100));
    const { container } = renderChart(points);

    expect(screen.getByRole("img", { name: "CPU over the last 1 h" })).toBeTruthy();
    expect(screen.getByText("1 h ago")).toBeTruthy();
    const line = container.querySelectorAll("path")[1].getAttribute("d") ?? "";
    expect(line.match(/M/g)).toHaveLength(1);
  });

  it("breaks the line across a gap, such as a restart, and says since when history exists", () => {
    const points = [
      point(NOW - 20 * 60_000, 10),
      point(NOW - 20 * 60_000 + 5_000, 12),
      // Homeio restarted: nothing for ten minutes.
      point(NOW - 10 * 60_000, 30),
      point(NOW - 10 * 60_000 + 5_000, 32),
    ];
    const { container } = renderChart(points);

    const line = container.querySelectorAll("path")[1].getAttribute("d") ?? "";
    expect(line.match(/M/g)).toHaveLength(2);
    expect(screen.getByText(`Since ${new Date(NOW - 20 * 60_000).toISOString().slice(11, 19)}`)).toBeTruthy();
  });

  it("spreads a short history across the full width instead of starting empty", () => {
    // Two minutes of data in a one-hour chart.
    const points = Array.from({ length: 24 }, (_, i) => point(NOW - 120_000 + (i + 1) * 5_000, 50));
    const { container } = renderChart(points);

    const line = container.querySelectorAll("path")[1].getAttribute("d") ?? "";
    const xs = [...line.matchAll(/[ML](-?[\d.]+),/g)].map((m) => Number(m[1]));
    expect(Math.min(...xs)).toBeLessThan(15);
    expect(Math.max(...xs)).toBeCloseTo(300, 0);
  });

  it("shows the nearest reading on hover", () => {
    const points = [point(NOW - 10_000, 42), point(NOW - 5_000, 43)];
    const { container } = renderChart(points);
    const area = container.firstElementChild?.firstElementChild as HTMLElement;
    area.getBoundingClientRect = () => ({ left: 0, width: 300, top: 0, height: 64, right: 300, bottom: 64, x: 0, y: 0, toJSON: () => ({}) });

    fireEvent.mouseMove(area, { clientX: 300 });

    expect(screen.getByText("43.0%")).toBeTruthy();
  });
});
