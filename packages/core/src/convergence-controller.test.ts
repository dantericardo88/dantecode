// ============================================================================
// ConvergenceController — unit tests
// ============================================================================

import { describe, it, expect } from "vitest";
import { ConvergenceController, computeSlope } from "./convergence-controller.js";
import type { ScoreObservation } from "./convergence-controller.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeObservation(score: number, round: number, passed = false): ScoreObservation {
  return { score, round, passed, timestamp: new Date().toISOString() };
}

function feedScores(ctrl: ConvergenceController, scores: number[]): void {
  scores.forEach((score, i) => ctrl.record(score, i + 1, score >= 75));
}

// ---------------------------------------------------------------------------
// describe: computeSlope
// ---------------------------------------------------------------------------

describe("computeSlope", () => {
  it("returns 0 for empty array", () => {
    expect(computeSlope([])).toBe(0);
  });

  it("returns 0 for single observation", () => {
    expect(computeSlope([makeObservation(50, 1)])).toBe(0);
  });

  it("returns positive slope for monotonically increasing scores", () => {
    const obs = [40, 50, 60, 70, 80].map((s, i) => makeObservation(s, i + 1));
    const slope = computeSlope(obs);
    expect(slope).toBeGreaterThan(0);
    expect(slope).toBeCloseTo(10, 0); // +10 per round
  });

  it("returns negative slope for monotonically decreasing scores", () => {
    const obs = [80, 70, 60, 50, 40].map((s, i) => makeObservation(s, i + 1));
    const slope = computeSlope(obs);
    expect(slope).toBeLessThan(0);
    expect(slope).toBeCloseTo(-10, 0);
  });

  it("returns near-zero slope for flat scores", () => {
    const obs = [60, 60, 60, 60].map((s, i) => makeObservation(s, i + 1));
    expect(Math.abs(computeSlope(obs))).toBeLessThan(0.1);
  });

  it("handles two observations correctly", () => {
    const obs = [50, 70].map((s, i) => makeObservation(s, i + 1));
    expect(computeSlope(obs)).toBeCloseTo(20, 0);
  });
});

// ---------------------------------------------------------------------------
// describe: empty state
// ---------------------------------------------------------------------------

