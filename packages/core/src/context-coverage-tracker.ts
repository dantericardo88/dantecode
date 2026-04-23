// Sprint AP — Dim 2: Context coverage tracker
// Records which context sources fire per session (repo-memory, LSP, mentions, etc.)
// and their relevance scores, providing evidence that context injection is working.
import { appendFileSync, readFileSync, existsSync, mkdirSync } from "node:fs";
import { join, resolve } from "node:path";

export type ContextSource = "repo-memory" | "lsp" | "mention" | "git-context" | "lesson" | "approach-memory" | "debug" | "other";

export interface ContextHitEntry {
  timestamp: string;
  sessionId: string;
  key: string;
  source: ContextSource;
  relevanceScore: number; // 0-1
  tokenCount?: number;
}

export interface ContextCoverageSummary {
  totalHits: number;
  sourceBreakdown: Record<string, number>;
  avgRelevance: number;
  topSources: string[];
  sessionsWithContext: number;
}

const COVERAGE_FILE = ".danteforge/context-coverage-log.json";

/** Record a context source hit for the current session. */
export function recordContextHit(
  entry: Omit<ContextHitEntry, "timestamp">,
  projectRoot = process.cwd(),
): void {
  try {
    const root = resolve(projectRoot);
    mkdirSync(join(root, ".danteforge"), { recursive: true });
    const record: ContextHitEntry = { timestamp: new Date().toISOString(), ...entry };
    appendFileSync(join(root, COVERAGE_FILE), JSON.stringify(record) + "\n", "utf-8");
  } catch { /* non-fatal */ }
}

/** Load all context coverage entries. */
export function loadContextCoverage(projectRoot = process.cwd()): ContextHitEntry[] {
  const root = resolve(projectRoot);
  const path = join(root, COVERAGE_FILE);
  if (!existsSync(path)) return [];
  try {
    return readFileSync(path, "utf-8").trim().split("\n").filter(Boolean)
      .map((l) => JSON.parse(l) as ContextHitEntry);
  } catch { return []; }
}

// ─── Memory-to-outcome correlation (Sprint AV — Dim 21) ─────────────────────

export interface MemoryOutcomeEntry {
  sessionId: string;
  contextHitsUsed: number;
  taskSucceeded: boolean;
  timestamp: string;
}

const MEMORY_OUTCOME_FILE = ".danteforge/memory-outcome-log.json";

/** Record correlation between context hits used and task success. */
export function recordMemoryOutcomeCorrelation(
  sessionId: string,
  contextHitsUsed: number,
  taskSucceeded: boolean,
  projectRoot?: string,
): void {
  try {
    const root = resolve(projectRoot ?? process.cwd());
    mkdirSync(join(root, ".danteforge"), { recursive: true });
    const entry: MemoryOutcomeEntry = { sessionId, contextHitsUsed, taskSucceeded, timestamp: new Date().toISOString() };
    appendFileSync(join(root, MEMORY_OUTCOME_FILE), JSON.stringify(entry) + "\n", "utf-8");
  } catch { /* non-fatal */ }
}

/** Load all memory-outcome correlation entries. */
export function loadMemoryOutcomes(projectRoot?: string): MemoryOutcomeEntry[] {
  const root = resolve(projectRoot ?? process.cwd());
  const path = join(root, MEMORY_OUTCOME_FILE);
  if (!existsSync(path)) return [];
  try {
    return readFileSync(path, "utf-8").trim().split("\n").filter(Boolean)
      .map((l) => JSON.parse(l) as MemoryOutcomeEntry);
  } catch { return []; }
}

/**
 * Return (success rate when contextHitsUsed > 0) - (success rate when contextHitsUsed === 0).
 * Positive = memory helps. Returns 0 if < 2 entries in either bucket.
 */
export function getMemoryImpactScore(entries: MemoryOutcomeEntry[]): number {
  const withHits = entries.filter((e) => e.contextHitsUsed > 0);
  const withoutHits = entries.filter((e) => e.contextHitsUsed === 0);
  if (withHits.length < 2 || withoutHits.length < 2) return 0;
  const rateWith = withHits.filter((e) => e.taskSucceeded).length / withHits.length;
  const rateWithout = withoutHits.filter((e) => e.taskSucceeded).length / withoutHits.length;
  return rateWith - rateWithout;
}

// ─── Memory decision influence (Sprint AZ — Dim 21) ─────────────────────────

export interface MemoryDecisionEntry {
  sessionId: string;
  injectedFactCount: number;
  influencedFactCount: number;
  influenceRate: number;
  influencedSnippets: string[];
  avgJaccardScore: number;  // avg Jaccard of influenced facts (Sprint BM)
  timestamp: string;
}

const MEMORY_DECISION_FILE = ".danteforge/memory-decision-log.json";

/** Tokenize text into a Set of meaningful words (3+ chars, alpha-numeric only). */
function _tokenize(text: string): Set<string> {
  return new Set(
    text.toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter((w) => w.length >= 3),
  );
}

