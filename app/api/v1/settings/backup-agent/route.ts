import { NextResponse } from "next/server";
import { requireApiSession } from "@/lib/server/modules/auth/api";
import { createRequestId, logServerAction } from "@/lib/server/logging/logger";
import {
  getBackupAgentConfig,
  saveBackupAgentConfig,
} from "@/lib/server/modules/integrations/backup-agent-config";
import { invalidateBackupAgentStatusCache } from "@/lib/server/modules/integrations/backup-agent-status";
import type { BackupAgentConfig } from "@/lib/shared/contracts/backup-agent";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const apiSession = await requireApiSession(request);
  if (apiSession.response) return apiSession.response;

  const requestId = createRequestId();
  try {
    return NextResponse.json({ data: await getBackupAgentConfig() });
  } catch (err) {
    logServerAction({
      level: "error",
      layer: "api",
      action: "settings.backup-agent.get",
      status: "error",
      requestId,
      message: "Failed to read homelab-backup config",
      error: err,
    });
    return NextResponse.json({ error: "Failed to read config", code: "internal_error" }, { status: 500 });
  }
}

export async function PUT(request: Request) {
  const apiSession = await requireApiSession(request);
  if (apiSession.response) return apiSession.response;

  const requestId = createRequestId();
  try {
    const body = (await request.json()) as Partial<BackupAgentConfig>;
    const enabled = Boolean(body.enabled);
    const url = typeof body.url === "string" ? body.url.trim() : "";
    const configPath = typeof body.configPath === "string" ? body.configPath.trim() : "";
    const port = typeof body.port === "number" ? body.port : undefined;

    if (enabled && url.length > 0) {
      try {
        void new URL(url);
      } catch {
        return NextResponse.json(
          { error: "That doesn't look like a valid URL (e.g. http://127.0.0.1:3095).", code: "validation_error" },
          { status: 400 },
        );
      }
    }

    if (enabled && url.length === 0 && port !== undefined) {
      if (!Number.isInteger(port) || port < 1 || port > 65535) {
        return NextResponse.json(
          { error: "Port must be a number between 1 and 65535.", code: "validation_error" },
          { status: 400 },
        );
      }
    }

    const config = await saveBackupAgentConfig({ enabled, url, port, configPath });
    invalidateBackupAgentStatusCache();

    return NextResponse.json({ data: config });
  } catch (err) {
    logServerAction({
      level: "error",
      layer: "api",
      action: "settings.backup-agent.put",
      status: "error",
      requestId,
      message: "Failed to save homelab-backup config",
      error: err,
    });
    return NextResponse.json({ error: "Failed to save config", code: "internal_error" }, { status: 500 });
  }
}
