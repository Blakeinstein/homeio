import { describe, expect, it, vi } from "vitest";

const { inventoryMock, countersMock, snapshotMock } = vi.hoisted(() => ({
  inventoryMock: vi.fn(),
  countersMock: vi.fn(),
  snapshotMock: vi.fn(),
}));

vi.mock("@/lib/server/modules/system/disk-service", () => ({ getDiskInventory: inventoryMock }));
vi.mock("@/lib/server/modules/system/service", () => ({ getSystemMetricsSnapshot: snapshotMock }));
vi.mock("@/lib/server/modules/system/disk-activity", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/server/modules/system/disk-activity")>()),
  readDiskCounters: countersMock,
}));

import { getDiskMonitor } from "@/lib/server/modules/system/disk-monitor";

const sda = {
  name: "sda",
  device: "/dev/sda",
  model: "Samsung SSD 870",
  vendor: "ATA",
  serial: "S1",
  sizeBytes: 500_000_000_000,
  mediaType: "ssd",
  transport: "sata",
  isRemovable: false,
  partitions: [
    { name: "sda1", device: "/dev/sda1", number: 1, fstype: "ext4", label: null, uuid: "u", sizeBytes: 500_000_000_000, mountpoint: "/", type: "part", ro: false },
  ],
};

describe("getDiskMonitor", () => {
  it("adds live throughput and SMART data to each disk", async () => {
    vi.useFakeTimers();
    inventoryMock.mockResolvedValue({ disks: [sda], unavailableReason: null, readOnly: false });
    snapshotMock.mockResolvedValue({
      storage: { smart: { disks: [{ device: "/dev/sda", status: "healthy", temperatureCelsius: 34, powerOnHours: 1200 }] } },
    });

    vi.setSystemTime(10_000);
    countersMock.mockResolvedValueOnce(new Map([["sda", { readBytes: 0, writeBytes: 0 }]]));
    const first = await getDiskMonitor();
    expect(first.disks[0].readBytesPerSec).toBeNull();

    vi.setSystemTime(12_000);
    countersMock.mockResolvedValueOnce(new Map([["sda", { readBytes: 4_000_000, writeBytes: 1_000_000 }]]));
    const second = await getDiskMonitor();

    expect(second.disks[0]).toMatchObject({
      device: "/dev/sda",
      readBytesPerSec: 2_000_000,
      writeBytesPerSec: 500_000,
      health: "healthy",
      temperatureCelsius: 34,
      powerOnHours: 1200,
      partitions: [{ name: "sda1", mountpoint: "/", fstype: "ext4", sizeBytes: 500_000_000_000 }],
    });
    vi.useRealTimers();
  });

  it("passes on why disks cannot be listed", async () => {
    inventoryMock.mockResolvedValue({ disks: [], unavailableReason: "Disk management needs Linux; this machine runs darwin.", readOnly: false });
    countersMock.mockResolvedValue(null);
    snapshotMock.mockRejectedValue(new Error("no metrics"));

    const result = await getDiskMonitor();

    expect(result.disks).toEqual([]);
    expect(result.unavailableReason).toContain("needs Linux");
  });

  it("leaves out the container's own mount points in Docker", async () => {
    inventoryMock.mockResolvedValue({ disks: [sda], unavailableReason: null, readOnly: true });
    countersMock.mockResolvedValue(null);
    snapshotMock.mockResolvedValue(null);

    const result = await getDiskMonitor();

    expect(result.inContainer).toBe(true);
    expect(result.disks[0].partitions[0].mountpoint).toBeNull();
  });
});
