"use client";

import { useEffect, useState } from "react";

const PROBE_TIMEOUT_MS = 2_000;
const RECHECK_INTERVAL_MS = 30_000;

/**
 * Whether `url` answers from the browser's own network path. This has to run
 * client-side, not on the server: a relative-port URL has no fixed host the
 * server could probe, and even an absolute one may only be reachable from
 * wherever the browser is (e.g. a LAN IP or Tailscale address the Homeio
 * server process itself can't reach, such as when it runs in a container).
 *
 * `mode: "no-cors"` is deliberate: the target (homelab-backup) sends no CORS
 * headers, so a normal fetch would throw even when it's perfectly reachable.
 * An opaque no-cors response only tells us the request didn't fail at the
 * network level, which is all "reachable" means here.
 */
export function useUrlReachability(url: string | null): boolean | null {
  const [reachable, setReachable] = useState<boolean | null>(null);

  useEffect(() => {
    if (!url) {
      setReachable(null);
      return;
    }

    let cancelled = false;

    function probe() {
      fetch(url as string, { mode: "no-cors", signal: AbortSignal.timeout(PROBE_TIMEOUT_MS) })
        .then(() => {
          if (!cancelled) setReachable(true);
        })
        .catch(() => {
          if (!cancelled) setReachable(false);
        });
    }

    setReachable(null);
    probe();
    const interval = setInterval(probe, RECHECK_INTERVAL_MS);

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [url]);

  return reachable;
}
