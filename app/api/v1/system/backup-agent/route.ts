import { NextResponse } from "next/server";
import { requireApiSession } from "@/lib/server/modules/auth/api";
import { createRequestId, logServerAction } from "@/lib/server/logging/logger";
import { getBackupAgentStatus } from "@/lib/server/modules/integrations/backup-agent-status";

export const runtime = "nodejs";

/**
 * GET /api/v1/system/backup-agent
 *
 * Whether homelab-backup (a standalone agent, not a container Homeio drives)
 * is configured, and the status of its own dashboard. Response shape:
 * { data: BackupAgentStatus }
 */
export async function GET(request: Request) {
  const apiSession = await requireApiSession(request);
  if (apiSession.response) return apiSession.response;

  const requestId = createRequestId();
  try {
    const status = await getBackupAgentStatus();
    return NextResponse.json({ data: status });
  } catch (error) {
    logServerAction({
      level: "error",
      layer: "api",
      action: "system.backupAgent.status",
      status: "error",
      requestId,
      message: "Failed to read homelab-backup status",
      error,
    });
    return NextResponse.json(
      { error: "Failed to read homelab-backup status", code: "internal_error" },
      { status: 500 },
    );
  }
}
