/* @vitest-environment jsdom */

import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { writePersistedPowerActionState } from "@/lib/desktop/reboot-state";
import { dispatchSystemStreamStatus } from "@/lib/desktop/system-stream-status";
import { queryKeys } from "@/lib/shared/query-keys";
import { useServerConnection } from "@/modules/shell/hooks/useServerConnection";
import { createTestQueryClient, createWrapper } from "@/test/query-client-wrapper";

const { reloadBrowserWindowMock } = vi.hoisted(() => ({
  reloadBrowserWindowMock: vi.fn(),
}));

vi.mock("@/lib/desktop/browser-reload", () => ({
  reloadBrowserWindow: reloadBrowserWindowMock,
}));

// A fake Homeio: up or down, and one process at a time.
function createServer() {
  const server = {
    up: true,
    pid: 4242,
    processStartedAt: Date.now() - 600_000,
    snapshot() {
      const now = Date.now();
      return {
        timestamp: new Date(now).toISOString(),
        process: {
          pid: server.pid,
          uptimeSeconds: (now - server.processStartedAt) / 1_000,
          nodeVersion: "v22",
          runtime: "host" as const,
        },
      };
    },
    restart() {
      server.pid += 1;
      server.processStartedAt = Date.now();
    },
  };

  const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url === "/icon.png") return { ok: false, status: 404 };
    if (!server.up) throw new TypeError("Failed to fetch");
    if (url === "/api/v1/system/metrics") {
      return { ok: true, status: 200, json: async () => ({ data: server.snapshot() }) };
    }
    return { ok: true, status: 200 };
  });

  return { server, fetchMock };
}

async function advance(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

describe("useServerConnection", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    localStorage.clear();
    reloadBrowserWindowMock.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  function setup() {
    const { server, fetchMock } = createServer();
    vi.stubGlobal("fetch", fetchMock);
    const client = createTestQueryClient();
    client.setQueryData(queryKeys.systemMetrics, server.snapshot());
    const hook = renderHook(() => useServerConnection(true), {
      wrapper: createWrapper(client),
    });
    return { server, fetchMock, client, hook };
  }

  it("ignores a stream drop when the server still answers", async () => {
    const { hook } = setup();

    act(() => dispatchSystemStreamStatus("disconnected"));
    await advance(0);

    expect(hook.result.current.phase).toBe("online");
  });

  it("shows the screen on the first failed check after the stream drops", async () => {
    const { server, hook } = setup();

    // A service restart: Homeio is away for about a second.
    server.up = false;
    act(() => dispatchSystemStreamStatus("disconnected"));
    await advance(0);

    expect(hook.result.current.phase).toBe("lost");

    server.restart();
    server.up = true;
    await advance(2_000);

    expect(hook.result.current.phase).toBe("restored");
  });

  it("hides the screen without a reload when the same process is back", async () => {
    const { server, client, hook } = setup();
    const invalidateSpy = vi.spyOn(client, "invalidateQueries");

    server.up = false;
    act(() => dispatchSystemStreamStatus("disconnected"));
    await advance(2_000);

    expect(hook.result.current.phase).toBe("lost");
    expect(hook.result.current.runtime).toBe("host");
    expect(hook.result.current.lostSince).not.toBeNull();

    // A network blip: the server kept running the whole time.
    server.up = true;
    await advance(2_000);

    expect(hook.result.current.phase).toBe("restored");
    expect(hook.result.current.serverRestarted).toBe(false);

    await advance(1_200);

    expect(hook.result.current.phase).toBe("online");
    expect(reloadBrowserWindowMock).not.toHaveBeenCalled();
    expect(invalidateSpy).toHaveBeenCalled();
  });

  it("reloads the page when a new process answers", async () => {
    const { server, hook } = setup();

    server.up = false;
    act(() => dispatchSystemStreamStatus("disconnected"));
    await advance(2_000);
    expect(hook.result.current.phase).toBe("lost");

    server.restart();
    server.up = true;
    await advance(2_000);

    expect(hook.result.current.phase).toBe("restored");
    expect(hook.result.current.serverRestarted).toBe(true);

    await advance(1_200);

    expect(reloadBrowserWindowMock).toHaveBeenCalledOnce();
  });

  it("checks right away when the user asks", async () => {
    const { server, fetchMock, hook } = setup();

    server.up = false;
    act(() => dispatchSystemStreamStatus("disconnected"));
    await advance(2_000);
    expect(hook.result.current.phase).toBe("lost");

    const callsBefore = fetchMock.mock.calls.length;
    act(() => hook.result.current.checkNow());
    await advance(0);

    expect(fetchMock.mock.calls.length).toBe(callsBefore + 1);
  });

  it("leaves reboots and updates started from the desktop to their own screen", async () => {
    const { server, fetchMock, hook } = setup();
    writePersistedPowerActionState(localStorage, {
      action: "reboot",
      startedAt: new Date().toISOString(),
    });

    server.up = false;
    act(() => dispatchSystemStreamStatus("disconnected"));
    await advance(6_000);

    expect(hook.result.current.phase).toBe("online");
    expect(fetchMock).not.toHaveBeenCalledWith("/api/health", expect.anything());
  });
});
