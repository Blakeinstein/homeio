"use client";

import { useQuery } from "@tanstack/react-query";
import type { QuadletApp } from "@/lib/shared/contracts/quadlet";

async function fetchQuadletApps() {
  const response = await fetch("/api/v1/docker/quadlet-apps", {
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch quadlet apps (${response.status})`);
  }

  const json = (await response.json()) as { data: QuadletApp[] };
  return json.data;
}

export function useQuadletApps() {
  return useQuery({
    queryKey: ["docker", "quadlet-apps"] as const,
    queryFn: fetchQuadletApps,
    staleTime: 30_000,
    refetchOnWindowFocus: false,
    placeholderData: (previousData) => previousData,
  });
}
