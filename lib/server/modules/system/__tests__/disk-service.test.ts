import { afterEach, describe, expect, it, vi, beforeEach } from "vitest";

const { execFileMock, readFileMock } = vi.hoisted(() => ({
  execFileMock: vi.fn(),
  readFileMock: vi.fn(),
}));

vi.mock("node:child_process", () => ({
  execFile: execFileMock,
}));

vi.mock("node:fs/promises", () => ({
  readFile: readFileMock,
  writeFile: vi.fn(),
  mkdir: vi.fn(),
  stat: vi.fn(),
}));

import {
  getDiskInventory,
  invalidateDiskList,
  mountPartition,
  unmountPartition,
  wipeDisk,
} from "@/lib/server/modules/system/disk-service";

describe("disk-service safety validations", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    execFileMock.mockReset();
    readFileMock.mockReset();
  });

  describe("wipeDisk", () => {
    it("rejects invalid or dangerous device paths", async () => {
      await expect(wipeDisk("/dev/sda; rm -rf /")).rejects.toThrow("Invalid disk device path");
      await expect(wipeDisk("/dev/../etc/passwd")).rejects.toThrow("Invalid disk device path");
      await expect(wipeDisk("sda")).rejects.toThrow("Invalid disk device path");
      await expect(wipeDisk("/dev/sda1")).rejects.toThrow("Invalid disk device path");
    });

    it("rejects wiping a disk containing active mounts in /proc/mounts", async () => {
      readFileMock.mockResolvedValueOnce(
        "/dev/sdb1 /data ext4 rw,relatime 0 0\n" +
        "/dev/sda2 / ext4 rw,relatime 0 0\n"
      );

      await expect(wipeDisk("/dev/sdb")).rejects.toThrow("Cannot modify active mounted device");
    });

    it("rejects wiping a system disk mounted at /", async () => {
      readFileMock.mockResolvedValueOnce(
        "/dev/sda1 /boot/efi vfat rw 0 0\n" +
        "/dev/sda2 / ext4 rw,relatime 0 0\n"
      );

      await expect(wipeDisk("/dev/sda")).rejects.toThrow("Cannot modify system device containing critical mountpoint");
    });
  });

  describe("mountPartition", () => {
    it("rejects invalid partition device paths", async () => {
      await expect(mountPartition("/dev/sda", "/mnt/data"))
        .rejects.toThrow("Invalid partition device path");
      await expect(mountPartition("/dev/sda1; rm -rf /", "/mnt/data"))
        .rejects.toThrow("Invalid partition device path");
    });

    it("rejects mountpoints containing newlines or carriage returns", async () => {
      await expect(mountPartition("/dev/sdb1", "/mnt/data\n/dev/sdc1 /"))
        .rejects.toThrow("Mount point must be a safe, absolute path");
      await expect(mountPartition("/dev/sdb1", "/mnt/data\r\n"))
        .rejects.toThrow("Mount point must be a safe, absolute path");
      await expect(mountPartition("/dev/sdb1", "relative/path"))
        .rejects.toThrow("Mount point must be a safe, absolute path");
    });

    it("rejects dangerous system mountpoints", async () => {
      await expect(mountPartition("/dev/sdb1", "/"))
        .rejects.toThrow("Cannot mount partition over critical system directory: /");
      await expect(mountPartition("/dev/sdb1", "/etc"))
        .rejects.toThrow("Cannot mount partition over critical system directory: /etc");
    });

    it("only mounts inside /mnt, /media, /srv or /DATA", async () => {
      for (const mountPoint of ["/opt/data", "/etc/ssh", "/root/.ssh", "/usr/local/bin", "/mnt", "/DATA", "/mnt/../etc/x"]) {
        await expect(mountPartition("/dev/sdb1", mountPoint)).rejects.toThrow(/Mount point must be/);
      }
      expect(execFileMock).not.toHaveBeenCalled();
    });

    it("mounts inside an allowed folder, normalizing the path", async () => {
      execFileMock.mockImplementation((...args: unknown[]) => (args.at(-1) as (...a: unknown[]) => void)(null, "", ""));
      await mountPartition("/dev/sdb1", "/mnt//data/");
      expect(execFileMock).toHaveBeenCalledWith("mount", ["/dev/sdb1", "/mnt/data"], expect.any(Function));
    });
  });

  describe("unmountPartition", () => {
    it("rejects unmounting root or system directories", async () => {
      await expect(unmountPartition("/")).rejects.toThrow("Cannot unmount critical system directory: /");
      await expect(unmountPartition("/boot")).rejects.toThrow("Cannot unmount critical system directory: /boot");
    });
  });
});

