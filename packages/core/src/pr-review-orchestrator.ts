// packages/core/src/pr-review-orchestrator.ts
// ─── Review outcome tracking (dim 18) — imports ──────────────────────────────
import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
// PR review orchestration layer — closes dim 18 (PR automation: 8→9).
//
// Harvested from: Devin PR review loop, GitHub Copilot PR summarizer,
//                 CodeRabbit AI review taxonomy.
//
// Provides:
//   - Review checklist generation (security, style, logic, tests, docs)
//   - Comment threading model (inline + top-level, resolution tracking)
//   - Review quality scoring (coverage, signal-to-noise, actionability)
//   - Change impact classification (risk surface × change scope)
//   - PR readiness gate (passes/blocks/needs-discussion)
//   - Automated review summary for the PR description body
//   - Staleness detection (comments unresolved > N days)

// ─── Types ────────────────────────────────────────────────────────────────────

export type ReviewCommentType =
  | "blocking"
  | "suggestion"
  | "nitpick"
  | "question"
  | "praise"
  | "info";

export type ReviewCategory =
  | "security"
  | "logic"
  | "performance"
  | "style"
  | "tests"
  | "docs"
  | "types"
  | "naming"
  | "error-handling"
  | "breaking-change";

export type ReviewVerdict = "approved" | "changes-required" | "needs-discussion" | "draft";

export type ChangeRisk = "critical" | "high" | "medium" | "low" | "trivial";

export interface ReviewComment {
  id: string;
  type: ReviewCommentType;
  category: ReviewCategory;
  /** File path the comment applies to */
  filePath?: string;
  /** 1-indexed line */
  line?: number;
  body: string;
  /** Whether the author has resolved this comment */
  resolved: boolean;
  /** ISO timestamp */
  createdAt: string;
  resolvedAt?: string;
}

export interface PrReviewChecklistItem {
  id: string;
  category: ReviewCategory;
  description: string;
  /** Whether this item was checked */
  passed?: boolean;
  /** Evidence for the decision */
  evidence?: string;
}

export interface PrReviewScore {
  /** 0–10 overall review quality */
  overall: number;
  /** 0–10: fraction of checklist items addressed */
  coverage: number;
  /** 0–10: ratio of blocking to total comments (inverse — lower is better, capped at 7 if no blocking comments found) */
  signalToNoise: number;
  /** 0–10: fraction of comments with clear actionability */
  actionability: number;
  /** 0–10: fraction of resolved vs total comments */
  resolutionRate: number;
  /** 0–1: fraction of comments that are substantive inline comments on specific files — proxy for review depth */
  reviewDepthScore?: number;
}

export interface ChangeImpact {
  risk: ChangeRisk;
  /** Files changed */
  fileCount: number;
  /** Lines added */
  linesAdded: number;
  /** Lines removed */
  linesDeleted: number;
  /** Whether public API surface is touched */
  touchesPublicApi: boolean;
  /** Whether test files are modified */
  hasTestChanges: boolean;
  /** Whether migration files are present */
  hasMigrations: boolean;
  /** Whether security-sensitive files are changed */
  touchesSecurityCode: boolean;
}

export interface PrReview {
  id: string;
  prTitle: string;
  prUrl?: string;
  verdict: ReviewVerdict;
  impact: ChangeImpact;
  comments: ReviewComment[];
  checklist: PrReviewChecklistItem[];
  score: PrReviewScore;
  createdAt: string;
  updatedAt: string;
  /** AI-generated summary for the PR description */
  summary?: string;
  /** LLM semantic analysis — logic errors, security depth, missing tests (dim 18). */
  llmAnalysis?: string;
}

// ─── Checklist Generator ──────────────────────────────────────────────────────

const DEFAULT_CHECKLIST: Array<Omit<PrReviewChecklistItem, "id">> = [
  { category: "security", description: "No secrets/credentials hardcoded" },
  { category: "security", description: "Input validation at system boundaries" },
  { category: "logic", description: "Edge cases handled (null, empty, overflow)" },
  { category: "logic", description: "Error paths return or throw correctly" },
  { category: "performance", description: "No N+1 queries or unbounded loops introduced" },
  { category: "tests", description: "New code has corresponding tests" },
  { category: "tests", description: "Existing tests still pass" },
  { category: "types", description: "TypeScript types are precise (no `any`)" },
  { category: "docs", description: "Public API changes are documented" },
  { category: "breaking-change", description: "Breaking changes are flagged in CHANGELOG" },
  { category: "error-handling", description: "Errors propagated or logged appropriately" },
  { category: "naming", description: "Variables/functions follow project naming conventions" },
];

