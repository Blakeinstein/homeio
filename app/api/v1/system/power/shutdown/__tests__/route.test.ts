import { NextRequest, NextResponse } from "next/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/server/modules/system/power-service", () => ({
  scheduleSystemShutdown: vi.fn(),
}));

import { POST } from "@/app/api/v1/system/power/shutdown/route";
import { requireApiSession } from "@/lib/server/modules/auth/api";
import { scheduleSystemShutdown } from "@/lib/server/modules/system/power-service";

describe("POST /api/v1/system/power/shutdown", () => {
  it("returns 202 and schedules shutdown for authenticated users", async () => {
    vi.mocked(scheduleSystemShutdown).mockResolvedValueOnce(undefined);

    const request = new NextRequest("http://localhost/api/v1/system/power/shutdown", {
      method: "POST",
      headers: {
        cookie: "homeio_session=session-token",
      },
    });

    const response = await POST(request);
    const json = (await response.json()) as {
      data: { action: string; accepted: boolean };
    };

    expect(response.status).toBe(202);
    expect(json.data).toEqual({ action: "shutdown", accepted: true });
    expect(scheduleSystemShutdown).toHaveBeenCalledOnce();
  });

  it("returns 401 when the session is missing or invalid", async () => {
    vi.mocked(requireApiSession).mockResolvedValueOnce({
      session: null,
      response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    });

    const request = new NextRequest("http://localhost/api/v1/system/power/shutdown", {
      method: "POST",
    });

    const response = await POST(request);

    expect(response.status).toBe(401);
    expect(scheduleSystemShutdown).not.toHaveBeenCalled();
  });

  it("returns 500 when shutdown scheduling fails", async () => {
    vi.mocked(scheduleSystemShutdown).mockRejectedValueOnce(new Error("spawn failed"));

    const request = new NextRequest("http://localhost/api/v1/system/power/shutdown", {
      method: "POST",
      headers: {
        cookie: "homeio_session=session-token",
      },
    });

    const response = await POST(request);
    const json = (await response.json()) as { error: string };

    expect(response.status).toBe(500);
    expect(json.error).toBe("Failed to schedule shutdown");
  });
});