describe("getDiskInventory", () => {
  const originalPlatform = process.platform;

  function setPlatform(platform: NodeJS.Platform) {
    Object.defineProperty(process, "platform", { value: platform, configurable: true });
  }

  beforeEach(() => {
    execFileMock.mockReset();
    invalidateDiskList();
    setPlatform("linux");
    vi.stubEnv("HOMEIO_CONTAINER", "");
  });

  afterEach(() => {
    setPlatform(originalPlatform);
    vi.unstubAllEnvs();
  });

  function lsblkReturns(blockdevices: unknown[]) {
    // promisify(execFile) resolves to { stdout, stderr }; the mock has no custom promisify.
    execFileMock.mockImplementation((...args: unknown[]) =>
      (args.at(-1) as (...a: unknown[]) => void)(null, { stdout: JSON.stringify({ blockdevices }), stderr: "" }),
    );
  }

  it("lists real disks and leaves out empty and in-memory devices", async () => {
    lsblkReturns([
      { name: "sda", size: 500_000_000_000, type: "disk", rm: false, rota: false, children: [] },
      { name: "nbd0", size: 0, type: "disk" },
      { name: "zram0", size: 1_000_000_000, type: "disk" },
      { name: "mmcblk0", size: 0, type: "disk" },
      { name: "loop3", size: 50_000_000, type: "loop" },
    ]);

    const inventory = await getDiskInventory();

    expect(inventory.disks.map((d) => d.name)).toEqual(["sda"]);
    expect(inventory.unavailableReason).toBeNull();
    expect(inventory.readOnly).toBe(false);
  });

  it("reuses the disk list between polls, and reads it again after a disk command", async () => {
    lsblkReturns([{ name: "sda", type: "disk", size: 500_000_000_000, children: [] }]);

    await getDiskInventory();
    await getDiskInventory();
    expect(execFileMock).toHaveBeenCalledTimes(1);

    await unmountPartition("/dev/sda1").catch(() => {});
    await getDiskInventory();
    const lsblkCalls = execFileMock.mock.calls.filter(([command]) => command === "lsblk");
    expect(lsblkCalls).toHaveLength(2);
  });

  it("says lsblk is missing instead of reporting no disks", async () => {
    execFileMock.mockImplementation((...args: unknown[]) =>
      (args.at(-1) as (...a: unknown[]) => void)(Object.assign(new Error("spawn lsblk ENOENT"), { code: "ENOENT" })),
    );

    const host = await getDiskInventory();
    expect(host.disks).toEqual([]);
    expect(host.unavailableReason).toContain("apt install util-linux");

    vi.stubEnv("HOMEIO_CONTAINER", "true");
    const container = await getDiskInventory();
    expect(container.unavailableReason).toContain("missing from this container image");
    expect(container.readOnly).toBe(true);
  });

  it("explains that disk management needs Linux", async () => {
    setPlatform("darwin");
    execFileMock.mockImplementation((...args: unknown[]) =>
      (args.at(-1) as (...a: unknown[]) => void)(Object.assign(new Error("spawn lsblk ENOENT"), { code: "ENOENT" })),
    );

    const inventory = await getDiskInventory();
    expect(inventory.unavailableReason).toBe("Disk management needs Linux; this machine runs darwin.");
  });
});
