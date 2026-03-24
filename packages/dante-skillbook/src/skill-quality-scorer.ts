// ============================================================================
// @dantecode/dante-skillbook — Skill Quality Scorer
// Multi-dimensional quality scoring for skills to drive improvement flagging
// and promotion to "proven" status.
// ============================================================================

import { DimensionScorer } from "@dantecode/core";

// ────────────────────────────────────────────────────────────────────────────
// Types
// ────────────────────────────────────────────────────────────────────────────

/** A skill enriched with quality-relevant metadata for scoring. */
export interface SkillQualityInput {
  /** Unique skill identifier. */
  id: string;
  /** Fraction of code paths covered by tests (0-1). */
  testCoverage: number;
  /** Number of times this skill has been invoked. */
  usageCount: number;
  /** Fraction of invocations that succeeded (0-1). */
  successRate: number;
  /** Fraction of documentation completeness (0-1): has title, description, examples. */
  documentationCompleteness: number;
}

/** Quality score decomposed into four dimensions. */
export interface SkillQualityScore {
  /** Test coverage dimension (0-25). */
  testCoverage: number;
  /** Usage frequency dimension (0-25). */
  usageFrequency: number;
  /** Success rate dimension (0-25). */
  successRate: number;
  /** Documentation completeness dimension (0-25). */
  documentationCompleteness: number;
  /** Aggregate score (0-100). */
  total: number;
}

// ────────────────────────────────────────────────────────────────────────────
// Thresholds
// ────────────────────────────────────────────────────────────────────────────

/** Skills below this total are flagged for improvement. */
const IMPROVEMENT_THRESHOLD = 50;

/** Skills above this total are promoted to "proven" status. */
const PROMOTION_THRESHOLD = 90;

/** Usage count at which the frequency dimension saturates (100 uses). */
const MAX_USAGE_COUNT = 100;

// ────────────────────────────────────────────────────────────────────────────
// Scorer
// ────────────────────────────────────────────────────────────────────────────

/**
 * Deterministic quality scorer for skills.
 *
 * Each dimension is scored 0-25 and combined into a 0-100 aggregate:
 * - **testCoverage** (0-25): direct scale from coverage ratio.
 * - **usageFrequency** (0-25): logarithmic scale of usage count.
 * - **successRate** (0-25): direct scale from success ratio.
 * - **documentationCompleteness** (0-25): direct scale from doc ratio.
 */
export class SkillQualityScorer extends DimensionScorer<SkillQualityInput> {
  constructor() {
    super();
  }

  protected dimensionNames(): [string, string, string, string] {
    return ["testCoverage", "usageFrequency", "successRate", "documentationCompleteness"];
  }

  protected scoreDimensions(skill: SkillQualityInput): [number, number, number, number] {
    return [
      this.scoreTestCoverage(skill.testCoverage),
      this.scoreUsageFrequency(skill.usageCount),
      this.scoreSuccessRate(skill.successRate),
      this.scoreDocumentation(skill.documentationCompleteness),
    ];
  }

  /**
   * Score a skill across four dimensions.
   * Returns an aggregate 0-100 quality score.
   */
  score(skill: SkillQualityInput): SkillQualityScore {
    const [testCoverage, usageFrequency, successRate, documentationCompleteness] =
      this.scoreDimensions(skill);
    const total = testCoverage + usageFrequency + successRate + documentationCompleteness;
    return { testCoverage, usageFrequency, successRate, documentationCompleteness, total };
  }

  /** True if the skill's aggregate score is below the improvement threshold (50). */
  flagForImprovement(qualityScore: SkillQualityScore): boolean {
    return qualityScore.total < IMPROVEMENT_THRESHOLD;
  }

  /** True if the skill's aggregate score is above the promotion threshold (90). */
  promoteToProven(qualityScore: SkillQualityScore): boolean {
    return qualityScore.total > PROMOTION_THRESHOLD;
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Dimension scorers (each returns 0-25)
  // ──────────────────────────────────────────────────────────────────────────

  /** Test coverage: direct scale of coverage ratio (0-1 -> 0-25). */
  private scoreTestCoverage(coverage: number): number {
    return this.clamp25(coverage);
  }

  /** Usage frequency: logarithmic scale of usage count. */
  private scoreUsageFrequency(usageCount: number): number {
    if (usageCount <= 0) return 0;
    const capped = Math.min(usageCount, MAX_USAGE_COUNT);
    const ratio = Math.log(1 + capped) / Math.log(1 + MAX_USAGE_COUNT);
    return Math.round(ratio * 25);
  }

  /** Success rate: direct scale of success ratio (0-1 -> 0-25). */
  private scoreSuccessRate(rate: number): number {
    return this.clamp25(rate);
  }

  /** Documentation completeness: direct scale (0-1 -> 0-25). */
  private scoreDocumentation(completeness: number): number {
    return this.clamp25(completeness);
  }
}
