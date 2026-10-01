export type DiskMediaType = "ssd" | "hdd" | "nvme" | "removable" | "unknown";

export type DiskPartition = {
  name: string;
  device: string;
  number: number | null;
  fstype: string | null;
  label: string | null;
  uuid: string | null;
  sizeBytes: number | null;
  mountpoint: string | null;
  type: string;
  ro: boolean;
};

export type DiskDevice = {
  name: string;
  device: string;
  model: string | null;
  vendor: string | null;
  serial: string | null;
  sizeBytes: number | null;
  mediaType: DiskMediaType;
  transport: string | null;
  isRemovable: boolean;
  partitions: DiskPartition[];
};

export type DiskListResponse = {
  disks: DiskDevice[];
  /** Why the list is empty when disks could not be read at all; null otherwise. */
  unavailableReason: string | null;
  /** In the Docker image disks can be listed but not formatted, partitioned or mounted. */
  readOnly: boolean;
};

export const DISK_FILESYSTEMS = ["ext4", "ext3", "btrfs", "xfs", "ntfs", "vfat", "exfat"] as const;
export type DiskFilesystem = (typeof DISK_FILESYSTEMS)[number];

export type DiskFormatRequest = {
  device: string;
  filesystem: DiskFilesystem;
  label?: string;
};

export type DiskMountRequest = {
  device: string;
  mountPoint: string;
  addToFstab?: boolean;
};

export type DiskUnmountRequest = {
  device: string;
};

export type DiskCreatePartitionRequest = {
  disk: string;
  start: string;
  end: string;
  filesystem?: string;
};

export type DiskDeletePartitionRequest = {
  device: string;
};

export type DiskWipeRequest = {
  disk: string;
};

export type DiskActionResponse = {
  accepted: true;
  action: string;
};

/** One disk as the Monitor's Disks tab shows it: identity, live throughput and SMART. */
export type DiskMonitorEntry = {
  name: string;
  device: string;
  model: string | null;
  vendor: string | null;
  sizeBytes: number | null;
  mediaType: DiskMediaType;
  transport: string | null;
  isRemovable: boolean;
  /** Null until a second reading exists, or off Linux. */
  readBytesPerSec: number | null;
  writeBytesPerSec: number | null;
  /** From SMART; null when smartctl has nothing for this disk. */
  health: "healthy" | "degraded" | "unknown" | null;
  temperatureCelsius: number | null;
  powerOnHours: number | null;
  partitions: Pick<DiskPartition, "name" | "mountpoint" | "fstype" | "sizeBytes">[];
};

export type DiskMonitorResponse = {
  disks: DiskMonitorEntry[];
  /**
   * In the Docker image lsblk reports the container's own mounts (/etc/hosts…),
   * so partition mount points are left out rather than shown wrong.
   */
  inContainer: boolean;
  unavailableReason: string | null;
  sampledAt: string;
};
