// ============================================================================
// packages/core/src/false-positive-suppressor.ts
//
// Dim 18 — PR review sharpness: track and suppress false-positive review
// comments so the reviewer sees only comments worth acting on.
//
// Decision-changing: `shouldSuppressComment` filters comments before display,
// reducing noise and raising the signal-to-noise ratio in practice.
// ============================================================================

import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import type { ReviewComment, ReviewCategory } from "./pr-review-orchestrator.js";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface FalsePositiveEntry {
  commentId: string;
  category: ReviewCategory;
  bodySnippet: string;   // first 80 chars of the comment body
  reason: "quick-dismiss" | "no-location" | "pattern-match" | "manual";
  suppressedAt: string;
}

export interface FalsePositiveStats {
  totalFPs: number;
  byCategory: Record<string, number>;
  suppressionRate: number;   // totalFPs / (totalFPs + passed comments)
  topNoisyCategory: string | null;
  computedAt: string;
}

// ── Pattern-based suppression rules ──────────────────────────────────────────

const NOISY_PATTERNS: RegExp[] = [
  /^add (more )?comments?\.?$/i,
  /^needs? (more )?documentation\.?$/i,
  /^consider adding (a )?comment\.?$/i,
  /^this (should|could) be (better )?documented\.?$/i,
  /^nit:?\s*$/i,
  /^minor:?\s*$/i,
  /^\s*$/,
  /^looks? (good|fine|ok)\.?$/i,
];

const STYLE_ONLY_CATEGORIES: ReviewCategory[] = ["style", "naming"];

// ── shouldSuppressComment ─────────────────────────────────────────────────────

/**
 * Returns true if this comment should be suppressed (likely a false positive).
 *
 * Suppression triggers:
 * 1. Pattern match: body matches a known noisy pattern
 * 2. No location: style/naming category with no filePath (too vague to act on)
 * 3. History: category FP rate > 60% in recent history
 */
export function shouldSuppressComment(
  comment: ReviewComment,
  fpHistory?: FalsePositiveEntry[],
): boolean {
  // Rule 1: pattern-based noisy comment
  const trimmed = comment.body.trim();
  if (NOISY_PATTERNS.some((p) => p.test(trimmed))) return true;
  if (trimmed.length < 15 && !comment.filePath) return true;

  // Rule 2: style/naming comment with no file+line reference
  if (STYLE_ONLY_CATEGORIES.includes(comment.category) && !comment.filePath) return true;

  // Rule 3: history-based — if this category has FP rate > 60%, suppress
  if (fpHistory && fpHistory.length >= 5) {
    const categoryFPs = fpHistory.filter((e) => e.category === comment.category).length;
    const categoryTotal = fpHistory.length;
    if (categoryFPs / categoryTotal > 0.6) return true;
  }

  return false;
}

// ── Pattern filter: filterSuppressedComments ──────────────────────────────────

/**
 * Filter an array of comments, removing those that should be suppressed.
 * Records each suppressed comment to the FP log.
 */
export function filterSuppressedComments(
  comments: ReviewComment[],
  fpHistory: FalsePositiveEntry[],
  projectRoot?: string,
): ReviewComment[] {
  const passed: ReviewComment[] = [];
  for (const c of comments) {
    if (shouldSuppressComment(c, fpHistory)) {
      const reason = NOISY_PATTERNS.some((p) => p.test(c.body.trim()))
        ? "pattern-match"
        : !c.filePath && STYLE_ONLY_CATEGORIES.includes(c.category)
        ? "no-location"
        : "pattern-match";
      if (projectRoot) {
        recordFalsePositive(c.id, c.category, c.body, reason, projectRoot);
      }
    } else {
      passed.push(c);
    }
  }
  return passed;
}

// ── Persistence ───────────────────────────────────────────────────────────────

const FP_FILE = ".danteforge/false-positive-log.jsonl";

export function recordFalsePositive(
  commentId: string,
  category: ReviewCategory,
  body: string,
  reason: FalsePositiveEntry["reason"],
  projectRoot: string,
): void {
  try {
    const dir = join(resolve(projectRoot), ".danteforge");
    mkdirSync(dir, { recursive: true });
    const entry: FalsePositiveEntry = {
      commentId,
      category,
      bodySnippet: body.slice(0, 80),
      reason,
      suppressedAt: new Date().toISOString(),
    };
    appendFileSync(join(dir, "false-positive-log.jsonl"), JSON.stringify(entry) + "\n", "utf-8");
  } catch { /* non-fatal */ }
}

export function loadFalsePositives(projectRoot: string): FalsePositiveEntry[] {
  const path = join(resolve(projectRoot), FP_FILE);
  if (!existsSync(path)) return [];
  try {
    return readFileSync(path, "utf-8")
      .split("\n")
      .filter(Boolean)
      .map((l) => JSON.parse(l) as FalsePositiveEntry);
  } catch {
    return [];
  }
}

// ── getFalsePositiveRate ──────────────────────────────────────────────────────

/**
 * Compute FP rate: count of suppressions by category (or overall).
 * Rate = FP entries in category / total FP entries.
 */
export function getFalsePositiveRate(
  history: FalsePositiveEntry[],
  category?: ReviewCategory,
): number {
  if (history.length === 0) return 0;
  const total = history.length;
  if (!category) return 1; // all entries ARE false positives by definition
  const inCategory = history.filter((e) => e.category === category).length;
  return Math.round((inCategory / total) * 1000) / 1000;
}

// ── getFalsePositiveStats ─────────────────────────────────────────────────────

export function getFalsePositiveStats(
  history: FalsePositiveEntry[],
  passedCommentCount = 0,
): FalsePositiveStats {
  const byCategory: Record<string, number> = {};
  for (const entry of history) {
    byCategory[entry.category] = (byCategory[entry.category] ?? 0) + 1;
  }
  const topNoisyCategory =
    Object.keys(byCategory).sort((a, b) => (byCategory[b] ?? 0) - (byCategory[a] ?? 0))[0] ?? null;
  const total = history.length + passedCommentCount;
  return {
    totalFPs: history.length,
    byCategory,
    suppressionRate: total === 0 ? 0 : Math.round((history.length / total) * 1000) / 1000,
    topNoisyCategory,
    computedAt: new Date().toISOString(),
  };
}
