import { describe, it, expect } from "vitest";
import {
  evaluatePromotionGate,
  createRollbackOverride,
  shouldRollback,
} from "./model-adaptation-promotion.js";
import type { ExperimentResult, CandidateOverride } from "./model-adaptation-types.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeExperiment(overrides?: Partial<ExperimentResult>): ExperimentResult {
  return {
    id: "exp_test1",
    overrideId: "ovr_test1",
    provider: "anthropic",
    model: "claude-opus-4",
    quirkKey: "tool_call_format_error",
    baseline: { pdseScore: 80, completionStatus: "complete", successRate: 0.8 },
    candidate: { pdseScore: 90, completionStatus: "complete", successRate: 0.9 },
    controlRegression: false,
    smokePassed: true,
    decision: "promote",
    createdAt: "2026-03-23T00:00:00.000Z",
    ...overrides,
  };
}

function makeOverride(overrides?: Partial<CandidateOverride>): CandidateOverride {
  return {
    id: "ovr_test1",
    provider: "anthropic",
    model: "claude-opus-4",
    quirkKey: "tool_call_format_error",
    status: "promoted",
    scope: {},
    patch: { promptPreamble: "fix tool calls" },
    basedOnObservationIds: ["obs_1"],
    version: 3,
    createdAt: "2026-03-23T00:00:00.000Z",
    promotedAt: "2026-03-23T01:00:00.000Z",
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// evaluatePromotionGate
// ---------------------------------------------------------------------------

describe("evaluatePromotionGate", () => {
  it("promotes when all criteria pass and family count >= 3", () => {
    const experiment = makeExperiment();
    const result = evaluatePromotionGate(experiment, 3);

    expect(result.decision).toBe("promote");
    expect(result.requiresHumanApproval).toBe(false);
    expect(result.reasons).toContain("PDSE improved by 10.0 points");
  });

  it("rejects when PDSE improvement < 5%", () => {
    const experiment = makeExperiment({
      candidate: { pdseScore: 83, completionStatus: "complete", successRate: 0.85 },
    });
    const result = evaluatePromotionGate(experiment, 5);

    expect(result.decision).toBe("reject");
    expect(result.reasons.some((r) => r.includes("below 5-point threshold"))).toBe(true);
  });

  it("rejects when smoke test fails", () => {
    const experiment = makeExperiment({ smokePassed: false });
    const result = evaluatePromotionGate(experiment, 5);

    expect(result.decision).toBe("reject");
    expect(result.reasons).toContain("Smoke test failed");
  });

  it("rejects when control regresses", () => {
    const experiment = makeExperiment({ controlRegression: true });
    const result = evaluatePromotionGate(experiment, 5);

    expect(result.decision).toBe("reject");
    expect(result.reasons).toContain("Control task regressed");
  });

  it("returns needs_human_review for first 3 promotions", () => {
    const experiment = makeExperiment();

    // promotionCountForFamily = 0, 1, 2 → all need human review
    for (let i = 0; i < 3; i++) {
      const result = evaluatePromotionGate(experiment, i);
      expect(result.decision).toBe("needs_human_review");
      expect(result.requiresHumanApproval).toBe(true);
      expect(result.reasons.some((r) => r.includes("requires human approval"))).toBe(true);
    }
  });

  it("rejects when completion status regresses from complete", () => {
    const experiment = makeExperiment({
      baseline: { pdseScore: 80, completionStatus: "complete", successRate: 0.8 },
      candidate: { pdseScore: 90, completionStatus: "partial", successRate: 0.9 },
    });
    const result = evaluatePromotionGate(experiment, 5);

    expect(result.decision).toBe("reject");
    expect(result.reasons).toContain("Completion status regressed from complete");
  });

  it("accumulates multiple rejection reasons", () => {
    const experiment = makeExperiment({
      smokePassed: false,
      controlRegression: true,
      candidate: { pdseScore: 78, completionStatus: "partial", successRate: 0.7 },
    });
    const result = evaluatePromotionGate(experiment, 5);

    expect(result.decision).toBe("reject");
    // Should have multiple rejection reasons
    expect(result.reasons.length).toBeGreaterThanOrEqual(3);
  });
});

// ---------------------------------------------------------------------------
// createRollbackOverride
// ---------------------------------------------------------------------------

describe("createRollbackOverride", () => {
  it("creates override with rolled_back status and version bump", () => {
    const current = makeOverride({ version: 3 });
    const rolled = createRollbackOverride(current, "pdse_regression");

    expect(rolled.id).toMatch(/^rb_/);
    expect(rolled.status).toBe("rolled_back");
    expect(rolled.version).toBe(4);
    expect(rolled.rollbackOfVersion).toBe(3);
    expect(rolled.rejectedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    // Preserved fields
    expect(rolled.provider).toBe("anthropic");
    expect(rolled.model).toBe("claude-opus-4");
    expect(rolled.quirkKey).toBe("tool_call_format_error");
    expect(rolled.patch).toEqual({ promptPreamble: "fix tool calls" });
  });

  it("preserves all original fields except id/status/version/rejectedAt", () => {
    const current = makeOverride({
      scope: { workflow: "magic", commandName: "build" },
      basedOnObservationIds: ["obs_1", "obs_2", "obs_3"],
    });
    const rolled = createRollbackOverride(current, "completion_regression");

    expect(rolled.scope).toEqual({ workflow: "magic", commandName: "build" });
    expect(rolled.basedOnObservationIds).toEqual(["obs_1", "obs_2", "obs_3"]);
    expect(rolled.createdAt).toBe(current.createdAt);
  });
});

// ---------------------------------------------------------------------------
// shouldRollback
// ---------------------------------------------------------------------------

describe("shouldRollback", () => {
  it("triggers on PDSE regression (delta < -5)", () => {
    const experiments = [
      makeExperiment({
        candidate: { pdseScore: 70, completionStatus: "complete", successRate: 0.7 },
      }),
    ];
    const result = shouldRollback(experiments);

    expect(result.shouldRollback).toBe(true);
    expect(result.trigger).toBe("pdse_regression");
    expect(result.reason).toContain("PDSE regressed");
  });

  it("triggers on completion regression (complete -> failed)", () => {
    const experiments = [
      makeExperiment({
        baseline: { pdseScore: 80, completionStatus: "complete", successRate: 0.8 },
        candidate: { pdseScore: 82, completionStatus: "failed", successRate: 0.5 },
      }),
    ];
    const result = shouldRollback(experiments);

    expect(result.shouldRollback).toBe(true);
    expect(result.trigger).toBe("completion_regression");
    expect(result.reason).toContain("complete to failed");
  });

  it("triggers on control regression", () => {
    const experiments = [makeExperiment({ controlRegression: true })];
    const result = shouldRollback(experiments);

    expect(result.shouldRollback).toBe(true);
    expect(result.trigger).toBe("control_regression");
    expect(result.reason).toContain("Control task regressed");
  });

  it("triggers on repeated failures (3+)", () => {
    const experiments = [makeExperiment()];
    const result = shouldRollback(experiments, 3);

    expect(result.shouldRollback).toBe(true);
    expect(result.trigger).toBe("repeated_failures");
    expect(result.reason).toContain("3 consecutive runtime failures");
  });

  it("does not trigger with fewer than 3 runtime failures", () => {
    const experiments = [makeExperiment()];
    const result = shouldRollback(experiments, 2);

    expect(result.shouldRollback).toBe(false);
    expect(result.trigger).toBeNull();
  });

  it("returns false when no experiments to evaluate", () => {
    const result = shouldRollback([]);

    expect(result.shouldRollback).toBe(false);
    expect(result.trigger).toBeNull();
    expect(result.reason).toBe("No experiments to evaluate");
  });

  it("returns false when no issues detected", () => {
    const experiments = [makeExperiment()];
    const result = shouldRollback(experiments, 0);

    expect(result.shouldRollback).toBe(false);
    expect(result.trigger).toBeNull();
    expect(result.reason).toBe("No rollback needed");
  });

  it("evaluates only the latest experiment", () => {
    const experiments = [
      // Old bad result — should be ignored
      makeExperiment({
        candidate: { pdseScore: 70, completionStatus: "failed", successRate: 0.3 },
        controlRegression: true,
      }),
      // Latest good result
      makeExperiment(),
    ];
    const result = shouldRollback(experiments, 0);

    expect(result.shouldRollback).toBe(false);
    expect(result.trigger).toBeNull();
  });

  it("prioritizes PDSE regression over other triggers", () => {
    const experiments = [
      makeExperiment({
        candidate: { pdseScore: 70, completionStatus: "failed", successRate: 0.3 },
        controlRegression: true,
      }),
    ];
    // PDSE regression is checked first
    const result = shouldRollback(experiments, 5);

    expect(result.shouldRollback).toBe(true);
    expect(result.trigger).toBe("pdse_regression");
  });
});

// ---------------------------------------------------------------------------
// PDSE boundary tests (D-12A Phase 3 — Issue 10)
// ---------------------------------------------------------------------------

describe("evaluatePromotionGate — boundary cases", () => {
  it("boundary: PDSE delta 4.9 → reject", () => {
    const experiment = makeExperiment({
      baseline: { pdseScore: 80, completionStatus: "complete", successRate: 0.8 },
      candidate: { pdseScore: 84.9, completionStatus: "complete", successRate: 0.85 },
    });
    const result = evaluatePromotionGate(experiment, 5);
    expect(result.decision).toBe("reject");
  });

  it("boundary: PDSE delta exactly 5.0 → promote (with sufficient promotion count)", () => {
    const experiment = makeExperiment({
      baseline: { pdseScore: 80, completionStatus: "complete", successRate: 0.8 },
      candidate: { pdseScore: 85, completionStatus: "complete", successRate: 0.85 },
    });
    const result = evaluatePromotionGate(experiment, 3);
    expect(result.decision).toBe("promote");
  });
});

// ---------------------------------------------------------------------------
// Custom config tests (D-12A Phase 3 — Issue 7)
// ---------------------------------------------------------------------------

describe("evaluatePromotionGate — custom config", () => {
  it("respects custom minPdseImprovement", () => {
    const experiment = makeExperiment({
      baseline: { pdseScore: 80, completionStatus: "complete", successRate: 0.8 },
      candidate: { pdseScore: 88, completionStatus: "complete", successRate: 0.85 },
    });
    // Default threshold (5) → promote; custom threshold (10) → reject
    const defaultResult = evaluatePromotionGate(experiment, 5);
    expect(defaultResult.decision).toBe("promote");

    const strictResult = evaluatePromotionGate(experiment, 5, { minPdseImprovement: 10 });
    expect(strictResult.decision).toBe("reject");
  });

  it("respects custom humanVetoThreshold", () => {
    const experiment = makeExperiment();
    // Default threshold (3) with promotionCount=2 → needs_human_review
    const defaultResult = evaluatePromotionGate(experiment, 2);
    expect(defaultResult.decision).toBe("needs_human_review");

    // Custom threshold (1) with promotionCount=2 → promote (past threshold)
    const relaxedResult = evaluatePromotionGate(experiment, 2, { humanVetoThreshold: 1 });
    expect(relaxedResult.decision).toBe("promote");
  });
});

// ---------------------------------------------------------------------------
// PDSE message uses "points" not "%" (D-12A Phase 4 — Issue 6)
// ---------------------------------------------------------------------------

describe("evaluatePromotionGate — PDSE message wording", () => {
  it("rejection reason says 'points' not '%'", () => {
    const experiment = makeExperiment({
      baseline: { pdseScore: 80, completionStatus: "complete", successRate: 0.8 },
      candidate: { pdseScore: 83, completionStatus: "complete", successRate: 0.85 },
    });
    const result = evaluatePromotionGate(experiment, 5);
    expect(result.decision).toBe("reject");
    const pdseReason = result.reasons.find((r) => r.includes("PDSE"));
    expect(pdseReason).toContain("points");
    expect(pdseReason).not.toContain("%");
  });

  it("promotion reason says 'points' not '%'", () => {
    const experiment = makeExperiment();
    const result = evaluatePromotionGate(experiment, 3);
    expect(result.decision).toBe("promote");
    const pdseReason = result.reasons.find((r) => r.includes("PDSE"));
    expect(pdseReason).toContain("points");
    expect(pdseReason).not.toContain("%");
  });
});

// ---------------------------------------------------------------------------
// Configurable rollbackPdseThreshold (D-12A Phase 5 — Issue A)
// ---------------------------------------------------------------------------

describe("shouldRollback — custom rollbackPdseThreshold", () => {
  it("respects custom rollbackPdseThreshold", () => {
    // Delta = -8 (candidate 72, baseline 80)
    const experiments = [
      makeExperiment({
        baseline: { pdseScore: 80, completionStatus: "complete", successRate: 0.8 },
        candidate: { pdseScore: 72, completionStatus: "complete", successRate: 0.7 },
      }),
    ];

    // Default threshold (-5) → -8 < -5 → rollback triggered
    const defaultResult = shouldRollback(experiments);
    expect(defaultResult.shouldRollback).toBe(true);
    expect(defaultResult.trigger).toBe("pdse_regression");

    // Custom threshold (-10) → -8 > -10 → rollback NOT triggered
    const relaxedResult = shouldRollback(experiments, 0, { rollbackPdseThreshold: -10 });
    expect(relaxedResult.shouldRollback).toBe(false);
  });
});
