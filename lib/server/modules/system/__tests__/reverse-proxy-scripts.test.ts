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
      // A pool too small makes nginx open a new connection per request under load.
      expect(script).toContain("keepalive 128;");
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

  it.each(["install.sh", "update.sh"])(
    "%s makes nginx ask Homeio before streaming an upload",
    async (scriptName) => {
      const script = await readScript(scriptName);
      const uploadLocation = script.slice(script.indexOf("location = /api/v1/files/upload {"));

      // The Go upload server never sees the middleware: without this check a
      // demo visitor could write files, and a logged-out cookie kept uploading.
      expect(uploadLocation.slice(0, uploadLocation.indexOf("}"))).toContain(
        "auth_request /__homeio_upload_authorize;",
      );
      expect(script).toContain("proxy_pass http://homeio_backend/api/v1/files/upload/authorize;");
      expect(script).toContain("proxy_pass_request_body off;");
    },
  );

  it.each(["install.sh", "update.sh"])(
    "%s gives the upload socket a runtime directory of its own",
    async (scriptName) => {
      const script = await readScript(scriptName);
      const goServer = await readFile(path.join(process.cwd(), "services/upload-server/main.go"), "utf8");
      const socket = "/run/home-server-upload/upload.sock";

      // Shared with the DBus helper, the directory took whichever mode started
      // last and vanished whenever either service stopped.
      expect(script).toContain("RuntimeDirectory=home-server-upload");
      expect(script).toContain(`Environment=UPLOAD_SERVER_ADDR=${socket}`);
      expect(script).toContain(`proxy_pass http://unix:${socket}:/upload;`);
      expect(goServer).toContain(`"${socket}"`);
    },
  );
});