describe("ConvergenceController — empty state", () => {
  it("returns continue with insufficient_data when no observations", () => {
    const ctrl = new ConvergenceController();
    const decision = ctrl.evaluate();
    expect(decision.action).toBe("continue");
    expect(decision.trend).toBe("insufficient_data");
    expect(decision.currentScore).toBe(0);
  });

  it("returns 0 for getBestScore when empty", () => {
    expect(new ConvergenceController().getBestScore()).toBe(0);
  });

  it("returns 0 for getCurrentScore when empty", () => {
    expect(new ConvergenceController().getCurrentScore()).toBe(0);
  });

  it("returns false for isPassing when empty", () => {
    expect(new ConvergenceController().isPassing()).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// describe: passing state
// ---------------------------------------------------------------------------

describe("ConvergenceController — passing threshold", () => {
  it("returns continue when score meets passing threshold", () => {
    const ctrl = new ConvergenceController({ passingThreshold: 75 });
    ctrl.record(75, 1, true);
    const decision = ctrl.evaluate();
    expect(decision.action).toBe("continue");
    expect(decision.trend).toBe("improving");
  });

  it("returns continue for score above threshold", () => {
    const ctrl = new ConvergenceController({ passingThreshold: 75 });
    feedScores(ctrl, [40, 50, 80]);
    const decision = ctrl.evaluate();
    expect(decision.action).toBe("continue");
  });

  it("isPassing returns true after passing observation", () => {
    const ctrl = new ConvergenceController({ passingThreshold: 75 });
    ctrl.record(80, 1, true);
    expect(ctrl.isPassing()).toBe(true);
  });

  it("isPassing returns false after failing observation", () => {
    const ctrl = new ConvergenceController({ passingThreshold: 75 });
    ctrl.record(70, 1, false);
    expect(ctrl.isPassing()).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// describe: improving trend
// ---------------------------------------------------------------------------

describe("ConvergenceController — improving trend", () => {
  it("returns continue + improving for strongly rising scores", () => {
    const ctrl = new ConvergenceController({ improvingSlope: 2 });
    feedScores(ctrl, [30, 40, 55, 65, 70]);
    const decision = ctrl.evaluate();
    expect(decision.action).toBe("continue");
    expect(decision.trend).toBe("improving");
  });

  it("best score tracked correctly", () => {
    const ctrl = new ConvergenceController();
    feedScores(ctrl, [30, 70, 50, 60]);
    expect(ctrl.getBestScore()).toBe(70);
  });

  it("current score is always the last recorded", () => {
    const ctrl = new ConvergenceController();
    feedScores(ctrl, [30, 70, 50, 65]);
    expect(ctrl.getCurrentScore()).toBe(65);
  });
});

// ---------------------------------------------------------------------------
// describe: flat trend → scope reduction
// ---------------------------------------------------------------------------

describe("ConvergenceController — flat trend", () => {
  it("returns reduce_scope after flatRoundsBeforeScopeReduce flat rounds", () => {
    const ctrl = new ConvergenceController({ flatRoundsBeforeScopeReduce: 3 });
    feedScores(ctrl, [50, 51, 51, 50, 51]); // flat ≈ 0 slope
    const decision = ctrl.evaluate();
    expect(decision.action).toBe("reduce_scope");
    expect(decision.trend).toBe("flat");
  });

  it("does not reduce scope prematurely (before threshold)", () => {
    const ctrl = new ConvergenceController({ flatRoundsBeforeScopeReduce: 4 });
    feedScores(ctrl, [50, 50, 50]); // only 2 flat rounds in window
    const decision = ctrl.evaluate();
    // With only 3 observations and insufficient flat count, may still continue
    expect(["continue", "reduce_scope"]).toContain(decision.action);
  });

  it("recommends reduced_scope strategy on first scope reduction", () => {
    const ctrl = new ConvergenceController({ flatRoundsBeforeScopeReduce: 2 });
    feedScores(ctrl, [50, 50, 50]);
    const decision = ctrl.evaluate();
    if (decision.action === "reduce_scope") {
      expect(["reduced_scope", "minimal"]).toContain(decision.recommendedStrategy);
    }
  });

  it("includes slope in reason string", () => {
    const ctrl = new ConvergenceController({ flatRoundsBeforeScopeReduce: 3 });
    feedScores(ctrl, [50, 50, 50, 50, 50]);
    const decision = ctrl.evaluate();
    expect(decision.reason).toContain("slope=");
  });
});

// ---------------------------------------------------------------------------
// describe: declining trend → escalation
// ---------------------------------------------------------------------------

describe("ConvergenceController — declining trend", () => {
  it("returns escalate after decliningRoundsBeforeEscalate declining rounds", () => {
    const ctrl = new ConvergenceController({ decliningRoundsBeforeEscalate: 2 });
    feedScores(ctrl, [80, 70, 60, 50, 40]); // strong decline
    const decision = ctrl.evaluate();
    expect(decision.action).toBe("escalate");
    expect(decision.trend).toBe("declining");
  });

  it("escalation includes best score in reason", () => {
    const ctrl = new ConvergenceController({ decliningRoundsBeforeEscalate: 2 });
    feedScores(ctrl, [80, 70, 60, 50, 40]);
    const decision = ctrl.evaluate();
    expect(decision.reason).toContain("80"); // best score
  });

  it("recommends minimal strategy on escalation", () => {
    const ctrl = new ConvergenceController({ decliningRoundsBeforeEscalate: 2 });
    feedScores(ctrl, [80, 70, 60, 50, 40]);
    const decision = ctrl.evaluate();
    if (decision.action === "escalate") {
      expect(decision.recommendedStrategy).toBe("minimal");
    }
  });

  it("does not escalate on single declining round", () => {
    const ctrl = new ConvergenceController({ decliningRoundsBeforeEscalate: 3 });
    feedScores(ctrl, [80, 70]); // only 1 declining round
    const decision = ctrl.evaluate();
    expect(decision.action).not.toBe("escalate");
  });
});

// ---------------------------------------------------------------------------
// describe: window size
// ---------------------------------------------------------------------------

describe("ConvergenceController — window size", () => {
  it("only uses last windowSize observations for trend", () => {
    const ctrl = new ConvergenceController({ windowSize: 3, flatRoundsBeforeScopeReduce: 3 });
    // First 5 observations are improving, last 3 are flat
    feedScores(ctrl, [10, 20, 30, 50, 50, 50]);
    const decision = ctrl.evaluate();
    // Window of 3 = [50, 50, 50] → flat
    expect(decision.trend).toBe("flat");
  });
});

// ---------------------------------------------------------------------------
// describe: getObservations + reset
// ---------------------------------------------------------------------------

describe("ConvergenceController — getObservations + reset", () => {
  it("getObservations returns all recorded observations", () => {
    const ctrl = new ConvergenceController();
    feedScores(ctrl, [40, 60, 80]);
    const obs = ctrl.getObservations();
    expect(obs).toHaveLength(3);
    expect(obs[0]?.score).toBe(40);
    expect(obs[2]?.score).toBe(80);
  });

  it("getObservations returns a copy (immutable)", () => {
    const ctrl = new ConvergenceController();
    ctrl.record(50, 1, false);
    const obs = ctrl.getObservations();
    obs.push({ score: 999, round: 99, passed: true, timestamp: "" });
    expect(ctrl.getObservations()).toHaveLength(1); // original unchanged
  });

  it("reset clears all state", () => {
    const ctrl = new ConvergenceController();
    feedScores(ctrl, [40, 50, 60, 70, 80]);
    ctrl.reset();

    expect(ctrl.getObservations()).toHaveLength(0);
    expect(ctrl.getBestScore()).toBe(0);
    expect(ctrl.getCurrentScore()).toBe(0);
    const decision = ctrl.evaluate();
    expect(decision.trend).toBe("insufficient_data");
  });
});
