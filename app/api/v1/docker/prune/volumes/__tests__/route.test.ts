import { NextRequest, NextResponse } from "next/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/server/modules/docker/maintenance-service", () => ({
  pruneDockerVolumes: vi.fn(),
}));

import { POST } from "@/app/api/v1/docker/prune/volumes/route";
import { requireApiSession } from "@/lib/server/modules/auth/api";
import { pruneDockerVolumes } from "@/lib/server/modules/docker/maintenance-service";

describe("/api/v1/docker/prune/volumes", () => {
  it("returns 401 for unauthenticated requests", async () => {
    vi.mocked(requireApiSession).mockResolvedValueOnce({
      session: null,
      response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    });

    const response = await POST(
      new NextRequest("http://localhost/api/v1/docker/prune/volumes"),
    );

    expect(response.status).toBe(401);
  });

  it("prunes docker volumes for authenticated users", async () => {
    vi.mocked(pruneDockerVolumes).mockResolvedValueOnce({
      command: "volumes",
      output: "Deleted Volumes:\nold-volume",
    });

    const response = await POST(
      new NextRequest("http://localhost/api/v1/docker/prune/volumes", {
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
    expect(pruneDockerVolumes).toHaveBeenCalledTimes(1);
    expect(json.data.command).toBe("volumes");
  });

  it("returns 500 when prune fails", async () => {
    vi.mocked(pruneDockerVolumes).mockRejectedValueOnce(new Error("docker volume prune failed"));

    const response = await POST(
      new NextRequest("http://localhost/api/v1/docker/prune/volumes", {
        method: "POST",
        headers: {
          cookie: "homeio_session=session-token",
        },
      }),
    );
    const json = (await response.json()) as { error: string };

    expect(response.status).toBe(500);
    expect(json.error).toBe("Failed to prune Docker volumes");
  });
});
