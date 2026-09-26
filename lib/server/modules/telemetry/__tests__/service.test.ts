import { beforeEach, describe, expect, it, vi } from "vitest";

const { env, row, updates } = vi.hoisted(() => ({
  env: {
    HOMEIO_TELEMETRY: true,
    HOMEIO_TELEMETRY_URL: "https://homeio.app/api/stats",
    DEMO_MODE: false,
    NODE_ENV: "production",
  },
  row: { current: { enabled: true, instanceId: null as string | null } },
  updates: [] as Array<Record<string, unknown>>,
}));

vi.mock("@/lib/server/env", () => ({ serverEnv: env }));
vi.mock("@/lib/server/logging/logger", () => ({ logServerAction: vi.fn() }));
vi.mock("@/lib/server/db/drizzle", () => ({
  db: {
    execute: vi.fn(async () => undefined),
    select: () => ({
      from: () => ({
        where: () => ({ limit: async () => [row.current] }),
      }),
    }),
    update: () => ({
      set: (values: Record<string, unknown>) => ({
        where: async () => {
          updates.push(values);
          if (typeof values.telemetryInstanceId === "string") {
            row.current = { ...row.current, instanceId: values.telemetryInstanceId };
          }
          if (typeof values.telemetryEnabled === "boolean") {
            row.current = { ...row.current, enabled: values.telemetryEnabled };
          }
        },
      }),
    }),
  },
}));

import {
  getTelemetrySettings,
  sendTelemetryPing,
  setTelemetryEnabled,
} from "@/lib/server/modules/telemetry/service";

function okFetch() {
  return vi.fn(async () => new Response(null, { status: 204 })) as unknown as typeof fetch & {
    mock: { calls: Array<[string, RequestInit]> };
  };
}

describe("telemetry service", () => {
  beforeEach(() => {
    env.HOMEIO_TELEMETRY = true;
    env.DEMO_MODE = false;
    env.NODE_ENV = "production";
    row.current = { enabled: true, instanceId: null };
    updates.length = 0;
  });

  it("sends only the instance ID, version, arch and platform", async () => {
    const fetchImpl = okFetch();

    expect(await sendTelemetryPing(fetchImpl)).toBe(true);

    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe("https://homeio.app/api/stats");
    const body = JSON.parse(String(init.body));
    expect(Object.keys(body).sort()).toEqual(["arch", "instanceId", "platform", "version"]);
    expect(body.instanceId).toMatch(/^[0-9a-f-]{36}$/);
    expect(body.arch).toBe(process.arch);
    expect(body.platform).toBe(process.platform);
  });

  it("keeps the same instance ID across pings", async () => {
    const fetchImpl = okFetch();

    await sendTelemetryPing(fetchImpl);
    await sendTelemetryPing(fetchImpl);

    const ids = fetchImpl.mock.calls.map(([, init]) => JSON.parse(String(init.body)).instanceId);
    expect(ids[0]).toBe(ids[1]);
    expect(updates.filter((values) => "telemetryInstanceId" in values)).toHaveLength(1);
  });

  it("sends nothing when turned off in settings", async () => {
    await setTelemetryEnabled(false);
    const fetchImpl = okFetch();

    expect(await sendTelemetryPing(fetchImpl)).toBe(false);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("sends nothing when HOMEIO_TELEMETRY=false, whatever the setting says", async () => {
    env.HOMEIO_TELEMETRY = false;
    const fetchImpl = okFetch();

    expect(await sendTelemetryPing(fetchImpl)).toBe(false);
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(await getTelemetrySettings()).toEqual({ enabled: false, disabledByEnv: true });
  });

  it("sends nothing outside production or in demo mode", async () => {
    const fetchImpl = okFetch();

    env.NODE_ENV = "development";
    expect(await sendTelemetryPing(fetchImpl)).toBe(false);

    env.NODE_ENV = "production";
    env.DEMO_MODE = true;
    expect(await sendTelemetryPing(fetchImpl)).toBe(false);

    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("swallows network failures", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error("offline");
    }) as unknown as typeof fetch;

    await expect(sendTelemetryPing(fetchImpl)).resolves.toBe(false);
  });
});
