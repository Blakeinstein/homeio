import { NextRequest, NextResponse } from "next/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/server/modules/system/metrics-history", () => ({
  getMetricsHistory: vi.fn((range: string) => ({
    range,
    intervalSeconds: range === "1h" ? 5 : 60,
    points: [],
  })),
}));

import { GET } from "@/app/api/v1/system/metrics/history/route";
import { requireApiSession } from "@/lib/server/modules/auth/api";

function request(query = "") {
  return new NextRequest(`http://localhost/api/v1/system/metrics/history${query}`);
}

describe("GET /api/v1/system/metrics/history", () => {
  it("returns 15 minutes by default, and the hour or the day on request", async () => {
    const quarter = await GET(request());
    expect(quarter.status).toBe(200);
    expect(quarter.headers.get("cache-control")).toBe("no-store");
    expect(((await quarter.json()) as { data: { range: string } }).data.range).toBe("15m");

    const hour = await GET(request("?range=1h"));
    expect(((await hour.json()) as { data: { range: string } }).data.range).toBe("1h");

    const day = await GET(request("?range=24h"));
    expect(((await day.json()) as { data: { intervalSeconds: number } }).data.intervalSeconds).toBe(60);
  });

  it("rejects an unknown range", async () => {
    const response = await GET(request("?range=7d"));
    expect(response.status).toBe(400);
  });

  it("returns 401 without a session", async () => {
    // test/setup.ts signs every request in; refuse this one.
    vi.mocked(requireApiSession).mockResolvedValueOnce({
      session: null,
      response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    });

    const response = await GET(request());
    expect(response.status).toBe(401);
  });
});
