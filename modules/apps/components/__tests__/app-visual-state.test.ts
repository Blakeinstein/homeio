import { describe, expect, it } from "vitest";
import { getAppVisualState, type AppItem } from "@/modules/apps/components/app-grid-presenters";
import { Container } from "@/components/icons/platform-icons";

function app(overrides: Partial<AppItem>): AppItem {
  return {
    id: "uptimekuma",
    name: "Uptime Kuma",
    icon: Container,
    logoUrl: null,
    color: "",
    bgColor: "",
    status: "running",
    category: "Apps",
    webUiPort: null,
    webUiUrl: null,
    containerName: "uptimekuma",
    updateAvailable: false,
    ...overrides,
  };
}

describe("getAppVisualState", () => {
  it("shows a clean stop quietly, not as a crash", () => {
    const stopped = getAppVisualState(app({ status: "stopped", condition: { condition: "stopped", exitCode: 143 } }));
    expect(stopped.title).toBe("Stopped (exit 143)");
    expect(stopped.imageClass).toContain("grayscale");
    expect(stopped.badgeIcon).toBeNull();
  });

  it("flags a crash with its exit code", () => {
    const crashed = getAppVisualState(app({ status: "stopped", condition: { condition: "crashed", exitCode: 1 } }));
    expect(crashed.title).toBe("Crashed (exit 1)");
    expect(crashed.imageClass).toContain("grayscale");
    expect(crashed.badgeClass).toBe("text-status-red");
    expect(crashed.badgeIcon).not.toBeNull();
  });

  it("tells unhealthy, restarting and never started apart", () => {
    expect(getAppVisualState(app({ status: "running", condition: { condition: "unhealthy", exitCode: null } })).title).toBe(
      "Running but unhealthy",
    );
    expect(getAppVisualState(app({ status: "stopped", condition: { condition: "restarting", exitCode: 1 } })).title).toBe(
      "Restarting (exit 1)",
    );
    expect(getAppVisualState(app({ status: "stopped", condition: { condition: "created", exitCode: null } })).title).toBe(
      "Never started",
    );
  });

  it("follows an optimistic Stop over a stale running condition", () => {
    const visual = getAppVisualState(app({ status: "stopped", condition: { condition: "running", exitCode: null } }));
    expect(visual.title).toBe("Stopped");
  });

  it("gives unmanaged containers the same colours, a dashed outline and a note", () => {
    const running = getAppVisualState(app({ status: "unmanaged", condition: { condition: "running", exitCode: null } }));
    expect(running.imageClass).toBe("");
    expect(running.badgeIcon).toBeNull();
    expect(running.ringClass).toBe("border-dashed border-muted-foreground/40");
    expect(running.title).toBe("Running · not managed by Homeio");

    const created = getAppVisualState(app({ status: "unmanaged", condition: { condition: "created", exitCode: null } }));
    expect(created.title).toBe("Never started · not managed by Homeio");
  });

  it("keeps the processing state for apps being updated", () => {
    expect(getAppVisualState(app({ status: "updating", condition: { condition: "crashed", exitCode: 1 } })).title).toBe(
      "Processing",
    );
  });
});
