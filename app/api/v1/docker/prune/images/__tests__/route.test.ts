import { NextRequest, NextResponse } from "next/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/server/modules/docker/maintenance-service", () => ({
  pruneDockerImages: vi.fn(),
}));

import { POST } from "@/app/api/v1/docker/prune/images/route";
import { requireApiSession } from "@/lib/server/modules/auth/api";
import { pruneDockerImages } from "@/lib/server/modules/docker/maintenance-service";

describe("/api/v1/docker/prune/images", () => {
  it("returns 401 for unauthenticated requests", async () => {
    vi.mocked(requireApiSession).mockResolvedValueOnce({
      session: null,
      response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    });

    const response = await POST(
      new NextRequest("http://localhost/api/v1/docker/prune/images"),
    );

    expect(response.status).toBe(401);
  });

  it("prunes docker images for authenticated users", async () => {
    vi.mocked(pruneDockerImages).mockResolvedValueOnce({
      command: "images",
      output: "Deleted Images:\nsha256:deadbeef",
    });

    const response = await POST(
      new NextRequest("http://localhost/api/v1/docker/prune/images", {
        method: "POST",
        headers: {
          cookie: "homeio_session=session-token",
        },
      }),
    );
    const json = (await response.json()) as {
      data: { command: string; output: string };
    };

    expect(response.status).toBe(200);
    expect(pruneDockerImages).toHaveBeenCalledTimes(1);
    expect(json.data.command).toBe("images");
  });

  it("returns 500 when prune fails", async () => {
    vi.mocked(pruneDockerImages).mockRejectedValueOnce(new Error("docker prune failed"));

    const response = await POST(
      new NextRequest("http://localhost/api/v1/docker/prune/images", {
        method: "POST",
        headers: {
          cookie: "homeio_session=session-token",
        },
      }),
    );
    const json = (await response.json()) as { error: string };

    expect(response.status).toBe(500);
    expect(json.error).toBe("Failed to prune Docker images");
  });
});
