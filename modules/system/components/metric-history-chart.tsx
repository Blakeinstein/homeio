"use client";

import { useMemo, useState } from "react";
import type { HistoryMetricKey } from "@/lib/client/metrics-history";
import type { MetricsHistoryPoint } from "@/lib/shared/contracts/system";
import { PANEL_INSET } from "@/lib/ui/surface-tokens";
import { cn } from "@/lib/utils";

const WIDTH = 300;
const HEIGHT = 64;

export type ChartSeries = {
  key: HistoryMetricKey;
  label: string;
  /** A text colour class; lines and fills use currentColor. */
  className: string;
};

type MetricHistoryChartProps = {
  points: MetricsHistoryPoint[];
  series: ChartSeries[];
  rangeMs: number;
  now: number;
  /** Lines break across gaps longer than this, such as a Homeio restart. */
  gapMs: number;
  /** Fixed top of the scale, 100 for percentages; otherwise fitted to the data. */
  max?: number;
  /** Fit the bottom of the scale to the data as well, for temperatures. */
  fitMin?: boolean;
  formatValue: (value: number) => string;
  formatTime: (t: number) => string;
  rangeLabel: string;
  /**
   * Spread a history shorter than the range across the whole width (the 15 min
   * view). Otherwise the chart keeps the real time scale and greys out the
   * part the server has no data for yet, so 1 h and 24 h look different.
   */
  fitToData?: boolean;
};

type Segment = { x: number; y: number }[];

function buildSegments(
  points: MetricsHistoryPoint[],
  key: HistoryMetricKey,
  toX: (t: number) => number,
  toY: (value: number) => number,
  gapMs: number,
) {
  const segments: Segment[] = [];
  let current: Segment = [];
  let previousT: number | null = null;

  for (const point of points) {
    const value = point[key];
    const gap = previousT !== null && point.t - previousT > gapMs;
    if (value === null || gap) {
      if (current.length > 0) segments.push(current);
      current = [];
    }
    if (value !== null) current.push({ x: toX(point.t), y: toY(value) });
    previousT = point.t;
  }
  if (current.length > 0) segments.push(current);

  // A lone point would draw nothing; give it a hair of width.
  return segments.map((segment) =>
    segment.length === 1 ? [segment[0], { x: segment[0].x + 1, y: segment[0].y }] : segment,
  );
}

