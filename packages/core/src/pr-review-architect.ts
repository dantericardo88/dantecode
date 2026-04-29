// ============================================================================
// Sprint BC — Dim 18: Two-pass Architect PR Review
// Harvested from Aider's architect_coder.py:
//   Pass 1 (Architect): LLM identifies issues as structured text
//   Pass 2 (Editor): Convert architect output to ReviewComment[]
// ============================================================================

import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import type { ReviewComment, ReviewCategory } from "./pr-review-orchestrator.js";

const LOG_FILE = ".danteforge/architect-review-log.json";

export type ArchitectIssueSeverity = "critical" | "major" | "minor";

export interface ArchitectReviewIssue {
  severity: ArchitectIssueSeverity;
  /** "filename.ts:line" or just "filename.ts" if no specific line */
  location: string;
  category: ReviewCategory;
  description: string;
  suggestedFix?: string;
}

export interface ArchitectReviewPlan {
  issues: ArchitectReviewIssue[];
  rawPlanText: string;
  filesReviewed: string[];
  issueCount: number;
  timestamp: string;
}

// ─── ArchitectReviewResult ────────────────────────────────────────────────────

/**
 * Enriched result from a two-pass architect review.
 * Includes the original plan plus computed depth metrics (Sprint BH — dim 18).
 */
export interface ArchitectReviewResult {
  plan: ArchitectReviewPlan;

  /**
   * Ratio of changed files that received a substantive inline comment (body > 20 chars).
   * Range: [0, 1]. 1.0 = every changed file had at least one substantive comment.
   */
  fileCoverageRate: number;

  /**
   * Number of blocking comments (severity=critical → type=blocking) in this review.
   */
  softBlockingComments: number;

  /**
   * Composite depth score combining coverage and blocking-comment penalty.
   *
   * Formula: fileCoverageRate * (1 - Math.max(0, softBlockingComments / 10))
   *
   * Interpretation:
   *   1.0 = full coverage with no blocking comments (ideal)
   *   0.0 = no coverage or 10+ blocking comments (low-value review)
   *
   * A blocking comment penalty is applied because reviews with many blockers
   * tend to reflect high-churn / unreviewed code where depth is uncertain.
   */
  reviewDepthScore: number;
}

// ─── computeReviewDepthScore ─────────────────────────────────────────────────

/**
 * Compute the `reviewDepthScore` for a review result.
 *
 * @param comments  All ReviewComment[] produced by architectToReviewComments().
 * @param totalChangedFiles  Total number of files in the PR diff (denominator for coverage).
 * @returns ArchitectReviewResult (without `plan` — caller must attach it).
 */
export function computeReviewDepth(
  comments: ReviewComment[],
  totalChangedFiles: number,
): Omit<ArchitectReviewResult, "plan"> {
  // Count distinct files that have at least one substantive comment (body > 20 chars)
  const filesWithSubstantiveComment = new Set<string>();
  let softBlockingComments = 0;

  for (const comment of comments) {
    if (comment.type === "blocking") {
      softBlockingComments++;
    }
    // Substantive = filePath defined AND body length > 20 chars
    if (comment.filePath && comment.body.length > 20) {
      filesWithSubstantiveComment.add(comment.filePath);
    }
  }

  const denominator = Math.max(1, totalChangedFiles);
  const fileCoverageRate = Math.min(1, filesWithSubstantiveComment.size / denominator);

  // Penalty: each 10 blocking comments reduces score by 100% (floor at 0)
  const blockingPenaltyFactor = Math.max(0, 1 - softBlockingComments / 10);
  const reviewDepthScore = fileCoverageRate * blockingPenaltyFactor;

  return {
    fileCoverageRate,
    softBlockingComments,
    reviewDepthScore,
  };
}

/**
 * Build a complete ArchitectReviewResult from a plan and the total changed file count.
 *
 * Converts the plan's issues to ReviewComment[] internally, then computes depth metrics.
 */
