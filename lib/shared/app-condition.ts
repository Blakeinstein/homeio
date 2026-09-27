/**
 * What an app or container is actually doing, finer than running/stopped: the
 * desktop tells a clean stop from a crash, a container that never started, a
 * restart loop and a failing health check.
 */
export type AppCondition =
  | "running"
  | "starting"
  | "unhealthy"
  | "restarting"
  | "partial"
  | "paused"
  | "stopped"
  | "crashed"
  | "created"
  | "unknown";

export type AppConditionSummary = {
  condition: AppCondition;
  /** The exit code behind a stop, crash or partial stack; null otherwise. */
  exitCode: number | null;
};

export type ContainerHealth = "healthy" | "unhealthy" | "starting";

export type ContainerSnapshot = {
  state: string;
  exitCode: number | null;
  health: ContainerHealth | null;
};

// How `docker stop` ends things: exited by itself (0), SIGINT (130), SIGTERM
// (143), or SIGKILL after the stop timeout (137). Counting these as crashes
// would flag every app the user stopped on purpose.
const CLEAN_EXIT_CODES = new Set([0, 130, 137, 143]);

function isCrash(container: ContainerSnapshot) {
  if (container.state === "dead") return true;
  return container.state === "exited" && container.exitCode !== null && !CLEAN_EXIT_CODES.has(container.exitCode);
}

export function toContainerHealth(value: unknown): ContainerHealth | null {
  const health = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (health === "healthy" || health === "unhealthy" || health === "starting") return health;
  return null;
}

/**
 * Exit code and health from Docker's status line: "Exited (137) 2 hours ago",
 * "Restarting (1) 7 seconds ago" (the code of the last run), "Up 3 days (unhealthy)".
 */
export function parseDockerStatusLine(status: string): { exitCode: number | null; health: ContainerHealth | null } {
  const exit = /(?:Exited|Restarting) \((-?\d+)\)/i.exec(status);
  const health = /\((healthy|unhealthy|health: starting)\)/i.exec(status);
  return {
    exitCode: exit ? Number(exit[1]) : null,
    health: health ? toContainerHealth(health[1].toLowerCase().replace("health: ", "")) : null,
  };
}

/** One condition for a container or a whole Compose stack. */
export function summarizeContainers(input: ContainerSnapshot[]): AppConditionSummary {
  const containers = input.map((c) => ({ ...c, state: c.state.trim().toLowerCase() }));
  if (containers.length === 0) return { condition: "stopped", exitCode: null };

  const restarting = containers.find((c) => c.state === "restarting");
  if (restarting) return { condition: "restarting", exitCode: restarting.exitCode };

  const running = containers.filter((c) => c.state === "running");
  if (running.length > 0) {
    if (running.some((c) => c.health === "unhealthy")) return { condition: "unhealthy", exitCode: null };

    // A one-shot container that finished cleanly (exit 0) is part of a
    // healthy stack; anything else not running means the stack is incomplete.
    const missing = containers.filter(
      (c) => c.state !== "running" && !(c.state === "exited" && c.exitCode === 0),
    );
    if (missing.length > 0) {
      const crashed = missing.find(isCrash);
      return { condition: "partial", exitCode: (crashed ?? missing[0]).exitCode };
    }

    if (running.some((c) => c.health === "starting")) return { condition: "starting", exitCode: null };
    return { condition: "running", exitCode: null };
  }

  if (containers.some((c) => c.state === "paused")) return { condition: "paused", exitCode: null };

  const crashed = containers.find(isCrash);
  if (crashed) return { condition: "crashed", exitCode: crashed.exitCode };

  if (containers.every((c) => c.state === "created")) return { condition: "created", exitCode: null };

  if (containers.every((c) => c.state === "exited" || c.state === "created")) {
    const stopped = containers.find((c) => c.state === "exited");
    return { condition: "stopped", exitCode: stopped?.exitCode ?? null };
  }

  return { condition: "unknown", exitCode: null };
}