function linePath(segments: Segment[]) {
  return segments
    .map((segment) =>
      segment.map((p, i) => `${i === 0 ? "M" : "L"}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(""),
    )
    .join("");
}

function areaPath(segments: Segment[]) {
  return segments
    .map((segment) => {
      const first = segment[0];
      const last = segment[segment.length - 1];
      return `M${first.x.toFixed(1)},${HEIGHT}${segment
        .map((p) => `L${p.x.toFixed(1)},${p.y.toFixed(1)}`)
        .join("")}L${last.x.toFixed(1)},${HEIGHT}Z`;
    })
    .join("");
}

export function MetricHistoryChart({
  points,
  series,
  rangeMs,
  now,
  gapMs,
  max,
  fitMin,
  formatValue,
  formatTime,
  rangeLabel,
  fitToData = false,
}: MetricHistoryChartProps) {
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);
  const firstT = points[0]?.t;
  // The right edge is the latest sample, not the clock: a 24 h point is the
  // start of its minute, so ending at "now" left an empty strip on the right.
  const end = points.at(-1)?.t ?? now;
  const rangeStart = end - rangeMs;
  const partial = firstT !== undefined && firstT - rangeStart > 2 * gapMs;
  const start = fitToData && partial && firstT !== undefined ? firstT : rangeStart;
  const span = Math.max(end - start, 1);

  const scale = useMemo(() => {
    const values = points.flatMap((point) =>
      series.map((s) => point[s.key]).filter((v): v is number => v !== null),
    );
    if (values.length === 0) return null;
    const dataMax = Math.max(...values);
    const dataMin = Math.min(...values);
    const bottom = fitMin ? Math.floor(dataMin - 2) : 0;
    let top = max ?? dataMax * 1.15;
    if (top <= bottom) top = bottom + 1;
    return { bottom, top };
  }, [points, series, max, fitMin]);

  const toX = (t: number) => ((t - start) / span) * WIDTH;
  const toY = (value: number) =>
    scale ? HEIGHT - ((value - scale.bottom) / (scale.top - scale.bottom)) * HEIGHT : HEIGHT;

  const hovered = hoverIndex !== null ? points[hoverIndex] : null;

  function handleMove(event: React.MouseEvent<HTMLDivElement>) {
    if (points.length === 0) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const t = start + ((event.clientX - rect.left) / rect.width) * span;
    let best = 0;
    for (let i = 1; i < points.length; i += 1) {
      if (Math.abs(points[i].t - t) < Math.abs(points[best].t - t)) best = i;
    }
    setHoverIndex(best);
  }

  return (
    <div className="flex flex-col gap-1">
      <div
        className={cn(PANEL_INSET, "relative h-16 overflow-hidden")}
        onMouseMove={handleMove}
        onMouseLeave={() => setHoverIndex(null)}
      >
        {scale === null ? (
          <span className="absolute inset-0 m-auto flex items-center justify-center text-xs text-muted-foreground/50">
            Collecting…
          </span>
        ) : (
          <>
            {!fitToData && partial && firstT !== undefined ? (
              <div
                className="absolute inset-y-0 left-0 flex items-center justify-center overflow-hidden border-r border-dashed border-glass-border/60 bg-[repeating-linear-gradient(135deg,transparent_0_6px,hsl(var(--foreground)/0.04)_6px_12px)]"
                style={{ width: `${(toX(firstT) / WIDTH) * 100}%` }}
              >
                {toX(firstT) > WIDTH * 0.25 ? (
                  <span className="whitespace-nowrap text-[10px] text-muted-foreground/50">No data yet</span>
                ) : null}
              </div>
            ) : null}
            <svg
              viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
              preserveAspectRatio="none"
              className="absolute inset-0 size-full"
              role="img"
              aria-label={`${series.map((s) => s.label).join(" and ")} over the last ${rangeLabel}`}
            >
              {series.map((s) => {
                const segments = buildSegments(points, s.key, toX, toY, gapMs);
                return (
                  <g key={s.key} className={s.className}>
                    <path d={areaPath(segments)} fill="currentColor" fillOpacity={0.12} />
                    <path
                      d={linePath(segments)}
                      fill="none"
                      stroke="currentColor"
                      strokeWidth={1.5}
                      strokeLinejoin="round"
                      vectorEffect="non-scaling-stroke"
                    />
                  </g>
                );
              })}
              {hovered ? (
                <line
                  x1={toX(hovered.t)}
                  x2={toX(hovered.t)}
                  y1={0}
                  y2={HEIGHT}
                  className="text-foreground/40"
                  stroke="currentColor"
                  strokeWidth={1}
                  vectorEffect="non-scaling-stroke"
                />
              ) : null}
            </svg>
          </>
        )}

        {hovered ? (
          <div
            className="pointer-events-none absolute top-1 z-10 rounded-md border border-glass-border/60 bg-popover/95 px-2 py-1 text-[10px] shadow-lg"
            style={
              toX(hovered.t) > WIDTH / 2
                ? { right: `${100 - (toX(hovered.t) / WIDTH) * 100 + 2}%` }
                : { left: `${(toX(hovered.t) / WIDTH) * 100 + 2}%` }
            }
          >
            <div className="font-mono text-muted-foreground">{formatTime(hovered.t)}</div>
            {series.map((s) => {
              const value = hovered[s.key];
              return (
                <div key={s.key} className="flex items-center gap-1.5 whitespace-nowrap font-mono">
                  <span className={cn("size-1.5 rounded-full bg-current", s.className)} />
                  {series.length > 1 ? <span className="text-muted-foreground">{s.label}</span> : null}
                  <span className="text-foreground">{value === null ? "--" : formatValue(value)}</span>
                </div>
              );
            })}
          </div>
        ) : null}
      </div>

      <div className="flex justify-between text-[10px] text-muted-foreground/60">
        <span>
          {partial && firstT !== undefined
            ? fitToData
              ? `Since ${formatTime(firstT)}`
              : `${rangeLabel} ago · data since ${formatTime(firstT)}`
            : `${rangeLabel} ago`}
        </span>
        <span>Now</span>
      </div>
    </div>
  );
}
