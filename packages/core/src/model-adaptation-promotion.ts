// ============================================================================
// Model Adaptation — Promotion Gate + Rollback (D-12A Phase 5)
//
// Evaluates whether an experiment result should be promoted to production,
// enforces human veto for the first N promotions per quirk family, and
// provides rollback detection + override generation.
// ============================================================================

import type {
  ExperimentResult,
  CandidateOverride,
  RollbackTrigger,
  PromotionGateResult,
  AdaptationConfig,
} from "./model-adaptation-types.js";
import { generateId, DEFAULT_ADAPTATION_CONFIG } from "./model-adaptation-types.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

// Constants kept as documentation; actual values come from AdaptationConfig.
// const MIN_PDSE_IMPROVEMENT = 5;
// const HUMAN_VETO_THRESHOLD = 3;

// ---------------------------------------------------------------------------
// Promotion gate
// ---------------------------------------------------------------------------

/**
 * Evaluate whether an experiment result warrants promotion.
 *
 * Checks (in order):
 *  1. Smoke test must pass
 *  2. No control regression
 *  3. PDSE improvement >= MIN_PDSE_IMPROVEMENT
 *  4. Completion status must not regress
 *  5. First HUMAN_VETO_THRESHOLD promotions per quirk family require human approval
 *
 * @param experiment          The experiment result to evaluate
 * @param promotionCountForFamily  Number of prior promotions for this quirk family
 */
export function evaluatePromotionGate(
  experiment: ExperimentResult,
  promotionCountForFamily: number,
  config?: Partial<AdaptationConfig>,
): PromotionGateResult {
  const minPdseImprovement =
    config?.minPdseImprovement ?? DEFAULT_ADAPTATION_CONFIG.minPdseImprovement;
  const humanVetoThreshold =
    config?.humanVetoThreshold ?? DEFAULT_ADAPTATION_CONFIG.humanVetoThreshold;

  const reasons: string[] = [];
  let canPromote = true;

  // 1. Smoke must pass
  if (!experiment.smokePassed) {
    reasons.push("Smoke test failed");
    canPromote = false;
  }

  // 2. No control regression
  if (experiment.controlRegression) {
    reasons.push("Control task regressed");
    canPromote = false;
  }

  // 3. PDSE improvement >= threshold
  const pdseDelta = (experiment.candidate.pdseScore ?? 0) - (experiment.baseline.pdseScore ?? 0);

  if (pdseDelta < minPdseImprovement) {
    reasons.push(
      `PDSE improvement ${pdseDelta.toFixed(1)} points is below ${minPdseImprovement}-point threshold`,
    );
    canPromote = false;
  } else {
    reasons.push(`PDSE improved by ${pdseDelta.toFixed(1)} points`);
  }

  // 4. Completion must not regress
  if (
    experiment.baseline.completionStatus === "complete" &&
    experiment.candidate.completionStatus !== "complete"
  ) {
    reasons.push("Completion status regressed from complete");
    canPromote = false;
  }

  // 5. Human veto for first N promotions per quirk family
  const requiresHumanApproval = promotionCountForFamily < humanVetoThreshold;

  if (requiresHumanApproval && canPromote) {
    reasons.push(
      `Promotion ${promotionCountForFamily + 1}/${humanVetoThreshold} — requires human approval`,
    );
  }

  // Final decision
  let decision: PromotionGateResult["decision"];
  if (!canPromote) {
    decision = "reject";
  } else if (requiresHumanApproval) {
    decision = "needs_human_review";
  } else {
    decision = "promote";
  }

  return { decision, reasons, requiresHumanApproval };
}

// ---------------------------------------------------------------------------
// Rollback override generation
// ---------------------------------------------------------------------------

/**
 * Create a rolled-back copy of an override.
 *
 * Returns a new CandidateOverride with:
 *  - Fresh id (rb_ prefix)
 *  - Status set to "rolled_back"
 *  - Version bumped by 1
 *  - rollbackOfVersion pointing to the current version
 *  - rejectedAt timestamp
 *
 * The `trigger` parameter is accepted for caller context but not stored
 * on the override itself (it belongs in the audit trail).
 */
export function createRollbackOverride(
  current: CandidateOverride,
  _trigger: RollbackTrigger,
): CandidateOverride {
  return {
    ...current,
    id: generateId("rb"),
    status: "rolled_back",
    version: current.version + 1,
    rollbackOfVersion: current.version,
    rejectedAt: new Date().toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Rollback detection
// ---------------------------------------------------------------------------

/**
 * Check whether an override should be rolled back based on recent
 * experiment results and/or runtime failure counts.
 *
 * Triggers:
 *  - pdse_regression:       latest PDSE delta < -5
 *  - completion_regression: baseline complete but candidate failed
 *  - control_regression:    control task regressed
 *  - repeated_failures:     3+ consecutive runtime failures
 */
export function shouldRollback(
  experiments: ExperimentResult[],
  runtimeFailureCount: number = 0,
  config?: Partial<AdaptationConfig>,
): {
  shouldRollback: boolean;
  trigger: RollbackTrigger | null;
  reason: string;
} {
  if (experiments.length === 0) {
    return {
      shouldRollback: false,
      trigger: null,
      reason: "No experiments to evaluate",
    };
  }

  const latest = experiments[experiments.length - 1]!;

  // PDSE regression — candidate dropped below rollback threshold
  const rollbackThreshold =
    config?.rollbackPdseThreshold ?? DEFAULT_ADAPTATION_CONFIG.rollbackPdseThreshold;
  const pdseDelta = (latest.candidate.pdseScore ?? 0) - (latest.baseline.pdseScore ?? 0);
  if (pdseDelta < rollbackThreshold) {
    return {
      shouldRollback: true,
      trigger: "pdse_regression",
      reason: `PDSE regressed by ${Math.abs(pdseDelta).toFixed(1)} points`,
    };
  }

  // Completion regression — baseline complete, candidate failed
  if (
    latest.baseline.completionStatus === "complete" &&
    latest.candidate.completionStatus === "failed"
  ) {
    return {
      shouldRollback: true,
      trigger: "completion_regression",
      reason: "Completion regressed from complete to failed",
    };
  }

  // Control regression — environmental integrity compromised
  if (latest.controlRegression) {
    return {
      shouldRollback: true,
      trigger: "control_regression",
      reason: "Control task regressed",
    };
  }

  // Repeated runtime failures
  if (runtimeFailureCount >= 3) {
    return {
      shouldRollback: true,
      trigger: "repeated_failures",
      reason: `${runtimeFailureCount} consecutive runtime failures`,
    };
  }

  return {
    shouldRollback: false,
    trigger: null,
    reason: "No rollback needed",
  };
}
