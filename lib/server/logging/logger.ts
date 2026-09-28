import "server-only";

import { randomUUID } from "node:crypto";
import { appendFile, mkdir, rename, stat } from "node:fs/promises";
import path from "node:path";
import { serverEnv } from "@/lib/server/env";
import type {
  LogLevel,
  LogLayer,
  LogStatus,
  StructuredLogEntry,
} from "@/lib/shared/contracts/logging";

type ServerLogInput = {
  level?: LogLevel;
  layer: LogLayer;
  action: string;
  status?: LogStatus;
  durationMs?: number;
  requestId?: string;
  message?: string;
  meta?: Record<string, unknown>;
  error?: unknown;
  runtime?: "server" | "client";
};

type ServerTimingOptions = {
  level?: LogLevel;
  layer: LogLayer;
  action: string;
  requestId?: string;
  meta?: Record<string, unknown>;
  onSuccessMeta?: (result: unknown) => Record<string, unknown> | undefined;
  onErrorMeta?: (error: unknown) => Record<string, unknown> | undefined;
};

const levelRank: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

const ANSI = {
  reset: "\x1b[0m",
  red: "\x1b[31m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  cyan: "\x1b[36m",
  gray: "\x1b[90m",
} as const;

// Lines logged together are appended together: one file write per burst, not
// one open/write/close per line queued behind each other under load. The file
// rotates past LOG_FILE_MAX_BYTES, keeping the previous one as .1, so it cannot
// fill the disk of a small home server.
const LOG_FILE_MAX_BYTES = 10 * 1024 * 1024;

let writeQueue: Promise<void> = Promise.resolve();
let pendingLines: string[] = [];
let logFileBytes: number | null = null;
let logDirectoryReady = false;

function getServerLogLevel(): LogLevel {
  const raw = serverEnv.LOG_LEVEL;
  if (raw === "debug" || raw === "info" || raw === "warn" || raw === "error") {
    return raw;
  }

  return "info";
}

function shouldLog(level: LogLevel) {
  return levelRank[level] >= levelRank[getServerLogLevel()];
}

function canUseColor() {
  if (process.env.NO_COLOR === "1" || process.env.NO_COLOR === "true") return false;
  return Boolean(process.stdout?.isTTY);
}

function colorize(text: string, color: string) {
  if (!canUseColor()) return text;
  return `${color}${text}${ANSI.reset}`;
}

function safeStringify(value: unknown) {
  try {
    return JSON.stringify(value);
  } catch {
    return '"[unserializable]"';
  }
}

function statusGlyph(entry: StructuredLogEntry) {
  if (entry.status === "success") return colorize("✓", ANSI.green);
  if (entry.status === "error" || entry.level === "error") return colorize("x", ANSI.red);
  if (entry.level === "warn") return colorize("!", ANSI.yellow);
  if (entry.status === "start") return colorize(">", ANSI.cyan);
  return colorize("•", ANSI.gray);
}

function formatConsoleLine(entry: StructuredLogEntry) {
  const duration = typeof entry.durationMs === "number" ? ` ${entry.durationMs}ms` : "";
  const request = entry.requestId ? ` req=${entry.requestId}` : "";
  const message = entry.message ? ` msg=${entry.message}` : "";
  const meta = entry.meta ? ` meta=${safeStringify(entry.meta)}` : "";
  const error = entry.error?.message ? ` err=${entry.error.message}` : "";

  return `${statusGlyph(entry)} ${entry.timestamp} ${entry.layer}.${entry.action} ${entry.status.toUpperCase()}${duration}${request}${message}${meta}${error}`;
}

function serializeError(error: unknown) {
  if (!error) return undefined;

  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      stack: error.stack,
    };
  }

  return {
    message: typeof error === "string" ? error : JSON.stringify(error),
  };
}

function getLogFilePath() {
  const filePath = serverEnv.LOG_FILE_PATH || "logs/home-server.log";
  return path.isAbsolute(filePath)
    ? filePath
    : path.resolve(process.cwd(), filePath);
}

