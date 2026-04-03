// ============================================================================
// @dantecode/skill-adapter — Conditional Gate Logic
// Evaluates PDSE score thresholds and verification results to decide
// whether a skill chain should proceed, retry, or stop.
// ============================================================================

// ----------------------------------------------------------------------------
// Types
// ----------------------------------------------------------------------------

export interface GateEvaluation {
  passed: boolean;
  reason: string;
  suggestedAction?: "retry" | "stop" | "skip";
}

export interface GateCondition {
  minPdse?: number;
  requireVerification?: boolean;
  onFail?: "stop" | "retry" | "skip";
  maxRetries?: number;
}

// ----------------------------------------------------------------------------
// Gate Evaluation
// ----------------------------------------------------------------------------

/**
 * Evaluates gate conditions against a PDSE score and verification status.
 *
 * @param score      - The PDSE score (0–100), or undefined if unavailable.
 * @param verified   - Whether the skill passed verification.
 * @param condition  - The gate condition to evaluate.
 * @param retryCount - Number of retries already attempted.
 * @returns GateEvaluation with pass/fail status, reason, and suggested action.
 */
export function evaluateGate(
  score: number | undefined,
  verified: boolean,
  condition: GateCondition,
  retryCount: number,
): GateEvaluation {
  // Check PDSE score threshold
  if (condition.minPdse !== undefined && score !== undefined && score < condition.minPdse) {
    return {
      passed: false,
      reason: `PDSE score ${score} below minimum ${condition.minPdse}`,
      suggestedAction: selectOnFail(condition, retryCount),
    };
  }

  // Check verification requirement
  if (condition.requireVerification && !verified) {
    return {
      passed: false,
      reason: "Verification required but not passed",
      suggestedAction: selectOnFail(condition, retryCount),
    };
  }

  // All conditions met
  return {
    passed: true,
    reason: "Gate conditions met",
  };
}

// ----------------------------------------------------------------------------
// Threshold Check
// ----------------------------------------------------------------------------

/**
 * Returns true if the score meets or exceeds the threshold.
 */
export function scorePassesThreshold(score: number, threshold: number): boolean {
  return score >= threshold;
}

// ----------------------------------------------------------------------------
// onFail Action Selection
// ----------------------------------------------------------------------------

/**
 * Determines the suggested action based on the condition's onFail setting
 * and the number of retries already attempted.
 */
export function selectOnFail(
  condition: GateCondition,
  retryCount: number,
): "retry" | "stop" | "skip" {
  const { onFail, maxRetries = 1 } = condition;

  if (onFail === "retry" && retryCount < maxRetries) {
    return "retry";
  }

  if (onFail === "skip") {
    return "skip";
  }

  return "stop";
}
