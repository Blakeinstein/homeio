import type * as NodeFsPromises from "node:fs/promises";
import { afterEach, describe, expect, it, vi, beforeEach } from "vitest";

const { execFileMock, statMock } = vi.hoisted(() => ({
  execFileMock: vi.fn(),
  statMock: vi.fn(),
}));

vi.mock("node:child_process", () => ({
  execFile: execFileMock,
}));

vi.mock("node:fs/promises", async (importOriginal) => {
  const original = await importOriginal<typeof NodeFsPromises>();
  return { ...original, stat: statMock };
});

import {
  buildLatestReleaseApiUrl,
  buildRemotePackageJsonApiUrl,
  buildRemotePackageJsonUrl,
  compareVersions,
  getSystemUpdateStatus,
  scheduleSystemUpdate,
} from "@/lib/server/modules/system/update-service";
import packageJson from "@/package.json";

function resolveExecFileCallback(args: unknown[]) {
  const maybeCallback = args.at(-1);
  if (typeof maybeCallback !== "function") {
    throw new Error("Expected execFile callback");
  }

  return maybeCallback as (error: Error | null, stdout?: string, stderr?: string) => void;
}

function bumpPatchVersion(version: string) {
  const parts = version.split(".");
  const last = Number.parseInt(parts.at(-1) ?? "0", 10);
  parts[parts.length - 1] = String(Number.isFinite(last) ? last + 1 : 1);
  return parts.join(".");
}

function releaseResponse(tag: string) {
  return { ok: true, status: 200, json: async () => ({ tag_name: tag }) } as Response;
}

function branchResponse(version: string) {
  return {
    ok: true,
    status: 200,
    json: async () => ({
      content: Buffer.from(JSON.stringify({ version }), "utf8").toString("base64"),
      encoding: "base64",
    }),
  } as Response;
}

function succeedAllExecFileCalls() {
  execFileMock.mockImplementation((_command: string, _args: string[], ...rest: unknown[]) => {
    resolveExecFileCallback(rest)(null, "", "");
  });
}

