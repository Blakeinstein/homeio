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

const fetchMock = vi.fn();
vi.stubGlobal("fetch", fetchMock);

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
    mockGetBackupAgentConfig.mockResolvedValue({ enabled: false, url: null, configPath: null });
    const getBackupAgentStatus = await freshGetBackupAgentStatus();

    const status = await getBackupAgentStatus();

    expect(status).toEqual({ enabled: false, configFound: null, dashboardUrl: null, reachable: null });
    expect(mockAccess).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("auto-detects the config path under QUADLET_SERVICES_ROOT/homelab-backup when none is saved", async () => {
    serverEnvMock.QUADLET_SERVICES_ROOT = "/fake/services";
    mockGetBackupAgentConfig.mockResolvedValue({ enabled: true, url: null, configPath: null });
    mockAccess.mockResolvedValue(undefined);
    fetchMock.mockResolvedValue({ ok: true });
    const getBackupAgentStatus = await freshGetBackupAgentStatus();

    const status = await getBackupAgentStatus();

    expect(mockAccess).toHaveBeenCalledWith("/fake/services/homelab-backup/backup-services.yaml");
    expect(status).toEqual({
      enabled: true,
      configFound: true,
      dashboardUrl: "http://127.0.0.1:3095",
      reachable: true,
    });
  });

  it("reports configFound: false but still probes the URL when no config file is found", async () => {
    mockGetBackupAgentConfig.mockResolvedValue({
      enabled: true,
      url: "http://backup.local:9000",
      configPath: "/missing/backup-services.yaml",
    });
    mockAccess.mockRejectedValue(Object.assign(new Error("ENOENT"), { code: "ENOENT" }));
    fetchMock.mockResolvedValue({ ok: true });
    const getBackupAgentStatus = await freshGetBackupAgentStatus();

    const status = await getBackupAgentStatus();

    expect(status).toEqual({
      enabled: true,
      configFound: false,
      dashboardUrl: "http://backup.local:9000",
      reachable: true,
    });
  });

  it("falls back to configFound: false when no path could be resolved at all", async () => {
    mockGetBackupAgentConfig.mockResolvedValue({ enabled: true, url: "http://backup.local:9000", configPath: null });
    fetchMock.mockResolvedValue({ ok: true });
    const getBackupAgentStatus = await freshGetBackupAgentStatus();

    const status = await getBackupAgentStatus();

    expect(status.configFound).toBe(false);
    expect(mockAccess).not.toHaveBeenCalled();
  });

  it("prefers the saved URL, then HOMELAB_BACKUP_URL, then the agent's own default", async () => {
    mockGetBackupAgentConfig.mockResolvedValue({ enabled: true, url: null, configPath: null });
    serverEnvMock.HOMELAB_BACKUP_URL = "http://env-configured:4000";
    fetchMock.mockResolvedValue({ ok: true });
    const getBackupAgentStatus = await freshGetBackupAgentStatus();

    const status = await getBackupAgentStatus();

    expect(status.dashboardUrl).toBe("http://env-configured:4000");
  });

  it("reports unreachable when the request fails", async () => {
    mockGetBackupAgentConfig.mockResolvedValue({ enabled: true, url: "http://backup.local:9000", configPath: null });
    fetchMock.mockRejectedValue(new Error("connection refused"));
    const getBackupAgentStatus = await freshGetBackupAgentStatus();

    const status = await getBackupAgentStatus();

    expect(status.reachable).toBe(false);
  });
});
