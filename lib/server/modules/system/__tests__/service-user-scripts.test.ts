import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

const repoRoot = process.cwd();

async function readScript(scriptName: string) {
  return readFile(path.join(repoRoot, "scripts", scriptName), "utf8");
}

describe("host service user scripts", () => {
  it("installs Homeio and its upload server as the dedicated account", async () => {
    const script = await readScript("install.sh");

    expect(script).toContain('APP_USER="homeio"');
    expect(script).toContain("useradd --system --gid \"${APP_GROUP}\"");
    expect(script).toContain("loginctl enable-linger \"${APP_USER}\"");
    expect(script).toContain("configure_homeio_rootless_podman");
    expect(script).toContain("PODMAN_ROOTLESS_SOCKET_PATH=");
    expect(script).toContain("QUADLET_SERVICES_ROOT=");
    expect(script).toContain("User=${APP_USER}\nGroup=${APP_GROUP}");
    expect(script).toContain("User=root\nGroup=${APP_GROUP}");
  });

  it("migrates existing installs to the dedicated user during updates", async () => {
    const script = await readScript("update.sh");

    expect(script).toContain('APP_USER="homeio"');
    expect(script).toContain("20-runtime-user.conf");
    expect(script).toContain("configure_homeio_rootless_podman");
    expect(script).toContain('set_env_key "PODMAN_ROOTLESS_SOCKET_PATH"');
    expect(script).toContain('git -c "safe.directory=${INSTALL_DIR}" -C "${INSTALL_DIR}" "$@"');
    expect(script).toContain("git_install fetch --depth=1 origin");
    expect(script).toContain("User=${APP_USER}\nGroup=${APP_GROUP}");
    expect(script).toContain("apply_homeio_ownership");
  });
});
