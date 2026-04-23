// ============================================================================
// packages/core/src/memory-outcome-correlator.ts
//
// Joins memory-decision-log entries to task-completion-log entries by sessionId
// to produce causal evidence that high memory influence → higher task completion.
//
// Key types:
//   JoinedMemoryOutcome — a session's influenceRate joined to its verdict
//   MemoryOutcomeCorrelation — aggregate stats: high vs low influence completion rates
//   StaleMemoryReport — counts facts whose source files are missing or old
// ============================================================================

import { readFileSync, writeFileSync, mkdirSync, statSync, existsSync } from "node:fs";
import { join } from "node:path";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface JoinedMemoryOutcome {
  sessionId: string;
  influenceRate: number;
  verdict: "COMPLETED" | "ATTEMPTED" | "FAILED";
  toolCallCount: number;
}

export interface MemoryOutcomeCorrelation {
  highInfluenceSessionCount: number;
  lowInfluenceSessionCount: number;
  highInfluenceCompletionRate: number;
  lowInfluenceCompletionRate: number;
  delta: number;
  isSignificant: boolean;
  computedAt: string;
}

export interface StaleMemoryReport {
  staleFacts: number;
  staleKeys: string[];
  checkedAt: string;
}

// ── Internal helpers ──────────────────────────────────────────────────────────

function readJSONL<T>(filePath: string): T[] {
  if (!existsSync(filePath)) return [];
  try {
    return readFileSync(filePath, "utf-8")
      .split("\n")
      .filter((l) => l.trim())
      .map((l) => JSON.parse(l) as T);
  } catch {
    return [];
  }
}

// ── joinMemoryToOutcomes ──────────────────────────────────────────────────────

/**
 * Reads memory-decision-log.json and task-completion-log.jsonl,
 * joins by sessionId, returns only sessions present in both logs.
 */
export function joinMemoryToOutcomes(projectRoot: string): JoinedMemoryOutcome[] {
  const danteDir = join(projectRoot, ".danteforge");

  type MemEntry = { sessionId: string; influenceRate: number };
  type CompEntry = { sessionId: string; verdict: string; toolCallCount: number };

  const memEntries = readJSONL<MemEntry>(join(danteDir, "memory-decision-log.json"));
  const compEntries = readJSONL<CompEntry>(join(danteDir, "task-completion-log.jsonl"));

  const compMap = new Map<string, CompEntry>();
  for (const e of compEntries) {
    compMap.set(e.sessionId, e);
  }

  const joined: JoinedMemoryOutcome[] = [];
  for (const mem of memEntries) {
    const comp = compMap.get(mem.sessionId);
    if (!comp) continue;
    const verdict = comp.verdict as JoinedMemoryOutcome["verdict"];
    if (verdict !== "COMPLETED" && verdict !== "ATTEMPTED" && verdict !== "FAILED") continue;
    joined.push({
      sessionId: mem.sessionId,
      influenceRate: mem.influenceRate,
      verdict,
      toolCallCount: comp.toolCallCount,
    });
  }
  return joined;
}

// ── computeMemoryOutcomeCorrelation ──────────────────────────────────────────

/**
 * Splits joined sessions into high-influence (>0.5) and low-influence (<0.3)
 * buckets, computes COMPLETED rate in each bucket, and measures the delta.
 * isSignificant = delta > 0.15.
 */
export function computeMemoryOutcomeCorrelation(
  joined: JoinedMemoryOutcome[],
): MemoryOutcomeCorrelation {
  const high = joined.filter((j) => j.influenceRate > 0.5);
  const low = joined.filter((j) => j.influenceRate < 0.3);

  const completionRate = (bucket: JoinedMemoryOutcome[]) => {
    if (bucket.length === 0) return 0;
    return bucket.filter((j) => j.verdict === "COMPLETED").length / bucket.length;
  };

  const highInfluenceCompletionRate = completionRate(high);
  const lowInfluenceCompletionRate = completionRate(low);
  const delta = highInfluenceCompletionRate - lowInfluenceCompletionRate;

  return {
    highInfluenceSessionCount: high.length,
    lowInfluenceSessionCount: low.length,
    highInfluenceCompletionRate: Math.round(highInfluenceCompletionRate * 1000) / 1000,
    lowInfluenceCompletionRate: Math.round(lowInfluenceCompletionRate * 1000) / 1000,
    delta: Math.round(delta * 1000) / 1000,
    isSignificant: delta > 0.15,
    computedAt: new Date().toISOString(),
  };
}

// ── recordMemoryOutcomeCorrelation ───────────────────────────────────────────

export function recordMemoryOutcomeCorrelation(
  result: MemoryOutcomeCorrelation,
  projectRoot: string,
): void {
  try {
    const danteDir = join(projectRoot, ".danteforge");
    mkdirSync(danteDir, { recursive: true });
    writeFileSync(join(danteDir, "memory-outcome-correlation.json"), JSON.stringify(result, null, 2), "utf-8");
  } catch { /* non-fatal */ }
}

// ── loadMemoryOutcomeCorrelation ──────────────────────────────────────────────

export function loadMemoryOutcomeCorrelation(
  projectRoot: string,
): MemoryOutcomeCorrelation | null {
  try {
    const p = join(projectRoot, ".danteforge", "memory-outcome-correlation.json");
    if (!existsSync(p)) return null;
    return JSON.parse(readFileSync(p, "utf-8")) as MemoryOutcomeCorrelation;
  } catch {
    return null;
  }
}

// ── detectStaleMemoryFacts ────────────────────────────────────────────────────

/**
 * Given a list of retrieved facts (each with a source that may be a file path),
 * counts facts whose source file either does not exist or was last modified more
 * than maxAgeDays ago. Returns { staleFacts, staleKeys }.
 */
export function detectStaleMemoryFacts(
  facts: Array<{ key: string; text: string; source: string }>,
  projectRoot: string,
  maxAgeDays = 7,
): StaleMemoryReport {
  const maxAgeMs = maxAgeDays * 24 * 60 * 60 * 1000;
  const now = Date.now();
  const staleKeys: string[] = [];

  for (const fact of facts) {
    const src = fact.source;
    if (!src || src.startsWith("http") || src === "lesson" || src === "approach-memory") continue;

    const candidate = existsSync(src) ? src : join(projectRoot, src);
    try {
      if (!existsSync(candidate)) {
        staleKeys.push(fact.key);
        continue;
      }
      const mtime = statSync(candidate).mtimeMs;
      if (now - mtime > maxAgeMs) {
        staleKeys.push(fact.key);
      }
    } catch {
      staleKeys.push(fact.key);
    }
  }

  return {
    staleFacts: staleKeys.length,
    staleKeys,
    checkedAt: new Date().toISOString(),
  };
}