/** Jaccard similarity between two token sets. */
function _jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 0;
  let intersection = 0;
  for (const t of a) { if (b.has(t)) intersection++; }
  const union = a.size + b.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

export function computeMemoryDecisionInfluence(
  sessionId: string,
  injectedFacts: string[],
  assistantMessages: string[],
  threshold = 0.2,
): MemoryDecisionEntry {
  const influencedSnippets: string[] = [];
  const jaccardScores: number[] = [];
  const msgTokenSets = assistantMessages.map(_tokenize);
  for (const fact of injectedFacts) {
    if (!fact.trim()) continue;
    const factTokens = _tokenize(fact);
    let bestScore = 0;
    for (const msgTokens of msgTokenSets) {
      const score = _jaccard(factTokens, msgTokens);
      if (score > bestScore) bestScore = score;
    }
    if (bestScore >= threshold) {
      influencedSnippets.push(fact.slice(0, 60));
      jaccardScores.push(bestScore);
    }
  }
  const injectedFactCount = injectedFacts.filter((f) => f.trim()).length;
  const influencedFactCount = influencedSnippets.length;
  const avgJaccardScore = jaccardScores.length === 0
    ? 0
    : jaccardScores.reduce((s, v) => s + v, 0) / jaccardScores.length;
  return {
    sessionId,
    injectedFactCount,
    influencedFactCount,
    influenceRate: injectedFactCount === 0 ? 0 : influencedFactCount / injectedFactCount,
    influencedSnippets,
    avgJaccardScore,
    timestamp: new Date().toISOString(),
  };
}

export function recordMemoryDecisionInfluence(
  entry: MemoryDecisionEntry,
  projectRoot?: string,
): void {
  try {
    const root = resolve(projectRoot ?? process.cwd());
    mkdirSync(join(root, ".danteforge"), { recursive: true });
    appendFileSync(join(root, MEMORY_DECISION_FILE), JSON.stringify(entry) + "\n", "utf-8");
  } catch { /* non-fatal */ }
}

export function loadMemoryDecisionLog(projectRoot?: string): MemoryDecisionEntry[] {
  const root = resolve(projectRoot ?? process.cwd());
  const path = join(root, MEMORY_DECISION_FILE);
  if (!existsSync(path)) return [];
  try {
    return readFileSync(path, "utf-8").trim().split("\n").filter(Boolean)
      .map((l) => JSON.parse(l) as MemoryDecisionEntry);
  } catch { return []; }
}

export function getMemoryInfluenceStats(entries: MemoryDecisionEntry[]): {
  avgInfluenceRate: number;
  sessionsWithInfluence: number;
  totalSessions: number;
} {
  if (entries.length === 0) return { avgInfluenceRate: 0, sessionsWithInfluence: 0, totalSessions: 0 };
  const avgInfluenceRate = entries.reduce((s, e) => s + e.influenceRate, 0) / entries.length;
  const sessionsWithInfluence = entries.filter((e) => e.influencedFactCount > 0).length;
  return { avgInfluenceRate, sessionsWithInfluence, totalSessions: entries.length };
}

/**
 * Sprint BM: High-level memory influence summary across sessions.
 * highInfluenceRate = fraction of sessions with avgJaccardScore >= 0.3
 */
export function getMemoryInfluenceSummary(entries: MemoryDecisionEntry[]): {
  highInfluenceRate: number;
  avgJaccard: number;
  totalFacts: number;
} {
  if (entries.length === 0) return { highInfluenceRate: 0, avgJaccard: 0, totalFacts: 0 };
  const highInfluenceCount = entries.filter((e) => e.avgJaccardScore >= 0.3).length;
  const avgJaccard = entries.reduce((s, e) => s + e.avgJaccardScore, 0) / entries.length;
  const totalFacts = entries.reduce((s, e) => s + e.injectedFactCount, 0);
  return {
    highInfluenceRate: highInfluenceCount / entries.length,
    avgJaccard,
    totalFacts,
  };
}

/** Summarize coverage metrics. */
export function summarizeContextCoverage(entries: ContextHitEntry[]): ContextCoverageSummary {
  if (entries.length === 0) {
    return { totalHits: 0, sourceBreakdown: {}, avgRelevance: 0, topSources: [], sessionsWithContext: 0 };
  }
  const sourceBreakdown: Record<string, number> = {};
  let totalRelevance = 0;
  for (const e of entries) {
    sourceBreakdown[e.source] = (sourceBreakdown[e.source] ?? 0) + 1;
    totalRelevance += e.relevanceScore;
  }
  const topSources = Object.entries(sourceBreakdown)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 3)
    .map(([k]) => k);
  const sessionsWithContext = new Set(entries.map((e) => e.sessionId)).size;
  return {
    totalHits: entries.length,
    sourceBreakdown,
    avgRelevance: totalRelevance / entries.length,
    topSources,
    sessionsWithContext,
  };
}
