import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import {
  createRequestId,
  logServerAction,
  withServerTiming,
} from "@/lib/server/logging/logger";
import { getSystemUpdateStatus } from "@/lib/server/modules/system/update-service";
import { requireApiSession } from "@/lib/server/modules/auth/api";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const apiSession = await requireApiSession(request);
  if (apiSession.response) return apiSession.response;
  const requestId = createRequestId();

  try {
    return await withServerTiming(
      {
        layer: "api",
        action: "system.updates.get",
        requestId,
      },
      async () => {
        const session = apiSession.session;

        const status = await getSystemUpdateStatus();

        logServerAction({
          layer: "api",
          action: "system.updates.get.read",
          status: "success",
          requestId,
          message: "Loaded Homeio update status",
          meta: {
            userId: session.userId,
            username: session.username,
            currentVersion: status.currentVersion,
            latestVersion: status.latestVersion,
            updateAvailable: status.updateAvailable,
          },
        });

        return NextResponse.json({ data: status });
      },
    );
  } catch (error) {
    logServerAction({
      level: "error",
      layer: "api",
      action: "system.updates.get.response",
      status: "error",
      requestId,
      message: "Failed to load Homeio update status",
      error,
    });

    return NextResponse.json({ error: "Failed to load Homeio updates" }, { status: 500 });
  }
}
