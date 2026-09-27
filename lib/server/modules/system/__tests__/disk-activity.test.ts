import { describe, expect, it } from "vitest";
import {
  createDiskRateTracker,
  parseDiskstats,
  totalMegabytesPerSecond,
} from "@/lib/server/modules/system/disk-activity";

// Real layout: major minor name reads merged sectors_read ms writes merged sectors_written ...
const DISKSTATS = `
   8       0 sda 1000 0 2000 0 500 0 4000 0 0 0 0 0 0 0 0 0 0
   8       1 sda1 900 0 1800 0 400 0 3800 0 0 0 0 0 0 0 0 0 0
 259       0 nvme0n1 10 0 100 0 20 0 200 0 0 0 0 0 0 0 0 0 0
 259       1 nvme0n1p1 10 0 100 0 20 0 200 0 0 0 0 0 0 0 0 0 0
 179       0 mmcblk0 1 0 8 0 1 0 8 0 0 0 0 0 0 0 0 0 0
   7       0 loop0 5 0 50 0 0 0 0 0 0 0 0 0 0 0 0 0 0
 252       0 zram0 5 0 50 0 5 0 50 0 0 0 0 0 0 0 0 0 0
 253       0 dm-0 5 0 50 0 5 0 50 0 0 0 0 0 0 0 0 0 0
`;

describe("disk activity", () => {
  it("reads whole disks only, in bytes", () => {
    const counters = parseDiskstats(DISKSTATS);

    expect([...counters.keys()]).toEqual(["sda", "nvme0n1", "mmcblk0"]);
    expect(counters.get("sda")).toEqual({ readBytes: 2000 * 512, writeBytes: 4000 * 512 });
  });

  it("turns two readings into per-disk rates", () => {
    const track = createDiskRateTracker();
    const first = new Map([["sda", { readBytes: 0, writeBytes: 0 }]]);
    const second = new Map([["sda", { readBytes: 10_000_000, writeBytes: 2_000_000 }]]);

    expect(track(first, 1_000).size).toBe(0);
    const rates = track(second, 3_000);

    expect(rates.get("sda")).toEqual({ readBytesPerSec: 5_000_000, writeBytesPerSec: 1_000_000 });
    expect(totalMegabytesPerSecond(rates)).toEqual({ readMBps: 5, writeMBps: 1 });
  });

  it("gives no rate after a long gap or when a counter goes backwards", () => {
    const track = createDiskRateTracker(60_000);
    track(new Map([["sda", { readBytes: 100, writeBytes: 100 }]]), 0);

    expect(track(new Map([["sda", { readBytes: 200, writeBytes: 200 }]]), 120_000).size).toBe(0);
    expect(track(new Map([["sda", { readBytes: 50, writeBytes: 300 }]]), 121_000).size).toBe(0);
    expect(totalMegabytesPerSecond(new Map())).toEqual({ readMBps: null, writeMBps: null });
  });
});
