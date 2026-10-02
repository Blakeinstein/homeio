import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { discoverQuadletServicesMock, listContainersMock } = vi.hoisted(() => ({
  discoverQuadletServicesMock: vi.fn(),
  listContainersMock: vi.fn(),
}));

vi.mock("@/lib/server/env", () => ({
  serverEnv: {
    QUADLET_SERVICES_ROOT: "/fake/quadlet-root",
  },
}));

vi.mock("@/lib/server/modules/docker/quadlet-discovery", () => ({
  discoverQuadletServices: discoverQuadletServicesMock,
  resolveLocalIconPath: vi.fn(() => null),
}));

vi.mock("@/lib/server/modules/docker/stats", () => ({
  listContainers: listContainersMock,
}));

import {
  invalidateQuadletDiscoveryCache,
  listClaimedQuadletContainerNames,
  listQuadletApps,
} from "@/lib/server/modules/docker/quadlet-apps";

function fakeService(overrides: Record<string, unknown> = {}) {
  return {
    id: "sure",
    dirName: "sure",
    sourceDir: "/fake/quadlet-root/sure",
    name: "Sure",
    description: "Personal finance app",
    category: "Finance",
    icon: { kind: "url", value: "https://cdn.example.com/sure.png" },
    webUiPort: 3064,
    containers: [
      { containerName: "sure-web", image: "sure:latest", publishPorts: [3064] },
      { containerName: "sure-db", image: "postgres:16", publishPorts: [] },
    ],
    primaryContainerName: "sure-web",
    ...overrides,
  };
}

function fakeContainer(name: string, state: string, status = "") {
  return { Id: name, Names: [`/${name}`], State: state, Status: status };
}

beforeEach(() => {
  discoverQuadletServicesMock.mockReset();
  listContainersMock.mockReset();
  invalidateQuadletDiscoveryCache();
});

afterEach(() => {
  invalidateQuadletDiscoveryCache();
});

describe("listQuadletApps", () => {
  it("returns an empty list when nothing is discovered", async () => {
    discoverQuadletServicesMock.mockResolvedValue([]);
    listContainersMock.mockResolvedValue([]);

    expect(await listQuadletApps()).toEqual([]);
    expect(listContainersMock).not.toHaveBeenCalled();
  });

  it("marks an app running when all its containers are running", async () => {
    discoverQuadletServicesMock.mockResolvedValue([fakeService()]);
    listContainersMock.mockResolvedValue([
      fakeContainer("sure-web", "running", "Up 2 hours"),
      fakeContainer("sure-db", "running", "Up 2 hours"),
    ]);

    const apps = await listQuadletApps();
    expect(apps).toHaveLength(1);
    expect(apps[0]).toMatchObject({
      id: "quadlet:sure",
      name: "Sure",
      logoUrl: "https://cdn.example.com/sure.png",
      webUiPort: 3064,
      primaryContainerName: "sure-web",
      containerNames: ["sure-web", "sure-db"],
    });
    expect(apps[0].condition.condition).toBe("running");
  });

  it("marks an app partial when one of its containers is missing", async () => {
    discoverQuadletServicesMock.mockResolvedValue([fakeService()]);
    listContainersMock.mockResolvedValue([fakeContainer("sure-web", "running", "Up 2 hours")]);

    const apps = await listQuadletApps();
    expect(apps[0].condition.condition).toBe("partial");
  });

  it("marks an app unknown when none of its containers are found", async () => {
    discoverQuadletServicesMock.mockResolvedValue([fakeService()]);
    listContainersMock.mockResolvedValue([fakeContainer("unrelated", "running")]);

    const apps = await listQuadletApps();
    expect(apps[0].condition).toEqual({ condition: "unknown", exitCode: null });
  });

  it("generates a local icon URL instead of inlining a relative path", async () => {
    discoverQuadletServicesMock.mockResolvedValue([
      fakeService({ icon: { kind: "local", relativePath: "icon.png" } }),
    ]);
    listContainersMock.mockResolvedValue([]);

    const apps = await listQuadletApps();
    expect(apps[0].logoUrl).toBe("/api/v1/docker/quadlet-apps/sure/icon");
  });
});

describe("listClaimedQuadletContainerNames", () => {
  it("collects every container name across discovered apps", async () => {
    discoverQuadletServicesMock.mockResolvedValue([fakeService()]);
    listContainersMock.mockResolvedValue([]);

    const claimed = await listClaimedQuadletContainerNames();
    expect(claimed).toEqual(new Set(["sure-web", "sure-db"]));
  });
});