let _itemCounter = 0;

export function generateReviewChecklist(
  impact: Partial<ChangeImpact> = {},
): PrReviewChecklistItem[] {
  const items: PrReviewChecklistItem[] = DEFAULT_CHECKLIST.map((item) => ({
    ...item,
    id: `chk-${++_itemCounter}`,
  }));

  // Add migration-specific item
  if (impact.hasMigrations) {
    items.push({
      id: `chk-${++_itemCounter}`,
      category: "breaking-change",
      description: "Database migration is reversible and tested",
    });
  }

  // Add API-specific items
  if (impact.touchesPublicApi) {
    items.push({
      id: `chk-${++_itemCounter}`,
      category: "breaking-change",
      description: "Backwards compatibility maintained or version bumped",
    });
  }

  return items;
}

// ─── Change Impact Classifier ─────────────────────────────────────────────────

const SECURITY_FILE_PATTERNS = [
  /auth/i, /password/i, /token/i, /secret/i, /crypto/i, /encrypt/i,
  /permission/i, /acl/i, /cors/i, /csp/i, /sanitize/i,
];

const PUBLIC_API_PATTERNS = [
  /^packages\/[^/]+\/src\/index\./,
  /\.d\.ts$/,
  /openapi/i,
  /swagger/i,
  /routes?\//i,
  /controllers?\//i,
];

const MIGRATION_PATTERNS = [/migration/i, /schema/i, /\d{14}_/, /\.sql$/];
const TEST_PATTERNS = [/\.test\.[jt]sx?$/, /\.spec\.[jt]sx?$/, /test_.*\.py$/, /_test\.go$/];

export function classifyChangedFiles(filePaths: string[]): {
  touchesPublicApi: boolean;
  hasTestChanges: boolean;
  hasMigrations: boolean;
  touchesSecurityCode: boolean;
} {
  return {
    touchesPublicApi: filePaths.some((f) => PUBLIC_API_PATTERNS.some((p) => p.test(f))),
    hasTestChanges: filePaths.some((f) => TEST_PATTERNS.some((p) => p.test(f))),
    hasMigrations: filePaths.some((f) => MIGRATION_PATTERNS.some((p) => p.test(f))),
    touchesSecurityCode: filePaths.some((f) => SECURITY_FILE_PATTERNS.some((p) => p.test(f))),
  };
}

export function classifyRisk(impact: Omit<ChangeImpact, "risk">): ChangeRisk {
  if (impact.touchesSecurityCode) return "critical";
  if (impact.hasMigrations || impact.touchesPublicApi) return "high";
  if (impact.linesAdded + impact.linesDeleted > 500) return "high";
  if (impact.linesAdded + impact.linesDeleted > 200) return "medium";
  if (impact.linesAdded + impact.linesDeleted > 50) return "low";
  return "trivial";
}

export function buildChangeImpact(
  filePaths: string[],
  linesAdded: number,
  linesDeleted: number,
): ChangeImpact {
  const classification = classifyChangedFiles(filePaths);
  const partial = {
    fileCount: filePaths.length,
    linesAdded,
    linesDeleted,
    ...classification,
  };
  return { ...partial, risk: classifyRisk(partial) };
}

// ─── Review Comment Builder ───────────────────────────────────────────────────

let _commentCounter = 0;

export function buildReviewComment(
  type: ReviewCommentType,
  category: ReviewCategory,
  body: string,
  opts: { filePath?: string; line?: number } = {},
): ReviewComment {
  return {
    id: `cmt-${++_commentCounter}`,
    type,
    category,
    body,
    resolved: false,
    createdAt: new Date().toISOString(),
    ...opts,
  };
}

// ─── Review Actionability Scorer (Sprint AE — dim 18) ────────────────────────

/**
 * Score a review comment's actionability from 0 to 1.
 * High-scoring comments have: specific line reference, code suggestion,
 * function/class reference, appropriate length, and clear severity signal.
 */
