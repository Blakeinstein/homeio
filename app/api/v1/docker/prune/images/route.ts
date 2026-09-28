import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import {
  createRequestId,
  logServerAction,
  withServerTiming,
} from "@/lib/server/logging/logger";
import { pruneDockerImages } from "@/lib/server/modules/docker/maintenance-service";
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
        action: "docker.prune.images.post",
        requestId,
      },
      async () => {
        const session = apiSession.session;

        const result = await pruneDockerImages();

        logServerAction({
          layer: "api",
          action: "docker.prune.images.post.completed",
          status: "success",
          requestId,
          message: "Completed Docker image prune",
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
      action: "docker.prune.images.post.response",
      status: "error",
      requestId,
      message: "Failed to prune Docker images",
      error,
    });

    return NextResponse.json({ error: "Failed to prune Docker images" }, { status: 500 });
  }
}
