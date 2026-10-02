/* @vitest-environment jsdom */

import { render, screen } from "@testing-library/react";
import { Cpu, MemoryStick, Thermometer } from "@/components/icons/platform-icons";
import { describe, expect, it, vi } from "vitest";
import type { SystemWidgetsViewModel } from "@/modules/system/components/system-widgets/types";

const mockUseSystemWidgetsData = vi.fn<() => SystemWidgetsViewModel>();

vi.mock("@/modules/system/components/system-widgets/use-system-widgets-data", () => ({
  useSystemWidgetsData: () => mockUseSystemWidgetsData(),
}));

import { SystemWidgets } from "@/modules/system/components/system-widgets";

describe("SystemWidgets", () => {
  it("renders sections and values from backend view model", () => {
    mockUseSystemWidgetsData.mockReturnValue({
      uptime: { days: 1, hours: 4, minutes: 28 },
      resources: [
        {
          label: "CPU",
          value: "51%",
          progress: 51,
          colorClassName: "bg-primary",
          icon: Cpu,
        },
        {
          label: "Memory",
          value: "4.2 / 8.0 GB",
          progress: 52,
          colorClassName: "bg-chart-2",
          icon: MemoryStick,
        },
        {
          label: "Temperature",
          value: "46 C",
          progress: 46,
          colorClassName: "bg-status-amber",
          icon: Thermometer,
        },
      ],
      network: {
        downloadText: "24.8 Mbps",
        uploadText: "8.3 Mbps",
        ipAddress: "192.168.1.30",
        hostname: "pi4-home",
        interfaceName: "wlan0",
        ssid: "HomeNet",
      },
      quickStats: [
        { label: "Running", value: "7", sub: "apps" },
        { label: "Installed", value: "11", sub: "apps" },
        { label: "Networks", value: "4", sub: "nearby" },
        { label: "Weather", value: "21°", sub: "Tunis, Tunisia" },
      ],
      backupAgent: { enabled: false, dashboardUrl: null, reachable: null },
    });

    render(<SystemWidgets />);

    expect(screen.getByText("Uptime")).toBeTruthy();
    expect(screen.getByText("Resources")).toBeTruthy();
    expect(screen.getByText("Network")).toBeTruthy();
    expect(screen.getByText("4.2 / 8.0 GB")).toBeTruthy();
    expect(screen.getByText("192.168.1.30")).toBeTruthy();
    expect(screen.getByText("21°")).toBeTruthy();
    expect(screen.queryByText("Backups")).toBeNull();
  });

  it("shows a Backups card with a link when homelab-backup is configured", () => {
    mockUseSystemWidgetsData.mockReturnValue({
      uptime: { days: 1, hours: 4, minutes: 28 },
      resources: [],
      network: {
        downloadText: "--",
        uploadText: "--",
        ipAddress: "--",
        hostname: "--",
        interfaceName: "--",
        ssid: "offline",
      },
      quickStats: [],
      backupAgent: { enabled: true, dashboardUrl: "http://127.0.0.1:3095", reachable: true },
    });

    render(<SystemWidgets />);

    expect(screen.getByText("Backups")).toBeTruthy();
    expect(screen.getByText("Reachable")).toBeTruthy();
    const link = screen.getByText("View backup stats").closest("a");
    expect(link?.getAttribute("href")).toBe("http://127.0.0.1:3095");
  });
});
