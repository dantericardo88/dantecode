// =============================================================================
// Verification Bootstrapping — DSPy-inspired metric weight calibration.
// Takes labeled examples (task+output+expectedDecision) and calibrates
// PDSE weights and confidence thresholds to minimize decision errors.
// Strictly opt-in. Never mutates verifier behavior silently.
// =============================================================================

import type { PdseWeights } from "./pdse-scorer.js";
import type { ConfidenceThresholds } from "./confidence-synthesizer.js";
import { verifyOutput } from "./qa-harness.js";
import { synthesizeConfidence } from "./confidence-synthesizer.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type LabeledDecision = "pass" | "soft-pass" | "review-required" | "block";

export interface LabeledExample {
  id: string;
  task: string;
  output: string;
  expectedDecision: LabeledDecision;
  /** Optional explanation for the expected decision. */
  rationale?: string;
}

export interface CalibrationResult {
  calibratedWeights: PdseWeights;
  calibratedThresholds: ConfidenceThresholds;
  accuracy: number;       // fraction of examples where decision matched expected
  errorRate: number;      // 1 - accuracy
  exampleCount: number;
  decisionBreakdown: Record<LabeledDecision, { correct: number; total: number }>;
  iterationsRun: number;
  delta: number;          // final weight delta from last iteration
}

export interface BootstrapOptions {
  /** Max calibration iterations. Default: 10 */
  maxIterations?: number;
  /** Learning rate for weight adjustment. Default: 0.05 */
  learningRate?: number;
  /** Minimum delta to stop early. Default: 0.001 */
  convergenceDelta?: number;
  /** Starting weights. Default: DEFAULT_PDSE_WEIGHTS */
  initialWeights?: Partial<PdseWeights>;
  /** Starting thresholds. Default: DEFAULT_CONFIDENCE_THRESHOLDS */
  initialThresholds?: Partial<ConfidenceThresholds>;
}

const DEFAULT_WEIGHTS: PdseWeights = {
  faithfulness: 0.22,
  correctness: 0.28,
  hallucination: 0.18,
  completeness: 0.22,
  safety: 0.10,
};

const DEFAULT_THRESHOLDS: ConfidenceThresholds = {
  passGate: 0.85,
  softPassGate: 0.70,
  reviewGate: 0.45,
};

// ---------------------------------------------------------------------------
// Bootstrapper
// ---------------------------------------------------------------------------

export class VerificationBootstrapper {
  private examples: LabeledExample[] = [];

  /** Add a labeled example for calibration. */
  addExample(example: LabeledExample): void {
    this.examples.push({ ...example });
  }

  /** Add multiple examples. */
  addExamples(examples: LabeledExample[]): void {
    for (const ex of examples) {
      this.addExample(ex);
    }
  }

  /** Remove all examples. */
  clearExamples(): void {
    this.examples = [];
  }

  /** Return example count. */
  get exampleCount(): number {
    return this.examples.length;
  }

  /**
   * Calibrate PDSE weights and thresholds against the labeled examples.
   * Returns calibrated parameters without mutating any global state.
   */
  calibrate(options: BootstrapOptions = {}): CalibrationResult {
    const maxIterations = options.maxIterations ?? 10;
    const learningRate = options.learningRate ?? 0.05;
    const convergenceDelta = options.convergenceDelta ?? 0.001;

    let weights: PdseWeights = {
      ...DEFAULT_WEIGHTS,
      ...options.initialWeights,
    };
    let thresholds: ConfidenceThresholds = {
      ...DEFAULT_THRESHOLDS,
      ...options.initialThresholds,
    };

    if (this.examples.length === 0) {
      return this.buildResult(weights, thresholds, [], 0, 0, 0);
    }

    let lastDelta = Infinity;
    let iteration = 0;

    for (iteration = 0; iteration < maxIterations; iteration++) {
      const { errors, decisions } = this.evaluate(weights, thresholds);

      if (errors === 0) break; // perfect calibration

      // Gradient-free weight adjustment: boost weights of dimensions that
      // correlate with incorrect decisions, reduce those that don't.
      const newWeights = this.adjustWeights(weights, decisions, learningRate);
      const newThresholds = this.adjustThresholds(thresholds, decisions, learningRate);

      // Compute delta
      const deltas = Object.values(newWeights).map((v, i) =>
        Math.abs(v - Object.values(weights)[i]!),
      );
      lastDelta = Math.max(...deltas);

      weights = newWeights;
      thresholds = newThresholds;

      if (lastDelta < convergenceDelta) break;
    }

    const { errors, decisions } = this.evaluate(weights, thresholds);
    // iteration is the loop variable; cap it so iterationsRun never exceeds maxIterations
    const iterationsRun = Math.min(iteration, maxIterations);
    return this.buildResult(weights, thresholds, decisions, errors, iterationsRun, lastDelta);
  }

