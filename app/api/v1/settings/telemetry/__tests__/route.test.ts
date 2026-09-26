import { describe, expect, it, vi } from "vitest";

const setTelemetryEnabled = vi.fn();
const getTelemetrySettings = vi.fn(async () => ({ enabled: false, disabledByEnv: false }));

vi.mock("@/lib/server/modules/telemetry/service", () => ({
  setTelemetryEnabled: (...args: unknown[]) => setTelemetryEnabled(...args),
  getTelemetrySettings: () => getTelemetrySettings(),
}));

import { PUT } from "@/app/api/v1/settings/telemetry/route";

function request(body: string) {
  return new Request("http://localhost/api/v1/settings/telemetry", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body,
  });
}

describe("PUT /api/v1/settings/telemetry", () => {
  it("turns telemetry off", async () => {
    const response = await PUT(request(JSON.stringify({ enabled: false })));

    expect(response.status).toBe(200);
    expect(setTelemetryEnabled).toHaveBeenCalledWith(false);
    expect(await response.json()).toEqual({ data: { enabled: false, disabledByEnv: false } });
  });

  it("refuses a body without a boolean", async () => {
    const response = await PUT(request(JSON.stringify({ enabled: "no" })));

    expect(response.status).toBe(400);
    expect(setTelemetryEnabled).not.toHaveBeenCalled();
  });

  it("refuses a body that is not JSON", async () => {
    const response = await PUT(request("nope"));

    expect(response.status).toBe(400);
    expect(setTelemetryEnabled).not.toHaveBeenCalled();
  });
});