export function buildArchitectReviewResult(
  plan: ArchitectReviewPlan,
  totalChangedFiles: number,
): ArchitectReviewResult {
  const comments = architectToReviewComments(plan);
  const depth = computeReviewDepth(comments, totalChangedFiles);
  return { plan, ...depth };
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

const VALID_SEVERITIES = new Set<ArchitectIssueSeverity>(["critical", "major", "minor"]);
const VALID_CATEGORIES = new Set<ReviewCategory>([
  "security", "logic", "performance", "style", "tests", "docs",
  "types", "naming", "error-handling", "breaking-change",
]);

function normalizeSeverity(raw: string): ArchitectIssueSeverity | null {
  const v = raw.trim().toLowerCase();
  if (VALID_SEVERITIES.has(v as ArchitectIssueSeverity)) return v as ArchitectIssueSeverity;
  return null;
}

function normalizeCategory(raw: string): ReviewCategory {
  const v = raw.trim().toLowerCase() as ReviewCategory;
  if (VALID_CATEGORIES.has(v)) return v;
  // fuzzy fallbacks
  if (v.includes("security") || v.includes("auth") || v.includes("sql")) return "security";
  if (v.includes("perf") || v.includes("speed")) return "performance";
  if (v.includes("test")) return "tests";
  if (v.includes("doc")) return "docs";
  if (v.includes("type")) return "types";
  if (v.includes("error") || v.includes("exception")) return "error-handling";
  if (v.includes("break")) return "breaking-change";
  if (v.includes("name") || v.includes("naming")) return "naming";
  if (v.includes("style") || v.includes("format")) return "style";
  return "logic";
}

// ─── parseArchitectIssues ─────────────────────────────────────────────────────

/**
 * Parses architect output text into structured issues.
 *
 * Supports two formats:
 *
 * Format A (structured ISSUE: block):
 *   ISSUE: severity=critical location=src/auth.ts:45 category=security
 *     description: SQL injection via unescaped user input
 *     fix: Use parameterized queries
 *
 * Format B (markdown list):
 *   - **critical** (security, auth.ts:45): description text
 */
/** Parse one ISSUE: block — header `key=value` pairs + body lines.
 *  Returns null if the block is missing required fields. */
function parseFormatABlock(headerLine: string, body: string): ArchitectReviewIssue | null {
  const severityM = /severity=(\S+)/i.exec(headerLine);
  const locationM = /location=(\S+)/i.exec(headerLine);
  if (!severityM || !locationM) return null;

  const severity = normalizeSeverity(severityM[1] ?? "");
  if (!severity) return null;

  const location = (locationM[1] ?? "").replace(/^"|"$/g, "");
  const categoryRaw = /category=(\S+)/i.exec(headerLine)?.[1] ?? "";
  const category = categoryRaw ? normalizeCategory(categoryRaw) : "logic";

  const descGroup = /description:\s*(.+)/i.exec(body)?.[1];
  const bodyFirstLine = body.trim().split("\n")[0] ?? "";
  const description = descGroup != null ? descGroup.trim() : bodyFirstLine.trim();
  if (!description) return null;

  const issue: ArchitectReviewIssue = { severity, location, category, description };
  const fixGroup = /fix:\s*(.+)/i.exec(body)?.[1];
  if (fixGroup != null) issue.suggestedFix = fixGroup.trim();
  return issue;
}

/** Parse `(security, auth.ts:45)` style category+location parenthetical. */
function parseCategoryAndLocationParen(parenContent: string): { category: ReviewCategory; location: string } {
  let category: ReviewCategory = "logic";
  let location = "unknown";
  for (const part of parenContent.split(",").map((s) => s.trim())) {
    if (/\.|:/.test(part) && !VALID_CATEGORIES.has(part as ReviewCategory)) {
      location = part;
    } else {
      const cat = normalizeCategory(part);
      if (VALID_CATEGORIES.has(cat)) category = cat;
    }
  }
  return { category, location };
}

function parseFormatBLine(line: string): ArchitectReviewIssue | null {
  const lineRe = /^[-*]\s+\*{0,2}(critical|major|minor)\*{0,2}\s*\(([^)]+)\)\s*:\s*(.+)$/im;
  const m = lineRe.exec(line.trim());
  if (!m) return null;
  const severity = normalizeSeverity(m[1] ?? "");
  if (!severity) return null;
  const description = (m[3] ?? "").trim();
  if (!description) return null;
  const { category, location } = parseCategoryAndLocationParen((m[2] ?? "").trim());
  return { severity, location, category, description };
}

export function parseArchitectIssues(architectOutput: string): ArchitectReviewIssue[] {
  const issues: ArchitectReviewIssue[] = [];

  const blockRe = /ISSUE:\s*([^\n]+)\n([\s\S]*?)(?=\nISSUE:|\n?$)/g;
  let match: RegExpExecArray | null;
  while ((match = blockRe.exec(architectOutput)) !== null) {
    const issue = parseFormatABlock((match[1] ?? "").trim(), match[2] ?? "");
    if (issue) issues.push(issue);
  }
  if (issues.length > 0) return issues;

  for (const line of architectOutput.split("\n")) {
    const issue = parseFormatBLine(line);
    if (issue) issues.push(issue);
  }
  return issues;
}

// ─── architectToReviewComments ───────────────────────────────────────────────

/**
 * Convert ArchitectReviewIssue[] → ReviewComment[].
 *
 * severity mapping:
 *   critical → blocking
 *   major    → suggestion
 *   minor    → nitpick
 */
