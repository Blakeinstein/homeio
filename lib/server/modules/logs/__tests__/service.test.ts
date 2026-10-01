import { mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { readTailLines } from "@/lib/server/modules/logs/service";

let dir: string;

async function logFile(content: string) {
  const filePath = path.join(dir, "home-server.log");
  await writeFile(filePath, content, "utf8");
  return filePath;
}

function numberedLines(count: number, width = 0) {
  return Array.from({ length: count }, (_, i) => `{"n":${i + 1},"pad":"${"x".repeat(width)}"}`);
}

describe("readTailLines", () => {
  beforeEach(async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), "homeio-logs-"));
  });

  it("returns the last lines of a small file", async () => {
    const file = await logFile(`${numberedLines(10).join("\n")}\n`);

    expect(await readTailLines(file, 3)).toEqual(numberedLines(10).slice(-3));
  });

  it("returns every line when the file has fewer than asked", async () => {
    const file = await logFile("one\ntwo\n");

    expect(await readTailLines(file, 500)).toEqual(["one", "two"]);
  });

  it("reads only the end of a file much larger than one chunk", async () => {
    // ~9 MB: 60k lines of ~150 bytes, crossing many 64 KB chunk boundaries.
    const lines = numberedLines(60_000, 130);
    const file = await logFile(`${lines.join("\n")}\n`);

    expect(await readTailLines(file, 500)).toEqual(lines.slice(-500));
  });

  it("keeps the last line when the file does not end with a newline", async () => {
    const file = await logFile("one\ntwo\nthree");

    expect(await readTailLines(file, 2)).toEqual(["two", "three"]);
  });

  it("skips empty lines", async () => {
    const file = await logFile("one\n\n  \ntwo\n\n");

    expect(await readTailLines(file, 5)).toEqual(["one", "two"]);
  });

  it("keeps multi-byte characters whole across chunk boundaries", async () => {
    // 3-byte characters, so some of them straddle a 64 KB boundary.
    const lines = Array.from({ length: 3_000 }, (_, i) => `${i} ${"€".repeat(40)}`);
    const file = await logFile(`${lines.join("\n")}\n`);

    expect(await readTailLines(file, 2_000)).toEqual(lines.slice(-2_000));
  });

  it("returns nothing for a missing file", async () => {
    expect(await readTailLines(path.join(dir, "missing.log"), 500)).toEqual([]);
  });
});
