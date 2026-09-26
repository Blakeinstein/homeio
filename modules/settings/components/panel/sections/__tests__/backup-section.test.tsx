/* @vitest-environment jsdom */

import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { SystemFeatureAvailability } from "@/lib/shared/contracts/system";
import { BackupSection } from "@/modules/settings/components/panel/sections/backup-section";
import { createSettingsCapabilities } from "@/modules/settings/hooks/backend/capabilities";
import type { SettingsBackend } from "@/modules/settings/components/panel/types";

const AVAILABLE: SystemFeatureAvailability = { available: true, reason: null };

function renderSection(overrides: {
  runNow?: SystemFeatureAvailability;
  restore?: SystemFeatureAvailability;
  restoreError?: string | null;
} = {}) {
  const data: SettingsBackend["backup"] = {
    settings: {
      enabled: false,
      frequency: "weekly",
      dayOfWeek: "sunday",
      time: "03:00",
      retentionCount: 7,
      isLoading: false,
      isSaving: false,
      error: null,
    },
    backups: [
      {
        id: "backup-2020-03-01T00-00-00Z",
        createdAt: "2020-03-01T00:00:00.000Z",
        sizeBytes: 1,
        appVersion: "2.0.12",
        hostname: "d9-docker",
        backupPath: "/DATA/Backups/homeio/backup-2020-03-01T00-00-00Z.tar.gz",
        dbDumpIncluded: true,
        dataRootIncluded: true,
        stacksRootIncluded: true,
        storeConfigIncluded: true,
        status: "completed",
      },
    ],
    backupRoot: "/DATA/Backups/homeio",
    availability: {
      runNow: overrides.runNow ?? AVAILABLE,
      restore: overrides.restore ?? AVAILABLE,
    },
    isLoading: false,
    runNow: { isPending: false, error: null },
    restore: { isPending: false, error: overrides.restoreError ?? null },
  };

  render(
    <BackupSection
      data={data}
      capabilities={createSettingsCapabilities().backup}
      settingsDraft={{
        enabled: false,
        frequency: "weekly",
        dayOfWeek: "sunday",
        time: "03:00",
        retentionCount: "7",
      }}
      onSettingsChange={vi.fn()}
      onRunBackupNow={vi.fn(async () => undefined)}
      onRestoreBackup={vi.fn(async () => undefined)}
    />,
  );
}

describe("BackupSection", () => {
  it("says what this host lacks and does not offer what cannot work", () => {
    renderSection({
      runNow: { available: false, reason: "Backing up needs pg_dump, which is not installed on this host." },
      restore: {
        available: false,
        reason: "Restoring needs systemd-run and psql, which are not installed on this host.",
      },
    });

    // In words on the page, not only in a tooltip.
    expect(screen.getByText("Backing up needs pg_dump, which is not installed on this host.")).toBeTruthy();
    expect(
      screen.getByText("Restoring needs systemd-run and psql, which are not installed on this host."),
    ).toBeTruthy();
    expect((screen.getByRole("button", { name: /Run now/ }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: /^Restore$/ }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("offers both where the host can do them", () => {
    renderSection();

    expect((screen.getByRole("button", { name: /Run now/ }) as HTMLButtonElement).disabled).toBe(false);
    expect((screen.getByRole("button", { name: /^Restore$/ }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("shows a restore failure inside the dialog that is still open", () => {
    renderSection({ restoreError: "systemd-run is not available on this host" });

    fireEvent.click(screen.getByRole("button", { name: /^Restore$/ }));

    const dialog = screen.getByRole("alertdialog");
    expect(dialog.textContent).toContain("systemd-run is not available on this host");
  });
});
