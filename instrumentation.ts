export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { startScheduledTaskRunner } = await import(
      "@/lib/server/modules/scheduled-tasks/runner"
    );
    startScheduledTaskRunner();

    const { startUsbPoller } = await import(
      "@/lib/server/modules/files/usb-storage"
    );
    startUsbPoller();

    const { startTelemetry } = await import(
      "@/lib/server/modules/telemetry/service"
    );
    startTelemetry();

    const { startMetricsHistory } = await import(
      "@/lib/server/modules/system/metrics-history"
    );
    startMetricsHistory();

    if (process.env.NODE_ENV === "production") {
      const { isContainerRuntime } = await import(
        "@/lib/server/modules/system/update-service"
      );
      if (!isContainerRuntime()) {
        const { ensureInstalledAppsRestartOnBoot } = await import(
          "@/lib/server/modules/apps/restart-policy"
        );
        void ensureInstalledAppsRestartOnBoot();
      }
    }
  }
}
