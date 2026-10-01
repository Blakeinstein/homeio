"use client";

import { useQuery } from "@tanstack/react-query";
import type { NetworkOverview } from "@/lib/shared/contracts/network";
import { queryKeys } from "@/lib/shared/query-keys";

async function fetchNetworkOverview(): Promise<NetworkOverview> {
  const response = await fetch("/api/v1/network/overview", { cache: "no-store" });

  if (!response.ok) {
    throw new Error(`Failed to load network interfaces (${response.status})`);
  }

  const json = (await response.json()) as { data: NetworkOverview };
  return json.data;
}

/** Interfaces, gateway and DNS, polled every 3 s while the Network tab is open. */
export function useNetworkOverview(enabled: boolean) {
  return useQuery({
    queryKey: queryKeys.networkOverview,
    queryFn: fetchNetworkOverview,
    enabled,
    refetchInterval: enabled ? 3_000 : false,
    refetchOnWindowFocus: false,
  });
}
