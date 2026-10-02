import type { LucideIcon } from "@/components/icons/platform-icons";

export type UptimeParts = {
  days: number;
  hours: number;
  minutes: number;
};

export type ResourceWidgetItem = {
  label: string;
  value: string;
  progress: number;
  colorClassName: string;
  icon: LucideIcon;
};

export type NetworkWidgetData = {
  downloadText: string;
  uploadText: string;
  ipAddress: string;
  hostname: string;
  interfaceName: string;
  ssid: string;
  isDemoMode?: boolean;
};

export type QuickStatItem = {
  label: string;
  value: string;
  sub: string;
};

/** homelab-backup (a standalone agent, not a Homeio-managed container) status for the Backups widget. */
export type BackupAgentWidgetData = {
  enabled: boolean;
  dashboardUrl: string | null;
  relativePort: number | null;
};

export type SystemWidgetsViewModel = {
  uptime: UptimeParts;
  resources: ResourceWidgetItem[];
  network: NetworkWidgetData;
  quickStats: QuickStatItem[];
  backupAgent: BackupAgentWidgetData;
};
