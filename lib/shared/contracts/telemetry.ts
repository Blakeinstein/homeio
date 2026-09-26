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
  /** "docker" inside a container, "host" when Homeio runs directly on the machine. */
  install: "docker" | "host";
  /** ID from /etc/os-release (debian, ubuntu…); null in Docker, where it names the image, not the host. */
  distro: string | null;
  /** VERSION_ID from /etc/os-release (12, 24.04…); null when absent or in Docker. */
  distroVersion: string | null;
};
