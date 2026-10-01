import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import {
  createRequestId,
  logServerAction,
  withServerTiming,
} from "@/lib/server/logging/logger";
import { scheduleSystemBackupRestore } from "@/lib/server/modules/system/backup-service";
import { emitPowerAction } from "@/lib/server/modules/system/power-action-events";
import { requireApiSession } from "@/lib/server/modules/auth/api";

export const runtime = "nodejs";

export async function POST(request: NextRequest,
  context: { params: Promise<{ backupId: string }> },) {
  const apiSession = await requireApiSession(request);
  if (apiSession.response) return apiSession.response;
  const requestId = createRequestId();

  try {
    return await withServerTiming(
      {
        layer: "api",
        action: "system.backups.restore.post",
        requestId,
      },
      async () => {
        const session = apiSession.session;

        const { backupId } = await context.params;

        try {
          const accepted = await scheduleSystemBackupRestore(backupId);
          emitPowerAction("restore");

          logServerAction({
            layer: "api",
            action: "system.backups.restore.post.accepted",
            status: "success",
            requestId,
            message: "Backup restore scheduled",
            meta: {
              userId: session.userId,
              username: session.username,
              backupId,
            },
          });

          return NextResponse.json({ data: accepted }, { status: 202 });
        } catch (error) {
          if (error instanceof Error && error.message === "Backup not found") {
            return NextResponse.json({ error: error.message }, { status: 404 });
          }
          throw error;
        }
      },
    );
  } catch (error) {
    logServerAction({
      level: "error",
      layer: "api",
      action: "system.backups.restore.post.response",
      status: "error",
      requestId,
      message: "Failed to schedule backup restore",
      error,
    });

    return NextResponse.json({ error: "Failed to schedule restore" }, { status: 500 });
  }
}