describe("update-service", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    execFileMock.mockReset();
    // Release mode unless a test opts into following a branch.
    vi.stubEnv("HOMEIO_REPO_BRANCH", "");
    vi.stubEnv("HOMEIO_CONTAINER", "");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("compares semantic versions correctly", () => {
    expect(compareVersions("0.1.75", "0.1.74")).toBe(1);
    expect(compareVersions("0.1.74", "0.1.74")).toBe(0);
    expect(compareVersions("0.1.73", "0.1.74")).toBe(-1);
  });

  it("builds a raw GitHub package.json url from the repo config", () => {
    expect(
      buildRemotePackageJsonUrl("https://github.com/doctor-io/homeio.git", "main"),
    ).toBe("https://raw.githubusercontent.com/doctor-io/homeio/main/package.json");
  });

  it("builds a GitHub contents API url from the repo config", () => {
    expect(
      buildRemotePackageJsonApiUrl("https://github.com/doctor-io/homeio.git", "main"),
    ).toBe("https://api.github.com/repos/doctor-io/homeio/contents/package.json?ref=main");
  });

  it("reports that the Docker image cannot update itself", async () => {
    vi.stubEnv("HOMEIO_CONTAINER", "true");
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(releaseResponse(`v${packageJson.version}`));

    const status = await getSystemUpdateStatus();
    expect(status.canSelfUpdate).toBe(false);
  });

  it("offers the latest published release, not whatever main holds", async () => {
    const nextVersion = bumpPatchVersion(packageJson.version);
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(releaseResponse(`v${nextVersion}`));

    const status = await getSystemUpdateStatus();

    expect(status.currentVersion).toBe(packageJson.version);
    expect(status.latestVersion).toBe(nextVersion);
    expect(status.updateAvailable).toBe(true);
    expect(status.checkedAt).toBeTruthy();
    expect(status.canSelfUpdate).toBe(true);
    const [requestUrl, requestInit] = fetchMock.mock.calls[0] ?? [];
    expect(String(requestUrl)).toBe(buildLatestReleaseApiUrl());
    expect(String(requestUrl)).toBe("https://api.github.com/repos/doctor-io/homeio/releases/latest");
    expect(requestInit).toMatchObject({
      cache: "no-store",
      headers: {
        Accept: "application/vnd.github+json",
        "User-Agent": "homeio-update-check",
      },
    });
  });

  it("reports no update before the first release is published", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce({ ok: false, status: 404 } as Response);

    const status = await getSystemUpdateStatus();

    expect(status.latestVersion).toBeNull();
    expect(status.updateAvailable).toBe(false);
  });

  it("rejects a latest release whose tag is not a version", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(releaseResponse("main; rm -rf /"));

    await expect(getSystemUpdateStatus()).rejects.toThrow("does not have a version tag");
  });

  it("follows HOMEIO_REPO_BRANCH when a server sets it", async () => {
    vi.stubEnv("HOMEIO_REPO_BRANCH", "v2.0");
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(branchResponse("2.0.13"));

    const status = await getSystemUpdateStatus();

    expect(status.latestVersion).toBe("2.0.13");
    expect(String(fetchMock.mock.calls[0]?.[0])).toBe(
      "https://api.github.com/repos/doctor-io/homeio/contents/package.json?ref=v2.0",
    );
  });

  it("schedules the updater through a transient systemd unit, pinned to the latest release", async () => {
    statMock.mockResolvedValueOnce({});
    succeedAllExecFileCalls();
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(releaseResponse("v9.9.9"));

    const result = await scheduleSystemUpdate();

    expect(result).toEqual({
      action: "update",
      accepted: true,
    });
    expect(execFileMock).toHaveBeenCalledWith(
      "systemd-run",
      expect.arrayContaining([
        "--quiet",
        "--no-block",
        "--collect",
        "--property=Type=exec",
        "--property=KillMode=control-group",
        "--property=TimeoutStopSec=30s",
        "--property=SendSIGKILL=yes",
        "--setenv=HOMEIO_REPO_BRANCH=v9.9.9",
        "--setenv=HOMEIO_REPO_URL=https://github.com/doctor-io/homeio.git",
        "bash",
        "-lc",
        expect.stringContaining("scripts/update.sh"),
      ]),
      expect.any(Function),
    );
  });

  it("installs the configured branch when the server follows one", async () => {
    vi.stubEnv("HOMEIO_REPO_BRANCH", "v2.0");
    statMock.mockResolvedValueOnce({});
    succeedAllExecFileCalls();
    const fetchMock = vi.spyOn(globalThis, "fetch");

    await scheduleSystemUpdate();

    expect(fetchMock).not.toHaveBeenCalled();
    expect(execFileMock).toHaveBeenCalledWith(
      "systemd-run",
      expect.arrayContaining(["--setenv=HOMEIO_REPO_BRANCH=v2.0"]),
      expect.any(Function),
    );
  });

  it("refuses to update when no release has been published", async () => {
    statMock.mockResolvedValueOnce({});
    succeedAllExecFileCalls();
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce({ ok: false, status: 404 } as Response);

    await expect(scheduleSystemUpdate()).rejects.toThrow("no published Homeio release");
    expect(execFileMock).not.toHaveBeenCalledWith("systemd-run", expect.anything(), expect.anything());
  });

  it("rejects scheduling when the update script does not exist", async () => {
    statMock.mockRejectedValueOnce(Object.assign(new Error("ENOENT"), { code: "ENOENT" }));

    await expect(scheduleSystemUpdate()).rejects.toThrow(
      "Update script not found",
    );
    expect(execFileMock).not.toHaveBeenCalled();
  });

    it("rejects scheduling when running inside a container runtime", async () => {
    process.env.HOMEIO_CONTAINER = "true";
    try {
      await expect(scheduleSystemUpdate()).rejects.toThrow(
        "Homeio is running in a Docker container",
      );
    } finally {
      delete process.env.HOMEIO_CONTAINER;
    }
  });
});
