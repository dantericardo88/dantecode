// ============================================================================
// packages/core/src/review-severity-ranker.ts
//
// Dim 18 — PR review sharpness: rank review comments by severity so the author
// knows exactly which blocking issues to fix first.
//
// Decision-changing: comment ordering changes which issues get fixed first;
// severity histogram tells reviewers whether depth is sufficient.
// ============================================================================

import type { ReviewComment, ReviewCommentType, ReviewCategory, ChangeRisk } from "./pr-review-orchestrator.js";

// ── Severity scoring weights ──────────────────────────────────────────────────

const TYPE_BASE_SCORE: Record<ReviewCommentType, number> = {
  blocking: 10,
  suggestion: 5,
  question: 3,
  nitpick: 2,
  info: 1,
  praise: 0,
};

const CATEGORY_MULTIPLIER: Record<ReviewCategory, number> = {
  security: 1.5,
  "breaking-change": 1.4,
  logic: 1.2,
  "error-handling": 1.2,
  performance: 1.1,
  tests: 1.1,
  types: 1.0,
  docs: 0.9,
  naming: 0.8,
  style: 0.7,
};

const RISK_BONUS: Record<ChangeRisk, number> = {
  critical: 3,
  high: 2,
  medium: 1,
  low: 0,
  trivial: -1,
};

// ── Types ─────────────────────────────────────────────────────────────────────

export interface RankedReviewComment extends ReviewComment {
  severityRank: number;      // raw score: higher = more urgent
  severityLabel: "critical" | "high" | "medium" | "low" | "noise";
}

export interface SeverityHistogram {
  critical: number;   // blocking + (security | breaking-change)
  high: number;       // blocking (other) | suggestion + security
  medium: number;     // suggestion (non-security)
  low: number;        // nitpick, question
  noise: number;      // praise, info
}

export interface SeverityRankingReport {
  rankedComments: RankedReviewComment[];
  histogram: SeverityHistogram;
  topBlockers: RankedReviewComment[];  // top 3 critical/high
  reviewSharpnessScore: number;        // 0-1: critical+high / total (higher = sharper review)
  computedAt: string;
}

// ── Severity label ────────────────────────────────────────────────────────────

function computeSeverityLabel(
  comment: ReviewComment,
  rank: number,
): RankedReviewComment["severityLabel"] {
  if (comment.type === "praise" || comment.type === "info") return "noise";
  if (comment.type === "nitpick" || comment.type === "question") return "low";
  if (
    comment.type === "blocking" &&
    (comment.category === "security" || comment.category === "breaking-change")
  ) return "critical";
  if (comment.type === "blocking") return rank >= 12 ? "critical" : "high";
  if (comment.category === "security") return "high";
  return rank >= 7 ? "medium" : "low";
}

// ── rankReviewComments ────────────────────────────────────────────────────────

/**
 * Rank review comments by severity. Returns comments sorted from most to least urgent.
 * Optional fileRisk allows boosting comments on high-risk files.
 */
export function rankReviewComments(
  comments: ReviewComment[],
  fileRiskMap?: Record<string, ChangeRisk>,
): RankedReviewComment[] {
  const ranked: RankedReviewComment[] = comments.map((c) => {
    const base = TYPE_BASE_SCORE[c.type] ?? 0;
    const catMult = CATEGORY_MULTIPLIER[c.category] ?? 1.0;
    const fileRisk = c.filePath ? (fileRiskMap?.[c.filePath] ?? "low") : "low";
    const riskBonus = RISK_BONUS[fileRisk as ChangeRisk] ?? 0;
    const hasLocation = c.filePath && c.line ? 2 : 0;

    const severityRank = base * catMult + riskBonus + hasLocation;
    const severityLabel = computeSeverityLabel(c, severityRank);
    return { ...c, severityRank, severityLabel };
  });

  return ranked.sort((a, b) => b.severityRank - a.severityRank);
}

// ── getSeverityHistogram ──────────────────────────────────────────────────────

export function getSeverityHistogram(
  rankedComments: RankedReviewComment[],
): SeverityHistogram {
  return {
    critical: rankedComments.filter((c) => c.severityLabel === "critical").length,
    high: rankedComments.filter((c) => c.severityLabel === "high").length,
    medium: rankedComments.filter((c) => c.severityLabel === "medium").length,
    low: rankedComments.filter((c) => c.severityLabel === "low").length,
    noise: rankedComments.filter((c) => c.severityLabel === "noise").length,
  };
}

// ── getTopPriorityComments ────────────────────────────────────────────────────

export function getTopPriorityComments(
  rankedComments: RankedReviewComment[],
  limit = 5,
): RankedReviewComment[] {
  return rankedComments.slice(0, limit);
}

// ── buildSeverityRankingReport ────────────────────────────────────────────────

export function buildSeverityRankingReport(
  comments: ReviewComment[],
  fileRiskMap?: Record<string, ChangeRisk>,
): SeverityRankingReport {
  const rankedComments = rankReviewComments(comments, fileRiskMap);
  const histogram = getSeverityHistogram(rankedComments);
  const topBlockers = rankedComments
    .filter((c) => c.severityLabel === "critical" || c.severityLabel === "high")
    .slice(0, 3);

  const total = rankedComments.length;
  const reviewSharpnessScore =
    total === 0 ? 0 : Math.round(((histogram.critical + histogram.high) / total) * 100) / 100;

  return {
    rankedComments,
    histogram,
    topBlockers,
    reviewSharpnessScore,
    computedAt: new Date().toISOString(),
  };
}

/** Format severity ranking for prompt injection (top issues only). */
export function formatSeverityRankingForPrompt(report: SeverityRankingReport): string {
  const lines: string[] = [
    `[Review Severity Ranking — sharpness: ${report.reviewSharpnessScore.toFixed(2)}]`,
    `  Critical: ${report.histogram.critical}  High: ${report.histogram.high}  Medium: ${report.histogram.medium}  Low: ${report.histogram.low}  Noise: ${report.histogram.noise}`,
  ];
  if (report.topBlockers.length > 0) {
    lines.push("Top issues to fix first:");
    for (const c of report.topBlockers) {
      const loc = c.filePath ? ` (${c.filePath}${c.line ? `:${c.line}` : ""})` : "";
      lines.push(`  [${c.severityLabel.toUpperCase()}] ${c.category}${loc}: ${c.body.slice(0, 80)}`);
    }
  }
  return lines.join("\n");
}
