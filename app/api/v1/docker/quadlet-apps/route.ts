import { NextResponse } from "next/server";
import {
  createRequestId,
  logServerAction,
  withServerTiming,
} from "@/lib/server/logging/logger";
import { listQuadletApps } from "@/lib/server/modules/docker/quadlet-apps";
import { requireApiSession } from "@/lib/server/modules/auth/api";

export const runtime = "nodejs";

/**
 * GET /api/v1/docker/quadlet-apps
 *
 * Apps discovered from Podman quadlet service folders under
 * `QUADLET_SERVICES_ROOT`. Response shape: { data: QuadletApp[] }
 */
export async function GET(request: Request) {
  const apiSession = await requireApiSession(request);
  if (apiSession.response) return apiSession.response;
  const requestId = createRequestId();

  try {
    return await withServerTiming(
      {
        layer: "api",
        action: "docker.quadletApps.list.get",
        requestId,
      },
      async () => {
        const apps = await listQuadletApps();

        return NextResponse.json(
          { data: apps },
          { headers: { "Cache-Control": "no-store" } },
        );
      },
    );
  } catch (error) {
    logServerAction({
      level: "error",
      layer: "api",
      action: "docker.quadletApps.list.get.response",
      status: "error",
      requestId,
      message: "Failed to list quadlet apps",
      error,
    });

    return NextResponse.json(
      {
        error: "Failed to list quadlet apps",
        code: "internal_error",
      },
      { status: 500 },
    );
  }
}
