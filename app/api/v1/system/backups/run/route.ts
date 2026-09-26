import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import {
  createRequestId,
  logServerAction,
  withServerTiming,
} from "@/lib/server/logging/logger";
import { getAuthCookieName } from "@/lib/server/modules/auth/cookies";
import { authenticateSession } from "@/lib/server/modules/auth/service";
import { runSystemBackupNow } from "@/lib/server/modules/system/backup-service";
import { isCommandMissing } from "@/lib/server/platform/process";
import { requireApiSession } from "@/lib/server/modules/auth/api";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  const apiSession = await requireApiSession(request);
  if (apiSession.response) return apiSession.response;
  const requestId = createRequestId();
  const sessionToken = request.cookies.get(getAuthCookieName())?.value;

  try {
    return await withServerTiming(
      {
        layer: "api",
        action: "system.backups.run.post",
        requestId,
      },
      async () => {
        const session = await authenticateSession(sessionToken);
        if (!session) {
          return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }

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
    // A missing tool is a fact about this host, not a server fault: say which
    // one, so the answer is "not here" rather than "try again".
    if (isCommandMissing(error)) {
      return NextResponse.json(
        { error: (error as Error).message, code: "unavailable_on_host" },
        { status: 409 },
      );
    }

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
