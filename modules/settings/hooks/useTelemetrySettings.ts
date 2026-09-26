"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { queryKeys } from "@/lib/shared/query-keys";
import type {
  TelemetrySettings,
  TelemetrySettingsUpdateRequest,
} from "@/lib/shared/contracts/telemetry";

async function fetchTelemetrySettings(): Promise<TelemetrySettings> {
  const res = await fetch("/api/v1/settings/telemetry");
  if (!res.ok) throw new Error("Failed to fetch telemetry settings");
  const json = (await res.json()) as { data: TelemetrySettings };
  return json.data;
}

async function updateTelemetrySettings(
  payload: TelemetrySettingsUpdateRequest,
): Promise<TelemetrySettings> {
  const res = await fetch("/api/v1/settings/telemetry", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const json = (await res.json()) as { data?: TelemetrySettings; error?: string };
  if (!res.ok || !json.data) throw new Error(json.error ?? "Failed to save");
  return json.data;
}

export function useTelemetrySettings() {
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: queryKeys.telemetrySettings,
    queryFn: fetchTelemetrySettings,
    refetchOnWindowFocus: false,
  });

  const mutation = useMutation({
    mutationFn: updateTelemetrySettings,
    onSuccess: (data) => {
      queryClient.setQueryData(queryKeys.telemetrySettings, data);
    },
  });

  return {
    settings: query.data,
    isLoading: query.isLoading,
    isSaving: mutation.isPending,
    setEnabled: (enabled: boolean) => mutation.mutate({ enabled }),
  };
}
