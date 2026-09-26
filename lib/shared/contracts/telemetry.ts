export const TELEMETRY_STATS_PAGE_URL = "https://homeio.app/stats";

export type TelemetrySettings = {
  enabled: boolean;
  /** HOMEIO_TELEMETRY=false is set, so the toggle cannot turn pings back on. */
  disabledByEnv: boolean;
};

export type TelemetrySettingsUpdateRequest = {
  enabled: boolean;
};

/** Everything a ping sends. Nothing else leaves the server. */
export type TelemetryPingPayload = {
  instanceId: string;
  version: string;
  arch: string;
  platform: string;
};
