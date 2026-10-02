import "server-only";

/** Docker/Podman prefix container names with a slash; fall back to a short id. */
export function toContainerName(names: string[] | undefined, id: string) {
  const first = names?.[0]?.trim() ?? "";
  const stripped = first.startsWith("/") ? first.slice(1) : first;
  return stripped.length > 0 ? stripped : id.slice(0, 12);
}
