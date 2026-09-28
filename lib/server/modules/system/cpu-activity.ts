import "server-only";

import os from "node:os";

export type CpuTimes = { busyMs: number; totalMs: number };

/** CPU time spent busy and in total since boot, summed over all cores. */
export function readCpuTimes(cpus: os.CpuInfo[] = os.cpus()): CpuTimes {
  let busyMs = 0;
  let totalMs = 0;
  for (const { times } of cpus) {
    const busy = times.user + times.nice + times.sys + times.irq;
    busyMs += busy;
    totalMs += busy + times.idle;
  }
  return { busyMs, totalMs };
}

/**
 * Turns successive readings into a 0-100 load percent, the way `top` does.
 *
 * The kernel already keeps these counters, so this replaces
 * systeminformation's currentLoad(), which runs `cat /proc/stat | grep cpu`
 * through execSync and freezes the event loop on every metrics snapshot.
 */
export function createCpuLoadTracker() {
  let previous: CpuTimes | null = null;

  return function update(now: CpuTimes): number | null {
    const before = previous;
    previous = now;
    if (!before) return null;

    const totalMs = now.totalMs - before.totalMs;
    const busyMs = now.busyMs - before.busyMs;
    // No time passed, or the counters went backwards: no load this round.
    if (totalMs <= 0 || busyMs < 0) return null;

    return (busyMs / totalMs) * 100;
  };
}
