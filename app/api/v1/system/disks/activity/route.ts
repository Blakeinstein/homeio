import { NextResponse } from "next/server";
import { createRequestId, withServerTiming } from "@/lib/server/logging/logger";
import { requireApiSession } from "@/lib/server/modules/auth/api";
import { getDiskMonitor } from "@/lib/server/modules/system/disk-monitor";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const apiSession = await requireApiSession(request);
  if (apiSession.response) return apiSession.response;
  const requestId = createRequestId();

  return withServerTiming(
    { layer: "api", action: "system.disks.activity.get", requestId },
    async () =>
      NextResponse.json(
        { data: await getDiskMonitor() },
        { headers: { "Cache-Control": "no-store" } },
      ),
  );
}
