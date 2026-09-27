import { describe, expect, it } from "vitest";
import {
  connectorTokenOf,
  homeioComponentOf,
  isCloudflaredContainer,
  tunnelIdOf,
} from "@/lib/server/modules/integrations/cloudflared-connectors";

const token = (tunnel: string) =>
  Buffer.from(JSON.stringify({ a: "account", t: tunnel, s: "secret" })).toString("base64");

describe("homeioComponentOf", () => {
  it("reads the component label", () => {
    expect(
      homeioComponentOf({ Names: ["/whatever"], Labels: { "io.homeio.component": "cloudflare-tunnel" } }),
    ).toBe("cloudflare-tunnel");
  });

  it("recognises a connector created before the label existed", () => {
    expect(homeioComponentOf({ Names: ["/homeio-cloudflared"], Labels: {} })).toBe("cloudflare-tunnel");
  });

  it("leaves a user's own cloudflared app alone, even under the same name", () => {
    expect(homeioComponentOf({ Names: ["/cloudflared"], Labels: {} })).toBeNull();
    expect(
      homeioComponentOf({
        Names: ["/homeio-cloudflared"],
        Labels: { "com.docker.compose.project": "cloudflared" },
      }),
    ).toBeNull();
  });
});

describe("isCloudflaredContainer", () => {
  it("matches on the image or the command", () => {
    expect(isCloudflaredContainer({ Image: "cloudflare/cloudflared:2025.1.0" })).toBe(true);
    expect(isCloudflaredContainer({ Image: "sha256:abc", Command: "cloudflared --no-autoupdate tunnel run" })).toBe(true);
    expect(isCloudflaredContainer({ Image: "nginx:alpine", Command: "nginx -g daemon off;" })).toBe(false);
  });
});

describe("connector tokens", () => {
  it("finds the token in the command or the environment", () => {
    expect(connectorTokenOf({ Cmd: ["tunnel", "run", "--token", "abc"] })).toBe("abc");
    expect(connectorTokenOf({ Cmd: ["tunnel", "run", "--token=abc"] })).toBe("abc");
    expect(connectorTokenOf({ Cmd: ["tunnel", "run"], Env: ["PATH=/bin", "TUNNEL_TOKEN=xyz"] })).toBe("xyz");
    expect(connectorTokenOf({ Cmd: ["tunnel", "run"], Env: null })).toBeNull();
  });

  it("reads the tunnel id out of a token", () => {
    expect(tunnelIdOf(token("tunnel-1"))).toBe("tunnel-1");
    expect(tunnelIdOf("not-a-token")).toBeNull();
    expect(tunnelIdOf(null)).toBeNull();
  });
});
