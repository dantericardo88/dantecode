// =============================================================================
// Verification Tuning — metric-driven tuner that tracks verifier outcomes
// and user feedback to surface threshold and weight adjustment suggestions.
// Strictly advisory: never auto-applies changes without explicit call.
// Inspired by DSPy optimizer pattern: optimize against explicit metrics.
// =============================================================================

import type { ConfidenceDecision, ConfidenceThresholds } from "./confidence-synthesizer.js";
import type { PdseWeights } from "./pdse-scorer.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type TuningFeedback =
  | "confirmed_correct"
  | "false_positive"
  | "false_negative"
  | "review_helpful";

export interface VerifierOutcome {
  id: string;
  task: string;
  decision: ConfidenceDecision;
  pdseScore: number;
  feedback?: TuningFeedback;
  recordedAt: string;
}

export interface TuningSuggestion {
  dimension: "passGate" | "softPassGate" | "reviewGate" | keyof PdseWeights;
  direction: "increase" | "decrease";
  magnitude: number; // 0–1, suggested adjustment amount
  confidence: number; // how confident is the suggestion (0–1)
  reason: string;
}

export interface TuningReport {
  outcomeCount: number;
  falsePositiveRate: number;
  falseNegativeRate: number;
  confirmedCorrectRate: number;
  suggestions: TuningSuggestion[];
  summary: string;
}

// ---------------------------------------------------------------------------
// Tuner
// ---------------------------------------------------------------------------

export class VerificationTuner {
  private readonly outcomes: VerifierOutcome[] = [];
  /** Maximum outcomes retained in memory. */
  private readonly maxOutcomes: number;

  constructor(maxOutcomes = 500) {
    this.maxOutcomes = maxOutcomes;
  }

  /**
   * Track a verifier outcome.
   * Returns the stored outcome id.
   */
  track(outcome: Omit<VerifierOutcome, "recordedAt">): string {
    if (this.outcomes.length >= this.maxOutcomes) {
      this.outcomes.shift(); // LRU eviction
    }
    const entry: VerifierOutcome = {
      ...outcome,
      recordedAt: new Date().toISOString(),
    };
    this.outcomes.push(entry);
    return entry.id;
  }

  /**
   * Apply user feedback to an existing outcome.
   */
  applyFeedback(id: string, feedback: TuningFeedback): boolean {
    const outcome = this.outcomes.find((o) => o.id === id);
    if (!outcome) return false;
    outcome.feedback = feedback;
    return true;
  }

  /** Return all outcomes (copy). */
  getOutcomes(): VerifierOutcome[] {
    return [...this.outcomes];
  }

  /** Count of tracked outcomes. */
  get outcomeCount(): number {
    return this.outcomes.length;
  }

  /**
   * Analyze outcomes and produce tuning suggestions.
   * Does NOT apply suggestions automatically.
   */
  suggestTuning(): TuningReport {
    const feedbacked = this.outcomes.filter((o) => o.feedback !== undefined);
    const total = feedbacked.length;

    if (total === 0) {
      return {
        outcomeCount: this.outcomes.length,
        falsePositiveRate: 0,
        falseNegativeRate: 0,
        confirmedCorrectRate: 0,
        suggestions: [],
        summary: "No feedback yet. Provide feedback to enable tuning suggestions.",
      };
    }

    const fps = feedbacked.filter((o) => o.feedback === "false_positive").length;
    const fns = feedbacked.filter((o) => o.feedback === "false_negative").length;
    const correct = feedbacked.filter((o) => o.feedback === "confirmed_correct").length;

    const fpRate = fps / total;
    const fnRate = fns / total;
    const correctRate = correct / total;

    const suggestions: TuningSuggestion[] = [];

    // If too many false positives (blocking things that were actually fine):
    // lower the gates
    if (fpRate > 0.15) {
      suggestions.push({
        dimension: "passGate",
        direction: "decrease",
        magnitude: Math.min(fpRate * 0.3, 0.1),
        confidence: Math.min(fpRate * 2, 0.9),
        reason: `${(fpRate * 100).toFixed(0)}% false-positive rate suggests passGate may be too strict.`,
      });
      suggestions.push({
        dimension: "hallucination",
        direction: "decrease",
        magnitude: Math.min(fpRate * 0.2, 0.05),
        confidence: Math.min(fpRate * 1.5, 0.7),
        reason: "Reducing hallucination weight may reduce false positives.",
      });
    }

    // If too many false negatives (passing things that were actually bad):
    // raise the gates
    if (fnRate > 0.15) {
      suggestions.push({
        dimension: "reviewGate",
        direction: "increase",
        magnitude: Math.min(fnRate * 0.3, 0.1),
        confidence: Math.min(fnRate * 2, 0.9),
        reason: `${(fnRate * 100).toFixed(0)}% false-negative rate suggests gates are too permissive.`,
      });
      suggestions.push({
        dimension: "faithfulness",
        direction: "increase",
        magnitude: Math.min(fnRate * 0.2, 0.05),
        confidence: Math.min(fnRate * 1.5, 0.7),
        reason: "Increasing faithfulness weight may catch more bad outputs.",
      });
    }

    // Review-helpful feedback suggests review-required is working well but
    // passGate might be slightly too aggressive
    const reviewHelpful = feedbacked.filter((o) => o.feedback === "review_helpful").length;
    if (reviewHelpful > 0 && reviewHelpful / total > 0.3) {
      suggestions.push({
        dimension: "passGate",
        direction: "increase",
        magnitude: 0.03,
        confidence: 0.5,
        reason: "Many outputs benefited from review — consider raising passGate slightly.",
      });
    }

    const summary = buildSummary(fpRate, fnRate, correctRate, suggestions.length);

    return {
      outcomeCount: this.outcomes.length,
      falsePositiveRate: fpRate,
      falseNegativeRate: fnRate,
      confirmedCorrectRate: correctRate,
      suggestions,
      summary,
    };
  }

  /**
   * Apply a suggestion to existing thresholds/weights (returns new values — does not mutate input).
   */
  applySuggestion(
    suggestion: TuningSuggestion,
    current: ConfidenceThresholds & Partial<PdseWeights>,
  ): ConfidenceThresholds & Partial<PdseWeights> {
    const result = { ...current };
    const key = suggestion.dimension as keyof typeof result;
    const existing = result[key];
    if (typeof existing === "number") {
      const delta =
        suggestion.direction === "increase" ? suggestion.magnitude : -suggestion.magnitude;
      (result as Record<string, number>)[key] = clamp(existing + delta);
    }
    return result;
  }

  clear(): void {
    this.outcomes.length = 0;
  }
}

// ---------------------------------------------------------------------------
// Private helpers
// ---------------------------------------------------------------------------

function clamp(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function buildSummary(fp: number, fn: number, correct: number, suggCount: number): string {
  const parts = [
    `FP rate: ${(fp * 100).toFixed(0)}%`,
    `FN rate: ${(fn * 100).toFixed(0)}%`,
    `Correct: ${(correct * 100).toFixed(0)}%`,
  ];
  if (suggCount > 0) parts.push(`${suggCount} tuning suggestion(s)`);
  return parts.join(" | ");
}

/** Global singleton tuner. */
export const globalVerificationTuner = new VerificationTuner();
