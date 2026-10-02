# Docker Integration

## Purpose

Docker integration parses Compose content, materializes stacks, runs Docker Compose commands, streams logs, gathers container stats, and performs maintenance tasks such as image/volume prune.

## Locations

- Server-side: `lib/server/modules/docker/`
- Client-side: `modules/apps/`, `modules/system/hooks/useDockerInfo.ts`, `modules/system/hooks/useDockerStats.ts`, settings Docker section
- Routes: `app/api/v1/docker/`, app operation routes under `app/api/v1/store/`

## Key Files

| File | Role |
|---|---|
| `lib/server/modules/docker/compose-runner.ts` | Compose materialization, YAML text transforms, Docker CLI execution |
| `lib/server/modules/docker/compose-parser.ts` | Compose parsing helpers |
| `lib/server/modules/docker/logs.ts` | Container log streaming |
| `lib/server/modules/docker/stats.ts` | Docker stats collection |
| `lib/server/modules/docker/maintenance-service.ts` | Image and volume prune |
| `lib/server/modules/docker/app-data-ownership.ts` | App data ownership helpers |
| `lib/server/modules/docker/unmanaged-containers.ts` | Containers Homeio didn't deploy, for read-only display |
| `lib/server/modules/docker/quadlet-discovery.ts` | Scans `QUADLET_SERVICES_ROOT` for Podman quadlet service folders and their `app.yaml` metadata |
| `lib/server/modules/docker/quadlet-apps.ts` | Resolves discovered quadlet services against live containers |

## Public API

- Compose runner helpers used by `lib/server/modules/apps/operations.ts`
- `pruneDockerImages()`
- `pruneDockerVolumes()`
- Docker info/stats helpers used by system hooks

## Contracts

- `lib/shared/contracts/docker.ts`
- `lib/shared/contracts/quadlet.ts`

## Database Tables

Docker itself is not persisted directly. Docker-backed app state is in:

- `app_stacks`
- `app_operations`

## API Routes Owned

- `GET /api/v1/docker/info`
- `GET /api/v1/docker/stats`
- `GET /api/v1/docker/stats/stream`
- `GET /api/v1/docker/containers`
- `GET /api/v1/docker/quadlet-apps`
- `GET /api/v1/docker/quadlet-apps/[id]/icon`
- `POST /api/v1/docker/prune/images`
- `POST /api/v1/docker/prune/volumes`

## Known Issues

- `lib/server/modules/docker/compose-runner.ts` is over 1,400 lines.
- Compose YAML manipulation is text-based and fragile.
- Docker access depends on the host Docker socket, which is a high-privilege boundary.
- Docker read and mutation routes are protected by `requireApiSession()`.

## How To Extend

To add a Docker maintenance action:

1. Add request/response types to `lib/shared/contracts/docker.ts`.
2. Add the server function in `lib/server/modules/docker/maintenance-service.ts` or a narrow new file.
3. Add a protected route under `app/api/v1/docker/`.
4. Add query/mutation code in `modules/settings/hooks/backend/api.ts` or a module hook.
5. Add UI in the relevant settings or apps component.
6. Add tests under `lib/server/modules/docker/__tests__/` and route tests.
