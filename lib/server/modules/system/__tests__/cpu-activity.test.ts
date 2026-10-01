import type os from "node:os";
import { describe, expect, it } from "vitest";
import { createCpuLoadTracker, readCpuTimes } from "@/lib/server/modules/system/cpu-activity";

function core(times: Partial<os.CpuInfo["times"]>): os.CpuInfo {
  return { model: "cpu", speed: 1000, times: { user: 0, nice: 0, sys: 0, idle: 0, irq: 0, ...times } };
}

describe("cpu activity", () => {
  it("sums busy and total time over all cores", () => {
    const times = readCpuTimes([
      core({ user: 100, nice: 10, sys: 50, irq: 5, idle: 835 }),
      core({ user: 200, idle: 800 }),
    ]);

    expect(times).toEqual({ busyMs: 365, totalMs: 2000 });
  });

  it("turns two readings into a load percent", () => {
    const track = createCpuLoadTracker();

    expect(track({ busyMs: 1_000, totalMs: 10_000 })).toBeNull();
    expect(track({ busyMs: 1_250, totalMs: 11_000 })).toBe(25);
  });

  it("gives no load when no time passed or counters went backwards", () => {
    const track = createCpuLoadTracker();
    track({ busyMs: 1_000, totalMs: 10_000 });

    expect(track({ busyMs: 1_000, totalMs: 10_000 })).toBeNull();
    expect(track({ busyMs: 500, totalMs: 12_000 })).toBeNull();
  });
});
