import { createServer } from "node:http";
import { describe, expect, it } from "vitest";
import {
  NGINX_UPSTREAM_KEEPALIVE_MS,
  configureUpstreamKeepAlive,
} from "@/lib/server/http/keep-alive";

describe("configureUpstreamKeepAlive", () => {
  it("keeps idle connections open longer than nginx reuses them", () => {
    const server = createServer();

    configureUpstreamKeepAlive(server);

    expect(server.keepAliveTimeout).toBeGreaterThan(NGINX_UPSTREAM_KEEPALIVE_MS);
    expect(server.headersTimeout).toBeGreaterThan(server.keepAliveTimeout);
  });
});
