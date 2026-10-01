import { NextResponse } from "next/server";
import { createRequestId, withServerTiming } from "@/lib/server/logging/logger";
import { requireApiSession } from "@/lib/server/modules/auth/api";
import { getNetworkOverview } from "@/lib/server/modules/network/overview-service";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const apiSession = await requireApiSession(request);
  if (apiSession.response) return apiSession.response;
  const requestId = createRequestId();

  return withServerTiming(
    {
      layer: "api",
      action: "network.overview.get",
      requestId,
    },
    async () =>
      NextResponse.json(
        { data: await getNetworkOverview() },
        { headers: { "Cache-Control": "no-store" } },
      ),
  );
}
