"use client";

import { useQuery } from "@tanstack/react-query";
import { queryKeys } from "@/lib/shared/query-keys";
import type { BackupAgentStatus } from "@/lib/shared/contracts/backup-agent";

async function fetchBackupAgentStatus(): Promise<BackupAgentStatus> {
  const response = await fetch("/api/v1/system/backup-agent");

  if (!response.ok) {
    throw new Error(`Failed to fetch homelab-backup status (${response.status})`);
  }

  const json = (await response.json()) as { data: BackupAgentStatus };
  return json.data;
}

/** Whether homelab-backup (a standalone agent, not a Homeio-managed container) is configured and reachable. */
export function useBackupAgentStatus() {
  return useQuery({
    queryKey: queryKeys.backupAgentStatus,
    queryFn: fetchBackupAgentStatus,
    staleTime: 30_000,
    refetchInterval: 30_000,
    retry: false,
  });
}
