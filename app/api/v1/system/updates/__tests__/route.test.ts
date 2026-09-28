import { NextRequest, NextResponse } from "next/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/server/modules/system/update-service", () => ({
  getSystemUpdateStatus: vi.fn(),
}));

import { GET } from "@/app/api/v1/system/updates/route";
import { requireApiSession } from "@/lib/server/modules/auth/api";
import { getSystemUpdateStatus } from "@/lib/server/modules/system/update-service";

describe("GET /api/v1/system/updates", () => {
  it("returns Homeio update status for authenticated users", async () => {
    vi.mocked(getSystemUpdateStatus).mockResolvedValueOnce({
      currentVersion: "0.1.74",
      latestVersion: "0.1.75",
      updateAvailable: true,
      checkedAt: "2026-03-08T10:00:00.000Z",
    });

    const response = await GET(
      new NextRequest("http://localhost/api/v1/system/updates", {
        headers: { cookie: "homeio_session=session-token" },
      }),
    );
    const json = (await response.json()) as { data: { currentVersion: string } };

    expect(response.status).toBe(200);
    expect(json.data.currentVersion).toBe("0.1.74");
  });

  it("returns 401 for unauthenticated requests", async () => {
    vi.mocked(requireApiSession).mockResolvedValueOnce({
      session: null,
      response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    });

    const response = await GET(new NextRequest("http://localhost/api/v1/system/updates"));

    expect(response.status).toBe(401);
  });
});
