import { describe, expect, it } from "vitest";
import {
  createNetworkRateTracker,
  parseDefaultRouteInterface,
  readInterfaceAddresses,
  readInterfaceCounters,
} from "@/lib/server/modules/system/network-activity";

// Real layout of /proc/net/route (tab separated, addresses in little-endian hex).
const ROUTES = [
  "Iface\tDestination\tGateway \tFlags\tRefCnt\tUse\tMetric\tMask\t\tMTU\tWindow\tIRTT",
  "wlan0\t00000000\t0101A8C0\t0003\t0\t0\t600\t00000000\t0\t0\t0",
  "eth0\t00000000\t0101A8C0\t0003\t0\t0\t100\t00000000\t0\t0\t0",
  "eth0\t0001A8C0\t00000000\t0001\t0\t0\t100\t00FFFFFF\t0\t0\t0",
  "docker0\t000011AC\t00000000\t0001\t0\t0\t0\t0000FFFF\t0\t0\t0",
].join("\n");

describe("network activity", () => {
  it("finds the interface carrying the default route, lowest metric first", () => {
    expect(parseDefaultRouteInterface(ROUTES)).toBe("eth0");
  });

  it("finds no default route on a machine without one", () => {
    expect(parseDefaultRouteInterface(ROUTES.split("\n").slice(0, 1).join("\n"))).toBeNull();
    expect(parseDefaultRouteInterface("")).toBeNull();
  });

  it("refuses interface names that could leave /sys/class/net", async () => {
    expect(await readInterfaceCounters("../../etc")).toBeNull();
  });

  it("turns two readings of an interface into rates", () => {
    const track = createNetworkRateTracker();

    expect(track("eth0", { rxBytes: 0, txBytes: 0 }, 10_000)).toBeNull();
    expect(track("eth0", { rxBytes: 6_000_000, txBytes: 2_000_000 }, 12_000)).toEqual({
      rxBytesPerSec: 3_000_000,
      txBytesPerSec: 1_000_000,
    });
  });

  it("starts a new baseline when the interface changes or the counters reset", () => {
    const track = createNetworkRateTracker();
    track("eth0", { rxBytes: 5_000, txBytes: 5_000 }, 10_000);

    expect(track("wlan0", { rxBytes: 9_000, txBytes: 9_000 }, 12_000)).toBeNull();
    expect(track("wlan0", { rxBytes: 100, txBytes: 100 }, 14_000)).toBeNull();
    expect(track("wlan0", { rxBytes: 2_100, txBytes: 1_100 }, 16_000)).toEqual({
      rxBytesPerSec: 1_000,
      txBytesPerSec: 500,
    });
  });

  it("gives no rate across a long gap", () => {
    const track = createNetworkRateTracker(60_000);
    track("eth0", { rxBytes: 0, txBytes: 0 }, 0);

    expect(track("eth0", { rxBytes: 1_000, txBytes: 1_000 }, 61_000)).toBeNull();
  });

  it("reads an interface's addresses, preferring a global IPv6 over link-local", () => {
    const interfaces = {
      eth0: [
        { address: "fe80::1", family: "IPv6", internal: false },
        { address: "192.168.1.27", family: "IPv4", internal: false },
        { address: "2a01:cb00::27", family: "IPv6", internal: false },
      ],
      lo: [{ address: "127.0.0.1", family: "IPv4", internal: true }],
    } as unknown as Parameters<typeof readInterfaceAddresses>[1];

    expect(readInterfaceAddresses("eth0", interfaces)).toEqual({
      ipv4: "192.168.1.27",
      ipv6: "2a01:cb00::27",
    });
    expect(readInterfaceAddresses("lo", interfaces)).toEqual({ ipv4: null, ipv6: null });
    expect(readInterfaceAddresses("wlan9", interfaces)).toEqual({ ipv4: null, ipv6: null });
  });
});
