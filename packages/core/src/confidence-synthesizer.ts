// =============================================================================
// Confidence Synthesizer — combines PDSE scores, rail findings, critique trace,
// and optional critic debate into a final structured decision.
// Inspired by LangGraph conditional edge patterns + DeepEval threshold logic.
// Decision: "pass" | "soft-pass" | "review-required" | "block"
// =============================================================================

import type { CriticDebateResult } from "./critic-debater.js";
import type { VerificationMetricScore } from "./pdse-scorer.js";
import type { VerificationRailFinding } from "./rails-enforcer.js";
import type { VerificationTraceStage } from "./qa-harness.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ConfidenceDecision = "pass" | "soft-pass" | "review-required" | "block";

export interface ConfidenceThresholds {
  /** Minimum PDSE score to pass outright. Default: 0.85 */
  passGate: number;
  /** Minimum PDSE score to soft-pass (pass with warnings). Default: 0.70 */
  softPassGate: number;
  /** Minimum PDSE score before requiring review. Below this → block. Default: 0.45 */
  reviewGate: number;
}

export const DEFAULT_CONFIDENCE_THRESHOLDS: ConfidenceThresholds = {
  passGate: 0.85,
  softPassGate: 0.7,
  reviewGate: 0.45,
};

export interface ConfidenceSynthesisInput {
  pdseScore: number;
  metrics: VerificationMetricScore[];
  railFindings: VerificationRailFinding[];
  critiqueTrace: VerificationTraceStage[];
  debate?: CriticDebateResult;
  thresholds?: Partial<ConfidenceThresholds>;
}

export interface ConfidenceSynthesisResult {
  decision: ConfidenceDecision;
  confidence: number;
  score: number;
  reasons: string[];
  hardBlocked: boolean;
  softWarnings: string[];
  dimensions: Record<string, number>;
}

// ---------------------------------------------------------------------------
// Synthesizer
// ---------------------------------------------------------------------------

/**
 * Combines PDSE score, rail findings, critique stages, and critic debate
 * into a structured confidence decision.
 */
export function synthesizeConfidence(input: ConfidenceSynthesisInput): ConfidenceSynthesisResult {
  const thresholds: ConfidenceThresholds = {
    ...DEFAULT_CONFIDENCE_THRESHOLDS,
    ...input.thresholds,
  };

  const reasons: string[] = [];
  const softWarnings: string[] = [];

  // Hard blocks from rails
  const hardRailFailures = input.railFindings.filter(
    (finding) => !finding.passed && finding.mode === "hard",
  );
  const softRailFailures = input.railFindings.filter(
    (finding) => !finding.passed && finding.mode === "soft",
  );

  if (hardRailFailures.length > 0) {
    for (const failure of hardRailFailures) {
      reasons.push(`Hard rail blocked: ${failure.railName} — ${failure.violations.join("; ")}`);
    }
  }

  for (const soft of softRailFailures) {
    softWarnings.push(`Soft rail warning: ${soft.railName} — ${soft.violations.join("; ")}`);
  }

  // Failed critique stages
  const failedStages = input.critiqueTrace.filter((stage) => !stage.passed);
  for (const stage of failedStages) {
    reasons.push(`Stage failed: ${stage.stage} — ${stage.summary}`);
  }

  // Weak metric dimensions
  const weakMetrics = input.metrics.filter((metric) => !metric.passed);
  for (const metric of weakMetrics) {
    reasons.push(
      `Metric below threshold: ${metric.name} (${metric.score.toFixed(2)}) — ${metric.reason}`,
    );
  }

  // Critic debate signals
  let debateSignal: ConfidenceDecision | null = null;
  if (input.debate) {
    if (input.debate.consensus === "fail") {
      debateSignal = "block";
      reasons.push(
        `Critic consensus: fail — ${input.debate.blockingFindings.slice(0, 2).join("; ")}`,
      );
    } else if (input.debate.consensus === "warn") {
      debateSignal = "review-required";
      softWarnings.push(
        `Critic consensus: warn (confidence ${input.debate.averageConfidence.toFixed(2)})`,
      );
    }
  }

  // Synthesize final decision
  const hardBlocked =
    hardRailFailures.length > 0 ||
    debateSignal === "block" ||
    input.pdseScore < thresholds.reviewGate;

  let decision: ConfidenceDecision;
  if (hardBlocked) {
    decision = "block";
  } else if (
    debateSignal === "review-required" ||
    softRailFailures.length > 0 ||
    failedStages.length > 0
  ) {
    decision = "review-required";
  } else if (input.pdseScore >= thresholds.passGate) {
    decision = "pass";
  } else if (input.pdseScore >= thresholds.softPassGate) {
    decision = "soft-pass";
  } else {
    decision = "review-required";
  }

  // Confidence score: how certain are we in the decision
  const confidence = computeConfidence(input.pdseScore, hardBlocked, input.debate);

  // Dimension map from metrics
  const dimensions: Record<string, number> = {};
  for (const metric of input.metrics) {
    dimensions[metric.name] = metric.score;
  }

  return {
    decision,
    confidence,
    score: input.pdseScore,
    reasons,
    hardBlocked,
    softWarnings,
    dimensions,
  };
}

// ---------------------------------------------------------------------------
// Private helpers
// ---------------------------------------------------------------------------

function computeConfidence(
  pdseScore: number,
  hardBlocked: boolean,
  debate?: CriticDebateResult,
): number {
  if (hardBlocked) {
    // High confidence in the block decision
    return Math.min(0.95, 0.6 + (1 - pdseScore) * 0.5);
  }

  let base = pdseScore;

  // Debate convergence boosts confidence
  if (debate) {
    if (debate.consensus === "pass") {
      base = clamp(base + debate.averageConfidence * 0.1);
    } else if (debate.consensus === "warn") {
      base = clamp(base - 0.1);
    }
  }

  return clamp(base);
}

function clamp(value: number): number {
  return Math.max(0, Math.min(1, value));
}
