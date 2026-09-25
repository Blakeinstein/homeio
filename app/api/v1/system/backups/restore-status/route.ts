import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import {
  createRequestId,
  logServerAction,
  withServerTiming,
} from "@/lib/server/logging/logger";
import { readSystemRestoreOutcome } from "@/lib/server/modules/system/backup-service";
import { requireApiSession } from "@/lib/server/modules/auth/api";

export const runtime = "nodejs";

/**
 * How the last restore ended, as the restore script wrote it down. The screen
 * reads this when the server comes back, because a restore that failed and one
 * that worked both end with the server answering again.
 */
export async function GET(request: NextRequest) {
  const apiSession = await requireApiSession(request);
  if (apiSession.response) return apiSession.response;
  const requestId = createRequestId();

  try {
    return await withServerTiming(
      {
        layer: "api",
        action: "system.backups.restore-status.get",
        requestId,
      },
      async () => {
        const outcome = await readSystemRestoreOutcome();
        return NextResponse.json(
          { data: outcome },
          { headers: { "Cache-Control": "private, no-store" } },
        );
      },
    );
  } catch (error) {
    logServerAction({
      level: "error",
      layer: "api",
      action: "system.backups.restore-status.get.response",
      status: "error",
      requestId,
      message: "Failed to read the restore outcome",
      error,
    });

    return NextResponse.json({ error: "Failed to read the restore outcome" }, { status: 500 });
  }
}
