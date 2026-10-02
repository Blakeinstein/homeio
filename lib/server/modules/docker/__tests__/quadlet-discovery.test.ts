import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  discoverQuadletServices,
  extractQuadletContainerInfo,
  resolveLocalIconPath,
} from "@/lib/server/modules/docker/quadlet-discovery";

describe("extractQuadletContainerInfo", () => {
  it("reads ContainerName, Image, and published ports from a .container unit", () => {
    const content = `
[Unit]
Description=Sure Web (Rails)

[Container]
ContainerName=sure-web
Image=ghcr.io/we-promise/sure:0.7.4
PublishPort=3064:3000
PublishPort=53:53/udp

[Service]
Restart=on-failure
`;

    const info = extractQuadletContainerInfo("sure-web", content);

    expect(info.containerName).toBe("sure-web");
    expect(info.image).toBe("ghcr.io/we-promise/sure:0.7.4");
    expect(info.publishPorts).toEqual([3064]);
  });

  it("defaults the container name to systemd-<unit> when ContainerName is absent", () => {
    const info = extractQuadletContainerInfo("sure-db", "[Container]\nImage=postgres:16\n");
    expect(info.containerName).toBe("systemd-sure-db");
  });

  it("ignores a PublishPort with no host port component", () => {
    const info = extractQuadletContainerInfo("app", "[Container]\nPublishPort=8080\n");
    expect(info.publishPorts).toEqual([]);
  });

  it("handles an ip:hostPort:containerPort mapping", () => {
    const info = extractQuadletContainerInfo(
      "app",
      "[Container]\nPublishPort=127.0.0.1:9000:9000\n",
    );
    expect(info.publishPorts).toEqual([9000]);
  });

  it("ignores comments and blank lines", () => {
    const info = extractQuadletContainerInfo(
      "app",
      "# comment\n\n[Container]\n; also a comment\nContainerName=app\n",
    );
    expect(info.containerName).toBe("app");
  });
});

describe("discoverQuadletServices", () => {
  let root = "";

  beforeEach(async () => {
    root = await mkdtemp(path.join(os.tmpdir(), "homeio-quadlet-"));
  });

  afterEach(async () => {
    if (root) await rm(root, { recursive: true, force: true });
  });

  it("returns an empty list for a root with no service folders", async () => {
    expect(await discoverQuadletServices(root)).toEqual([]);
  });

  it("skips folders with no .container unit files", async () => {
    await mkdir(path.join(root, "not-a-service"), { recursive: true });
    await writeFile(path.join(root, "not-a-service", "README.md"), "hi", "utf8");

    expect(await discoverQuadletServices(root)).toEqual([]);
  });

  it("discovers a single-container service with no app.yaml", async () => {
    const dir = path.join(root, "searxng");
    await mkdir(dir, { recursive: true });
    await writeFile(
      path.join(dir, "searxng.container"),
      "[Container]\nContainerName=searxng\nImage=docker.io/searxng/searxng:latest\nPublishPort=3080:8080\n",
      "utf8",
    );

    const services = await discoverQuadletServices(root);
    expect(services).toHaveLength(1);
    expect(services[0]).toMatchObject({
      id: "searxng",
      name: "Searxng",
      description: null,
      category: null,
      icon: null,
      webUiPort: 3080,
      primaryContainerName: "searxng",
    });
    expect(services[0].containers).toEqual([
      { containerName: "searxng", image: "docker.io/searxng/searxng:latest", publishPorts: [3080] },
    ]);
  });

  it("applies app.yaml metadata, including an explicit primary container across multiple units", async () => {
    const dir = path.join(root, "sure");
    await mkdir(dir, { recursive: true });
    await writeFile(
      path.join(dir, "sure-db.container"),
      "[Container]\nContainerName=sure-db\nImage=postgres:16\n",
      "utf8",
    );
    await writeFile(
      path.join(dir, "sure-web.container"),
      "[Container]\nContainerName=sure-web\nImage=ghcr.io/we-promise/sure:0.7.4\nPublishPort=3064:3000\n",
      "utf8",
    );
    await writeFile(
      path.join(dir, "app.yaml"),
      [
        "name: Sure",
        "description: Personal finance app",
        "category: Finance",
        "icon: icon.png",
        "primaryContainer: sure-web",
      ].join("\n"),
      "utf8",
    );
    await writeFile(path.join(dir, "icon.png"), "fake-png-bytes", "utf8");

    const services = await discoverQuadletServices(root);
    expect(services).toHaveLength(1);
    const service = services[0];

    expect(service.name).toBe("Sure");
    expect(service.description).toBe("Personal finance app");
    expect(service.category).toBe("Finance");
    expect(service.webUiPort).toBe(3064);
    expect(service.primaryContainerName).toBe("sure-web");
    expect(service.containers.map((c) => c.containerName).sort()).toEqual(["sure-db", "sure-web"]);
    expect(service.icon).toEqual({ kind: "local", relativePath: "icon.png" });
    expect(resolveLocalIconPath(service)).toBe(path.join(dir, "icon.png"));
  });

  it("ignores malformed app.yaml and falls back to folder-derived defaults", async () => {
    const dir = path.join(root, "broken-meta");
    await mkdir(dir, { recursive: true });
    await writeFile(
      path.join(dir, "broken-meta.container"),
      "[Container]\nContainerName=broken-meta\n",
      "utf8",
    );
    await writeFile(path.join(dir, "app.yaml"), "port: not-a-number\n", "utf8");

    const services = await discoverQuadletServices(root);
    expect(services).toHaveLength(1);
    expect(services[0].name).toBe("Broken Meta");
    expect(services[0].webUiPort).toBeNull();
  });

  it("treats an http(s) icon value as a URL rather than a local path", async () => {
    const dir = path.join(root, "openwebui");
    await mkdir(dir, { recursive: true });
    await writeFile(
      path.join(dir, "openwebui.container"),
      "[Container]\nContainerName=openwebui\nPublishPort=3000:8080\n",
      "utf8",
    );
    await writeFile(
      path.join(dir, "app.yaml"),
      "icon: https://cdn.example.com/openwebui.png\n",
      "utf8",
    );

    const services = await discoverQuadletServices(root);
    expect(services[0].icon).toEqual({ kind: "url", value: "https://cdn.example.com/openwebui.png" });
    expect(resolveLocalIconPath(services[0])).toBeNull();
  });

  it("rejects a path-traversal icon value", async () => {
    const dir = path.join(root, "evil");
    await mkdir(dir, { recursive: true });
    await writeFile(path.join(dir, "evil.container"), "[Container]\nContainerName=evil\n", "utf8");
    await writeFile(path.join(dir, "app.yaml"), "icon: ../../etc/passwd\n", "utf8");

    const services = await discoverQuadletServices(root);
    expect(services[0].icon).toBeNull();
  });
});
