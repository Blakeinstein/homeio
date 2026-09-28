import type { Server as HttpServer } from "node:http";

/**
 * How long nginx keeps an idle connection to Homeio open before reusing or
 * dropping it. The installer writes it into the upstream block
 * (`keepalive_timeout`); 60s is also nginx's default.
 */
export const NGINX_UPSTREAM_KEEPALIVE_MS = 60_000;

/**
 * Connections waiting to be accepted while the event loop is busy. Node's
 * default of 511 overflowed under load (thousands of drops a minute, each a
 * 502); the kernel caps it at net.core.somaxconn, 4096 on current distributions.
 */
export const LISTEN_BACKLOG = 4096;

/**
 * Node closes idle keep-alive sockets after 5s by default, but nginx reuses
 * them for up to a minute. Under load nginx then sends a request on a socket
 * Node is closing, and the visitor gets a 502 ("Connection reset by peer").
 * The side that closes idle connections must be the proxy: Node keeps them a
 * little longer than nginx does.
 */
export function configureUpstreamKeepAlive(
  server: Pick<HttpServer, "keepAliveTimeout" | "headersTimeout">,
) {
  server.keepAliveTimeout = NGINX_UPSTREAM_KEEPALIVE_MS + 5_000;
  // Node requires the header timeout to outlast the keep-alive timeout, or it
  // can drop a reused socket while the next request's headers arrive.
  server.headersTimeout = server.keepAliveTimeout + 1_000;
}
