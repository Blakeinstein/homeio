/* @vitest-environment jsdom */

import { afterEach, describe, expect, it, vi } from "vitest";
import { resolveBackupAgentDashboardUrl } from "@/lib/shared/backup-agent-url";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("resolveBackupAgentDashboardUrl", () => {
  it("prefers an absolute dashboard URL when set", () => {
    const url = resolveBackupAgentDashboardUrl({
      dashboardUrl: "http://backup.local:9000",
      relativePort: 3095,
    });
    expect(url).toBe("http://backup.local:9000");
  });

  it("builds a URL from the browser's own protocol and hostname when only a port is set", () => {
    vi.stubGlobal("window", {
      location: { protocol: "https:", hostname: "homeio.tailnet.ts.net" },
    });

    const url = resolveBackupAgentDashboardUrl({ dashboardUrl: null, relativePort: 3095 });
    expect(url).toBe("https://homeio.tailnet.ts.net:3095");
  });

  it("returns null when neither is set", () => {
    const url = resolveBackupAgentDashboardUrl({ dashboardUrl: null, relativePort: null });
    expect(url).toBeNull();
  });
});
