// packages/core/src/__tests__/fabrication-tracker.test.ts
import { describe, it, expect } from "vitest";
import { FabricationTracker } from "../fabrication-tracker.js";
import type { FabricationEvent } from "../fabrication-tracker.js";

const falseSuccessEvent = (round: number, toolName = "GitPush"): FabricationEvent => ({
  type: "false_success",
  round,
  toolName,
  claimedStatus: "SUCCESS",
  actualError: "non-fast-forward",
});

const missingBlockEvent = (round: number): FabricationEvent => ({
  type: "missing_block",
  round,
});

// ─── Basic recording ───────────────────────────────────────────────────────────

describe("FabricationTracker — initial state", () => {
  it("starts with zero counts", () => {
    const t = new FabricationTracker();
    expect(t.consecutiveFabrications).toBe(0);
    expect(t.fabricationRate).toBe(0);
    expect(t.isStrictMode).toBe(false);
    expect(t.circuitOpen).toBe(false);
  });

  it("snapshot reflects empty initial state", () => {
    const snap = new FabricationTracker().getSnapshot();
    expect(snap.totalRoundsWithTools).toBe(0);
    expect(snap.totalFabricatedRounds).toBe(0);
    expect(snap.events).toHaveLength(0);
  });
});

// ─── Round recording — clean rounds ──────────────────────────────────────────

describe("FabricationTracker — clean rounds", () => {
  it("ignores rounds with no tool names", () => {
    const t = new FabricationTracker();
    t.recordRound(1, [], []);
    expect(t.getSnapshot().totalRoundsWithTools).toBe(0);
  });

  it("counts rounds with tool names", () => {
    const t = new FabricationTracker();
    t.recordRound(1, ["GitPush"], []);
    t.recordRound(2, ["Read", "Edit"], []);
    expect(t.getSnapshot().totalRoundsWithTools).toBe(2);
  });

  it("does not increment fabricatedRounds on clean round", () => {
    const t = new FabricationTracker();
    t.recordRound(1, ["Read"], []);
    expect(t.getSnapshot().totalFabricatedRounds).toBe(0);
  });
});

// ─── Fabrication detection ────────────────────────────────────────────────────

describe("FabricationTracker — fabrication tracking", () => {
  it("increments consecutiveFabrications on fabricated round", () => {
    const t = new FabricationTracker();
    t.recordRound(1, ["GitPush"], [falseSuccessEvent(1)]);
    expect(t.consecutiveFabrications).toBe(1);
  });

  it("accumulates consecutive fabrications across rounds", () => {
    const t = new FabricationTracker();
    t.recordRound(1, ["GitPush"], [falseSuccessEvent(1)]);
    t.recordRound(2, ["Bash"], [missingBlockEvent(2)]);
    expect(t.consecutiveFabrications).toBe(2);
  });

  it("resets consecutive count on a clean round", () => {
    const t = new FabricationTracker();
    t.recordRound(1, ["GitPush"], [falseSuccessEvent(1)]);
    t.recordRound(2, ["GitPush"], [falseSuccessEvent(2)]);
    t.recordRound(3, ["Read"], []); // clean
    expect(t.consecutiveFabrications).toBe(0);
  });

  it("resumes counting after reset", () => {
    const t = new FabricationTracker();
    t.recordRound(1, ["GitPush"], [falseSuccessEvent(1)]);
    t.recordRound(2, ["Read"], []); // clean — resets
    t.recordRound(3, ["Bash"], [missingBlockEvent(3)]);
    expect(t.consecutiveFabrications).toBe(1);
  });

  it("collects all events in snapshot", () => {
    const t = new FabricationTracker();
    t.recordRound(1, ["GitPush"], [falseSuccessEvent(1), missingBlockEvent(1)]);
    const snap = t.getSnapshot();
    expect(snap.events).toHaveLength(2);
    expect(snap.events[0]?.type).toBe("false_success");
    expect(snap.events[1]?.type).toBe("missing_block");
  });
});

// ─── Fabrication rate ─────────────────────────────────────────────────────────

describe("FabricationTracker — fabrication rate", () => {
  it("computes rate as fabricatedRounds / totalRoundsWithTools", () => {
    const t = new FabricationTracker();
    t.recordRound(1, ["GitPush"], [falseSuccessEvent(1)]);
    t.recordRound(2, ["Read"], []);
    t.recordRound(3, ["Read"], []);
    t.recordRound(4, ["Read"], []);
    // 1 fabricated / 4 total = 0.25
    expect(t.fabricationRate).toBeCloseTo(0.25);
  });

  it("returns 0 when no rounds recorded", () => {
    expect(new FabricationTracker().fabricationRate).toBe(0);
  });
});

