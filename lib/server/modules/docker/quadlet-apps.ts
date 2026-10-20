import "server-only";

import { memoizeAsync } from "@/lib/server/cache/memoize-async";
import { serverEnv } from "@/lib/server/env";
import { toContainerName } from "@/lib/server/modules/docker/container-name";
import {
  discoverQuadletServices,
  type DiscoveredQuadletService,
} from "@/lib/server/modules/docker/quadlet-discovery";
import { listContainers } from "@/lib/server/modules/docker/stats";
import { parseDockerStatusLine, summarizeContainers } from "@/lib/shared/app-condition";
import type { QuadletApp } from "@/lib/shared/contracts/quadlet";

// Scanning disk on every poll (the dashboard refreshes every 30s) is cheap for
// a handful of service folders, but there's no reason to stat them on every
// request either -- a short memo keeps install/add-a-service changes visible
// within seconds without hitting the filesystem that often.
const QUADLET_DISCOVERY_TTL_MS = 10_000;

const discoverCached = memoizeAsync(async () => {
  const root = serverEnv.QUADLET_SERVICES_ROOT;
  if (!root) return [] as DiscoveredQuadletService[];
  return discoverQuadletServices(root);
}, QUADLET_DISCOVERY_TTL_MS);

export function invalidateQuadletDiscoveryCache() {
  discoverCached.invalidate();
}

function iconUrlFor(service: DiscoveredQuadletService): string | null {
  if (!service.icon) return null;
  if (service.icon.kind === "url") return service.icon.value;
  return `/api/v1/docker/quadlet-apps/${encodeURIComponent(service.id)}/icon`;
}

/**
 * Quadlet services discovered under `QUADLET_SERVICES_ROOT`, each resolved
 * against the containers actually running right now so its condition
 * reflects reality rather than just what the unit files declare.
 */
export async function listQuadletApps(): Promise<QuadletApp[]> {
  const services = await discoverCached();
  if (services.length === 0) return [];

  const containers = await listContainers();
  const containerByName = new Map(
    containers.map((container) => [toContainerName(container.Names, container.Id), container] as const),
  );

  return services
    .map((service): QuadletApp => {
      const matchedAny = service.containers.some((member) => containerByName.has(member.containerName));

      const condition = matchedAny
        ? summarizeContainers(
            service.containers.map((member) => {
              const container = containerByName.get(member.containerName);
              if (!container) return { state: "unknown", exitCode: null, health: null };
              return {
                state: container.State ?? "unknown",
                ...parseDockerStatusLine(container.Status ?? ""),
              };
            }),
          )
        : { condition: "unknown" as const, exitCode: null };

      return {
        id: `quadlet:${service.id}`,
        name: service.name,
        description: service.description,
        category: service.category,
        logoUrl: iconUrlFor(service),
        webUiPort: service.webUiPort,
        condition,
        containerNames: service.containers.map((member) => member.containerName),
        primaryContainerName: service.primaryContainerName,
      };
    })
    .sort((left, right) => left.name.localeCompare(right.name));
}

/** Every container name claimed by a discovered quadlet app, so the generic "unmanaged container" list can skip them. */
export async function listClaimedQuadletContainerNames(): Promise<Set<string>> {
  const apps = await listQuadletApps();
  return new Set(apps.flatMap((app) => app.containerNames));
}

export async function findQuadletServiceById(id: string): Promise<DiscoveredQuadletService | null> {
  const services = await discoverCached();
  return services.find((service) => service.id === id) ?? null;
}