async function ensureLogDirectory() {
  if (logDirectoryReady) return;

  await mkdir(path.dirname(getLogFilePath()), { recursive: true });
  logDirectoryReady = true;
}

function writeConsole(entry: StructuredLogEntry) {
  const line = formatConsoleLine(entry);

  if (entry.level === "error") {
    console.error(line);
    return;
  }

  if (entry.level === "warn") {
    console.warn(line);
    return;
  }

  console.log(line);
}

async function readFileSize(filePath: string) {
  try {
    return (await stat(filePath)).size;
  } catch {
    return 0;
  }
}

async function flushPendingLines() {
  const chunk = pendingLines.join("");
  pendingLines = [];
  const chunkBytes = Buffer.byteLength(chunk, "utf8");
  const filePath = getLogFilePath();

  await ensureLogDirectory();
  logFileBytes ??= await readFileSize(filePath);
  if (logFileBytes > 0 && logFileBytes + chunkBytes > LOG_FILE_MAX_BYTES) {
    await rename(filePath, `${filePath}.1`);
    logFileBytes = 0;
  }
  await appendFile(filePath, chunk, "utf8");
  logFileBytes += chunkBytes;
}

function reportFileWriteFailure(error: unknown) {
  // The size is unknown after a failed write or rotation: read it again next time.
  logFileBytes = null;
  const fallback: StructuredLogEntry = {
    timestamp: new Date().toISOString(),
    runtime: "server",
    level: "error",
    layer: "system",
    action: "log.file.write",
    status: "error",
    message: "Failed writing structured log to file",
    error: serializeError(error),
  };

  console.error(JSON.stringify(fallback));
}

function writeToFile(entry: StructuredLogEntry) {
  if (process.env.NODE_ENV === "test") return;
  if (serverEnv.LOG_TO_FILE === false) return;

  pendingLines.push(`${JSON.stringify(entry)}\n`);
  // The first line of a batch schedules its flush; later ones join the batch.
  if (pendingLines.length === 1) {
    writeQueue = writeQueue.then(flushPendingLines).catch(reportFileWriteFailure);
  }
}

export function logServerAction(input: ServerLogInput) {
  const level = input.level ?? "info";
  if (!shouldLog(level)) return;

  const entry: StructuredLogEntry = {
    timestamp: new Date().toISOString(),
    runtime: input.runtime ?? "server",
    level,
    layer: input.layer,
    action: input.action,
    status: input.status ?? "info",
    durationMs: input.durationMs,
    requestId: input.requestId,
    message: input.message,
    meta: input.meta,
    error: serializeError(input.error),
  };

  writeConsole(entry);
  writeToFile(entry);
}

export async function withServerTiming<T>(
  options: ServerTimingOptions,
  fn: () => Promise<T>,
): Promise<T> {
  const startedAt = performance.now();

  logServerAction({
    level: options.level ?? "info",
    layer: options.layer,
    action: options.action,
    status: "start",
    requestId: options.requestId,
    meta: options.meta,
  });

  try {
    const result = await fn();

    logServerAction({
      level: options.level ?? "info",
      layer: options.layer,
      action: options.action,
      status: "success",
      requestId: options.requestId,
      durationMs: Number((performance.now() - startedAt).toFixed(2)),
      meta: {
        ...options.meta,
        ...(options.onSuccessMeta ? options.onSuccessMeta(result) : {}),
      },
    });

    return result;
  } catch (error) {
    logServerAction({
      level: "error",
      layer: options.layer,
      action: options.action,
      status: "error",
      requestId: options.requestId,
      durationMs: Number((performance.now() - startedAt).toFixed(2)),
      meta: {
        ...options.meta,
        ...(options.onErrorMeta ? options.onErrorMeta(error) : {}),
      },
      error,
    });

    throw error;
  }
}

export function createRequestId() {
  return randomUUID();
}

export async function flushServerLogsForTests() {
  await writeQueue;
}
