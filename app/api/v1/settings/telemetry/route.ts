import { NextResponse } from "next/server";
import { requireApiSession } from "@/lib/server/modules/auth/api";
import { createRequestId, logServerAction } from "@/lib/server/logging/logger";
import {
  getTelemetrySettings,
  setTelemetryEnabled,
} from "@/lib/server/modules/telemetry/service";
import type { TelemetrySettingsUpdateRequest } from "@/lib/shared/contracts/telemetry";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const apiSession = await requireApiSession(request);
  if (apiSession.response) return apiSession.response;

  const requestId = createRequestId();
  try {
    return NextResponse.json({ data: await getTelemetrySettings() });
  } catch (err) {
    logServerAction({ level: "error", layer: "api", action: "settings.telemetry.get", status: "error", requestId, message: "Failed to read telemetry settings", error: err });
    return NextResponse.json({ error: "Failed to read settings", code: "internal_error" }, { status: 500 });
  }
}

export async function PUT(request: Request) {
  const apiSession = await requireApiSession(request);
  if (apiSession.response) return apiSession.response;

  const requestId = createRequestId();
  try {
    const body = (await request.json().catch(() => null)) as Partial<TelemetrySettingsUpdateRequest> | null;
    if (typeof body?.enabled !== "boolean") {
      return NextResponse.json({ error: "enabled must be a boolean", code: "validation_error" }, { status: 400 });
    }

    await setTelemetryEnabled(body.enabled);
    return NextResponse.json({ data: await getTelemetrySettings() });
  } catch (err) {
    logServerAction({ level: "error", layer: "api", action: "settings.telemetry.put", status: "error", requestId, message: "Failed to save telemetry settings", error: err });
    return NextResponse.json({ error: "Failed to save settings", code: "internal_error" }, { status: 500 });
  }
}
