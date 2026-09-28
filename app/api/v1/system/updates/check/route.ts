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

export async function POST(request: NextRequest) {
  const apiSession = await requireApiSession(request);
  if (apiSession.response) return apiSession.response;
  const requestId = createRequestId();

  try {
    return await withServerTiming(
      {
        layer: "api",
        action: "system.updates.check.post",
        requestId,
      },
      async () => {
        const session = apiSession.session;

        const status = await getSystemUpdateStatus({ refresh: true });

        logServerAction({
          layer: "api",
          action: "system.updates.check.completed",
          status: "success",
          requestId,
          message: "Checked for Homeio updates",
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
      action: "system.updates.check.response",
      status: "error",
      requestId,
      message: "Failed to check for Homeio updates",
      error,
    });

    return NextResponse.json({ error: "Failed to check for Homeio updates" }, { status: 500 });
  }
}
