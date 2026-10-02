import { describe, expect, it } from "vitest";
import {
  buildQuadletAppItems,
  getAppVisualState,
  type AppItem,
} from "@/modules/apps/components/app-grid-presenters";
import { Container } from "@/components/icons/platform-icons";
import type { QuadletApp } from "@/lib/shared/contracts/quadlet";

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

describe("buildQuadletAppItems", () => {
  function quadletApp(overrides: Partial<QuadletApp> = {}): QuadletApp {
    return {
      id: "quadlet:sure",
      name: "Sure",
      description: "Personal finance app",
      category: "Finance",
      logoUrl: "https://cdn.example.com/sure.png",
      webUiPort: 3064,
      condition: { condition: "running", exitCode: null },
      containerNames: ["sure-web", "sure-db"],
      primaryContainerName: "sure-web",
      ...overrides,
    };
  }

  it("maps a discovered quadlet app to an unmanaged app card carrying its own icon", () => {
    const [item] = buildQuadletAppItems([quadletApp()]);

    expect(item.id).toBe("quadlet:sure");
    expect(item.name).toBe("Sure");
    expect(item.logoUrl).toBe("https://cdn.example.com/sure.png");
    expect(item.category).toBe("Finance");
    expect(item.webUiPort).toBe(3064);
    expect(item.containerName).toBe("sure-web");
    expect(item.status).toBe("unmanaged");
    expect(item.condition).toEqual({ condition: "running", exitCode: null });
  });

  it("falls back to a keyword-derived category when app.yaml has none", () => {
    const [item] = buildQuadletAppItems([quadletApp({ name: "Grafana", category: null })]);
    expect(item.category).toBe("System");
  });
});
