"use client";

import { useQuery } from "@tanstack/react-query";
import type { DiskMonitorResponse } from "@/lib/shared/contracts/disks";
import { queryKeys } from "@/lib/shared/query-keys";

async function fetchDiskMonitor(): Promise<DiskMonitorResponse> {
  const response = await fetch("/api/v1/system/disks/activity", { cache: "no-store" });

  if (!response.ok) {
    throw new Error(`Failed to load disks (${response.status})`);
  }

  const json = (await response.json()) as { data: DiskMonitorResponse };
  return json.data;
}

/** Disks with live throughput and SMART, polled every 3 s while the Disks tab is open. */
export function useDiskMonitor(enabled: boolean) {
  return useQuery({
    queryKey: queryKeys.diskActivity,
    queryFn: fetchDiskMonitor,
    enabled,
    refetchInterval: enabled ? 3_000 : false,
    refetchOnWindowFocus: false,
  });
}
