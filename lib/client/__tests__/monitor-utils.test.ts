import { describe, expect, it } from "vitest";
import { findAppForContainer } from "@/lib/client/monitor-utils";

const apps = [
  { id: "jellyfin", stackName: "jellyfin", containerName: "jellyfin", logoUrl: "j.png" },
  { id: "nextcloud", stackName: "nextcloud", containerName: null, logoUrl: "n.png" },
  { id: "nextcloud-aio", stackName: "nextcloud-aio", containerName: null, logoUrl: "aio.png" },
  { id: "immich", stackName: "immich", containerName: "immich_server", logoUrl: "i.png" },
];

describe("findAppForContainer", () => {
  it("matches an app's own container first", () => {
    expect(findAppForContainer("immich_server", apps)?.id).toBe("immich");
    expect(findAppForContainer("/jellyfin", apps)?.id).toBe("jellyfin");
  });

  it("matches the other containers of a Compose stack", () => {
    expect(findAppForContainer("nextcloud-db-1", apps)?.id).toBe("nextcloud");
    expect(findAppForContainer("immich_redis", apps)?.id).toBe("immich");
  });

  it("prefers the longest stack name when several match", () => {
    expect(findAppForContainer("nextcloud-aio-mastercontainer", apps)?.id).toBe("nextcloud-aio");
  });

  it("returns null for containers Homeio did not install", () => {
    expect(findAppForContainer("uptimekuma", apps)).toBeNull();
    expect(findAppForContainer("jellyfinish", apps)).toBeNull();
  });
});