  // -------------------------------------------------------------------------
  // Private helpers
  // -------------------------------------------------------------------------

  private evaluate(
    _weights: PdseWeights,
    thresholds: ConfidenceThresholds,
  ): { errors: number; decisions: Array<{ expected: LabeledDecision; actual: string }> } {
    let errors = 0;
    const decisions: Array<{ expected: LabeledDecision; actual: string }> = [];

    for (const example of this.examples) {
      const report = verifyOutput({ task: example.task, output: example.output });
      const synthesis = synthesizeConfidence({
        pdseScore: report.pdseScore,
        metrics: report.metrics,
        railFindings: report.railFindings,
        critiqueTrace: report.critiqueTrace,
        thresholds,
      });
      const actual = synthesis.decision;
      decisions.push({ expected: example.expectedDecision, actual });
      if (actual !== example.expectedDecision) errors += 1;
    }

    return { errors, decisions };
  }

  private adjustWeights(
    weights: PdseWeights,
    decisions: Array<{ expected: LabeledDecision; actual: string }>,
    lr: number,
  ): PdseWeights {
    // Simple heuristic: if we're over-blocking (blocking things that should pass),
    // reduce hallucination and safety weights. If under-blocking, increase them.
    const overBlocking = decisions.filter(
      (d) => d.expected === "pass" && (d.actual === "block" || d.actual === "review-required"),
    ).length;
    const underBlocking = decisions.filter(
      (d) => d.expected === "block" && (d.actual === "pass" || d.actual === "soft-pass"),
    ).length;

    const adjust = overBlocking > underBlocking ? -lr : lr;
    return normalizeWeights({
      faithfulness: clamp(weights.faithfulness + adjust * 0.3),
      correctness: clamp(weights.correctness),
      hallucination: clamp(weights.hallucination + adjust * 0.5),
      completeness: clamp(weights.completeness),
      safety: clamp(weights.safety + adjust * 0.4),
    });
  }

  private adjustThresholds(
    thresholds: ConfidenceThresholds,
    decisions: Array<{ expected: LabeledDecision; actual: string }>,
    lr: number,
  ): ConfidenceThresholds {
    const overBlocking = decisions.filter(
      (d) => d.expected === "pass" && d.actual === "block",
    ).length;
    const underBlocking = decisions.filter(
      (d) => d.expected === "block" && d.actual === "pass",
    ).length;

    // Lower gates if over-blocking, raise if under-blocking
    const adjust = overBlocking > underBlocking ? -lr : lr;
    return {
      passGate: clamp(thresholds.passGate + adjust * 0.5),
      softPassGate: clamp(thresholds.softPassGate + adjust * 0.5),
      reviewGate: clamp(thresholds.reviewGate + adjust * 0.3),
    };
  }

  private buildResult(
    weights: PdseWeights,
    thresholds: ConfidenceThresholds,
    decisions: Array<{ expected: LabeledDecision; actual: string }>,
    errors: number,
    iterationsRun: number,
    delta: number,
  ): CalibrationResult {
    const accuracy = this.examples.length > 0 ? 1 - errors / this.examples.length : 1;
    const decisionBreakdown: Record<LabeledDecision, { correct: number; total: number }> = {
      pass: { correct: 0, total: 0 },
      "soft-pass": { correct: 0, total: 0 },
      "review-required": { correct: 0, total: 0 },
      block: { correct: 0, total: 0 },
    };
    for (const { expected, actual } of decisions) {
      const entry = decisionBreakdown[expected];
      if (entry) {
        entry.total += 1;
        if (actual === expected) entry.correct += 1;
      }
    }

    return {
      calibratedWeights: weights,
      calibratedThresholds: thresholds,
      accuracy,
      errorRate: 1 - accuracy,
      exampleCount: this.examples.length,
      decisionBreakdown,
      iterationsRun,
      delta,
    };
  }
}

// ---------------------------------------------------------------------------
// Private utils
// ---------------------------------------------------------------------------

function clamp(value: number): number {
  return Math.max(0.01, Math.min(1, value));
}

function normalizeWeights(weights: PdseWeights): PdseWeights {
  const total = Object.values(weights).reduce((sum, v) => sum + v, 0);
  if (total === 0) return weights;
  return {
    faithfulness: weights.faithfulness / total,
    correctness: weights.correctness / total,
    hallucination: weights.hallucination / total,
    completeness: weights.completeness / total,
    safety: weights.safety / total,
  };
}
