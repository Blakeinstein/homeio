import { describe, expect, it } from "vitest";
import { parseDockerStatusLine, summarizeContainers, type ContainerSnapshot } from "@/lib/shared/app-condition";

function c(state: string, exitCode: number | null = null, health: ContainerSnapshot["health"] = null): ContainerSnapshot {
  return { state, exitCode, health };
}

describe("summarizeContainers", () => {
  it("tells running, starting and unhealthy apart", () => {
    expect(summarizeContainers([c("running")])).toEqual({ condition: "running", exitCode: null });
    expect(summarizeContainers([c("running", null, "starting")]).condition).toBe("starting");
    expect(summarizeContainers([c("running", null, "unhealthy"), c("running")]).condition).toBe("unhealthy");
  });

  it("treats a stop by docker stop as stopped, not crashed", () => {
    for (const code of [0, 130, 137, 143]) {
      expect(summarizeContainers([c("exited", code)])).toEqual({ condition: "stopped", exitCode: code });
    }
    expect(summarizeContainers([])).toEqual({ condition: "stopped", exitCode: null });
  });

  it("reports a crash with its exit code, and a dead container as crashed", () => {
    expect(summarizeContainers([c("exited", 1)])).toEqual({ condition: "crashed", exitCode: 1 });
    expect(summarizeContainers([c("exited", 0), c("exited", 139)])).toEqual({ condition: "crashed", exitCode: 139 });
    expect(summarizeContainers([c("dead")]).condition).toBe("crashed");
  });

  it("says a container that never started is not started", () => {
    expect(summarizeContainers([c("created")])).toEqual({ condition: "created", exitCode: null });
  });

  it("flags a restart loop first", () => {
    expect(summarizeContainers([c("running"), c("restarting", 1)])).toEqual({ condition: "restarting", exitCode: 1 });
  });

  it("marks a stack with a missing service as partial, with the crashed one's code", () => {
    expect(summarizeContainers([c("running"), c("exited", 2)])).toEqual({ condition: "partial", exitCode: 2 });
    expect(summarizeContainers([c("running"), c("exited", 143)])).toEqual({ condition: "partial", exitCode: 143 });
  });

  it("keeps a stack running when a one-shot job finished cleanly", () => {
    expect(summarizeContainers([c("running"), c("exited", 0)])).toEqual({ condition: "running", exitCode: null });
  });

  it("reports paused", () => {
    expect(summarizeContainers([c("paused")]).condition).toBe("paused");
  });
});

describe("parseDockerStatusLine", () => {
  it("reads the exit code and the health from Docker's status line", () => {
    expect(parseDockerStatusLine("Exited (137) 2 hours ago")).toEqual({ exitCode: 137, health: null });
    expect(parseDockerStatusLine("Restarting (1) 7 seconds ago")).toEqual({ exitCode: 1, health: null });
    expect(parseDockerStatusLine("Up 3 days (unhealthy)")).toEqual({ exitCode: null, health: "unhealthy" });
    expect(parseDockerStatusLine("Up 10 seconds (health: starting)")).toEqual({ exitCode: null, health: "starting" });
    expect(parseDockerStatusLine("Up 10 hours (healthy)")).toEqual({ exitCode: null, health: "healthy" });
    expect(parseDockerStatusLine("Created")).toEqual({ exitCode: null, health: null });
  });
});
