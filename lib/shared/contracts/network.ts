export type NetworkStatus = {
  connected: boolean;
  iface: string | null;
  ssid: string | null;
  ipv4: string | null;
  signalPercent: number | null;
};

export type WifiAccessPoint = {
  ssid: string;
  bssid: string | null;
  signalPercent: number | null;
  channel: number | null;
  frequencyMhz: number | null;
  security: string | null;
};

export type ConnectNetworkRequest = {
  ssid: string;
  password?: string;
};

export type DisconnectNetworkRequest = {
  iface?: string;
};

export type NetworkEventType =
  | "network.connection.changed"
  | "network.device.state.changed";

export type NetworkEvent = {
  type: NetworkEventType;
  timestamp: string;
  iface: string | null;
  ssid: string | null;
  connected: boolean;
  state?: string;
  reason?: string;
};

export type NetworkServiceErrorCode =
  | "helper_unavailable"
  | "network_manager_unavailable"
  | "auth_failed"
  | "timeout"
  | "invalid_request"
  | "internal_error";

export type NetworkInterfaceKind = "wired" | "wireless" | "vpn" | "other";

/** One interface as the Monitor's Network tab shows it; null where the host has no value. */
export type NetworkInterfaceOverview = {
  iface: string;
  kind: NetworkInterfaceKind;
  up: boolean | null;
  isDefault: boolean;
  ip4: string | null;
  ip4Subnet: string | null;
  ip6: string | null;
  mac: string | null;
  speedMbps: number | null;
  duplex: string | null;
  dhcp: boolean;
  /** Totals since the interface came up. */
  rxBytes: number | null;
  txBytes: number | null;
  downloadMbps: number | null;
  uploadMbps: number | null;
  rxErrors: number | null;
  txErrors: number | null;
  rxDropped: number | null;
  txDropped: number | null;
};

export type NetworkOverview = {
  /** In the Docker image these are the container's interfaces, not the host's. */
  inContainer: boolean;
  interfaces: NetworkInterfaceOverview[];
  gateway: string | null;
  dnsServers: string[];
  checkedAt: string;
};
