"use client";

import { Toggle } from "@/modules/settings/components/panel/controls";
import { useTelemetrySettings } from "@/modules/settings/hooks/useTelemetrySettings";
import { TELEMETRY_STATS_PAGE_URL } from "@/lib/shared/contracts/telemetry";

export function TelemetrySection() {
  const { settings, isLoading, isSaving, setEnabled } = useTelemetrySettings();
  const enabled = settings?.enabled ?? false;

  return (
    <div className="flex flex-col">
      <Toggle
        label="Anonymous usage stats"
        description="Twice a day, send a random ID, the Homeio version, CPU architecture, OS, whether it runs in Docker, and the Linux distribution and its version. No IP address, usernames, file paths or app names are stored."
        enabled={enabled}
        onToggle={() => setEnabled(!enabled)}
        disabled={isLoading || isSaving || settings?.disabledByEnv}
        disabledReason={
          settings?.disabledByEnv
            ? "Turned off by HOMEIO_TELEMETRY=false in the server environment."
            : undefined
        }
      />
      <a
        href={TELEMETRY_STATS_PAGE_URL}
        target="_blank"
        rel="noopener noreferrer"
        className="self-start text-xs text-primary hover:underline"
      >
        See the public totals on homeio.app/stats
      </a>
    </div>
  );
}
