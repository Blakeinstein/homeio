import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import {
  createRequestId,
  logServerAction,
  withServerTiming,
} from "@/lib/server/logging/logger";
import { requireApiSession } from "@/lib/server/modules/auth/api";
import {
  getScheduledRebootConfig,
  setScheduledRebootConfig,
  type ScheduledRebootConfig,
} from "@/lib/server/modules/system/power-schedule";

export const runtime = "nodejs";

type SchedulePayload = ScheduledRebootConfig;

function isSchedulePayload(value: unknown): value is SchedulePayload {
  if (!value || typeof value !== "object") return false;

  const payload = value as Partial<SchedulePayload>;
  const validFrequency = payload.frequency === "daily" || payload.frequency === "weekly";
  const validDay = [
    "monday",
    "tuesday",
    "wednesday",
    "thursday",
    "friday",
    "saturday",
    "sunday",
  ].includes(String(payload.dayOfWeek));
  const validTime = typeof payload.time === "string" && /^\d{2}:\d{2}$/.test(payload.time);

  return typeof payload.enabled === "boolean" && validFrequency && validDay && validTime;
}

export async function GET(request: NextRequest) {
  const apiSession = await requireApiSession(request);
  if (apiSession.response) return apiSession.response;
  const requestId = createRequestId();

  try {
    return await withServerTiming(
      {
        layer: "api",
        action: "system.power.schedule.get",
        requestId,
      },
      async () => {
        const config = await getScheduledRebootConfig();

        return NextResponse.json({ data: config });
      },
    );
  } catch (error) {
    logServerAction({
      level: "error",
      layer: "api",
      action: "system.power.schedule.get.response",
      status: "error",
      requestId,
      message: "Failed to load scheduled reboot configuration",
      error,
    });

    return NextResponse.json({ error: "Failed to load scheduled reboot configuration" }, { status: 500 });
  }
}

export async function PUT(request: NextRequest) {
  const apiSession = await requireApiSession(request);
  if (apiSession.response) return apiSession.response;
  const requestId = createRequestId();

  try {
    return await withServerTiming(
      {
        layer: "api",
        action: "system.power.schedule.put",
        requestId,
      },
      async () => {
        const session = apiSession.session;

        const body = await request.json().catch(() => null);
        if (!isSchedulePayload(body)) {
          return NextResponse.json({ error: "Invalid scheduled reboot payload" }, { status: 400 });
        }

        await setScheduledRebootConfig(body);

        logServerAction({
          layer: "api",
          action: "system.power.schedule.put.saved",
          status: "success",
          requestId,
          message: "Scheduled reboot updated",
          meta: {
            userId: session.userId,
            username: session.username,
            enabled: body.enabled,
            frequency: body.frequency,
            dayOfWeek: body.dayOfWeek,
            time: body.time,
          },
        });

        return NextResponse.json({ data: body });
      },
    );
  } catch (error) {
    logServerAction({
      level: "error",
      layer: "api",
      action: "system.power.schedule.put.response",
      status: "error",
      requestId,
      message: "Failed to save scheduled reboot configuration",
      error,
    });

    return NextResponse.json({ error: "Failed to save scheduled reboot configuration" }, { status: 500 });
  }
}
