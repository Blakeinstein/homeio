import { NextRequest } from "next/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/server/modules/auth/service", () => ({
  authenticateSession: vi.fn(),
}));

vi.mock("@/lib/server/modules/system/backup-service", () => ({
  scheduleSystemBackupRestore: vi.fn(),
}));

import { POST } from "@/app/api/v1/system/backups/[backupId]/restore/route";
import { authenticateSession } from "@/lib/server/modules/auth/service";
import { scheduleSystemBackupRestore } from "@/lib/server/modules/system/backup-service";
import { ProcessError } from "@/lib/server/platform/process";

describe("POST /api/v1/system/backups/[backupId]/restore", () => {
  it("returns 202 when restore scheduling succeeds", async () => {
    vi.mocked(authenticateSession).mockResolvedValueOnce({
      sessionId: "s1",
      userId: "u1",
      username: "ahmed",
      passwordHash: "salt:hash",
      expiresAt: new Date(Date.now() + 60_000),
    });
    vi.mocked(scheduleSystemBackupRestore).mockResolvedValueOnce({
      action: "restore",
      accepted: true,
      backupId: "backup-1",
      restoreId: "restore-1",
    });

    const response = await POST(
      new NextRequest("http://localhost/api/v1/system/backups/backup-1/restore", {
        method: "POST",
        headers: {
          cookie: "homeio_session=session-token",
        },
      }),
      { params: Promise.resolve({ backupId: "backup-1" }) },
    );

    expect(response.status).toBe(202);
    expect(scheduleSystemBackupRestore).toHaveBeenCalledWith("backup-1");
  });

  it("returns 404 for unknown backups", async () => {
    vi.mocked(authenticateSession).mockResolvedValueOnce({
      sessionId: "s1",
      userId: "u1",
      username: "ahmed",
      passwordHash: "salt:hash",
      expiresAt: new Date(Date.now() + 60_000),
    });
    vi.mocked(scheduleSystemBackupRestore).mockRejectedValueOnce(new Error("Backup not found"));

    const response = await POST(
      new NextRequest("http://localhost/api/v1/system/backups/missing/restore", {
        method: "POST",
        headers: {
          cookie: "homeio_session=session-token",
        },
      }),
      { params: Promise.resolve({ backupId: "missing" }) },
    );

    expect(response.status).toBe(404);
  });

  it("says which tool is missing, as a 409, when this host cannot restore", async () => {
    vi.mocked(authenticateSession).mockResolvedValue({
      sessionId: "s1",
      userId: "u1",
      username: "ahmed",
      passwordHash: "salt:hash",
      expiresAt: new Date(Date.now() + 60_000),
    });
    vi.mocked(scheduleSystemBackupRestore).mockRejectedValueOnce(
      new ProcessError("systemd-run", Object.assign(new Error("spawn systemd-run ENOENT"), { code: "ENOENT" })),
    );

    const response = await POST(
      new NextRequest("http://localhost/api/v1/system/backups/backup-1/restore", {
        method: "POST",
        headers: { cookie: "homeio_session=session-token" },
      }),
      { params: Promise.resolve({ backupId: "backup-1" }) },
    );
    const json = (await response.json()) as { error: string };

    expect(response.status).toBe(409);
    expect(json.error).toBe("systemd-run is not available on this host");
  });
});
