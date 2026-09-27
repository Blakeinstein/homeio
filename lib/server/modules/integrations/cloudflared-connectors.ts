/**
 * Telling Homeio's own cloudflared connector apart from any other one on the
 * host. Pure helpers, so the rules can be tested without a Docker daemon.
 */

/** Set on containers Homeio runs for itself rather than as an app. */
export const HOMEIO_COMPONENT_LABEL = "io.homeio.component";
export const CLOUDFLARE_TUNNEL_COMPONENT = "cloudflare-tunnel";
export const CLOUDFLARED_CONTAINER_NAME = "homeio-cloudflared";

const COMPOSE_PROJECT_LABEL = "com.docker.compose.project";

type ContainerSummary = {
  Names?: string[];
  Image?: string;
  Command?: string;
  Labels?: Record<string, string>;
};

/** Which Homeio component a container is, or null for apps and anything else. */
export function homeioComponentOf(container: ContainerSummary): string | null {
  const label = container.Labels?.[HOMEIO_COMPONENT_LABEL];
  if (label) return label;

  // Connectors created before 1.10 carry no label: recognise the exact name,
  // and only outside a compose project, so a user's app with that name stays an app.
  const named = container.Names?.some((name) => name.replace(/^\//, "") === CLOUDFLARED_CONTAINER_NAME);
  if (named && !container.Labels?.[COMPOSE_PROJECT_LABEL]) return CLOUDFLARE_TUNNEL_COMPONENT;

  return null;
}

export function isCloudflaredContainer(container: ContainerSummary) {
  return /cloudflared/i.test(container.Image ?? "") || /(^|[\s/])cloudflared(\s|$)/i.test(container.Command ?? "");
}

/** The connector token a cloudflared container runs with, from `--token` or TUNNEL_TOKEN. */
export function connectorTokenOf(config: { Cmd?: string[] | null; Env?: string[] | null }): string | null {
  const cmd = config.Cmd ?? [];
  for (let index = 0; index < cmd.length; index += 1) {
    const arg = cmd[index];
    if (arg === "--token" && cmd[index + 1]) return cmd[index + 1];
    if (arg.startsWith("--token=")) return arg.slice("--token=".length);
  }

  const env = (config.Env ?? []).find((entry) => entry.startsWith("TUNNEL_TOKEN="));
  return env ? env.slice("TUNNEL_TOKEN=".length) || null : null;
}

/** A connector token is base64 JSON: {"a": account, "t": tunnel id, "s": secret}. */
export function tunnelIdOf(token: string | null | undefined): string | null {
  if (!token) return null;
  try {
    const decoded = JSON.parse(Buffer.from(token.trim(), "base64").toString("utf8")) as { t?: unknown };
    return typeof decoded.t === "string" && decoded.t.length > 0 ? decoded.t : null;
  } catch {
    return null;
  }
}
