import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { NGINX_UPSTREAM_KEEPALIVE_MS } from "@/lib/server/http/keep-alive";

async function readScript(scriptName: string) {
  return readFile(path.join(process.cwd(), "scripts", scriptName), "utf8");
}

describe("reverse proxy scripts", () => {
  it.each(["install.sh", "update.sh"])(
    "%s keeps nginx's upstream keep-alive shorter than Homeio's",
    async (scriptName) => {
      const script = await readScript(scriptName);

      // lib/server/http/keep-alive.ts relies on this value: Homeio must be the
      // side that keeps idle connections longer, or visitors get 502s.
      expect(script).toContain(`keepalive_timeout ${NGINX_UPSTREAM_KEEPALIVE_MS / 1000}s;`);
    },
  );

  it.each(["install.sh", "update.sh"])(
    "%s raises nginx's connection limits before testing the config",
    async (scriptName) => {
      const script = await readScript(scriptName);

      expect(script).toContain("tune_nginx_limits() {");
      expect(script).toContain("local worker_connections=4096");
      expect(script).toMatch(/\ttune_nginx_limits\n\tnginx -t\n/);
    },
  );
});
