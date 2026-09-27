import { beforeEach, describe, expect, it, vi } from "vitest";

// promisify(execFile) resolves to { stdout, stderr }; a plain mock has no
// custom promisify, so it must pass that object as its single result.
type ExecCallback = (error: NodeJS.ErrnoException | null, result: { stdout: string; stderr: string }) => void;

const { calls, respond } = vi.hoisted(() => ({
  calls: [] as string[][],
  respond: { stdout: "" },
}));

vi.mock("node:child_process", () => ({
  execFile: (_file: string, args: string[], _options: unknown, callback: ExecCallback) => {
    calls.push(args);
    callback(null, { stdout: respond.stdout, stderr: "" });
  },
}));

vi.mock("@/lib/server/env", () => ({ serverEnv: { DOCKER_COMPOSE_TIMEOUT_MS: 30_000 } }));
vi.mock("@/lib/server/logging/logger", () => ({
  logServerAction: vi.fn(),
  withServerTiming: async <T>(_meta: unknown, fn: () => Promise<T>) => fn(),
}));

import { getComposeRuntimeInfo } from "@/lib/server/modules/docker/compose-runner";

const input = { composePath: "/stacks/app/docker-compose.yml", envPath: "/stacks/app/.env", stackName: "app" };

function psOutput(entries: Record<string, unknown>[]) {
  return entries.map((entry) => JSON.stringify(entry)).join("\n");
}

describe("getComposeRuntimeInfo", () => {
  beforeEach(() => {
    calls.length = 0;
  });

  it("lists stopped containers too and reports a crash with its exit code", async () => {
    respond.stdout = psOutput([{ Name: "app-web-1", State: "exited", ExitCode: 1, Health: "" }]);

    const info = await getComposeRuntimeInfo(input);

    expect(calls[0]).toContain("-a");
    expect(info.status).toBe("stopped");
    expect(info.condition).toEqual({ condition: "crashed", exitCode: 1 });
  });

  it("keeps the old status for a running stack with a finished one-shot job", async () => {
    respond.stdout = psOutput([
      { Name: "app-web-1", State: "running", ExitCode: 0, Health: "healthy" },
      { Name: "app-migrate-1", State: "exited", ExitCode: 0, Health: "" },
    ]);

    const info = await getComposeRuntimeInfo(input);

    expect(info.status).toBe("running");
    expect(info.containerNames).toEqual(["app-web-1"]);
    expect(info.condition).toEqual({ condition: "running", exitCode: null });
  });

  it("reports an unhealthy service and a stack that has never run", async () => {
    respond.stdout = psOutput([{ Name: "app-web-1", State: "running", ExitCode: 0, Health: "unhealthy" }]);
    expect((await getComposeRuntimeInfo(input)).condition.condition).toBe("unhealthy");

    respond.stdout = psOutput([{ Name: "app-web-1", State: "created", ExitCode: 0, Health: "" }]);
    const created = await getComposeRuntimeInfo(input);
    expect(created.status).toBe("stopped");
    expect(created.condition.condition).toBe("created");

    respond.stdout = "";
    expect((await getComposeRuntimeInfo(input)).condition).toEqual({ condition: "stopped", exitCode: null });
  });
});
