import { NextResponse } from "next/server";
import { createRequestId, withServerTiming } from "@/lib/server/logging/logger";
import { getMetricsHistory } from "@/lib/server/modules/system/metrics-history";
import { requireApiSession } from "@/lib/server/modules/auth/api";
import type { MetricsHistoryRange } from "@/lib/shared/contracts/system";

export const runtime = "nodejs";

const RANGES: MetricsHistoryRange[] = ["15m", "1h", "24h"];

export async function GET(request: Request) {
  const apiSession = await requireApiSession(request);
  if (apiSession.response) return apiSession.response;
  const requestId = createRequestId();

  const range = new URL(request.url).searchParams.get("range") ?? "15m";
  if (!RANGES.includes(range as MetricsHistoryRange)) {
    return NextResponse.json(
      { error: "range must be 15m, 1h or 24h", code: "validation_error" },
      { status: 400 },
    );
  }

  return withServerTiming(
    {
      layer: "api",
      action: "system.metrics.history.get",
      requestId,
    },
    async () =>
      NextResponse.json(
        { data: getMetricsHistory(range as MetricsHistoryRange) },
        { headers: { "Cache-Control": "no-store" } },
      ),
  );
}
