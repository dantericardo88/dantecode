// ============================================================================
// packages/core/src/review-defect-correlator.ts
//
// Dim 18 — PR review sharpness: join review precision to post-merge defect
// discovery. Proves that higher-precision reviews escape fewer bugs.
//
// Decision-changing: when the correlation is significant (delta > 0.5 bugs
// escaped), the system injects a [Review Quality Warning] at the next review
// session to force deeper analysis.
// ============================================================================

import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface ReviewDefectOutcome {
  reviewId: string;
  reviewPrecision: number;      // 0-1 from benchmarkReviewQuality (f1 or precision)
  bugsFoundPostMerge: number;   // defects filed after this PR merged
  prTitle?: string;
  recordedAt: string;
}

export interface ReviewDefectCorrelation {
  highPrecisionBugRate: number;   // mean bugs/PR when precision > 0.7
  lowPrecisionBugRate: number;    // mean bugs/PR when precision <= 0.7
  delta: number;                  // lowPrecisionBugRate - highPrecisionBugRate
  isSignificant: boolean;         // delta > 0.5
  highPrecisionSampleCount: number;
  lowPrecisionSampleCount: number;
  computedAt: string;
}

// ── Persistence ───────────────────────────────────────────────────────────────

const OUTCOMES_FILE = ".danteforge/review-defect-correlation.jsonl";

export function recordReviewDefectOutcome(
  reviewId: string,
  reviewPrecision: number,
  bugsFoundPostMerge: number,
  projectRoot: string,
  prTitle?: string,
): void {
  try {
    const dir = join(resolve(projectRoot), ".danteforge");
    mkdirSync(dir, { recursive: true });
    const entry: ReviewDefectOutcome = {
      reviewId,
      reviewPrecision,
      bugsFoundPostMerge,
      prTitle,
      recordedAt: new Date().toISOString(),
    };
    appendFileSync(join(dir, "review-defect-correlation.jsonl"), JSON.stringify(entry) + "\n", "utf-8");
  } catch { /* non-fatal */ }
}

export function loadReviewDefectOutcomes(projectRoot: string): ReviewDefectOutcome[] {
  const path = join(resolve(projectRoot), OUTCOMES_FILE);
  if (!existsSync(path)) return [];
  try {
    return readFileSync(path, "utf-8")
      .split("\n")
      .filter(Boolean)
      .map((l) => JSON.parse(l) as ReviewDefectOutcome);
  } catch {
    return [];
  }
}

// ── computeReviewDefectCorrelation ────────────────────────────────────────────

/**
 * Split outcomes into high-precision (>0.7) and low-precision (<=0.7) groups.
 * Compute mean post-merge bugs per group.
 * isSignificant when low-precision reviews escape >0.5 more bugs on average.
 */
export function computeReviewDefectCorrelation(
  outcomes: ReviewDefectOutcome[],
  precisionThreshold = 0.7,
): ReviewDefectCorrelation {
  const high = outcomes.filter((o) => o.reviewPrecision > precisionThreshold);
  const low = outcomes.filter((o) => o.reviewPrecision <= precisionThreshold);

  const meanBugs = (arr: ReviewDefectOutcome[]) =>
    arr.length === 0 ? 0 : arr.reduce((s, o) => s + o.bugsFoundPostMerge, 0) / arr.length;

  const highPrecisionBugRate = Math.round(meanBugs(high) * 1000) / 1000;
  const lowPrecisionBugRate = Math.round(meanBugs(low) * 1000) / 1000;
  const delta = Math.round((lowPrecisionBugRate - highPrecisionBugRate) * 1000) / 1000;

  return {
    highPrecisionBugRate,
    lowPrecisionBugRate,
    delta,
    isSignificant: delta > 0.5,
    highPrecisionSampleCount: high.length,
    lowPrecisionSampleCount: low.length,
    computedAt: new Date().toISOString(),
  };
}

/** Read outcomes from disk and compute correlation. */
export function getReviewDefectCorrelation(projectRoot: string): ReviewDefectCorrelation {
  return computeReviewDefectCorrelation(loadReviewDefectOutcomes(projectRoot));
}

/** Format correlation for session injection — triggers deeper review when significant. */
export function formatDefectCorrelationWarning(corr: ReviewDefectCorrelation): string | null {
  if (!corr.isSignificant) return null;
  return `[Review Quality Warning] Low-precision reviews in this project escaped ${corr.lowPrecisionBugRate.toFixed(1)} bugs/PR vs ${corr.highPrecisionBugRate.toFixed(1)} for high-precision reviews (delta: ${corr.delta.toFixed(1)}). Prioritize blocking issues and security paths.`;
}
