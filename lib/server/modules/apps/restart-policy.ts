import "server-only";

import { listInstalledStacksFromDb } from "@/lib/server/modules/apps/stacks-repository";
import { ensureExistingComposeContainersRestartOnBoot } from "@/lib/server/modules/docker/compose-runner";

export async function ensureInstalledAppsRestartOnBoot() {
  try {
    const stacks = await listInstalledStacksFromDb();
    await Promise.all(
      stacks
        .filter((stack) => stack.status === "installed")
        .map((stack) =>
          ensureExistingComposeContainersRestartOnBoot({
            composePath: stack.composePath,
            stackName: stack.stackName,
          }),
        ),
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(`[Compose] Could not check existing apps for reboot restart policies: ${message}`);
  }
}
