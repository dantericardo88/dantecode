// ============================================================================
// packages/core/src/retrieval-relevance-eval.ts
//
// Retrieval relevance evaluation tied to task outcomes.
// Proves that high-quality retrieval (token overlap > 0.1 between query and
// retrieved snippet) correlates with COMPLETED task verdicts.
//
// Key chain:
//   evaluateRetrievalRelevance → .danteforge/retrieval-relevance-log.jsonl
//   getRetrievalImpactOnCompletion → .danteforge/retrieval-impact-report.json
// ============================================================================

import { readFileSync, writeFileSync, appendFileSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";

// ── Types ─────────────────────────────────────────────────────────────────────

export type RetrievalTaskOutcome = "COMPLETED" | "ATTEMPTED" | "FAILED";

export interface RetrievalEvalEntry {
  query: string;
  resultCount: number;
  tokenOverlap: number;
  relevanceScore: number;
  taskOutcome: RetrievalTaskOutcome;
  timestamp: string;
}

export interface RetrievalQualityStats {
  totalEvals: number;
  avgRelevanceScore: number;
  avgTokenOverlap: number;
  improvedTaskRate: number;
}

export interface RetrievalImpactReport {
  withContextRate: number;
  withoutContextRate: number;
  delta: number;
  isSignificant: boolean;
  computedAt: string;
}

// ── Internal helpers ──────────────────────────────────────────────────────────

function tokenizeText(text: string): Set<string> {
  return new Set(
    text
      .replace(/([a-z])([A-Z])/g, "$1 $2")
      .replace(/[^a-zA-Z0-9]/g, " ")
      .toLowerCase()
      .split(/\s+/)
      .filter((t) => t.length > 1),
  );
}

function jaccardOverlap(a: string, b: string): number {
  if (!a || !b) return 0;
  const setA = tokenizeText(a);
  const setB = tokenizeText(b);
  if (setA.size === 0 || setB.size === 0) return 0;
  let intersection = 0;
  for (const t of setA) {
    if (setB.has(t)) intersection++;
  }
  const union = new Set([...setA, ...setB]).size;
  return union === 0 ? 0 : Math.round((intersection / union) * 1000) / 1000;
}

function danteDir(projectRoot: string): string {
  return join(projectRoot, ".danteforge");
}

// ── evaluateRetrievalRelevance ────────────────────────────────────────────────

/**
 * Computes a RetrievalEvalEntry for one retrieval event.
 * relevanceScore = outcomeWeight × (resultCount > 0 ? 1 : 0)
 *   where outcomeWeight: COMPLETED=1.0, ATTEMPTED=0.5, FAILED=0
 * tokenOverlap = Jaccard(query tokens, first result snippet tokens)
 * Appends JSONL to .danteforge/retrieval-relevance-log.jsonl and returns the entry.
 */
export function evaluateRetrievalRelevance(
  query: string,
  results: Array<{ filePath: string; snippet: string }>,
  taskOutcome: RetrievalTaskOutcome,
  projectRoot: string,
): RetrievalEvalEntry {
  const outcomeWeight = taskOutcome === "COMPLETED" ? 1.0 : taskOutcome === "ATTEMPTED" ? 0.5 : 0;
  const relevanceScore = outcomeWeight * (results.length > 0 ? 1 : 0);
  const topSnippet = results[0]?.snippet ?? "";
  const tokenOverlap = jaccardOverlap(query, topSnippet);

  const entry: RetrievalEvalEntry = {
    query: query.slice(0, 200),
    resultCount: results.length,
    tokenOverlap,
    relevanceScore,
    taskOutcome,
    timestamp: new Date().toISOString(),
  };

  try {
    const dir = danteDir(projectRoot);
    mkdirSync(dir, { recursive: true });
    appendFileSync(join(dir, "retrieval-relevance-log.jsonl"), JSON.stringify(entry) + "\n", "utf-8");
  } catch { /* non-fatal */ }

  return entry;
}

// ── loadRetrievalRelevanceLog ─────────────────────────────────────────────────

export function loadRetrievalRelevanceLog(projectRoot: string): RetrievalEvalEntry[] {
  try {
    const p = join(danteDir(projectRoot), "retrieval-relevance-log.jsonl");
    if (!existsSync(p)) return [];
    return readFileSync(p, "utf-8")
      .split("\n")
      .filter((l) => l.trim())
      .map((l) => JSON.parse(l) as RetrievalEvalEntry);
  } catch {
    return [];
  }
}

// ── getRetrievalQualityStats ──────────────────────────────────────────────────

/**
 * Computes aggregate stats from retrieval eval log entries.
 * improvedTaskRate = fraction where taskOutcome === "COMPLETED" AND tokenOverlap > 0.1
 */
export function getRetrievalQualityStats(entries: RetrievalEvalEntry[]): RetrievalQualityStats {
  if (entries.length === 0) {
    return { totalEvals: 0, avgRelevanceScore: 0, avgTokenOverlap: 0, improvedTaskRate: 0 };
  }
  const avgRelevanceScore =
    Math.round((entries.reduce((s, e) => s + e.relevanceScore, 0) / entries.length) * 1000) / 1000;
  const avgTokenOverlap =
    Math.round((entries.reduce((s, e) => s + e.tokenOverlap, 0) / entries.length) * 1000) / 1000;
  const improved = entries.filter((e) => e.taskOutcome === "COMPLETED" && e.tokenOverlap > 0.1).length;
  const improvedTaskRate = Math.round((improved / entries.length) * 1000) / 1000;
  return { totalEvals: entries.length, avgRelevanceScore, avgTokenOverlap, improvedTaskRate };
}

// ── getRetrievalImpactOnCompletion ────────────────────────────────────────────

/**
 * Splits retrieval eval entries into two groups:
 *   "with context": tokenOverlap > 0.1 (meaningful retrieval happened)
 *   "without context": tokenOverlap <= 0.1 (retrieval had low overlap)
 * Computes fraction COMPLETED in each group and the delta.
 * isSignificant = delta > 0.15.
 */
export function getRetrievalImpactOnCompletion(projectRoot: string): RetrievalImpactReport {
  const entries = loadRetrievalRelevanceLog(projectRoot);

  const withContext = entries.filter((e) => e.tokenOverlap > 0.1);
  const withoutContext = entries.filter((e) => e.tokenOverlap <= 0.1);

  const rate = (bucket: RetrievalEvalEntry[]) => {
    if (bucket.length === 0) return 0;
    return Math.round((bucket.filter((e) => e.taskOutcome === "COMPLETED").length / bucket.length) * 1000) / 1000;
  };

  const withContextRate = rate(withContext);
  const withoutContextRate = rate(withoutContext);
  const delta = Math.round((withContextRate - withoutContextRate) * 1000) / 1000;

  const report: RetrievalImpactReport = {
    withContextRate,
    withoutContextRate,
    delta,
    isSignificant: delta > 0.15,
    computedAt: new Date().toISOString(),
  };

  recordRetrievalImpact(report, projectRoot);
  return report;
}

// ── recordRetrievalImpact ─────────────────────────────────────────────────────

export function recordRetrievalImpact(report: RetrievalImpactReport, projectRoot: string): void {
  try {
    const dir = danteDir(projectRoot);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "retrieval-impact-report.json"), JSON.stringify(report, null, 2), "utf-8");
  } catch { /* non-fatal */ }
}
