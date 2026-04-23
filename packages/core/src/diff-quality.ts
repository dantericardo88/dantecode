// ============================================================================
// @dantecode/core — Diff Quality Scoring (dim 13)
// Computes a quality score for an approved diff, capturing lines changed,
// files touched, and whether test files are included. Written to
// .danteforge/diff-quality-log.json as JSONL on approval.
// ============================================================================

import { appendFileSync, mkdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

export interface DiffQualityScore {
  /** Number of lines added in the diff */
  linesAdded: number;
  /** Number of lines removed in the diff */
  linesRemoved: number;
  /** Total lines changed (added + removed) */
  totalLines: number;
  /** Whether the diff touches any test files */
  hasTests: boolean;
  /** Estimated complexity 0–1: ratio of changed lines to total diff size */
  complexityScore: number;
  /** Aggregate quality 0–1: higher when tests included and balanced changes */
  qualityScore: number;
  /** Sprint BR: path of the file being scored */
  filePath: string;
  /**
   * Sprint BR: ratio of changed lines to total lines in the larger of old/new content (0–1).
   * Measures how much of the file was rewritten.
   */
  changeComplexity: number;
  /**
   * Sprint BR: true when substantial lines were both removed and added,
   * indicating a potentially breaking rewrite rather than an additive change.
   * Heuristic: linesRemoved > 0 && linesAdded > 0 &&
   *            (linesRemoved / max(linesAdded, linesRemoved)) > 0.5
   */
  hasBreakingChange: boolean;
}

export interface DiffQualityLogEntry extends DiffQualityScore {
  timestamp: string;
  filePath: string;
  commitSha?: string;
}

const TEST_FILE_RE = /\.(test|spec)\.[jt]sx?$|__tests__\//;

/**
 * Scores a code diff based on structural properties.
 * Higher scores reward test coverage and balanced add/remove ratios.
 *
 * @param oldContent - Original file content (empty string for new files)
 * @param newContent - New file content
 * @param filePath - Path of the file being reviewed (used to detect test files)
 */
export function scoreDiff(
  oldContent: string,
  newContent: string,
  filePath = "",
): DiffQualityScore {
  const oldLines = oldContent ? oldContent.split("\n") : [];
  const newLines = newContent ? newContent.split("\n") : [];

  // Simple line-level diff: count lines unique to each side
  const oldSet = new Set(oldLines.map((l) => l.trim()));
  const newSet = new Set(newLines.map((l) => l.trim()));

  let linesAdded = 0;
  let linesRemoved = 0;
  for (const line of newLines) {
    if (!oldSet.has(line.trim())) linesAdded++;
  }
  for (const line of oldLines) {
    if (!newSet.has(line.trim())) linesRemoved++;
  }
  const totalLines = linesAdded + linesRemoved;

  const hasTests = TEST_FILE_RE.test(filePath);

  // complexityScore: proportion of file that changed (capped at 1)
  const totalFileLines = Math.max(oldLines.length, newLines.length, 1);
  const complexityScore = Math.min(totalLines / totalFileLines, 1);

  // qualityScore: starts at 0.5, +0.3 for having tests, -0.2 if huge (>200 lines) without tests
  let qualityScore = 0.5;
  if (hasTests) qualityScore += 0.3;
  if (totalLines > 200 && !hasTests) qualityScore -= 0.2;
  if (totalLines === 0) qualityScore = 0.1; // empty diff scores low
  qualityScore = Math.max(0, Math.min(1, qualityScore));

  // Sprint BR: changeComplexity — how much of the file changed
  const changeComplexity = Math.min(totalLines / totalFileLines, 1);

  // Sprint BR: hasBreakingChange — substantial simultaneous removal + addition
  const hasBreakingChange =
    linesRemoved > 0 &&
    linesAdded > 0 &&
    linesRemoved / Math.max(linesAdded, linesRemoved) > 0.5;

  return {
    linesAdded,
    linesRemoved,
    totalLines,
    hasTests,
    complexityScore,
    qualityScore,
    filePath,
    changeComplexity,
    hasBreakingChange,
  };
}

/**
 * Appends a diff quality score entry to `.danteforge/diff-quality-log.json` (JSONL).
 * Called on approval to build a persistent record of review quality over time.
 */
// ============================================================================
// Enhanced Diff Quality Scorer (Sprint BP)
// Operates on unified diff text (e.g. from `git diff`), analysing hunks.
// ============================================================================

export interface DiffHunkAnalysis {
  hunkIndex: number;
  linesAdded: number;
  linesRemoved: number;
  /** Any line starting with +// or +# (new comment lines) */
  hasComments: boolean;
  /** Any + line contains test( | it( | expect( | describe( */
  hasTests: boolean;
  /** Change touches same logic without adding many lines: linesAdded <= linesRemoved * 1.2 */
  isRefactor: boolean;
  /** linesRemoved / Math.max(linesAdded, 1) */
  churnRatio: number;
}

/**
 * Parses unified diff text and returns per-hunk analysis.
 * A hunk starts with a line beginning with "@@".
 */
export function analyzeDiffHunks(diffText: string): DiffHunkAnalysis[] {
  const lines = diffText.split("\n");
  const hunks: DiffHunkAnalysis[] = [];
  let current: {
    linesAdded: number;
    linesRemoved: number;
    hasComments: boolean;
    hasTests: boolean;
  } | null = null;
  let hunkIndex = 0;

  const flushHunk = () => {
    if (current === null) return;
    const { linesAdded, linesRemoved, hasComments, hasTests } = current;
    const isRefactor =
      linesRemoved > 0 && linesAdded <= linesRemoved * 1.2;
    const churnRatio = linesRemoved / Math.max(linesAdded, 1);
    hunks.push({
      hunkIndex,
      linesAdded,
      linesRemoved,
      hasComments,
      hasTests,
      isRefactor,
      churnRatio,
    });
    hunkIndex++;
    current = null;
  };

  for (const line of lines) {
    if (line.startsWith("@@")) {
      flushHunk();
      current = { linesAdded: 0, linesRemoved: 0, hasComments: false, hasTests: false };
      continue;
    }
    if (current === null) continue;
    if (line.startsWith("+") && !line.startsWith("+++")) {
      current.linesAdded++;
      const content = line.slice(1);
      if (content.trimStart().startsWith("//") || content.trimStart().startsWith("#")) {
        current.hasComments = true;
      }
      if (/(?:test|it|expect|describe)\s*\(/.test(content)) {
        current.hasTests = true;
      }
    } else if (line.startsWith("-") && !line.startsWith("---")) {
      current.linesRemoved++;
    }
  }
  flushHunk();
  return hunks;
}

export interface DiffQualityReport {
  totalHunks: number;
  totalAdded: number;
  totalRemoved: number;
  hasTests: boolean;
  /** Fraction of hunks that are refactors */
  refactorFraction: number;
  /** Fraction of hunks with comments */
  commentDensity: number;
  /** 0-1 composite quality score */
  overallQuality: number;
  breakdown: DiffHunkAnalysis[];
}

/**
 * Scores a unified diff text holistically.
 *
 * overallQuality =
 *   0.4 * (hasTests ? 1 : 0.3)
 *   + 0.3 * (1 - Math.min(churnRatio, 1))
 *   + 0.3 * (1 - refactorFraction * 0.5)
 *
 * where churnRatio = totalRemoved / Math.max(totalAdded, 1)
 */
export function scoreDiffQuality(diffText: string): DiffQualityReport {
  const breakdown = analyzeDiffHunks(diffText);
  const totalHunks = breakdown.length;

  let totalAdded = 0;
  let totalRemoved = 0;
  let refactorCount = 0;
  let commentCount = 0;
  let anyTests = false;

  for (const h of breakdown) {
    totalAdded += h.linesAdded;
    totalRemoved += h.linesRemoved;
    if (h.isRefactor) refactorCount++;
    if (h.hasComments) commentCount++;
    if (h.hasTests) anyTests = true;
  }

  const refactorFraction = totalHunks > 0 ? refactorCount / totalHunks : 0;
  const commentDensity = totalHunks > 0 ? commentCount / totalHunks : 0;
  const churnRatio = totalRemoved / Math.max(totalAdded, 1);

  const overallQuality =
    0.4 * (anyTests ? 1 : 0.3) +
    0.3 * (1 - Math.min(churnRatio, 1)) +
    0.3 * (1 - refactorFraction * 0.5);

  return {
    totalHunks,
    totalAdded,
    totalRemoved,
    hasTests: anyTests,
    refactorFraction,
    commentDensity,
    overallQuality: Math.max(0, Math.min(1, overallQuality)),
    breakdown,
  };
}

const DIFF_QUALITY_REPORT_FILE = ".danteforge/diff-quality-report.json";

/**
 * Appends a DiffQualityReport (with sessionId + timestamp) as JSONL to
 * .danteforge/diff-quality-report.json
 */
export function recordDiffQualityReport(
  report: DiffQualityReport,
  sessionId: string,
  projectRoot?: string,
): void {
  const root = resolve(projectRoot ?? process.cwd());
  const filePath = join(root, DIFF_QUALITY_REPORT_FILE);
  try {
    mkdirSync(join(root, ".danteforge"), { recursive: true });
    const entry = { ...report, sessionId, timestamp: new Date().toISOString() };
    appendFileSync(filePath, JSON.stringify(entry) + "\n", "utf-8");
  } catch {
    // non-fatal
  }
}

/**
 * Reads and parses the JSONL diff-quality-report.json file.
 * Returns an empty array if the file is missing or malformed.
 */
export function loadDiffQualityReports(
  projectRoot?: string,
): Array<DiffQualityReport & { sessionId: string; timestamp: string }> {
  const root = resolve(projectRoot ?? process.cwd());
  const filePath = join(root, DIFF_QUALITY_REPORT_FILE);
  try {
    const raw = readFileSync(filePath, "utf-8");
    return raw
      .split("\n")
      .filter((line) => line.trim().length > 0)
      .map(
        (line) =>
          JSON.parse(line) as DiffQualityReport & {
            sessionId: string;
            timestamp: string;
          },
      );
  } catch {
    return [];
  }
}

// ============================================================================
// Legacy emitDiffQualityLog
// ============================================================================

export function emitDiffQualityLog(
  score: DiffQualityScore,
  filePath: string,
  commitSha?: string,
  projectRoot?: string,
): void {
  const root = projectRoot ?? resolve(process.cwd());
  const logPath = join(root, ".danteforge", "diff-quality-log.json");
  try {
    mkdirSync(join(root, ".danteforge"), { recursive: true });
    const { filePath: scoreFilePath, ...scoreRest } = score;
    const entry: DiffQualityLogEntry = {
      timestamp: new Date().toISOString(),
      filePath: filePath || scoreFilePath,
      commitSha,
      ...scoreRest,
    };
    appendFileSync(logPath, JSON.stringify(entry) + "\n", "utf-8");
  } catch { /* non-fatal */ }
}
