import { NextRequest, NextResponse } from "next/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/server/modules/system/security-service", () => ({
  getSystemSecuritySettings: vi.fn(),
  updateSystemSecuritySettings: vi.fn(),
}));

import { GET, PUT } from "@/app/api/v1/system/security/route";
import { requireApiSession } from "@/lib/server/modules/auth/api";
import {
  getSystemSecuritySettings,
  updateSystemSecuritySettings,
} from "@/lib/server/modules/system/security-service";

describe("/api/v1/system/security", () => {
  it("returns current security settings for authenticated users", async () => {
    vi.mocked(getSystemSecuritySettings).mockResolvedValueOnce({
      firewallEnabled: true,
      firewallIncomingPolicy: "deny",
      firewallOutgoingPolicy: "allow",
      fail2banEnabled: true,
      fail2banMaxRetries: 5,
      fail2banBanDurationSeconds: 3600,
    });

    const response = await GET(
      new NextRequest("http://localhost/api/v1/system/security", {
        headers: {
          cookie: "homeio_session=session-token",
        },
      }),
    );
    const json = (await response.json()) as {
      data: {
        firewallEnabled: boolean;
        firewallIncomingPolicy: string;
        firewallOutgoingPolicy: string;
        fail2banEnabled: boolean;
        fail2banMaxRetries: number;
        fail2banBanDurationSeconds: number;
      };
    };

    expect(response.status).toBe(200);
    expect(json.data.firewallEnabled).toBe(true);
    expect(json.data.fail2banBanDurationSeconds).toBe(3600);
  });

  it("returns 401 for unauthenticated requests", async () => {
    vi.mocked(requireApiSession).mockResolvedValueOnce({
      session: null,
      response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    });

    const response = await GET(new NextRequest("http://localhost/api/v1/system/security"));

    expect(response.status).toBe(401);
  });

  it("updates security settings for authenticated users", async () => {
    vi.mocked(updateSystemSecuritySettings).mockResolvedValueOnce({
      firewallEnabled: true,
      firewallIncomingPolicy: "reject",
      firewallOutgoingPolicy: "deny",
      fail2banEnabled: false,
      fail2banMaxRetries: 7,
      fail2banBanDurationSeconds: 7200,
    });

    const payload = {
      firewallEnabled: true,
      firewallIncomingPolicy: "reject",
      firewallOutgoingPolicy: "deny",
      fail2banEnabled: false,
      fail2banMaxRetries: 7,
      fail2banBanDurationSeconds: 7200,
    };

    const response = await PUT(
      new NextRequest("http://localhost/api/v1/system/security", {
        method: "PUT",
        headers: {
          cookie: "homeio_session=session-token",
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      }),
    );
    const json = (await response.json()) as { data: typeof payload };

    expect(response.status).toBe(200);
    expect(updateSystemSecuritySettings).toHaveBeenCalledWith(payload);
    expect(json.data.fail2banMaxRetries).toBe(7);
  });

  it("returns 400 for invalid payloads", async () => {

    const response = await PUT(
      new NextRequest("http://localhost/api/v1/system/security", {
        method: "PUT",
        headers: {
          cookie: "homeio_session=session-token",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ firewallEnabled: true }),
      }),
    );
    const json = (await response.json()) as { error: string };

    expect(response.status).toBe(400);
    expect(json.error).toBe("Invalid system security payload");
  });

  it("returns 400 for invalid policy and numeric values", async () => {
    vi.mocked(updateSystemSecuritySettings).mockRejectedValueOnce(
      new Error("Invalid incoming policy. Choose allow, deny, or reject."),
    );

    const response = await PUT(
      new NextRequest("http://localhost/api/v1/system/security", {
        method: "PUT",
        headers: {
          cookie: "homeio_session=session-token",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          firewallEnabled: true,
          firewallIncomingPolicy: "drop",
          firewallOutgoingPolicy: "allow",
          fail2banEnabled: true,
          fail2banMaxRetries: 5,
          fail2banBanDurationSeconds: 3600,
        }),
      }),
    );
    const json = (await response.json()) as { error: string };

    expect(response.status).toBe(400);
    expect(json.error).toContain("Invalid incoming policy");
  });

  it("returns 500 when the service fails", async () => {
    vi.mocked(updateSystemSecuritySettings).mockRejectedValueOnce(
      new Error("ufw failed"),
    );

    const response = await PUT(
      new NextRequest("http://localhost/api/v1/system/security", {
        method: "PUT",
        headers: {
          cookie: "homeio_session=session-token",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          firewallEnabled: true,
          firewallIncomingPolicy: "deny",
          firewallOutgoingPolicy: "allow",
          fail2banEnabled: true,
          fail2banMaxRetries: 5,
          fail2banBanDurationSeconds: 3600,
        }),
      }),
    );
    const json = (await response.json()) as { error: string };

    expect(response.status).toBe(500);
    expect(json.error).toBe("Failed to update security settings");
  });
});
