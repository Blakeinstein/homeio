import "server-only";

import { open, type FileHandle } from "node:fs/promises";
import path from "node:path";
import { exec } from "node:child_process";
import { promisify } from "node:util";
import { serverEnv } from "@/lib/server/env";
import type { StructuredLogEntry } from "@/lib/shared/contracts/logging";

const execAsync = promisify(exec);

export type LogSource = "homeio" | "system" | "docker";

export type RawLogEntry = {
  raw: string;
  timestamp?: string;
  level?: StructuredLogEntry["level"];
  layer?: string;
  action?: string;
  message?: string;
  status?: string;
  error?: { message: string };
};

export type LogsResult = {
  entries: RawLogEntry[];
  source: LogSource;
  truncated: boolean;
  error?: string;
};

const MAX_LINES = 500;

function getLogFilePath(): string {
  const filePath = serverEnv.LOG_FILE_PATH || "logs/home-server.log";
  return path.isAbsolute(filePath)
    ? filePath
    : path.resolve(process.cwd(), filePath);
}

// The Logs window shows the last lines of a file that only grows (tens of MB
// after a few weeks). Read it backwards from the end, a chunk at a time, so
// the cost follows the lines shown instead of the size of the file.
const TAIL_CHUNK_BYTES = 64 * 1024;
const NEWLINE = 0x0a;

/** The last `maxLines` non-empty lines of a file, or [] when it does not exist. */
export async function readTailLines(filePath: string, maxLines: number): Promise<string[]> {
  let file: FileHandle;
  try {
    file = await open(filePath, "r");
  } catch {
    return [];
  }

  try {
    const { size } = await file.stat();
    const chunks: Buffer[] = [];
    let position = size;
    let newlines = 0;

    // One newline more than the lines wanted: the window's first line may be cut.
    while (position > 0 && newlines <= maxLines) {
      const length = Math.min(TAIL_CHUNK_BYTES, position);
      position -= length;
      const chunk = Buffer.alloc(length);
      await file.read(chunk, 0, length, position);
      chunks.unshift(chunk);
      for (let at = chunk.indexOf(NEWLINE); at !== -1; at = chunk.indexOf(NEWLINE, at + 1)) {
        newlines += 1;
      }
    }

    // Decode once, after joining: a character split across two chunks stays whole.
    const lines = Buffer.concat(chunks).toString("utf8").split("\n");
    if (position > 0) lines.shift();
    return lines.filter((line) => line.trim()).slice(-maxLines);
  } finally {
    await file.close();
  }
}

function parseHomeioLine(raw: string): RawLogEntry {
  try {
    const parsed = JSON.parse(raw) as Partial<StructuredLogEntry>;
    return {
      raw,
      timestamp: parsed.timestamp,
      level: parsed.level,
      layer: parsed.layer,
      action: parsed.action,
      message: parsed.message,
      status: parsed.status,
      error: parsed.error
        ? { message: parsed.error.message }
        : undefined,
    };
  } catch {
    return { raw };
  }
}

export async function getHomeioLogs(): Promise<LogsResult> {
  const filePath = getLogFilePath();

  try {
    const lines = await readTailLines(filePath, MAX_LINES);
    const total = lines.length;

    return {
      entries: lines.map(parseHomeioLine),
      source: "homeio",
      truncated: total >= MAX_LINES,
    };
  } catch (error) {
    return {
      entries: [],
      source: "homeio",
      truncated: false,
      error: error instanceof Error ? error.message : "Failed to read logs",
    };
  }
}

async function runJournalctl(unit?: string): Promise<LogsResult> {
  const source: LogSource = unit ? "docker" : "system";
  const unitFlag = unit ? `-u ${unit}` : "";
  const cmd = `journalctl ${unitFlag} -n ${MAX_LINES} --no-pager --output=short-iso 2>&1`;

  try {
    const { stdout } = await execAsync(cmd, { timeout: 8_000 });
    const lines = stdout
      .split("\n")
      .filter((l) => l.trim())
      .slice(-MAX_LINES);

    return {
      entries: lines.map((raw) => ({ raw })),
      source,
      truncated: lines.length >= MAX_LINES,
    };
  } catch (error) {
    // journalctl may not be available (dev environment)
    const message =
      error instanceof Error ? error.message : "journalctl unavailable";
    return {
      entries: [],
      source,
      truncated: false,
      error: message.includes("not found") || message.includes("No such file")
        ? "journalctl is not available in this environment"
        : message,
    };
  }
}

export async function getSystemLogs(): Promise<LogsResult> {
  return runJournalctl();
}

export async function getDockerLogs(): Promise<LogsResult> {
  return runJournalctl("docker");
}
