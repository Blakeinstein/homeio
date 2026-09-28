import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

describe("server logger", () => {
  const originalNodeEnv = process.env.NODE_ENV;

  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    process.env.NODE_ENV = originalNodeEnv;
    vi.unstubAllEnvs();
  });

  it("writes structured logs to console and file", async () => {
    process.env.NODE_ENV = "development";

    const appendFile = vi.fn(async () => undefined);
    const mkdir = vi.fn(async () => undefined);
    const stat = vi.fn(async () => ({ size: 0 }));
    const rename = vi.fn(async () => undefined);

    vi.doMock("node:fs/promises", () => ({ appendFile, mkdir, stat, rename }));
    vi.doMock("@/lib/server/env", () => ({
      serverEnv: {
        LOG_LEVEL: "info",
        LOG_FILE_PATH: "logs/test.log",
        LOG_TO_FILE: true,
      },
    }));

    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    const { flushServerLogsForTests, logServerAction } = await import(
      "@/lib/server/logging/logger"
    );

    logServerAction({
      layer: "api",
      action: "health.get",
      status: "success",
      meta: { requestId: "r1" },
    });

    await flushServerLogsForTests();

    expect(logSpy).toHaveBeenCalledTimes(1);
    expect(mkdir).toHaveBeenCalledTimes(1);
    expect(appendFile).toHaveBeenCalledTimes(1);
    expect(String(appendFile.mock.calls[0][1])).toContain('"action":"health.get"');
  });

  it("appends lines logged together in one write", async () => {
    vi.stubEnv("NODE_ENV", "development");
    const appendFile = vi.fn(async (_path: string, _data: string) => undefined);
    vi.doMock("node:fs/promises", () => ({
      appendFile,
      mkdir: vi.fn(async () => undefined),
      stat: vi.fn(async () => ({ size: 0 })),
      rename: vi.fn(async () => undefined),
    }));
    vi.doMock("@/lib/server/env", () => ({
      serverEnv: { LOG_LEVEL: "info", LOG_FILE_PATH: "logs/test.log", LOG_TO_FILE: true },
    }));
    vi.spyOn(console, "log").mockImplementation(() => {});
    const { flushServerLogsForTests, logServerAction } = await import("@/lib/server/logging/logger");

    for (const action of ["one", "two", "three"]) {
      logServerAction({ layer: "api", action, status: "success" });
    }
    await flushServerLogsForTests();

    expect(appendFile).toHaveBeenCalledTimes(1);
    const written = String(appendFile.mock.calls[0][1]);
    expect(written.trim().split("\n")).toHaveLength(3);
  });

  it("rotates the file once it would grow past 10 MB", async () => {
    vi.stubEnv("NODE_ENV", "development");
    const appendFile = vi.fn(async (_path: string, _data: string) => undefined);
    const rename = vi.fn(async (_from: string, _to: string) => undefined);
    vi.doMock("node:fs/promises", () => ({
      appendFile,
      rename,
      mkdir: vi.fn(async () => undefined),
      stat: vi.fn(async () => ({ size: 10 * 1024 * 1024 - 10 })),
    }));
    vi.doMock("@/lib/server/env", () => ({
      serverEnv: { LOG_LEVEL: "info", LOG_FILE_PATH: "/var/log/homeio/test.log", LOG_TO_FILE: true },
    }));
    vi.spyOn(console, "log").mockImplementation(() => {});
    const { flushServerLogsForTests, logServerAction } = await import("@/lib/server/logging/logger");

    logServerAction({ layer: "api", action: "health.get", status: "success" });
    await flushServerLogsForTests();

    expect(rename).toHaveBeenCalledWith("/var/log/homeio/test.log", "/var/log/homeio/test.log.1");
    expect(rename.mock.invocationCallOrder[0]).toBeLessThan(appendFile.mock.invocationCallOrder[0]);
  });

  it("logs and rethrows timed operation errors", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    vi.doMock("@/lib/server/env", () => ({
      serverEnv: {
        LOG_LEVEL: "debug",
        LOG_FILE_PATH: "logs/test.log",
        LOG_TO_FILE: false,
      },
    }));

    const { withServerTiming } = await import("@/lib/server/logging/logger");

    await expect(
      withServerTiming(
        {
          layer: "db",
          action: "pg.query",
        },
        async () => {
          throw new Error("boom");
        },
      ),
    ).rejects.toThrow("boom");

    expect(errorSpy).toHaveBeenCalled();
  });

  it("suppresses debug logs when the server log level is info", async () => {
    vi.doMock("@/lib/server/env", () => ({
      serverEnv: {
        LOG_LEVEL: "info",
        LOG_FILE_PATH: "logs/test.log",
        LOG_TO_FILE: false,
      },
    }));

    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    const { withServerTiming } = await import("@/lib/server/logging/logger");

    await withServerTiming(
      {
        level: "debug",
        layer: "api",
        action: "network.status.get",
      },
      async () => "ok",
    );

    expect(logSpy).not.toHaveBeenCalled();
  });
});
