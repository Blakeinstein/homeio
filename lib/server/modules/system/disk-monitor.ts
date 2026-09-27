import "server-only";

import type { DiskMonitorResponse } from "@/lib/shared/contracts/disks";
import { createDiskRateTracker, readDiskCounters } from "@/lib/server/modules/system/disk-activity";
import { getDiskInventory } from "@/lib/server/modules/system/disk-service";
import { getSystemMetricsSnapshot } from "@/lib/server/modules/system/service";

// Its own baseline, separate from the metrics snapshot's, so polling the Disks
// tab does not shorten the interval the history sampler measures over.
const diskRates = createDiskRateTracker();

/** Disks for the Monitor: what lsblk sees, their live throughput and their SMART data. */
export async function getDiskMonitor(): Promise<DiskMonitorResponse> {
  const [inventory, counters, snapshot] = await Promise.all([
    getDiskInventory(),
    readDiskCounters(),
    getSystemMetricsSnapshot().catch(() => null),
  ]);

  const rates = counters ? diskRates(counters, Date.now()) : new Map();
  const smartByDevice = new Map(
    (snapshot?.storage?.smart?.disks ?? []).map((disk) => [disk.device, disk]),
  );

  return {
    disks: inventory.disks.map((disk) => {
      const rate = rates.get(disk.name);
      const smart = smartByDevice.get(disk.device);
      return {
        name: disk.name,
        device: disk.device,
        model: disk.model,
        vendor: disk.vendor,
        sizeBytes: disk.sizeBytes,
        mediaType: disk.mediaType,
        transport: disk.transport,
        isRemovable: disk.isRemovable,
        readBytesPerSec: rate?.readBytesPerSec ?? null,
        writeBytesPerSec: rate?.writeBytesPerSec ?? null,
        health: smart?.status ?? null,
        temperatureCelsius: smart?.temperatureCelsius ?? null,
        powerOnHours: smart?.powerOnHours ?? null,
        partitions: disk.partitions.map(({ name, mountpoint, fstype, sizeBytes }) => ({
          name,
          mountpoint: inventory.readOnly ? null : mountpoint,
          fstype,
          sizeBytes,
        })),
      };
    }),
    inContainer: inventory.readOnly,
    unavailableReason: inventory.unavailableReason,
    sampledAt: new Date().toISOString(),
  };
}
