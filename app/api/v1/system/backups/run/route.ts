import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import {
  createRequestId,
  logServerAction,
  withServerTiming,
} from "@/lib/server/logging/logger";
import { runSystemBackupNow } from "@/lib/server/modules/system/backup-service";
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
        action: "system.backups.run.post",
        requestId,
      },
      async () => {
        const session = apiSession.session;

        const backup = await runSystemBackupNow();

        logServerAction({
          layer: "api",
          action: "system.backups.run.post.completed",
          status: "success",
          requestId,
          message: "System backup completed",
          meta: {
            userId: session.userId,
            username: session.username,
            backupId: backup.id,
            sizeBytes: backup.sizeBytes,
          },
        });

        return NextResponse.json(
          {
            data: {
              accepted: true,
              backup,
            },
          },
          { status: 202 },
        );
      },
    );
  } catch (error) {
    logServerAction({
      level: "error",
      layer: "api",
      action: "system.backups.run.post.response",
      status: "error",
      requestId,
      message: "Failed to run system backup",
      error,
    });

    return NextResponse.json({ error: "Failed to run backup" }, { status: 500 });
  }
}
