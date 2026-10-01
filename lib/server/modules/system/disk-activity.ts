import "server-only";

import { readFile } from "node:fs/promises";

// /proc/diskstats counts in 512-byte sectors whatever the disk's own sector size.
const SECTOR_BYTES = 512;
// Whole disks only: partitions (sda1, nvme0n1p1, mmcblk0p1) would count the
// same bytes twice, and loop, RAM, zram and device-mapper devices are not disks.
const WHOLE_DISK = /^(sd[a-z]+|hd[a-z]+|vd[a-z]+|xvd[a-z]+|nvme\d+n\d+|mmcblk\d+)$/;

export type DiskCounters = { readBytes: number; writeBytes: number };
export type DiskRate = { readBytesPerSec: number; writeBytesPerSec: number };

/** Bytes read and written per whole disk since boot, from /proc/diskstats. */
export function parseDiskstats(text: string): Map<string, DiskCounters> {
  const counters = new Map<string, DiskCounters>();
  for (const line of text.split("\n")) {
    const fields = line.trim().split(/\s+/);
    // major minor name reads merged sectors_read ms writes merged sectors_written ...
    if (fields.length < 10) continue;
    const name = fields[2];
    if (!WHOLE_DISK.test(name)) continue;
    const sectorsRead = Number(fields[5]);
    const sectorsWritten = Number(fields[9]);
    if (!Number.isFinite(sectorsRead) || !Number.isFinite(sectorsWritten)) continue;
    counters.set(name, {
      readBytes: sectorsRead * SECTOR_BYTES,
      writeBytes: sectorsWritten * SECTOR_BYTES,
    });
  }
  return counters;
}

export async function readDiskCounters(): Promise<Map<string, DiskCounters> | null> {
  try {
    return parseDiskstats(await readFile("/proc/diskstats", "utf8"));
  } catch {
    // Not Linux: there is no /proc/diskstats.
    return null;
  }
}

/**
 * Turns successive counter readings into per-disk rates. Each caller keeps its
 * own tracker, so the history sampler and the Disks tab do not reset each
 * other's baseline.
 */
export function createDiskRateTracker(maxGapMs = 60_000) {
  let previous: { at: number; counters: Map<string, DiskCounters> } | null = null;

  return function update(counters: Map<string, DiskCounters>, at: number) {
    const rates = new Map<string, DiskRate>();
    if (previous && at > previous.at && at - previous.at <= maxGapMs) {
      const seconds = (at - previous.at) / 1000;
      for (const [name, now] of counters) {
        const before = previous.counters.get(name);
        if (!before) continue;
        // A counter that went backwards (device re-added) gives no rate this round.
        const read = now.readBytes - before.readBytes;
        const write = now.writeBytes - before.writeBytes;
        if (read < 0 || write < 0) continue;
        rates.set(name, { readBytesPerSec: read / seconds, writeBytesPerSec: write / seconds });
      }
    }
    previous = { at, counters };
    return rates;
  };
}

/** Sum of all disks, in MB/s, or null when there is no rate yet. */
export function totalMegabytesPerSecond(rates: Map<string, DiskRate>) {
  if (rates.size === 0) return { readMBps: null, writeMBps: null };
  let read = 0;
  let write = 0;
  for (const rate of rates.values()) {
    read += rate.readBytesPerSec;
    write += rate.writeBytesPerSec;
  }
  return { readMBps: read / 1_000_000, writeMBps: write / 1_000_000 };
}
