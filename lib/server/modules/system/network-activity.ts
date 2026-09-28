import "server-only";

import { readFile } from "node:fs/promises";
import os from "node:os";

// Everything the metrics snapshot needs about the network is already in /proc
// and /sys. systeminformation's networkInterfaces() and networkStats() gather
// it by spawning ~120 commands (cat, grep, nmcli, ip) on every snapshot.

export type NetworkCounters = { rxBytes: number; txBytes: number };
export type NetworkRate = { rxBytesPerSec: number; txBytesPerSec: number };
export type InterfaceAddresses = { ipv4: string | null; ipv6: string | null };

// Interface names are at most 15 characters and never contain a slash; this
// keeps a name from walking out of /sys/class/net.
const INTERFACE_NAME = /^[\w.:@-]{1,15}$/;

/**
 * The interface carrying the IPv4 default route, lowest metric first, from
 * /proc/net/route. Columns: Iface Destination Gateway Flags RefCnt Use Metric Mask ...
 */
export function parseDefaultRouteInterface(text: string): string | null {
  let best: { iface: string; metric: number } | null = null;
  for (const line of text.split("\n").slice(1)) {
    const fields = line.trim().split(/\s+/);
    if (fields.length < 8) continue;
    const [iface, destination, , , , , metricField, mask] = fields;
    if (destination !== "00000000" || mask !== "00000000") continue;
    const metric = Number(metricField);
    if (!best || metric < best.metric) best = { iface, metric };
  }
  return best?.iface ?? null;
}

export async function readDefaultRouteInterface(): Promise<string | null> {
  try {
    return parseDefaultRouteInterface(await readFile("/proc/net/route", "utf8"));
  } catch {
    // Not Linux: there is no /proc/net/route.
    return null;
  }
}

/** Bytes received and sent by one interface, from /sys/class/net/<iface>/statistics. */
export async function readInterfaceCounters(iface: string): Promise<NetworkCounters | null> {
  if (!INTERFACE_NAME.test(iface)) return null;
  try {
    const statistics = `/sys/class/net/${iface}/statistics`;
    const [rx, tx] = await Promise.all([
      readFile(`${statistics}/rx_bytes`, "utf8"),
      readFile(`${statistics}/tx_bytes`, "utf8"),
    ]);
    const rxBytes = Number(rx);
    const txBytes = Number(tx);
    if (!Number.isFinite(rxBytes) || !Number.isFinite(txBytes)) return null;
    return { rxBytes, txBytes };
  } catch {
    // The interface went away, or this is not Linux.
    return null;
  }
}

/**
 * Turns successive readings of an interface into rates. Switching interface
 * (Wi-Fi to Ethernet, say) starts a new baseline instead of reporting a
 * nonsense difference between two unrelated counters.
 */
export function createNetworkRateTracker(maxGapMs = 60_000) {
  let previous: { iface: string; at: number; counters: NetworkCounters } | null = null;

  return function update(iface: string, counters: NetworkCounters, at: number): NetworkRate | null {
    const before = previous;
    previous = { iface, at, counters };
    if (!before || before.iface !== iface || at <= before.at || at - before.at > maxGapMs) {
      return null;
    }

    const seconds = (at - before.at) / 1000;
    const rx = counters.rxBytes - before.counters.rxBytes;
    const tx = counters.txBytes - before.counters.txBytes;
    // A counter that went backwards (interface re-created) gives no rate this round.
    if (rx < 0 || tx < 0) return null;

    return { rxBytesPerSec: rx / seconds, txBytesPerSec: tx / seconds };
  };
}

/** The interface's IPv4 address, and its IPv6 address preferring a global one over link-local. */
export function readInterfaceAddresses(
  iface: string,
  interfaces: NodeJS.Dict<os.NetworkInterfaceInfo[]> = os.networkInterfaces(),
): InterfaceAddresses {
  const addresses = (interfaces[iface] ?? []).filter((address) => !address.internal);
  const ipv4 = addresses.find((address) => address.family === "IPv4")?.address ?? null;
  const ipv6Addresses = addresses.filter((address) => address.family === "IPv6");
  const ipv6 =
    (ipv6Addresses.find((address) => !address.address.startsWith("fe80:")) ?? ipv6Addresses[0])
      ?.address ?? null;
  return { ipv4, ipv6 };
}
