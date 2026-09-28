export const SYSTEM_STREAM_STATUS_EVENT = "homeio:system-stream-status";

export type SystemStreamStatus = "connected" | "disconnected";

export function dispatchSystemStreamStatus(status: SystemStreamStatus) {
  if (typeof window === "undefined") return;

  window.dispatchEvent(
    new CustomEvent<SystemStreamStatus>(SYSTEM_STREAM_STATUS_EVENT, { detail: status }),
  );
}
