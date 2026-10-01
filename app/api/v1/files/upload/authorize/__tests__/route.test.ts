import { NextRequest, NextResponse } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";

const { serverEnv } = vi.hoisted(() => ({ serverEnv: { DEMO_MODE: false } }));

vi.mock("@/lib/server/env", () => ({ serverEnv }));

import { GET } from "@/app/api/v1/files/upload/authorize/route";
import { requireApiSession } from "@/lib/server/modules/auth/api";

function authorize() {
  return GET(
    new NextRequest("http://localhost/api/v1/files/upload/authorize", {
      headers: { cookie: "homeio_session=session-token" },
    }),
  );
}

describe("GET /api/v1/files/upload/authorize", () => {
  afterEach(() => {
    serverEnv.DEMO_MODE = false;
  });

  it("lets a signed-in upload through", async () => {
    const response = await authorize();

    expect(response.status).toBe(204);
  });

  it("refuses a session the database no longer knows", async () => {
    vi.mocked(requireApiSession).mockResolvedValueOnce({
      session: null,
      response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    });

    const response = await authorize();

    expect(response.status).toBe(401);
  });

  it("blocks uploads in demo mode, like every other write", async () => {
    serverEnv.DEMO_MODE = true;

    const response = await authorize();
    const json = (await response.json()) as { error: string };

    expect(response.status).toBe(403);
    expect(json.error).toBe("This action is not available in demo mode.");
  });
});
