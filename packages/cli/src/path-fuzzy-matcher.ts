// ============================================================================
// packages/cli/src/path-fuzzy-matcher.ts
// Sprint 38 — Dim 24: File path anti-confabulation (Reliability)
//
// When the model references a file that doesn't exist, fuzzy-match against
// real files in the project and suggest the closest alternatives.
//
// Algorithm:
//   1. Scan project (excluding node_modules / .git / dist) for candidate paths
//   2. Score each candidate against the queried path
//   3. Return top-N matches sorted by similarity
// ============================================================================

import { readdir } from "node:fs/promises";
import { basename, dirname, relative, join, extname } from "node:path";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface FuzzyMatchResult {
  path: string;
  score: number;
}

// ─── Similarity helpers ───────────────────────────────────────────────────────

/**
 * Levenshtein distance between two strings (character-level).
 * Capped at 64 characters to keep it fast.
 */
function levenshtein(a: string, b: string): number {
  const aLen = Math.min(a.length, 64);
  const bLen = Math.min(b.length, 64);
  const dp: number[] = Array.from({ length: bLen + 1 }, (_, i) => i);

  for (let i = 1; i <= aLen; i++) {
    let prev = dp[0]!;
    dp[0] = i;
    for (let j = 1; j <= bLen; j++) {
      const temp = dp[j]!;
      dp[j] = a[i - 1] === b[j - 1]
        ? prev
        : 1 + Math.min(prev, dp[j]!, dp[j - 1]!);
      prev = temp;
    }
  }
  return dp[bLen]!;
}

/**
 * Score a candidate path against a query path.
 * Higher = better match. Range: 0–100.
 *
 * Scoring factors (descending priority):
 *   1. Basename exact match → +50
 *   2. Basename fuzzy match → 0–30 (inversely proportional to edit distance)
 *   3. Directory path overlap → 0–20 (shared components / total components)
 */
export function scorePathMatch(query: string, candidate: string): number {
  const queryBase = basename(query).toLowerCase();
  const candBase = basename(candidate).toLowerCase();

  // ── Factor 1: basename exact match ──
  let score = 0;
  if (queryBase === candBase) {
    score += 50;
  } else {
    // ── Factor 2: basename fuzzy match ──
    const dist = levenshtein(queryBase, candBase);
    const maxLen = Math.max(queryBase.length, candBase.length);
    if (maxLen > 0) {
      score += Math.max(0, 30 - (dist / maxLen) * 30);
    }
  }

  // ── Factor 3: directory overlap ──
  const queryDir = dirname(query).replace(/\\/g, "/").split("/").filter(Boolean);
  const candDir = dirname(candidate).replace(/\\/g, "/").split("/").filter(Boolean);

  const shared = queryDir.filter((part) => candDir.includes(part)).length;
  const total = Math.max(queryDir.length, 1);
  score += (shared / total) * 20;

  return score;
}

// ─── Project file scanner ─────────────────────────────────────────────────────

const SCAN_EXTENSIONS = new Set([".ts", ".tsx", ".js", ".jsx", ".mts", ".mjs", ".py", ".go"]);
const IGNORE_DIRS = new Set(["node_modules", ".git", "dist", "build", ".cache", "coverage"]);

/**
 * Recursively walk a directory, yielding relative paths of matching files.
 * Limits results to 2000 files to keep matching fast.
 */
async function walkDir(
  dir: string,
  root: string,
  results: string[],
  limit: number,
): Promise<void> {
  if (results.length >= limit) return;
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (results.length >= limit) break;
    if (entry.isDirectory()) {
      if (!IGNORE_DIRS.has(entry.name)) {
        await walkDir(join(dir, entry.name), root, results, limit);
      }
    } else if (entry.isFile() && SCAN_EXTENSIONS.has(extname(entry.name))) {
      results.push(relative(root, join(dir, entry.name)));
    }
  }
}

/**
 * Scan the project root for candidate files.
 * Limits results to 2000 files to keep matching fast.
 */
async function scanProjectFiles(
  projectRoot: string,
  _globFn?: (pattern: string, opts: object) => Promise<string[]>,
): Promise<string[]> {
  // _globFn injected for tests (allows overriding file scan)
  if (_globFn) {
    try {
      return await _globFn("{src,packages,lib,app}/**/*", { cwd: projectRoot });
    } catch {
      return [];
    }
  }
  const results: string[] = [];
  await walkDir(projectRoot, projectRoot, results, 2000);
  return results;
}

// ─── Main export ──────────────────────────────────────────────────────────────

/**
 * Find the closest real file paths in `projectRoot` for a given `queryPath`.
 * Returns up to `topN` results sorted by similarity score (highest first).
 *
 * Returns empty array when:
 * - The file scan fails
 * - No candidates score above the minimum threshold (20)
 *
 * @param queryPath  - The path the model claimed (may be relative or absolute)
 * @param projectRoot - Workspace root to scan
 * @param topN       - Maximum number of suggestions (default 3)
 * @param _globFn    - Injectable glob function for testing
 */
export async function fuzzyMatchFilePath(
  queryPath: string,
  projectRoot: string,
  topN = 3,
  _globFn?: (pattern: string, opts: object) => Promise<string[]>,
): Promise<FuzzyMatchResult[]> {
  // Normalise query to a relative path for comparison
  let normalizedQuery: string;
  try {
    normalizedQuery = relative(projectRoot, queryPath).replace(/\\/g, "/");
  } catch {
    normalizedQuery = queryPath.replace(/\\/g, "/");
  }

  const candidates = await scanProjectFiles(projectRoot, _globFn);
  if (candidates.length === 0) return [];

  const scored = candidates
    .map((c) => ({ path: c, score: scorePathMatch(normalizedQuery, c) }))
    .filter((r) => r.score >= 20)
    .sort((a, b) => b.score - a.score)
    .slice(0, topN);

  return scored;
}

/**
 * Format suggestions as a human-readable suggestion string for error messages.
 */
export function formatSuggestions(matches: FuzzyMatchResult[]): string {
  if (matches.length === 0) return "";
  const list = matches.map((m) => `  • ${m.path}`).join("\n");
  return `\nDid you mean one of these?\n${list}`;
}
