import "server-only";

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";
import { existsSync } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import { logServerAction, withServerTiming } from "@/lib/server/logging/logger";
import type {
  SystemUpdateApplyAcceptedResponse,
  SystemUpdateStatus,
} from "@/lib/shared/contracts/system";

const execFileAsync = promisify(execFile);

const DEFAULT_REPO_URL = process.env.HOMEIO_REPO_URL ?? "https://github.com/doctor-io/homeio.git";
const UPDATE_LOG_PATH = "/var/log/homeio-self-update.log";
const RELEASE_TAG = /^v?\d{1,3}\.\d{1,3}\.\d{1,4}(?:-[0-9A-Za-z.-]{1,32})?$/;
const GITHUB_API_HEADERS = {
  Accept: "application/vnd.github+json",
  "User-Agent": "homeio-update-check",
};

/**
 * A server that sets HOMEIO_REPO_BRANCH follows that branch, as before.
 * Everyone else follows published releases, so an update is only offered once
 * its GitHub release and Docker image exist, not the moment a PR lands on main.
 */
function configuredRepoBranch() {
  return process.env.HOMEIO_REPO_BRANCH?.trim() || null;
}

function parseGitHubRepository(repositoryUrl: string) {
  const url = new URL(repositoryUrl.replace(/\.git$/i, ""));

  if (url.hostname !== "github.com") {
    throw new Error("Unsupported repository host for Homeio update checks");
  }

  const [owner, repo] = url.pathname.replace(/^\//, "").split("/");
  if (!owner || !repo) {
    throw new Error("Invalid Homeio repository URL");
  }

  return { owner, repo };
}

function parseVersionParts(version: string) {
  return version
    .trim()
    .replace(/^v/i, "")
    .split(".")
    .map((part) => {
      const numeric = Number.parseInt(part, 10);
      return Number.isFinite(numeric) ? numeric : 0;
    });
}

export function compareVersions(left: string, right: string) {
  const leftParts = parseVersionParts(left);
  const rightParts = parseVersionParts(right);
  const length = Math.max(leftParts.length, rightParts.length);

  for (let index = 0; index < length; index += 1) {
    const leftValue = leftParts[index] ?? 0;
    const rightValue = rightParts[index] ?? 0;

    if (leftValue > rightValue) return 1;
    if (leftValue < rightValue) return -1;
  }

  return 0;
}

async function readCurrentVersion() {
  const packageJsonPath = path.join(process.cwd(), "package.json");
  const raw = await readFile(packageJsonPath, "utf8");
  const parsed = JSON.parse(raw) as { version?: string };
  return parsed.version?.trim() || "unknown";
}

export function buildRemotePackageJsonUrl(
  repositoryUrl = DEFAULT_REPO_URL,
  branch = configuredRepoBranch() ?? "main",
) {
  const { owner, repo } = parseGitHubRepository(repositoryUrl);
  return `https://raw.githubusercontent.com/${owner}/${repo}/${branch}/package.json`;
}

export function buildRemotePackageJsonApiUrl(
  repositoryUrl = DEFAULT_REPO_URL,
  branch = configuredRepoBranch() ?? "main",
) {
  const { owner, repo } = parseGitHubRepository(repositoryUrl);
  return `https://api.github.com/repos/${owner}/${repo}/contents/package.json?ref=${encodeURIComponent(branch)}`;
}

export function buildLatestReleaseApiUrl(repositoryUrl = DEFAULT_REPO_URL) {
  const { owner, repo } = parseGitHubRepository(repositoryUrl);
  return `https://api.github.com/repos/${owner}/${repo}/releases/latest`;
}

async function fetchBranchVersion(branch: string) {
  const response = await fetch(buildRemotePackageJsonApiUrl(DEFAULT_REPO_URL, branch), {
    cache: "no-store",
    headers: GITHUB_API_HEADERS,
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch Homeio version metadata (${response.status})`);
  }

  const parsed = (await response.json()) as { content?: string; encoding?: string };
  if (parsed.encoding !== "base64" || typeof parsed.content !== "string") {
    throw new Error("Remote Homeio package metadata did not include decodable content");
  }

  const packageJson = JSON.parse(Buffer.from(parsed.content, "base64").toString("utf8")) as {
    version?: string;
  };

  if (typeof packageJson.version !== "string" || packageJson.version.trim().length === 0) {
    throw new Error("Remote Homeio package metadata did not include a version");
  }

  return packageJson.version.trim();
}

/** The tag of the release GitHub marks as Latest, or null before the first release. */
async function fetchLatestReleaseTag() {
  const response = await fetch(buildLatestReleaseApiUrl(), {
    cache: "no-store",
    headers: GITHUB_API_HEADERS,
  });

  if (response.status === 404) return null;
  if (!response.ok) {
    throw new Error(`Failed to fetch the latest Homeio release (${response.status})`);
  }

  const parsed = (await response.json()) as { tag_name?: unknown };
  const tag = typeof parsed.tag_name === "string" ? parsed.tag_name.trim() : "";
  // The tag becomes a git ref for update.sh, so only accept a version tag.
  if (!RELEASE_TAG.test(tag)) {
    throw new Error("The latest Homeio release does not have a version tag");
  }

  return tag;
}

async function fetchLatestVersion() {
  const branch = configuredRepoBranch();
  if (branch) return fetchBranchVersion(branch);

  const tag = await fetchLatestReleaseTag();
  return tag ? tag.replace(/^v/i, "") : null;
}

export async function getSystemUpdateStatus(): Promise<SystemUpdateStatus> {
  return withServerTiming(
    {
      layer: "service",
      action: "system.updates.status.get",
    },
    async () => {
      const currentVersion = await readCurrentVersion();
      const latestVersion = await fetchLatestVersion();

      return {
        currentVersion,
        latestVersion,
        updateAvailable: latestVersion !== null && compareVersions(latestVersion, currentVersion) > 0,
        checkedAt: new Date().toISOString(),
        canSelfUpdate: !isContainerRuntime(),
      };
    },
  );
}

function shellEscape(value: string) {
  return `'${value.replace(/'/g, `'"'"'`)}'`;
}

export function isContainerRuntime(): boolean {
  if (process.env.HOMEIO_CONTAINER === "true" || process.env.DOCKER === "true") {
    return true;
  }
  try {
    if (existsSync("/.dockerenv")) {
      return true;
    }
  } catch {
    // ignore
  }
  return false;
}

export async function scheduleSystemUpdate(): Promise<SystemUpdateApplyAcceptedResponse> {
  if (isContainerRuntime()) {
    throw new Error(
      "Homeio is running in a Docker container. In-app self-update via systemd is disabled. Please update your container using: docker compose pull && docker compose up -d",
    );
  }

  const updateScriptPath = path.join(process.cwd(), "scripts", "update.sh");

  try {
    await stat(updateScriptPath);
  } catch {
    throw new Error(`Update script not found at ${updateScriptPath}. Cannot schedule Homeio update.`);
  }

  try {
    await execFileAsync("which", ["systemd-run"]);
  } catch {
    throw new Error(
      "systemd-run is not available on this host. Automated in-app update requires systemd. Please update Homeio manually or via git pull.",
    );
  }

  // Guard against concurrent updates. Two simultaneous update runs would race
  // on the same git working tree, npm install, and migration steps.
  try {
    const { stdout } = await execFileAsync("systemctl", [
      "list-units",
      "--state=activating,active",
      "--no-pager",
      "--no-legend",
      "homeio-self-update-*.service",
    ]);
    if (stdout.trim().length > 0) {
      throw new Error("A system update is already in progress. Wait for it to complete before starting another.");
    }
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("A system update")) {
      throw error;
    }
    // systemctl failure is non-fatal — proceed with scheduling
  }

  // update.sh fetches this ref: the configured branch, or the exact tag of the
  // release the update check announced.
  const targetRef = configuredRepoBranch() ?? (await fetchLatestReleaseTag());
  if (!targetRef) {
    throw new Error("There is no published Homeio release to update to yet.");
  }

  const unitName = `homeio-self-update-${Date.now()}`;
  const command = [
    "mkdir -p /var/log",
    "sleep 2",
    `${shellEscape(updateScriptPath)} >> ${shellEscape(UPDATE_LOG_PATH)} 2>&1`,
  ].join("; ");

  logServerAction({
    layer: "service",
    action: "system.updates.apply.schedule",
    status: "info",
    message: "Scheduling Homeio update",
    meta: {
      unitName,
      updateScriptPath,
      targetRef,
    },
  });

  // systemd-run starts a transient unit with a minimal environment. Without
  // HOME, `go build` fails ("GOCACHE is not defined and neither $XDG_CACHE_HOME
  // nor $HOME are defined"); without /usr/local/go on PATH the build can't find
  // the toolchain at all. Set both explicitly so update.sh runs the same way it
  // would in an interactive root shell.
  await execFileAsync("systemd-run", [
    "--quiet",
    "--no-block",
    `--unit=${unitName}`,
    "--collect",
    "--property=Type=exec",
    "--property=KillMode=control-group",
    "--property=TimeoutStopSec=30s",
    "--property=SendSIGKILL=yes",
    "--setenv=HOME=/root",
    "--setenv=PATH=/usr/local/go/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin",
    // update.sh defaults to main. Without this it would install whatever main
    // holds rather than the version the update check announced.
    `--setenv=HOMEIO_REPO_BRANCH=${targetRef}`,
    `--setenv=HOMEIO_REPO_URL=${DEFAULT_REPO_URL}`,
    "bash",
    "-lc",
    command,
  ]);

  return {
    action: "update",
    accepted: true,
  };
}
