import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import {
  createRequestId,
  logServerAction,
  withServerTiming,
} from "@/lib/server/logging/logger";
import { deleteScheduledRebootArtifacts } from "@/lib/server/modules/system/power-schedule";
import { requireApiSession } from "@/lib/server/modules/auth/api";
import { emitPowerAction } from "@/lib/server/modules/system/power-action-events";
import {
  deleteFactoryResetArtifacts,
  scheduleFactoryReset,
} from "@/lib/server/modules/system/power-service";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  const apiSession = await requireApiSession(request);
  if (apiSession.response) return apiSession.response;
  const requestId = createRequestId();

  try {
    return await withServerTiming(
      {
        layer: "api",
        action: "system.power.factory-reset.post",
        requestId,
      },
      async () => {
        const session = apiSession.session;

        logServerAction({
          layer: "api",
          action: "system.power.factory-reset.post.accepted",
          status: "success",
          requestId,
          message: "Authenticated factory reset request accepted",
          meta: {
            userId: session.userId,
            username: session.username,
          },
        });

        await deleteScheduledRebootArtifacts();
        await deleteFactoryResetArtifacts();
        await scheduleFactoryReset();
        emitPowerAction("factory-reset");

        logServerAction({
          layer: "api",
          action: "system.power.factory-reset.post.scheduled",
          status: "success",
          requestId,
          message: "Factory reset workflow scheduled",
          meta: {
            userId: session.userId,
            username: session.username,
          },
        });

        return NextResponse.json({ data: { action: "factory-reset", accepted: true } }, { status: 202 });
      },
    );
  } catch (error) {
    logServerAction({
      level: "error",
      layer: "api",
      action: "system.power.factory-reset.post.response",
      status: "error",
      requestId,
      message: "Failed to schedule factory reset",
      error,
    });

    return NextResponse.json({ error: "Failed to schedule factory reset" }, { status: 500 });
  }
}