export function architectToReviewComments(plan: ArchitectReviewPlan): ReviewComment[] {
  return plan.issues.map((issue, idx) => {
    const type =
      issue.severity === "critical" ? "blocking" :
      issue.severity === "major" ? "suggestion" :
      "nitpick";

    // Split location into filePath and optional line
    const colonIdx = issue.location.lastIndexOf(":");
    let filePath: string | undefined;
    let line: number | undefined;

    if (colonIdx > 0) {
      const afterColon = issue.location.slice(colonIdx + 1);
      const lineNum = parseInt(afterColon, 10);
      if (!isNaN(lineNum) && lineNum > 0) {
        filePath = issue.location.slice(0, colonIdx);
        line = lineNum;
      } else {
        filePath = issue.location;
      }
    } else if (issue.location && issue.location !== "unknown") {
      filePath = issue.location;
    }

    const body = issue.suggestedFix
      ? `${issue.description}\n\nSuggested fix: ${issue.suggestedFix}`
      : issue.description;

    const comment: ReviewComment = {
      id: `architect-${Date.now()}-${idx}`,
      type,
      category: issue.category,
      body,
      resolved: false,
      createdAt: new Date().toISOString(),
    };
    if (filePath) comment.filePath = filePath;
    if (line !== undefined) comment.line = line;

    return comment;
  });
}

// ─── Prompt builders ──────────────────────────────────────────────────────────

/**
 * Build the architect system prompt for the first pass.
 */
export function buildArchitectReviewPrompt(diffSummary: string, changedFiles: string[]): string {
  const fileList = changedFiles.length > 0 ? changedFiles.join(", ") : "(no files listed)";
  return (
    `You are a senior code reviewer. Analyze this diff for bugs, security issues, and design problems.\n` +
    `Files changed: ${fileList}\n\n` +
    `Diff summary:\n${diffSummary}\n\n` +
    `For each issue found, output:\n` +
    `ISSUE: severity=[critical|major|minor] location=[file:line] category=[security|logic|performance|style|tests|docs|types|error-handling|breaking-change]\n` +
    `  description: [what is wrong]\n` +
    `  fix: [how to fix it]\n\n` +
    `Focus on real bugs and security issues. Be specific about line numbers when possible.`
  );
}

/**
 * Build the editor prompt for the second pass — takes the architect's plan and structures it.
 */
export function buildEditorReviewPrompt(architectOutput: string, diffSummary: string): string {
  return (
    `Convert these code review findings into structured comments:\n` +
    `${architectOutput}\n\n` +
    `Diff context:\n${diffSummary}\n\n` +
    `Output each as: COMMENT: type=[blocking|suggestion|nitpick] file=[path] line=[n] body=[description with fix]`
  );
}

// ─── Persistence ──────────────────────────────────────────────────────────────

/**
 * Record architect review plan to .danteforge/architect-review-log.json (JSONL).
 */
export function recordArchitectReviewPlan(plan: ArchitectReviewPlan, projectRoot?: string): void {
  try {
    const root = resolve(projectRoot ?? process.cwd());
    const dir = join(root, ".danteforge");
    mkdirSync(dir, { recursive: true });
    appendFileSync(
      join(dir, "architect-review-log.json"),
      JSON.stringify(plan) + "\n",
      "utf-8",
    );
  } catch { /* non-fatal */ }
}

export function loadArchitectReviewLog(projectRoot?: string): ArchitectReviewPlan[] {
  try {
    const root = resolve(projectRoot ?? process.cwd());
    const path = join(root, LOG_FILE);
    if (!existsSync(path)) return [];
    return readFileSync(path, "utf-8")
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((l) => JSON.parse(l) as ArchitectReviewPlan);
  } catch { return []; }
}

// ─── Stats ────────────────────────────────────────────────────────────────────

export interface ArchitectReviewStats {
  totalReviews: number;
  avgIssueCount: number;
  criticalRate: number;
  topCategory: string;
}

export function getArchitectReviewStats(plans: ArchitectReviewPlan[]): ArchitectReviewStats {
  if (plans.length === 0) {
    return { totalReviews: 0, avgIssueCount: 0, criticalRate: 0, topCategory: "" };
  }

  const totalReviews = plans.length;
  const avgIssueCount = plans.reduce((s, p) => s + p.issueCount, 0) / totalReviews;

  // Flatten all issues for stats
  const allIssues = plans.flatMap((p) => p.issues);
  const criticalCount = allIssues.filter((i) => i.severity === "critical").length;
  const criticalRate = allIssues.length > 0 ? criticalCount / allIssues.length : 0;

  // Find most common category
  const catCounts = new Map<string, number>();
  for (const issue of allIssues) {
    catCounts.set(issue.category, (catCounts.get(issue.category) ?? 0) + 1);
  }
  let topCategory = "";
  let topCount = 0;
  for (const [cat, count] of catCounts) {
    if (count > topCount) {
      topCount = count;
      topCategory = cat;
    }
  }

  return { totalReviews, avgIssueCount, criticalRate, topCategory };
}
