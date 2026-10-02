import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockAccess, mockGetBackupAgentConfig } = vi.hoisted(() => ({
  mockAccess: vi.fn(),
  mockGetBackupAgentConfig: vi.fn(),
}));

const serverEnvMock: { QUADLET_SERVICES_ROOT?: string; HOMELAB_BACKUP_URL?: string } = {};

vi.mock("node:fs/promises", () => ({
  access: mockAccess,
}));

vi.mock("@/lib/server/env", () => ({
  get serverEnv() {
    return serverEnvMock;
  },
}));

vi.mock("@/lib/server/modules/integrations/backup-agent-config", () => ({
  getBackupAgentConfig: mockGetBackupAgentConfig,
}));

async function freshGetBackupAgentStatus() {
  vi.resetModules();
  const mod = await import("@/lib/server/modules/integrations/backup-agent-status");
  return mod.getBackupAgentStatus;
}

beforeEach(() => {
  vi.clearAllMocks();
  delete serverEnvMock.QUADLET_SERVICES_ROOT;
  delete serverEnvMock.HOMELAB_BACKUP_URL;
});

describe("getBackupAgentStatus", () => {
  it("is disabled when the saved config has not enabled it", async () => {
    mockGetBackupAgentConfig.mockResolvedValue({ enabled: false, url: null, port: null, configPath: null });
    const getBackupAgentStatus = await freshGetBackupAgentStatus();

    const status = await getBackupAgentStatus();

    expect(status).toEqual({ enabled: false, configFound: null, dashboardUrl: null, relativePort: null });
    expect(mockAccess).not.toHaveBeenCalled();
  });

  it("auto-detects the config path under QUADLET_SERVICES_ROOT/homelab-backup when none is saved", async () => {
    serverEnvMock.QUADLET_SERVICES_ROOT = "/fake/services";
    mockGetBackupAgentConfig.mockResolvedValue({ enabled: true, url: null, port: null, configPath: null });
    mockAccess.mockResolvedValue(undefined);
    const getBackupAgentStatus = await freshGetBackupAgentStatus();

    const status = await getBackupAgentStatus();

    expect(mockAccess).toHaveBeenCalledWith("/fake/services/homelab-backup/backup-services.yaml");
    expect(status).toEqual({
      enabled: true,
      configFound: true,
      dashboardUrl: "http://127.0.0.1:3095",
      relativePort: null,
    });
  });

  it("reports configFound: false when no config file is found at an explicit path", async () => {
    mockGetBackupAgentConfig.mockResolvedValue({
      enabled: true,
      url: "http://backup.local:9000",
      port: null,
      configPath: "/missing/backup-services.yaml",
    });
    mockAccess.mockRejectedValue(Object.assign(new Error("ENOENT"), { code: "ENOENT" }));
    const getBackupAgentStatus = await freshGetBackupAgentStatus();

    const status = await getBackupAgentStatus();

    expect(status).toEqual({
      enabled: true,
      configFound: false,
      dashboardUrl: "http://backup.local:9000",
      relativePort: null,
    });
  });

  it("falls back to configFound: false when no path could be resolved at all", async () => {
    mockGetBackupAgentConfig.mockResolvedValue({
      enabled: true,
      url: "http://backup.local:9000",
      port: null,
      configPath: null,
    });
    const getBackupAgentStatus = await freshGetBackupAgentStatus();

    const status = await getBackupAgentStatus();

    expect(status.configFound).toBe(false);
    expect(mockAccess).not.toHaveBeenCalled();
  });

  it("prefers the saved URL, then HOMELAB_BACKUP_URL, then the agent's own default", async () => {
    mockGetBackupAgentConfig.mockResolvedValue({ enabled: true, url: null, port: null, configPath: null });
    serverEnvMock.HOMELAB_BACKUP_URL = "http://env-configured:4000";
    const getBackupAgentStatus = await freshGetBackupAgentStatus();

    const status = await getBackupAgentStatus();

    expect(status.dashboardUrl).toBe("http://env-configured:4000");
    expect(status.relativePort).toBeNull();
  });

  it("exposes a relative port instead of an absolute URL when no URL is set", async () => {
    mockGetBackupAgentConfig.mockResolvedValue({ enabled: true, url: null, port: 3095, configPath: null });
    const getBackupAgentStatus = await freshGetBackupAgentStatus();

    const status = await getBackupAgentStatus();

    expect(status.dashboardUrl).toBeNull();
    expect(status.relativePort).toBe(3095);
  });

  it("prefers an absolute URL over a saved relative port when both are set", async () => {
    mockGetBackupAgentConfig.mockResolvedValue({
      enabled: true,
      url: "http://backup.local:9000",
      port: 3095,
      configPath: null,
    });
    const getBackupAgentStatus = await freshGetBackupAgentStatus();

    const status = await getBackupAgentStatus();

    expect(status.dashboardUrl).toBe("http://backup.local:9000");
    expect(status.relativePort).toBeNull();
  });
});
