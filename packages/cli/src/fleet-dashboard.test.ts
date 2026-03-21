// ============================================================================
// fleet-dashboard.test.ts — Unit tests for FleetDashboard + renderFleetDashboard
// ============================================================================

import { describe, it, expect } from "vitest";
import { renderFleetDashboard, FleetDashboard, formatDuration } from "./fleet-dashboard.js";
import type { FleetDashboardState, FleetLaneDisplay } from "./fleet-dashboard.js";

// Helper: strip ANSI codes from output for assertions
function stripAnsi(s: string): string {
  return s.replace(/\x1b\[[0-9;]*[mAKJHF]/g, "");
}

function makeLane(overrides: Partial<FleetLaneDisplay> & { laneId: string; agentName: string }): FleetLaneDisplay {
  return {
    laneId: overrides.laneId,
    agentName: overrides.agentName,
    agentKind: overrides.agentKind ?? "dantecode",
    status: overrides.status ?? "running",
    progressHint: overrides.progressHint,
    tokensUsed: overrides.tokensUsed ?? 0,
    pdseScore: overrides.pdseScore,
    elapsedMs: overrides.elapsedMs ?? 0,
    worktreeBranch: overrides.worktreeBranch,
  };
}

function makeState(overrides: Partial<FleetDashboardState> = {}): FleetDashboardState {
  return {
    objective: overrides.objective ?? "Build authentication system",
    runId: overrides.runId ?? "council-1234567890-abcdefgh",
    lanes: overrides.lanes ?? [],
    totalTokens: overrides.totalTokens ?? 0,
    budgetRemaining: overrides.budgetRemaining,
    elapsedMs: overrides.elapsedMs ?? 0,
    status: overrides.status ?? "running",
  };
}

describe("renderFleetDashboard", () => {
  it("renders with 3 lanes — correct structure", () => {
    const state = makeState({
      lanes: [
        makeLane({ laneId: "l1", agentName: "builder", status: "running", tokensUsed: 1500 }),
        makeLane({ laneId: "l2", agentName: "reviewer", status: "completed", tokensUsed: 800 }),
        makeLane({ laneId: "l3", agentName: "tester", status: "failed", tokensUsed: 300 }),
      ],
      totalTokens: 2600,
      elapsedMs: 90_000,
      status: "running",
    });
    const rendered = stripAnsi(renderFleetDashboard(state));
    expect(rendered).toContain("Fleet:");
    expect(rendered).toContain("builder");
    expect(rendered).toContain("reviewer");
    expect(rendered).toContain("tester");
    expect(rendered).toContain("running");
    expect(rendered).toContain("completed");
    expect(rendered).toContain("failed");
  });

  it("completed lane shows [+] icon", () => {
    const state = makeState({
      lanes: [makeLane({ laneId: "l1", agentName: "builder", status: "completed" })],
    });
    const rendered = stripAnsi(renderFleetDashboard(state));
    expect(rendered).toContain("[+]");
  });

  it("failed lane shows [!] icon", () => {
    const state = makeState({
      lanes: [makeLane({ laneId: "l1", agentName: "builder", status: "failed" })],
    });
    const rendered = stripAnsi(renderFleetDashboard(state));
    expect(rendered).toContain("[!]");
  });

  it("retrying lane shows [R] icon", () => {
    const state = makeState({
      lanes: [makeLane({ laneId: "l1", agentName: "builder", status: "retrying" })],
    });
    const rendered = stripAnsi(renderFleetDashboard(state));
    expect(rendered).toContain("[R]");
  });

  it("verifying lane shows [?] icon", () => {
    const state = makeState({
      lanes: [makeLane({ laneId: "l1", agentName: "builder", status: "verifying" })],
    });
    const rendered = stripAnsi(renderFleetDashboard(state));
    expect(rendered).toContain("[?]");
  });

  it("PDSE score displayed when available", () => {
    const state = makeState({
      lanes: [makeLane({ laneId: "l1", agentName: "builder", status: "completed", pdseScore: 92.5 })],
    });
    const rendered = stripAnsi(renderFleetDashboard(state));
    expect(rendered).toContain("93"); // Math.round(92.5)
  });

  it("PDSE shows -- when not available", () => {
    const state = makeState({
      lanes: [makeLane({ laneId: "l1", agentName: "builder", status: "running", pdseScore: undefined })],
    });
    const rendered = stripAnsi(renderFleetDashboard(state));
    expect(rendered).toContain("--");
  });

  it("budget remaining shown when configured", () => {
    const state = makeState({
      totalTokens: 50_000,
      budgetRemaining: 450_000,
    });
    const rendered = stripAnsi(renderFleetDashboard(state));
    expect(rendered).toContain("450.0K");
  });

  it("no budget remaining shown when undefined", () => {
    const state = makeState({ totalTokens: 50_000, budgetRemaining: undefined });
    const rendered = stripAnsi(renderFleetDashboard(state));
    // Should contain token count but no "/" separator for budget
    expect(rendered).toContain("50.0K");
  });

  it("objective truncated when too long", () => {
    const state = makeState({
      objective: "A".repeat(60),
    });
    const rendered = stripAnsi(renderFleetDashboard(state));
    expect(rendered).toContain("...");
  });

  it("empty lanes row shows no lanes message", () => {
    const state = makeState({ lanes: [] });
    const rendered = stripAnsi(renderFleetDashboard(state));
    expect(rendered).toContain("No lanes assigned");
  });
});

describe("FleetDashboard", () => {
  it("updateLane changes status — getState reflects new status", () => {
    const dashboard = new FleetDashboard(
      makeState({
        lanes: [makeLane({ laneId: "l1", agentName: "builder", status: "running" })],
      }),
      { enabled: false },
    );
    dashboard.updateLane("l1", { status: "completed" });
    const state = dashboard.getState();
    expect(state.lanes[0]!.status).toBe("completed");
  });

  it("updateLane with unknown id falls back to agentName match", () => {
    const dashboard = new FleetDashboard(
      makeState({
        lanes: [makeLane({ laneId: "", agentName: "builder", status: "pending" })],
      }),
      { enabled: false },
    );
    dashboard.updateLane("new-id", { agentName: "builder", status: "running" });
    const state = dashboard.getState();
    expect(state.lanes[0]!.status).toBe("running");
  });

  it("updateFleet changes fleet-level fields", () => {
    const dashboard = new FleetDashboard(makeState({ totalTokens: 0 }), { enabled: false });
    dashboard.updateFleet({ totalTokens: 5_000, status: "merging" });
    const state = dashboard.getState();
    expect(state.totalTokens).toBe(5_000);
    expect(state.status).toBe("merging");
  });

  it("getState returns a copy — mutations don't affect internal state", () => {
    const dashboard = new FleetDashboard(makeState({ totalTokens: 100 }), { enabled: false });
    const state = dashboard.getState();
    state.totalTokens = 999;
    expect(dashboard.getState().totalTokens).toBe(100);
  });
});

describe("formatDuration", () => {
  it("ms for < 1s", () => {
    expect(formatDuration(500)).toBe("500ms");
  });
  it("seconds for < 1m", () => {
    expect(formatDuration(45_000)).toBe("45s");
  });
  it("minutes for >= 1m", () => {
    expect(formatDuration(90_000)).toBe("1m30s");
  });
});
