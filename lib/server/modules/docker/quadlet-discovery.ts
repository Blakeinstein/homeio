import "server-only";

import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import yaml from "js-yaml";
import { z } from "zod";
import { logServerAction } from "@/lib/server/logging/logger";

const CONTAINER_UNIT_EXTENSION = ".container";
const APP_METADATA_FILE_NAMES = ["app.yaml", "app.yml"];

type QuadletSection = Record<string, string[]>;
type QuadletUnit = Record<string, QuadletSection>;

/**
 * Parses a systemd unit file (quadlet's `.container` format) into
 * section -> key -> values, keeping every value for a repeated key (e.g.
 * `PublishPort=` can appear more than once) in the order they were declared.
 */
function parseQuadletUnit(content: string): QuadletUnit {
  const unit: QuadletUnit = {};
  let currentSection: string | null = null;

  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#") || line.startsWith(";")) continue;

    const sectionMatch = /^\[([^\]]+)]$/.exec(line);
    if (sectionMatch) {
      currentSection = sectionMatch[1].trim();
      unit[currentSection] ??= {};
      continue;
    }

    if (!currentSection) continue;

    const separatorIndex = line.indexOf("=");
    if (separatorIndex === -1) continue;

    const key = line.slice(0, separatorIndex).trim();
    const value = line.slice(separatorIndex + 1).trim();
    if (!key) continue;

    const section = unit[currentSection];
    (section[key] ??= []).push(value);
  }

  return unit;
}

function lastValue(section: QuadletSection | undefined, key: string): string | null {
  const values = section?.[key];
  return values && values.length > 0 ? values[values.length - 1] : null;
}

/**
 * `PublishPort=` follows `-p`'s own shapes: `containerPort` (host port chosen
 * at random — nothing fixed to point a browser at), `hostPort:containerPort`,
 * or `ip:hostPort:containerPort`, each optionally suffixed with `/udp`.
 */
function parsePublishedHostPort(mapping: string): number | null {
  const [portPart, proto] = mapping.split("/");
  if (proto && proto.trim().toLowerCase() !== "tcp") return null;

  const segments = (portPart ?? "").split(":").map((segment) => segment.trim()).filter(Boolean);
  if (segments.length < 2) return null;

  const hostSegment = segments[segments.length - 2];
  const port = Number.parseInt(hostSegment, 10);
  if (!Number.isInteger(port) || port < 1 || port > 65535) return null;
  return port;
}

export type QuadletContainerInfo = {
  containerName: string;
  image: string | null;
  publishPorts: number[];
};

/**
 * Reads the `[Container]` section of a quadlet unit. Podman names the
 * container `systemd-<unit basename>` when `ContainerName=` is not set.
 */
export function extractQuadletContainerInfo(unitBaseName: string, content: string): QuadletContainerInfo {
  const containerSection = parseQuadletUnit(content).Container;

  return {
    containerName: lastValue(containerSection, "ContainerName") ?? `systemd-${unitBaseName}`,
    image: lastValue(containerSection, "Image"),
    publishPorts: (containerSection?.PublishPort ?? [])
      .map(parsePublishedHostPort)
      .filter((port): port is number => port !== null),
  };
}

const appMetadataSchema = z.object({
  name: z.string().trim().min(1).optional(),
  icon: z.string().trim().min(1).optional(),
  description: z.string().trim().min(1).optional(),
  category: z.string().trim().min(1).optional(),
  port: z.coerce.number().int().min(1).max(65535).optional(),
  primaryContainer: z.string().trim().min(1).optional(),
});

export type QuadletAppMetadata = z.infer<typeof appMetadataSchema>;

async function readAppMetadata(dirPath: string): Promise<QuadletAppMetadata | null> {
  for (const fileName of APP_METADATA_FILE_NAMES) {
    const filePath = path.join(dirPath, fileName);
    let content: string;
    try {
      content = await readFile(filePath, "utf8");
    } catch (error) {
      const nodeError = error as NodeJS.ErrnoException;
      if (nodeError.code === "ENOENT") continue;
      logServerAction({
        level: "warn",
        layer: "service",
        action: "docker.quadlet.readAppMetadata",
        status: "error",
        message: `Could not read ${filePath}`,
        error,
      });
      return null;
    }

    let parsed: unknown;
    try {
      parsed = yaml.load(content);
    } catch (error) {
      logServerAction({
        level: "warn",
        layer: "service",
        action: "docker.quadlet.readAppMetadata",
        status: "error",
        message: `Could not parse ${filePath} as YAML`,
        error,
      });
      return null;
    }

    const result = appMetadataSchema.safeParse(parsed ?? {});
    if (!result.success) {
      logServerAction({
        level: "warn",
        layer: "service",
        action: "docker.quadlet.readAppMetadata",
        status: "error",
        message: `${filePath} does not match the expected app.yaml shape`,
        meta: { issues: result.error.issues.map((issue) => issue.message) },
      });
      return null;
    }

    return result.data;
  }

  return null;
}

function slugifyDirName(dirName: string): string {
  const slug = dirName
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug.length > 0 ? slug : "app";
}