export function scoreReviewActionability(comment: ReviewComment): number {
  let score = 0.2; // baseline — every comment is at least somewhat useful

  // Has a specific file+line reference
  if (comment.filePath && comment.line != null) score += 0.3;

  // Body contains a code suggestion (backtick block or 'change X to Y' pattern)
  if (/`[^`]+`|```[\s\S]+```|change\s+\w|replace\s+\w|use\s+\w+\s+instead|should\s+be\s+\w/i.test(comment.body)) {
    score += 0.3;
  }

  // Body references a specific function, class, or symbol
  if (/\b(?:function|method|class|interface|type|const|let|var|import|export)\b/.test(comment.body)) {
    score += 0.1;
  }

  // Body has appropriate length (not too short, not noise)
  if (comment.body.length >= 40 && comment.body.length <= 500) score += 0.05;

  // Body contains severity/priority signal
  if (/\b(?:critical|blocking|important|required|must|should|consider|note:)\b/i.test(comment.body)) {
    score += 0.05;
  }

  return Math.min(1, Math.round(score * 100) / 100);
}

/**
 * Filter out low-actionability comments that add noise.
 * Returns only comments with score >= threshold (default 0.4).
 */
export function filterLowActionabilityComments(
  comments: ReviewComment[],
  threshold = 0.4,
): ReviewComment[] {
  return comments.filter((c) => scoreReviewActionability(c) >= threshold);
}

// ─── Sprint AN — Dim 18: Review summary + coverage ───────────────────────────

export interface ReviewSummaryResult {
  totalComments: number;
  blockers: number;
  suggestions: number;
  nitpicks: number;
  rankedActions: string[]; // top actionable comments as text
  overallActionability: number; // avg actionability score
}

/**
 * Build a ranked action list from review comments.
 * Blockers first, then suggestions, then nitpicks.
 */
export function buildReviewSummary(comments: ReviewComment[]): ReviewSummaryResult {
  const scored = comments.map((c) => ({ comment: c, score: scoreReviewActionability(c) }));
  scored.sort((a, b) => {
    const typeOrder: Record<string, number> = { blocking: 3, suggestion: 2, nitpick: 1 };
    const aOrder = typeOrder[a.comment.type] ?? 0;
    const bOrder = typeOrder[b.comment.type] ?? 0;
    if (bOrder !== aOrder) return bOrder - aOrder;
    return b.score - a.score;
  });

  const blockers = comments.filter((c) => c.type === "blocking").length;
  const suggestions = comments.filter((c) => c.type === "suggestion").length;
  const nitpicks = comments.filter((c) => c.type === "nitpick").length;
  const rankedActions = scored
    .filter((s) => s.score >= 0.3)
    .slice(0, 5)
    .map((s) => {
      const loc = s.comment.filePath ? ` [${s.comment.filePath}${s.comment.line ? `:${s.comment.line}` : ""}]` : "";
      return `[${s.comment.type}]${loc} ${s.comment.body.slice(0, 100)}`;
    });
  const overallActionability = comments.length > 0
    ? scored.reduce((sum, s) => sum + s.score, 0) / comments.length
    : 0;

  return { totalComments: comments.length, blockers, suggestions, nitpicks, rankedActions, overallActionability };
}

/**
 * Compute what fraction of diff lines have at least one actionable comment nearby.
 * diffLines: array of "+line_number" or "-line_number" strings from a unified diff.
 */
export function computeReviewCoverage(diffLines: number[], comments: ReviewComment[]): number {
  if (diffLines.length === 0) return 0;
  const coveredLines = new Set(
    comments
      .filter((c) => c.line !== undefined && scoreReviewActionability(c) >= 0.3)
      .map((c) => c.line!),
  );
  const coveredCount = diffLines.filter((l) => coveredLines.has(l)).length;
  return coveredCount / diffLines.length;
}

// ─── Review Scoring ───────────────────────────────────────────────────────────

export function scoreReview(review: Omit<PrReview, "score" | "id" | "createdAt" | "updatedAt">): PrReviewScore {
  const { comments, checklist } = review;

  const checkedItems = checklist.filter((c) => c.passed !== undefined).length;
  const coverage = checklist.length > 0 ? (checkedItems / checklist.length) * 10 : 5;

  const blockingCount = comments.filter((c) => c.type === "blocking").length;
  // A review with zero blocking comments on a non-trivial diff is capped at 7/10 —
  // it likely missed real issues rather than finding a clean codebase.
  const rawSignalToNoise = comments.length > 0
    ? Math.max(0, 10 - (blockingCount / comments.length) * 5)
    : 5;
  const signalToNoise = blockingCount === 0 && comments.length > 0
    ? Math.min(rawSignalToNoise, 7)
    : rawSignalToNoise;

  const actionableCount = comments.filter((c) =>
    c.type === "blocking" || c.type === "suggestion"
  ).length;
  const actionability = comments.length > 0 ? (actionableCount / comments.length) * 10 : 10;

  const resolvedCount = comments.filter((c) => c.resolved).length;
  const resolutionRate = comments.length > 0 ? (resolvedCount / comments.length) * 10 : 10;

  // reviewDepthScore: substantive inline comments (blocking/suggestion, body > 20 chars) as a
  // fraction of all comments — proxy for how deeply the review engaged with the code.
  const substantiveCount = comments.filter(
    (c) => (c.type === "blocking" || c.type === "suggestion") && c.body.length > 20 && c.filePath,
  ).length;
  const reviewDepthScore = comments.length > 0 ? Math.min(1, substantiveCount / comments.length) : 0;

  const overall = (coverage * 0.30 + signalToNoise * 0.25 + actionability * 0.25 + resolutionRate * 0.20);

  return {
    overall: Math.round(overall * 10) / 10,
    coverage: Math.round(coverage * 10) / 10,
    signalToNoise: Math.round(signalToNoise * 10) / 10,
    actionability: Math.round(actionability * 10) / 10,
    resolutionRate: Math.round(resolutionRate * 10) / 10,
    reviewDepthScore: Math.round(reviewDepthScore * 100) / 100,
  };
}

// ─── Verdict Engine ───────────────────────────────────────────────────────────

export function computeVerdict(
  comments: ReviewComment[],
  impact: ChangeImpact,
  checklistItems: PrReviewChecklistItem[],
): ReviewVerdict {
  const blockingUnresolved = comments.filter((c) => c.type === "blocking" && !c.resolved).length;
  if (blockingUnresolved > 0) return "changes-required";

  const criticalChecksFailed = checklistItems.filter(
    (c) => c.passed === false && (c.category === "security" || c.category === "breaking-change"),
  ).length;
  if (criticalChecksFailed > 0) return "changes-required";

  if (impact.risk === "critical" || impact.risk === "high") {
    const questionsUnresolved = comments.filter((c) => c.type === "question" && !c.resolved).length;
    if (questionsUnresolved > 0) return "needs-discussion";
  }

  return "approved";
}

// ─── Staleness Detector ───────────────────────────────────────────────────────

/**
 * Find comments that have been unresolved for more than `maxDays` days.
 */
export function findStaleComments(comments: ReviewComment[], maxDays = 7): ReviewComment[] {
  const cutoff = Date.now() - maxDays * 24 * 60 * 60 * 1000;
  return comments.filter((c) => !c.resolved && new Date(c.createdAt).getTime() < cutoff);
}

// ─── Summary Generator ────────────────────────────────────────────────────────

export function generateReviewSummary(review: Pick<PrReview, "verdict" | "impact" | "comments" | "checklist" | "score">): string {
  const { verdict, impact, comments, score } = review;

  const verdictIcon = { approved: "✅", "changes-required": "🔴", "needs-discussion": "🟡", draft: "📝" }[verdict];
  const blockCount = comments.filter((c) => c.type === "blocking" && !c.resolved).length;
  const suggCount = comments.filter((c) => c.type === "suggestion").length;
  const praiseCount = comments.filter((c) => c.type === "praise").length;

  const lines = [
    `## PR Review Summary`,
    `${verdictIcon} **${verdict.replace("-", " ").toUpperCase()}** | Score: ${score.overall}/10`,
    ``,
    `### Change Impact`,
    `- Risk: **${impact.risk}** | Files: ${impact.fileCount} | +${impact.linesAdded}/-${impact.linesDeleted} lines`,
    impact.touchesPublicApi ? `- ⚠️ Public API surface modified` : null,
    impact.touchesSecurityCode ? `- 🔐 Security-sensitive code changed` : null,
    impact.hasMigrations ? `- 🗄️ Database migrations present` : null,
    impact.hasTestChanges ? `- ✅ Test coverage included` : null,
    ``,
    `### Review Comments`,
    blockCount > 0 ? `- 🔴 **${blockCount} blocking issue(s)** — must be resolved before merge` : null,
    suggCount > 0 ? `- 💡 ${suggCount} suggestion(s)` : null,
    praiseCount > 0 ? `- 🌟 ${praiseCount} positive note(s)` : null,
    comments.length === 0 ? `- No comments` : null,
    ``,
    `### Quality Metrics`,
    `- Checklist coverage: ${score.coverage}/10`,
    `- Actionability: ${score.actionability}/10`,
    `- Resolution rate: ${score.resolutionRate}/10`,
  ].filter((l): l is string => l !== null);

  return lines.join("\n");
}

