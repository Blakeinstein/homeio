import { NextRequest } from "next/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/server/modules/system/update-service", () => ({
  getSystemUpdateStatus: vi.fn(),
}));

import { POST } from "@/app/api/v1/system/updates/check/route";
import { getSystemUpdateStatus } from "@/lib/server/modules/system/update-service";

describe("POST /api/v1/system/updates/check", () => {
  it("checks Homeio updates for authenticated users", async () => {
    vi.mocked(getSystemUpdateStatus).mockResolvedValueOnce({
      currentVersion: "0.1.74",
      latestVersion: "0.1.75",
      updateAvailable: true,
      checkedAt: "2026-03-08T10:00:00.000Z",
    });

    const response = await POST(
      new NextRequest("http://localhost/api/v1/system/updates/check", {
        method: "POST",
        headers: { cookie: "homeio_session=session-token" },
      }),
    );
    const json = (await response.json()) as { data: { latestVersion: string | null } };

    expect(response.status).toBe(200);
    expect(json.data.latestVersion).toBe("0.1.75");
    // "Check now" must ask GitHub, not return the cached answer.
    expect(getSystemUpdateStatus).toHaveBeenCalledWith({ refresh: true });
  });

  it("returns 500 when the update check fails", async () => {
    vi.mocked(getSystemUpdateStatus).mockRejectedValueOnce(new Error("fetch failed"));

    const response = await POST(
      new NextRequest("http://localhost/api/v1/system/updates/check", {
        method: "POST",
        headers: { cookie: "homeio_session=session-token" },
      }),
    );
    const json = (await response.json()) as { error: string };

    expect(response.status).toBe(500);
    expect(json.error).toBe("Failed to check for Homeio updates");
  });
});
