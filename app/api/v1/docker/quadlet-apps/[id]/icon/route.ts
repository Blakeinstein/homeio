import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { NextResponse } from "next/server";
import {
  createRequestId,
  logServerAction,
  withServerTiming,
} from "@/lib/server/logging/logger";
import { requireApiSession } from "@/lib/server/modules/auth/api";
import { findQuadletServiceById } from "@/lib/server/modules/docker/quadlet-apps";
import { resolveLocalIconPath } from "@/lib/server/modules/docker/quadlet-discovery";

export const runtime = "nodejs";

const EXTENSION_CONTENT_TYPES: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".ico": "image/x-icon",
};

type Context = {
  params: Promise<{
    id: string;
  }>;
};

/**
 * GET /api/v1/docker/quadlet-apps/[id]/icon
 *
 * Streams a quadlet app's locally-stored icon file (an app.yaml `icon:` that
 * is a relative path rather than a URL). 404s for apps with no local icon.
 */
export async function GET(request: Request, context: Context) {
  const apiSession = await requireApiSession(request);
  if (apiSession.response) return apiSession.response;
  const requestId = createRequestId();
  const { id } = await context.params;

  try {
    return await withServerTiming(
      {
        layer: "api",
        action: "docker.quadletApps.icon.get",
        requestId,
        meta: { id },
      },
      async () => {
        const service = await findQuadletServiceById(id);
        if (!service) {
          return NextResponse.json(
            { error: "Quadlet app not found", code: "not_found" },
            { status: 404 },
          );
        }

        const iconPath = resolveLocalIconPath(service);
        if (!iconPath) {
          return NextResponse.json(
            { error: "This app has no local icon", code: "not_found" },
            { status: 404 },
          );
        }

        const contentType = EXTENSION_CONTENT_TYPES[path.extname(iconPath).toLowerCase()];
        if (!contentType) {
          return NextResponse.json(
            { error: "Unsupported icon file type", code: "unsupported_file" },
            { status: 415 },
          );
        }

        const fileInfo = await stat(iconPath).catch(() => null);
        if (!fileInfo || !fileInfo.isFile()) {
          return NextResponse.json(
            { error: "Icon file not found", code: "not_found" },
            { status: 404 },
          );
        }

        const stream = createReadStream(iconPath);
        return new NextResponse(Readable.toWeb(stream) as ReadableStream, {
          status: 200,
          headers: {
            "Content-Type": contentType,
            "Content-Length": String(fileInfo.size),
            "Cache-Control": "private, max-age=300",
            "X-Content-Type-Options": "nosniff",
          },
        });
      },
    );
  } catch (error) {
    logServerAction({
      level: "error",
      layer: "api",
      action: "docker.quadletApps.icon.get.response",
      status: "error",
      requestId,
      message: "Failed to stream quadlet app icon",
      error,
    });

    return NextResponse.json(
      {
        error: "Failed to stream quadlet app icon",
        code: "internal_error",
      },
      { status: 500 },
    );
  }
}