function titleCaseFromSlug(slug: string): string {
  return slug
    .split(/[-_]+/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

export type QuadletAppIcon =
  | { kind: "url"; value: string }
  | { kind: "local"; relativePath: string };

/** A bare relative path, with no leading slash or `..` segment, into the service's own folder. */
function resolveIcon(metadataIcon: string | undefined): QuadletAppIcon | null {
  if (!metadataIcon) return null;
  if (/^https?:\/\//i.test(metadataIcon)) {
    return { kind: "url", value: metadataIcon };
  }

  const normalized = path.posix.normalize(metadataIcon.replaceAll("\\", "/").replace(/^\.\//, ""));
  if (normalized.startsWith("/") || normalized === ".." || normalized.startsWith("../")) {
    return null;
  }

  return { kind: "local", relativePath: normalized };
}

type DiscoveredUnit = { unitBaseName: string; info: QuadletContainerInfo };

function pickPrimaryContainer(
  containers: DiscoveredUnit[],
  explicitPrimary: string | undefined,
): DiscoveredUnit | null {
  if (containers.length === 0) return null;

  if (explicitPrimary) {
    const normalized = explicitPrimary.trim().toLowerCase();
    const match = containers.find(
      (container) =>
        container.unitBaseName.toLowerCase() === normalized ||
        container.info.containerName.toLowerCase() === normalized,
    );
    if (match) return match;
  }

  return containers.find((container) => container.info.publishPorts.length > 0) ?? containers[0];
}

export type DiscoveredQuadletServiceContainer = {
  containerName: string;
  image: string | null;
  publishPorts: number[];
};

export type DiscoveredQuadletService = {
  id: string;
  dirName: string;
  sourceDir: string;
  name: string;
  description: string | null;
  category: string | null;
  icon: QuadletAppIcon | null;
  webUiPort: number | null;
  containers: DiscoveredQuadletServiceContainer[];
  primaryContainerName: string | null;
};

async function discoverQuadletService(dirPath: string, dirName: string): Promise<DiscoveredQuadletService | null> {
  let entries;
  try {
    entries = await readdir(dirPath, { withFileTypes: true });
  } catch {
    return null;
  }

  const unitFiles = entries.filter((entry) => entry.isFile() && entry.name.endsWith(CONTAINER_UNIT_EXTENSION));
  if (unitFiles.length === 0) return null;

  const parsedUnits = await Promise.all(
    unitFiles.map(async (entry): Promise<DiscoveredUnit | null> => {
      const unitBaseName = entry.name.slice(0, -CONTAINER_UNIT_EXTENSION.length);
      try {
        const content = await readFile(path.join(dirPath, entry.name), "utf8");
        return { unitBaseName, info: extractQuadletContainerInfo(unitBaseName, content) };
      } catch (error) {
        logServerAction({
          level: "warn",
          layer: "service",
          action: "docker.quadlet.discoverService",
          status: "error",
          message: `Could not read quadlet unit ${path.join(dirPath, entry.name)}`,
          error,
        });
        return null;
      }
    }),
  );

  const containers = parsedUnits.filter((unit): unit is DiscoveredUnit => unit !== null);
  if (containers.length === 0) return null;

  const metadata = await readAppMetadata(dirPath);
  const primary = pickPrimaryContainer(containers, metadata?.primaryContainer);
  const slug = slugifyDirName(dirName);

  return {
    id: slug,
    dirName,
    sourceDir: dirPath,
    name: metadata?.name ?? titleCaseFromSlug(slug),
    description: metadata?.description ?? null,
    category: metadata?.category ?? null,
    icon: resolveIcon(metadata?.icon),
    webUiPort: metadata?.port ?? primary?.info.publishPorts[0] ?? null,
    containers: containers.map((container) => ({
      containerName: container.info.containerName,
      image: container.info.image,
      publishPorts: container.info.publishPorts,
    })),
    primaryContainerName: primary?.info.containerName ?? null,
  };
}

/**
 * Scans the immediate subdirectories of `root` for Podman quadlet services: a
 * folder with one or more `*.container` unit files, and optionally an
 * `app.yaml`/`app.yml` describing how to present it. A folder with no
 * `.container` files is not a quadlet service and is skipped.
 */
export async function discoverQuadletServices(root: string): Promise<DiscoveredQuadletService[]> {
  let entries;
  try {
    entries = await readdir(root, { withFileTypes: true });
  } catch (error) {
    logServerAction({
      level: "warn",
      layer: "service",
      action: "docker.quadlet.discoverServices",
      status: "error",
      message: `Could not read quadlet services root ${root}`,
      error,
    });
    return [];
  }

  const directories = entries.filter((entry) => entry.isDirectory());
  const services = await Promise.all(
    directories.map((entry) => discoverQuadletService(path.join(root, entry.name), entry.name)),
  );

  return services.filter((service): service is DiscoveredQuadletService => service !== null);
}

/**
 * Absolute path to a service's locally-stored icon file, or null when it has
 * none. Re-checks containment under the service's own directory even though
 * `resolveIcon` already rejects `..` segments, since this is the boundary an
 * HTTP route reads a file across.
 */
export function resolveLocalIconPath(service: DiscoveredQuadletService): string | null {
  if (!service.icon || service.icon.kind !== "local") return null;

  const base = path.resolve(service.sourceDir) + path.sep;
  const candidate = path.resolve(service.sourceDir, service.icon.relativePath);
  if (!candidate.startsWith(base)) return null;

  return candidate;
}
