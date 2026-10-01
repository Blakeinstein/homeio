import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import {
  createRequestId,
  logServerAction,
  withServerTiming,
} from "@/lib/server/logging/logger";
import { pruneDockerVolumes } from "@/lib/server/modules/docker/maintenance-service";
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
        action: "docker.prune.volumes.post",
        requestId,
      },
      async () => {
        const session = apiSession.session;

        const result = await pruneDockerVolumes();

        logServerAction({
          layer: "api",
          action: "docker.prune.volumes.post.completed",
          status: "success",
          requestId,
          message: "Completed Docker volume prune",
          meta: {
            userId: session.userId,
            username: session.username,
          },
        });

        return NextResponse.json({ data: result });
      },
    );
  } catch (error) {
    logServerAction({
      level: "error",
      layer: "api",
      action: "docker.prune.volumes.post.response",
      status: "error",
      requestId,
      message: "Failed to prune Docker volumes",
      error,
    });

    return NextResponse.json({ error: "Failed to prune Docker volumes" }, { status: 500 });
  }
}