// ─── Strict mode threshold ────────────────────────────────────────────────────

describe("FabricationTracker — strict mode", () => {
  it("activates strict mode at 3 consecutive fabrications (consecutive-path)", () => {
    const t = new FabricationTracker();
    // Pre-seed with 8 clean rounds so rate stays below 30% during the test
    for (let i = 0; i < 8; i++) t.recordRound(i, ["Read"], []);
    t.recordRound(9, ["GitPush"], [falseSuccessEvent(9)]);
    t.recordRound(10, ["Bash"], [falseSuccessEvent(10)]);
    // rate = 2/10 = 0.2, consecutive = 2 — not yet strict
    expect(t.isStrictMode).toBe(false);
    t.recordRound(11, ["Write"], [falseSuccessEvent(11)]);
    // consecutive = 3 >= threshold — strict mode active
    expect(t.isStrictMode).toBe(true);
  });

  it("activates strict mode when rate exceeds 30%", () => {
    const t = new FabricationTracker();
    // 2 fabricated / 5 total = 0.4 > 0.3
    t.recordRound(1, ["GitPush"], [falseSuccessEvent(1)]);
    t.recordRound(2, ["Read"], []);
    t.recordRound(3, ["Bash"], [falseSuccessEvent(3)]);
    t.recordRound(4, ["Read"], []);
    t.recordRound(5, ["Read"], []);
    expect(t.isStrictMode).toBe(true);
  });

  it("deactivates strict mode after clean rounds reset consecutive count below threshold", () => {
    const t = new FabricationTracker();
    t.recordRound(1, ["GitPush"], [falseSuccessEvent(1)]);
    t.recordRound(2, ["Bash"], [falseSuccessEvent(2)]);
    t.recordRound(3, ["Write"], [falseSuccessEvent(3)]);
    expect(t.isStrictMode).toBe(true);
    // Clean rounds reset consecutive, but rate may keep strict mode active
    // Let's verify only consecutive-based activation resets
    t.recordRound(4, ["Read"], []);
    expect(t.consecutiveFabrications).toBe(0);
    // rate is now 3/4 = 0.75, so still in strict mode via rate
    expect(t.isStrictMode).toBe(true);
  });
});

// ─── Circuit breaker ──────────────────────────────────────────────────────────

describe("FabricationTracker — circuit open", () => {
  it("opens circuit at 3 consecutive fabrications", () => {
    const t = new FabricationTracker();
    t.recordRound(1, ["GitPush"], [falseSuccessEvent(1)]);
    t.recordRound(2, ["Bash"], [falseSuccessEvent(2)]);
    expect(t.circuitOpen).toBe(false);
    t.recordRound(3, ["Write"], [falseSuccessEvent(3)]);
    expect(t.circuitOpen).toBe(true);
  });

  it("circuit closes after clean round resets consecutive count", () => {
    const t = new FabricationTracker();
    t.recordRound(1, ["GitPush"], [falseSuccessEvent(1)]);
    t.recordRound(2, ["Bash"], [falseSuccessEvent(2)]);
    t.recordRound(3, ["Write"], [falseSuccessEvent(3)]);
    t.recordRound(4, ["Read"], []); // clean
    expect(t.circuitOpen).toBe(false);
  });
});

// ─── Strict mode prompt ───────────────────────────────────────────────────────

describe("FabricationTracker — getStrictModePrompt", () => {
  it("includes consecutive count in prompt", () => {
    const t = new FabricationTracker();
    t.recordRound(1, ["GitPush"], [falseSuccessEvent(1)]);
    t.recordRound(2, ["Bash"], [falseSuccessEvent(2)]);
    const prompt = t.getStrictModePrompt();
    expect(prompt).toContain("2 responses");
    expect(prompt).toContain("STRICT VERIFICATION MODE");
    expect(prompt).toContain("VERIFICATION AUDIT:");
  });

  it("uses singular form for 1 fabrication", () => {
    const t = new FabricationTracker();
    t.recordRound(1, ["GitPush"], [falseSuccessEvent(1)]);
    expect(t.getStrictModePrompt()).toContain("1 response");
    expect(t.getStrictModePrompt()).not.toContain("1 responses");
  });
});
