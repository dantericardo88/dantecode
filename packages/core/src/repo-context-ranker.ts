// packages/core/src/repo-context-ranker.ts
// RepoContextRanker — BM25-inspired chunk ranking for dim 4 (repo context quality).
// Scores context chunks by query relevance, enforces token budget, and records events.

import * as fs from "node:fs";
import * as path from "node:path";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ContextChunk {
  filePath: string;
  content: string;
  startLine: number;
  endLine: number;
  relevanceScore?: number;
}

export interface RankedContextResult {
  chunks: ContextChunk[];
  /** sum of content.length / 4 (rough token estimate) */
  totalTokensEstimate: number;
  /** chunks dropped due to token budget */
  droppedCount: number;
  rankingMethod: "bm25" | "recency" | "combined";
}

// ─── BM25-inspired Scoring ────────────────────────────────────────────────────

const DEFAULT_AVG_CHUNK_LEN = 500;
const BM25_K1 = 1.5;
const BM25_B = 0.75;

/**
 * BM25-inspired term frequency scoring (simplified, no IDF).
 * score = sum(tf / (tf + k1 * (1 - b + b * chunkLen / avgChunkLen))) / queryTerms.length
 * Returns a value between 0 and 1.
 */
export function scoreChunkRelevance(
  chunk: ContextChunk,
  queryTerms: string[],
  avgChunkLen = DEFAULT_AVG_CHUNK_LEN,
): number {
  if (queryTerms.length === 0) return 0;

  const contentLower = chunk.content.toLowerCase();
  const chunkLen = chunk.content.length;
  const lenNorm = 1 - BM25_B + BM25_B * (chunkLen / avgChunkLen);

  let totalScore = 0;
  for (const term of queryTerms) {
    const termLower = term.toLowerCase();
    // Count occurrences
    let tf = 0;
    let pos = 0;
    while ((pos = contentLower.indexOf(termLower, pos)) !== -1) {
      tf++;
      pos += termLower.length;
    }
    if (tf > 0) {
      totalScore += tf / (tf + BM25_K1 * lenNorm);
    }
  }

  return Math.min(1, totalScore / queryTerms.length);
}

// ─── Chunk Ranker ─────────────────────────────────────────────────────────────

/**
 * Parse a query string into BM25 terms (words ≥ 3 chars, lowercase).
 */
function parseQueryTerms(query: string): string[] {
  return query
    .split(/\W+/)
    .map((t) => t.toLowerCase())
    .filter((t) => t.length >= 3);
}

/**
 * Rank context chunks by relevance within a token budget.
 *
 * Methods:
 * - "bm25": sort by BM25 score descending
 * - "recency": sort by startLine ascending (earlier = more recent in context)
 * - "combined": 0.6 * bm25Score + 0.4 * (1 - index/total) as recency factor
 */
export function rankContextChunks(
  chunks: ContextChunk[],
  query: string,
  tokenBudget = 4000,
  method: "bm25" | "recency" | "combined" = "bm25",
): RankedContextResult {
  if (chunks.length === 0) {
    return { chunks: [], totalTokensEstimate: 0, droppedCount: 0, rankingMethod: method };
  }

  const terms = parseQueryTerms(query);
  const avgChunkLen =
    chunks.reduce((sum, c) => sum + c.content.length, 0) / chunks.length;

  // Score all chunks
  const scored = chunks.map((chunk) => ({
    chunk,
    bm25Score: scoreChunkRelevance(chunk, terms, avgChunkLen),
  }));

  let sorted: typeof scored;

  if (method === "recency") {
    sorted = [...scored].sort((a, b) => a.chunk.startLine - b.chunk.startLine);
  } else if (method === "combined") {
    const total = scored.length;
    // First sort by bm25 to get index rank
    const byBm25 = [...scored].sort((a, b) => b.bm25Score - a.bm25Score);
    sorted = byBm25.map((item, idx) => ({
      ...item,
      combinedScore: 0.6 * item.bm25Score + 0.4 * (1 - idx / total),
    })).sort((a, b) => (b as typeof a & { combinedScore: number }).combinedScore - (a as typeof a & { combinedScore: number }).combinedScore);
  } else {
    // bm25
    sorted = [...scored].sort((a, b) => b.bm25Score - a.bm25Score);
  }

  // Greedy inclusion up to tokenBudget
  let tokensUsed = 0;
  let droppedCount = 0;
  const selected: ContextChunk[] = [];

  for (const { chunk, bm25Score } of sorted) {
    const chunkTokens = Math.ceil(chunk.content.length / 4);
    if (tokensUsed + chunkTokens <= tokenBudget) {
      selected.push({ ...chunk, relevanceScore: bm25Score });
      tokensUsed += chunkTokens;
    } else {
      droppedCount++;
    }
  }

  return {
    chunks: selected,
    totalTokensEstimate: tokensUsed,
    droppedCount,
    rankingMethod: method,
  };
}

// ─── Event Logging ────────────────────────────────────────────────────────────

const RANKING_LOG_FILE = ".danteforge/context-ranking-log.json";

function getRankingLogPath(projectRoot?: string): string {
  return path.join(projectRoot ?? process.cwd(), RANKING_LOG_FILE);
}

export interface ContextRankingLogEntry {
  sessionId: string;
  query: string;
  chunksConsidered: number;
  chunksSelected: number;
  method: string;
  timestamp: string;
}

/**
 * Appends a JSONL entry to .danteforge/context-ranking-log.json.
 */
export function recordContextRankingEvent(
  sessionId: string,
  query: string,
  chunksConsidered: number,
  chunksSelected: number,
  method: string,
  projectRoot?: string,
): void {
  const logPath = getRankingLogPath(projectRoot);
  fs.mkdirSync(path.dirname(logPath), { recursive: true });
  const entry: ContextRankingLogEntry = {
    sessionId,
    query,
    chunksConsidered,
    chunksSelected,
    method,
    timestamp: new Date().toISOString(),
  };
  fs.appendFileSync(logPath, JSON.stringify(entry) + "\n", "utf8");
}

/**
 * Reads all entries from .danteforge/context-ranking-log.json.
 */
export function loadContextRankingLog(
  projectRoot?: string,
): ContextRankingLogEntry[] {
  const logPath = getRankingLogPath(projectRoot);
  if (!fs.existsSync(logPath)) return [];
  const lines = fs.readFileSync(logPath, "utf8").split("\n").filter(Boolean);
  return lines.map((l) => JSON.parse(l) as ContextRankingLogEntry);
}

/**
 * Compute aggregate stats over ranking log entries.
 */
export function getContextRankingStats(
  entries: Array<{ chunksConsidered: number; chunksSelected: number }>,
): { avgSelectionRate: number; totalEvents: number } {
  if (entries.length === 0) return { avgSelectionRate: 0, totalEvents: 0 };
  const rates = entries.map((e) =>
    e.chunksConsidered === 0 ? 0 : e.chunksSelected / e.chunksConsidered,
  );
  const avgSelectionRate = rates.reduce((s, r) => s + r, 0) / rates.length;
  return { avgSelectionRate, totalEvents: entries.length };
}