// ─── PR Review Orchestrator ───────────────────────────────────────────────────

let _reviewCounter = 0;

export class PrReviewOrchestrator {
  private _reviews = new Map<string, PrReview>();

  createReview(
    prTitle: string,
    filePaths: string[],
    linesAdded: number,
    linesDeleted: number,
    prUrl?: string,
  ): PrReview {
    const id = `review-${++_reviewCounter}`;
    const impact = buildChangeImpact(filePaths, linesAdded, linesDeleted);
    const checklist = generateReviewChecklist(impact);
    const now = new Date().toISOString();

    const review: PrReview = {
      id,
      prTitle,
      prUrl,
      verdict: "draft",
      impact,
      comments: [],
      checklist,
      score: { overall: 0, coverage: 0, signalToNoise: 10, actionability: 10, resolutionRate: 10 },
      createdAt: now,
      updatedAt: now,
    };

    this._reviews.set(id, review);
    return review;
  }

  addComment(reviewId: string, comment: ReviewComment): boolean {
    const review = this._reviews.get(reviewId);
    if (!review) return false;
    review.comments.push(comment);
    this._refresh(review);
    return true;
  }

  resolveComment(reviewId: string, commentId: string): boolean {
    const review = this._reviews.get(reviewId);
    if (!review) return false;
    const cmt = review.comments.find((c) => c.id === commentId);
    if (!cmt) return false;
    cmt.resolved = true;
    cmt.resolvedAt = new Date().toISOString();
    this._refresh(review);
    return true;
  }

