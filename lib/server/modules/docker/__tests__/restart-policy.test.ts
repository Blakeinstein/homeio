import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";

import { ensureExistingComposeContainersRestartOnBoot } from "@/lib/server/modules/docker/compose-runner";

describe("existing Compose restart policies", () => {
  it("enables reboot restart on existing services without overriding explicit policies", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "homeio-restart-policy-"));
    const stackDir = path.join(root, "my-app");
    await mkdir(stackDir);
    const composePath = path.join(stackDir, "docker-compose.yml");
    await writeFile(
      composePath,
      "services:\n  web:\n    image: example/web\n  db:\n    image: postgres\n    restart: always\n",
    );
    const calls: Array<{ args: string[]; cwd: string }> = [];
    const runDockerCommand = vi.fn(async (args: string[], cwd: string) => {
      calls.push({ args, cwd });
      return args.includes("ps") ? "container-1\n" : "";
    });

    try {
      await ensureExistingComposeContainersRestartOnBoot({
        composePath,
        stackName: "my-app",
      }, runDockerCommand);

      expect(runDockerCommand).toHaveBeenCalledTimes(2);
      expect(calls[0].args).toEqual([
        "compose",
        "-f",
        composePath,
        "--env-file",
        path.join(stackDir, ".env"),
        "-p",
        "my-app",
        "ps",
        "--all",
        "--quiet",
        "web",
      ]);
      expect(calls[1].args).toEqual([
        "update",
        "--restart=unless-stopped",
        "container-1",
      ]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
