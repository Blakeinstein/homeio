/* @vitest-environment jsdom */

import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  POWER_ACTION_COMPLETION_STORAGE_KEY,
  POWER_ACTION_STATE_CHANGED_EVENT,
  readPersistedPowerActionCompletion,
  writePersistedPowerActionState,
} from "@/lib/desktop/reboot-state";
import { queryKeys } from "@/lib/shared/query-keys";
import { useRebootRecovery } from "@/modules/shell/hooks/useRebootRecovery";
import { createTestQueryClient, createWrapper } from "@/test/query-client-wrapper";

const { reloadBrowserWindowMock } = vi.hoisted(() => ({
  reloadBrowserWindowMock: vi.fn(),
}));

vi.mock("@/lib/desktop/browser-reload", () => ({
  reloadBrowserWindow: reloadBrowserWindowMock,
}));

describe("useRebootRecovery", () => {
  beforeEach(() => {
    vi.useRealTimers();
    localStorage.clear();
    vi.restoreAllMocks();
    reloadBrowserWindowMock.mockReset();
  });

  it("recovers from persisted reboot state and clears it after health/auth succeed", async () => {
    writePersistedPowerActionState(localStorage, {
      action: "reboot",
      startedAt: new Date(Date.now() - 10_000).toISOString(),
    });

    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new Error("down"))
      .mockResolvedValueOnce({ ok: true, status: 200 })
      .mockResolvedValueOnce({ ok: true, status: 200 });
    vi.stubGlobal("fetch", fetchMock);

    const client = createTestQueryClient();
    const invalidateSpy = vi.spyOn(client, "invalidateQueries");

    const { result } = renderHook(() => useRebootRecovery(), {
      wrapper: createWrapper(client),
    });

    await waitFor(() => {
      expect(result.current.isHydrated).toBe(true);
      expect(result.current.isActive).toBe(true);
    });

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(3);
    }, { timeout: 4_000 });

    await waitFor(() => {
      expect(result.current.isActive).toBe(false);
    }, { timeout: 4_000 });

    expect(localStorage.getItem("system.power.action.v1")).toBeNull();
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: queryKeys.currentUser,
    });
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: queryKeys.systemMetrics,
    });
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: queryKeys.installedApps,
    });
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: queryKeys.powerSchedule,
    });
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: queryKeys.systemBackups,
    });
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: queryKeys.systemUpdates,
    });
  });

  it("clears reboot state on 401 after service recovery", async () => {
    writePersistedPowerActionState(localStorage, {
      action: "factory-reset",
      startedAt: new Date(Date.now() - 20_000).toISOString(),
    });

    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, status: 200 })
      .mockResolvedValueOnce({ ok: false, status: 401 });
    vi.stubGlobal("fetch", fetchMock);

    const client = createTestQueryClient();

    const { result } = renderHook(() => useRebootRecovery(), {
      wrapper: createWrapper(client),
    });

    await waitFor(() => {
      expect(result.current.isHydrated).toBe(true);
    });

    await waitFor(() => {
      expect(result.current.isActive).toBe(false);
    }, { timeout: 4_000 });

    expect(localStorage.getItem("system.power.action.v1")).toBeNull();
  });

  describe("after a restore", () => {
    // Routes by URL rather than by call order: the restore path makes a call
    // the others do not, and the order of polls is not what is under test.
    function stubServer(outcomes: Array<Record<string, unknown> | null>) {
      let outcomeIndex = 0;
      const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes("/api/health")) return { ok: true, status: 200 };
        if (url.includes("/api/auth/me")) return { ok: true, status: 200 };
        if (url.includes("/restore-status")) {
          const data = outcomes[Math.min(outcomeIndex, outcomes.length - 1)] ?? null;
          outcomeIndex += 1;
          return { ok: true, status: 200, json: async () => ({ data }) };
        }
        throw new Error(`unexpected ${url}`);
      });
      vi.stubGlobal("fetch", fetchMock);
      return fetchMock;
    }

    function outcome(status: "running" | "failed" | "completed", message: string) {
      return {
        restoreId: "restore-1",
        backupId: "backup-2020-02-02T00-00-00Z",
        status,
        step: status === "failed" ? "rehearsing" : "restarting-apps",
        exitCode: status === "failed" ? 3 : 0,
        at: "2026-09-25T13:52:26Z",
        message,
      };
    }

    function startRestore(restoreId: string | undefined, secondsAgo = 20) {
      writePersistedPowerActionState(localStorage, {
        action: "restore",
        startedAt: new Date(Date.now() - secondsAgo * 1_000).toISOString(),
        restoreId,
      });
    }

    async function recover() {
      const { result } = renderHook(() => useRebootRecovery(), {
        wrapper: createWrapper(createTestQueryClient()),
      });
      await waitFor(() => {
        expect(result.current.isHydrated).toBe(true);
      });
      return result;
    }

    it("says the restore failed when the script says it did", async () => {
      startRestore("restore-1");
      stubServer([outcome("failed", "The restore failed. Nothing was changed.")]);

      const result = await recover();
      await waitFor(() => {
        expect(result.current.isActive).toBe(false);
      }, { timeout: 4_000 });

      // The server answering again is not a success: this used to clear the
      // screen in silence whether the restore had worked or not.
      expect(readPersistedPowerActionCompletion(localStorage)).toMatchObject({
        action: "restore",
        tone: "error",
        message: "The restore failed. Nothing was changed.",
      });
    });

    it("keeps waiting while the restore is still running, then reports how it ended", async () => {
      startRestore("restore-1");
      const fetchMock = stubServer([
        outcome("running", "still going"),
        outcome("completed", "Restored from backup-2020-02-02T00-00-00Z."),
      ]);

      const result = await recover();
      await waitFor(() => {
        expect(result.current.isActive).toBe(false);
      }, { timeout: 6_000 });

      const statusReads = fetchMock.mock.calls.filter(([url]) => String(url).includes("/restore-status"));
      expect(statusReads.length).toBeGreaterThanOrEqual(2);
      expect(readPersistedPowerActionCompletion(localStorage)).toMatchObject({
        tone: "success",
        message: "Restored from backup-2020-02-02T00-00-00Z.",
      });
    });

    it("does not take another restore's outcome for this one", async () => {
      startRestore("restore-2", 5 * 60);
      stubServer([outcome("completed", "Restored from an older attempt.")]);

      const result = await recover();
      await waitFor(() => {
        expect(result.current.isActive).toBe(false);
      }, { timeout: 4_000 });

      const completion = readPersistedPowerActionCompletion(localStorage);
      expect(completion?.tone).toBe("warning");
      expect(completion?.message).toContain("found no record of this restore");
    });
  });

  it("keeps the update overlay active until health and auth recover", async () => {
    writePersistedPowerActionState(localStorage, {
      action: "update",
      startedAt: new Date(Date.now() - 20_000).toISOString(),
    });

    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, status: 200 })
      .mockResolvedValueOnce({ ok: true, status: 200 });
    vi.stubGlobal("fetch", fetchMock);

    const client = createTestQueryClient();

    const { result } = renderHook(() => useRebootRecovery(), {
      wrapper: createWrapper(client),
    });

    await waitFor(() => {
      expect(result.current.isHydrated).toBe(true);
      expect(result.current.action).toBe("update");
    });

    await waitFor(() => {
      expect(result.current.isActive).toBe(false);
    }, { timeout: 4_000 });

    expect(localStorage.getItem("system.power.action.v1")).toBeNull();
    expect(readPersistedPowerActionCompletion(localStorage)).toMatchObject({
      action: "update",
    });
    expect(reloadBrowserWindowMock).toHaveBeenCalledTimes(1);
  });

  it("does not clear update recovery before the service actually goes away", async () => {
    writePersistedPowerActionState(localStorage, {
      action: "update",
      startedAt: new Date().toISOString(),
    });

    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, status: 200 })
      .mockRejectedValueOnce(new Error("gateway down"))
      .mockResolvedValueOnce({ ok: true, status: 200 })
      .mockResolvedValueOnce({ ok: true, status: 200 });
    vi.stubGlobal("fetch", fetchMock);

    const client = createTestQueryClient();

    const { result } = renderHook(() => useRebootRecovery(), {
      wrapper: createWrapper(client),
    });

    await waitFor(() => {
      expect(result.current.isHydrated).toBe(true);
      expect(result.current.isActive).toBe(true);
      expect(result.current.action).toBe("update");
    });

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(result.current.isActive).toBe(true);
    });

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(4);
      expect(result.current.isActive).toBe(false);
    }, { timeout: 8_000 });

    expect(reloadBrowserWindowMock).toHaveBeenCalledTimes(1);
  });

  it("reacts immediately when a power action is written in the same tab", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("still rebooting")));

    const client = createTestQueryClient();

    const { result } = renderHook(() => useRebootRecovery(), {
      wrapper: createWrapper(client),
    });

    await waitFor(() => {
      expect(result.current.isHydrated).toBe(true);
      expect(result.current.isActive).toBe(false);
    });

    act(() => {
      writePersistedPowerActionState(localStorage, {
        action: "update",
        startedAt: new Date().toISOString(),
      });
      window.dispatchEvent(new Event(POWER_ACTION_STATE_CHANGED_EVENT));
    });

    await waitFor(() => {
      expect(result.current.isActive).toBe(true);
      expect(result.current.action).toBe("update");
    });
    expect(localStorage.getItem(POWER_ACTION_COMPLETION_STORAGE_KEY)).toBeNull();
  });
});