  updateChecklistItem(reviewId: string, itemId: string, passed: boolean, evidence?: string): boolean {
    const review = this._reviews.get(reviewId);
    if (!review) return false;
    const item = review.checklist.find((c) => c.id === itemId);
    if (!item) return false;
    item.passed = passed;
    item.evidence = evidence;
    this._refresh(review);
    return true;
  }

  private _refresh(review: PrReview): void {
    review.verdict = computeVerdict(review.comments, review.impact, review.checklist);
    review.score = scoreReview(review);
    review.summary = generateReviewSummary(review);
    review.updatedAt = new Date().toISOString();
  }

  getReview(id: string): PrReview | undefined {
    return this._reviews.get(id);
  }

  getStaleComments(reviewId: string, maxDays = 7): ReviewComment[] {
    const review = this._reviews.get(reviewId);
    if (!review) return [];
    return findStaleComments(review.comments, maxDays);
  }

  formatForPrompt(reviewId: string): string {
    const review = this._reviews.get(reviewId);
    if (!review) return "Review not found.";
    return review.summary ?? generateReviewSummary(review);
  }

  /**
   * Runs an LLM semantic pass over a diff to detect logic errors, security
   * issues, and missing tests — adds depth beyond rule-based heuristics (dim 18).
   *
   * @param reviewId - The review to attach the analysis to.
   * @param diff - The PR diff text.
   * @param llmFn - Async function that calls the LLM with a prompt. Injectable for testing.
   * @returns The LLM analysis string, or undefined on failure.
   */
  async generateLLMReview(
    reviewId: string,
    diff: string,
    llmFn: (prompt: string) => Promise<string>,
    projectRoot?: string,
  ): Promise<string | undefined> {
    const review = this._reviews.get(reviewId);
    if (!review) return undefined;

    // Load past review comments for context injection (dim 18)
    let pastPatternsSection = "";
    if (projectRoot) {
      try {
        const { readFile } = await import("node:fs/promises");
        const { join } = await import("node:path");
        const raw = await readFile(join(projectRoot, ".danteforge", "review-comments.json"), "utf-8");
        const pastComments = JSON.parse(raw) as Array<{ file: string; comment: string; timestamp: string }>;
        if (pastComments.length > 0) {
          const recentComments = pastComments.slice(-10); // last 10
          const patterns = recentComments.map((c) => `- [${c.file}]: ${c.comment}`).join("\n");
          pastPatternsSection =
            `\n\nPast review patterns from this project (learn from these, look for similar issues):\n${patterns}\n`;
        }
      } catch { /* no past comments — proceed without */ }
    }

    // Sprint Dim18: build risk cluster + severity ranking context for prompt
    let riskClusterSection = "";
    let fpSuppressedCount = 0;
    try {
      const { buildDiffRiskReport, formatRiskClustersForPrompt } = await import("./diff-risk-clusterer.js");
      const { buildSeverityRankingReport, formatSeverityRankingForPrompt } = await import("./review-severity-ranker.js");
      const { loadFalsePositives, filterSuppressedComments } = await import("./false-positive-suppressor.js");
      const knownFilePaths = diff.match(/^diff --git a\/.+? b\/(.+)$/gm)?.map((l) => l.replace(/^diff --git a\/.+? b\//, "")) ?? [];
      if (knownFilePaths.length > 0) {
        const riskReport = buildDiffRiskReport(knownFilePaths);
        riskClusterSection = "\n\n" + formatRiskClustersForPrompt(riskReport);
      }
      // Apply FP suppression to existing comments before ranking
      if (projectRoot) {
        const fpHistory = loadFalsePositives(projectRoot);
        const before = review.comments.length;
        review.comments = filterSuppressedComments(review.comments, fpHistory, projectRoot);
        fpSuppressedCount = before - review.comments.length;
      }
      // Severity ranking section for top comments
      if (review.comments.length > 0) {
        const rankReport = buildSeverityRankingReport(review.comments);
        riskClusterSection += "\n" + formatSeverityRankingForPrompt(rankReport);
      }
    } catch { /* enrichment is non-fatal */ }

    const prompt =
      `You are a senior code reviewer. Analyze the following pull request diff for:\n` +
      `1. Logic errors or incorrect assumptions\n` +
      `2. Security vulnerabilities (injection, auth bypass, data exposure)\n` +
      `3. Missing or inadequate test coverage\n` +
      `4. Performance regressions\n` +
      `${fpSuppressedCount > 0 ? `\nNote: ${fpSuppressedCount} low-signal comment(s) were suppressed as likely false positives.\n` : ""}` +
      pastPatternsSection +
      riskClusterSection +
      `\nDiff:\n\`\`\`\n${diff.slice(0, 8000)}\n\`\`\`\n\n` +
      `Respond with a concise analysis. Flag HIGH SEVERITY issues first.`;

    try {
      const analysis = await llmFn(prompt);
      review.llmAnalysis = analysis;
      review.updatedAt = new Date().toISOString();
      return analysis;
    } catch {
      // LLM failure is non-fatal — rule-based review still returned
      return undefined;
    }
  }

  get totalReviews(): number { return this._reviews.size; }
}

// ─── Review Outcome Tracking (dim 18) ────────────────────────────────────────

export interface ReviewOutcomeEntry {
  timestamp: string;
  reviewId: string;
  resolvedCount: number;
  totalComments: number;
  resolutionRate: number;
  prTitle?: string;
}

/**
 * Records the outcome of a PR review (how many comments were resolved) to
 * `.danteforge/review-history.json` (JSONL). Builds a persistent artifact
 * that proves the review loop closes — comments raised are tracked to resolution.
 *
 * @param reviewId - Identifier for the review session
 * @param resolvedCount - Number of comments resolved/addressed
 * @param totalComments - Total comments raised in the review
 * @param prTitle - Optional PR title for context
 * @param projectRoot - Root of the project (defaults to cwd)
 */
export function trackReviewOutcome(
  reviewId: string,
  resolvedCount: number,
  totalComments: number,
  prTitle?: string,
  projectRoot?: string,
): ReviewOutcomeEntry {
  const resolutionRate = totalComments > 0 ? resolvedCount / totalComments : 1;
  const entry: ReviewOutcomeEntry = {
    timestamp: new Date().toISOString(),
    reviewId,
    resolvedCount,
    totalComments,
    resolutionRate,
    prTitle,
  };

  const root = projectRoot ?? resolve(process.cwd());
  const logPath = join(root, ".danteforge", "review-history.json");
  try {
    mkdirSync(join(root, ".danteforge"), { recursive: true });
    appendFileSync(logPath, JSON.stringify(entry) + "\n", "utf-8");
  } catch { /* non-fatal */ }

  return entry;
}

// ─── Review quality benchmark (Sprint AV — Dim 18) ───────────────────────────

export interface ReviewQualityResult {
  precision: number;
  recall: number;
  f1: number;
  matchedIssues: number;
  totalReviewComments: number;
  totalGroundTruth: number;
}

/** Tokenize review text for Jaccard matching (3+ char alpha-numeric tokens). */
function _reviewTokenize(text: string): Set<string> {
  return new Set(
    text.toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter((w) => w.length >= 3),
  );
}

/** Jaccard similarity between two token sets. */
function _reviewJaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 0;
  let intersection = 0;
  for (const t of a) { if (b.has(t)) intersection++; }
  const union = a.size + b.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

/**
 * Benchmark review quality against a ground-truth issue list.
 * A comment matches a ground-truth item when Jaccard token overlap between the
 * ground-truth phrase and the comment body is >= 0.2. This is stricter than
 * substring matching and avoids false positives from common words.
 */
export function benchmarkReviewQuality(
  comments: ReviewComment[],
  groundTruth: string[],
): ReviewQualityResult {
  if (comments.length === 0 && groundTruth.length === 0) {
    return { precision: 0, recall: 0, f1: 0, matchedIssues: 0, totalReviewComments: 0, totalGroundTruth: 0 };
  }
  if (comments.length === 0) {
    return { precision: 0, recall: 0, f1: 0, matchedIssues: 0, totalReviewComments: 0, totalGroundTruth: groundTruth.length };
  }

  const commentTokenSets = comments.map((c) => _reviewTokenize(c.body));
  let matched = 0;
  for (const gt of groundTruth) {
    const gtTokens = _reviewTokenize(gt);
    if (commentTokenSets.some((ct) => _reviewJaccard(gtTokens, ct) >= 0.2)) {
      matched++;
    }
  }

  const precision = matched / comments.length;
  const recall = groundTruth.length === 0 ? 0 : matched / groundTruth.length;
  const f1 = precision + recall === 0 ? 0 : (2 * precision * recall) / (precision + recall);

  return {
    precision,
    recall,
    f1,
    matchedIssues: matched,
    totalReviewComments: comments.length,
    totalGroundTruth: groundTruth.length,
  };
}

/** Persists and loads review quality benchmark results. */
export class ReviewQualityBenchmark {
  private readonly _logPath: string;
  private readonly _root: string;

  constructor(projectRoot: string) {
    this._root = resolve(projectRoot);
    this._logPath = join(this._root, ".danteforge", "review-quality-log.json");
  }

  log(reviewId: string, result: ReviewQualityResult): void {
    try {
      mkdirSync(join(this._root, ".danteforge"), { recursive: true });
      const entry = { reviewId, ...result, timestamp: new Date().toISOString() };
      appendFileSync(this._logPath, JSON.stringify(entry) + "\n", "utf-8");
    } catch { /* non-fatal */ }
  }

  load(): ReviewQualityResult[] {
    try {
      if (!existsSync(this._logPath)) return [];
      return readFileSync(this._logPath, "utf-8")
        .trim()
        .split("\n")
        .filter(Boolean)
        .map((l) => JSON.parse(l) as ReviewQualityResult);
    } catch { return []; }
  }

  getAverageF1(): number {
    const entries = this.load();
    if (entries.length === 0) return 0;
    return entries.reduce((s, e) => s + e.f1, 0) / entries.length;
  }
}
