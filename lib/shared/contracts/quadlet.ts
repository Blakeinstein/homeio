import type { AppConditionSummary } from "@/lib/shared/app-condition";

/**
 * An app discovered from a Podman quadlet service folder (one or more
 * `*.container` unit files, optionally alongside an `app.yaml` with display
 * metadata). Read-only: Homeio did not deploy it and cannot install, update,
 * or remove it, only show what it already knows.
 */
export type QuadletApp = {
  id: string;
  name: string;
  description: string | null;
  category: string | null;
  /** URL Homeio can render directly: either the app.yaml's own URL, or a path into this app's icon route. */
  logoUrl: string | null;
  webUiPort: number | null;
  condition: AppConditionSummary;
  /** Every container this app's quadlet units declare, by their resolved container name. */
  containerNames: string[];
  /** The container whose state and port represent the app as a whole. */
  primaryContainerName: string | null;
};

export type QuadletAppsResponse = {
  data: QuadletApp[];
};
