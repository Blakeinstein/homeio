import "server-only";

import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { eq, sql } from "drizzle-orm";
import { db } from "@/lib/server/db/drizzle";
import { settings } from "@/lib/server/db/schema";
import { serverEnv } from "@/lib/server/env";
import { logServerAction } from "@/lib/server/logging/logger";
import { isContainerRuntime } from "@/lib/server/modules/system/update-service";
import type {
  TelemetryPingPayload,
  TelemetrySettings,
} from "@/lib/shared/contracts/telemetry";

/** First ping waits for startup to settle, then one every 12 hours. */
const FIRST_PING_DELAY_MS = 60_000;
const PING_INTERVAL_MS = 12 * 60 * 60_000;
const PING_TIMEOUT_MS = 10_000;

let started = false;

async function ensureSettingsRow() {
  await db.execute(sql`
    INSERT INTO settings (id, appearance_json, updated_at)
    VALUES ('singleton', '{}', NOW())
    ON CONFLICT (id) DO NOTHING
  `);
}

async function readTelemetryRow() {
  await ensureSettingsRow();

  const rows = await db
    .select({
      enabled: settings.telemetryEnabled,
      instanceId: settings.telemetryInstanceId,
    })
    .from(settings)
    .where(eq(settings.id, "singleton"))
    .limit(1);

  return rows[0] ?? { enabled: true, instanceId: null };
}

/** The random ID this server reports under, created on first use. */
async function resolveInstanceId(existing: string | null) {
  if (existing) return existing;

  const instanceId = randomUUID();
  await db
    .update(settings)
    .set({ telemetryInstanceId: instanceId })
    .where(eq(settings.id, "singleton"));
  return instanceId;
}

async function readCurrentVersion() {
  const raw = await readFile(path.join(process.cwd(), "package.json"), "utf8");
  const parsed = JSON.parse(raw) as { version?: string };
  return parsed.version?.trim() || "unknown";
}

const OS_RELEASE_PATH = "/etc/os-release";
const DISTRO_ID = /^[a-z0-9._-]{1,32}$/;
const DISTRO_VERSION = /^[0-9a-z._-]{1,16}$/i;

/** ID and VERSION_ID from os-release text; anything unexpected becomes null. */
export function parseOsRelease(text: string) {
  const fields = new Map<string, string>();
  for (const line of text.split("\n")) {
    const match = line.match(/^([A-Z_]+)=(.*)$/);
    if (match) fields.set(match[1], match[2].trim().replace(/^(["'])(.*)\1$/, "$2"));
  }
  const id = fields.get("ID")?.toLowerCase() ?? "";
  const version = fields.get("VERSION_ID") ?? "";
  return {
    distro: DISTRO_ID.test(id) ? id : null,
    distroVersion: DISTRO_ID.test(id) && DISTRO_VERSION.test(version) ? version : null,
  };
}

async function readHostSystem(): Promise<Pick<TelemetryPingPayload, "install" | "distro" | "distroVersion">> {
  // Inside a container, os-release describes the image, not the host.
  if (isContainerRuntime()) return { install: "docker", distro: null, distroVersion: null };
  try {
    return { install: "host", ...parseOsRelease(await readFile(OS_RELEASE_PATH, "utf8")) };
  } catch {
    return { install: "host", distro: null, distroVersion: null };
  }
}

export async function getTelemetrySettings(): Promise<TelemetrySettings> {
  const row = await readTelemetryRow();
  const disabledByEnv = !serverEnv.HOMEIO_TELEMETRY;
  return {
    enabled: row.enabled && !disabledByEnv,
    disabledByEnv,
  };
}

export async function setTelemetryEnabled(enabled: boolean) {
  await ensureSettingsRow();
  await db
    .update(settings)
    .set({ telemetryEnabled: enabled, updatedAt: new Date() })
    .where(eq(settings.id, "singleton"));
}

export function buildTelemetryPayload(
  instanceId: string,
  version: string,
  system: Pick<TelemetryPingPayload, "install" | "distro" | "distroVersion">,
): TelemetryPingPayload {
  return {
    instanceId,
    version,
    arch: process.arch,
    platform: process.platform,
    ...system,
  };
}

function telemetryAllowedByEnv() {
  return (
    serverEnv.HOMEIO_TELEMETRY &&
    !serverEnv.DEMO_MODE &&
    serverEnv.NODE_ENV === "production"
  );
}

/**
 * Report this server to homeio.app/stats. Best-effort: a failed ping is
 * logged at debug level and never surfaces to the user.
 */
export async function sendTelemetryPing(fetchImpl: typeof fetch = fetch) {
  if (!telemetryAllowedByEnv()) return false;

  try {
    const row = await readTelemetryRow();
    if (!row.enabled) return false;

    const payload = buildTelemetryPayload(
      await resolveInstanceId(row.instanceId),
      await readCurrentVersion(),
      await readHostSystem(),
    );

    const response = await fetchImpl(serverEnv.HOMEIO_TELEMETRY_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(PING_TIMEOUT_MS),
    });

    if (!response.ok) {
      throw new Error(`Stats endpoint answered ${response.status}`);
    }
    return true;
  } catch (error) {
    logServerAction({
      level: "debug",
      layer: "service",
      action: "telemetry.ping",
      status: "error",
      message: "Anonymous stats ping failed",
      error,
    });
    return false;
  }
}

export function startTelemetry() {
  if (started || !telemetryAllowedByEnv()) return;
  started = true;

  setTimeout(() => void sendTelemetryPing(), FIRST_PING_DELAY_MS).unref();
  setInterval(() => void sendTelemetryPing(), PING_INTERVAL_MS).unref();
}
