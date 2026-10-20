import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type FakeOutcome = "success" | "not-found" | "connection-error";

type RequestOptions = { socketPath: string };
type ResponseHandler = (res: unknown) => void;

const { requestMock } = vi.hoisted(() => ({
  requestMock: vi.fn(),
}));

vi.mock("node:http", () => ({
  request: requestMock,
}));

const serverEnvMock: { DOCKER_SOCKET_PATH: string; PODMAN_ROOTLESS_SOCKET_PATH?: string } = {
  DOCKER_SOCKET_PATH: "/var/run/docker.sock",
};

vi.mock("@/lib/server/env", () => ({
  get serverEnv() {
    return serverEnvMock;
  },
}));

/** A fake node:http ClientRequest/IncomingMessage pair driven by `outcomesBySocket`. */
function configureFakeRequest(outcomesBySocket: Record<string, FakeOutcome>) {
  requestMock.mockImplementation((options: RequestOptions, callback?: ResponseHandler) => {
    const outcome = outcomesBySocket[options.socketPath] ?? "connection-error";
    const handlers: Record<string, (...args: unknown[]) => void> = {};

    const req = {
      on(event: string, handler: (...args: unknown[]) => void) {
        handlers[event] = handler;
        return req;
      },
      end() {
        if (outcome === "connection-error") {
          queueMicrotask(() => handlers.error?.(new Error(`connect ENOENT ${options.socketPath}`)));
          return;
        }

        const resHandlers: Record<string, (...args: unknown[]) => void> = {};
        const res = {
          statusCode: outcome === "not-found" ? 404 : 200,
          setEncoding() {},
          on(event: string, handler: (...args: unknown[]) => void) {
            resHandlers[event] = handler;
            if (outcome === "not-found" && event === "end") {
              queueMicrotask(() => {
                resHandlers.data?.("no such container");
                handler();
              });
            }
            return res;
          },
        };

        queueMicrotask(() => callback?.(res));
      },
    };

    return req;
  });
}

async function freshStreamDockerContainerLogs() {
  vi.resetModules();
  const mod = await import("@/lib/server/modules/docker/logs");
  return mod.streamDockerContainerLogs;
}

beforeEach(() => {
  vi.clearAllMocks();
  serverEnvMock.DOCKER_SOCKET_PATH = "/var/run/docker.sock";
  delete serverEnvMock.PODMAN_ROOTLESS_SOCKET_PATH;
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("streamDockerContainerLogs", () => {
  it("streams from the primary socket when the container is there", async () => {
    configureFakeRequest({ "/var/run/docker.sock": "success" });
    const streamDockerContainerLogs = await freshStreamDockerContainerLogs();

    const res = (await streamDockerContainerLogs("my-app")) as { statusCode: number };
    expect(res.statusCode).toBe(200);
    expect(requestMock).toHaveBeenCalledTimes(1);
  });

  it("falls back to the rootless Podman socket when the primary doesn't have the container", async () => {
    serverEnvMock.PODMAN_ROOTLESS_SOCKET_PATH = "/run/user/1000/podman/podman.sock";
    configureFakeRequest({
      "/var/run/docker.sock": "not-found",
      "/run/user/1000/podman/podman.sock": "success",
    });
    const streamDockerContainerLogs = await freshStreamDockerContainerLogs();

    const res = (await streamDockerContainerLogs("quadlet-app")) as { statusCode: number };
    expect(res.statusCode).toBe(200);
    expect(requestMock).toHaveBeenCalledTimes(2);
  });

  it("surfaces the primary socket's error when no rootless socket is configured", async () => {
    configureFakeRequest({ "/var/run/docker.sock": "not-found" });
    const streamDockerContainerLogs = await freshStreamDockerContainerLogs();

    await expect(streamDockerContainerLogs("missing")).rejects.toThrow(/404/);
    expect(requestMock).toHaveBeenCalledTimes(1);
  });

  it("surfaces the primary socket's error when both sockets fail", async () => {
    serverEnvMock.PODMAN_ROOTLESS_SOCKET_PATH = "/run/user/1000/podman/podman.sock";
    configureFakeRequest({
      "/var/run/docker.sock": "not-found",
      "/run/user/1000/podman/podman.sock": "connection-error",
    });
    const streamDockerContainerLogs = await freshStreamDockerContainerLogs();

    await expect(streamDockerContainerLogs("missing")).rejects.toThrow(/404/);
    expect(requestMock).toHaveBeenCalledTimes(2);
  });
});
