// ============================================================================
// Sprint AZ — Dim 2: Retrieval Citation Tracker
// Tracks which retrieved context facts actually appear in assistant responses.
// citationRate < 0.3 means retrieval is not influencing the agent — proof of
// retrieval quality. Decision-changing: low rate signals retrieval tuning needed.
// ============================================================================

import { appendFileSync, mkdirSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

export interface RetrievedFactBuffer {
  sessionId: string;
  facts: Array<{ key: string; text: string; source: string }>;
}

export interface CitationResult {
  sessionId: string;
  totalRetrieved: number;
  totalCited: number;
  citationRate: number;
  citedKeys: string[];
  uncitedKeys: string[];
  isHighConfidence: boolean;   // true when citationRate >= 0.4 and matchConfidence avg >= 0.25
  matchConfidence: number;     // average Jaccard overlap of cited facts (0-1)
  timestamp: string;
}

/** Tokenize text into a Set of meaningful words (3+ chars, alpha-numeric only). */
function tokenize(text: string): Set<string> {
  return new Set(
    text.toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter((w) => w.length >= 3),
  );
}

/** Jaccard similarity between two token sets (internal). */
function jaccardSets(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 0;
  let intersection = 0;
  for (const t of a) { if (b.has(t)) intersection++; }
  const union = a.size + b.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

/**
 * Jaccard similarity between two arrays of word tokens.
 * Exported utility for use in tests and external callers.
 */
export function jaccardSimilarity(tokensA: string[], tokensB: string[]): number {
  return jaccardSets(new Set(tokensA), new Set(tokensB));
}

/** Check if a fact is cited in any assistant message via Jaccard overlap >= threshold. */
function isCitedByJaccard(factText: string, assistantMessages: string[], threshold = 0.25): { cited: boolean; confidence: number } {
  const factTokens = tokenize(factText);
  let bestScore = 0;
  for (const msg of assistantMessages) {
    const score = jaccardSets(factTokens, tokenize(msg));
    if (score > bestScore) bestScore = score;
  }
  return { cited: bestScore >= threshold, confidence: bestScore };
}

// Module-level session buffer — keyed by sessionId
const _sessionBuffers = new Map<string, RetrievedFactBuffer>();

export function beginRetrievalSession(sessionId: string): void {
  _sessionBuffers.set(sessionId, { sessionId, facts: [] });
}

export function bufferRetrievedFact(
  sessionId: string,
  key: string,
  text: string,
  source: string,
): void {
  if (!_sessionBuffers.has(sessionId)) {
    beginRetrievalSession(sessionId);
  }
  _sessionBuffers.get(sessionId)!.facts.push({ key, text, source });
}

export function computeCitationScore(
  sessionId: string,
  assistantMessages: string[],
): CitationResult {
  const buffer = _sessionBuffers.get(sessionId);
  const facts = buffer?.facts ?? [];
  const citedKeys: string[] = [];
  const uncitedKeys: string[] = [];
  const confidenceScores: number[] = [];

  for (const fact of facts) {
    const { cited, confidence } = isCitedByJaccard(fact.text, assistantMessages);
    if (cited) {
      citedKeys.push(fact.key);
      confidenceScores.push(confidence);
    } else {
      uncitedKeys.push(fact.key);
    }
  }

  const totalRetrieved = facts.length;
  const totalCited = citedKeys.length;
  const citationRate = totalRetrieved === 0 ? 0 : totalCited / totalRetrieved;
  const matchConfidence = confidenceScores.length === 0 ? 0 : confidenceScores.reduce((s, c) => s + c, 0) / confidenceScores.length;
  return {
    sessionId,
    totalRetrieved,
    totalCited,
    citationRate,
    citedKeys,
    uncitedKeys,
    isHighConfidence: citationRate >= 0.4 && matchConfidence >= 0.25,
    matchConfidence,
    timestamp: new Date().toISOString(),
  };
}

export function recordCitationResult(
  result: CitationResult,
  projectRoot?: string,
): void {
  try {
    const dir = join(projectRoot ?? process.cwd(), ".danteforge");
    mkdirSync(dir, { recursive: true });
    appendFileSync(join(dir, "retrieval-citation-log.json"), JSON.stringify(result) + "\n", "utf-8");
  } catch { /* non-fatal */ }
}

export function loadCitationResults(projectRoot?: string): CitationResult[] {
  try {
    const path = join(projectRoot ?? process.cwd(), ".danteforge", "retrieval-citation-log.json");
    if (!existsSync(path)) return [];
    return readFileSync(path, "utf-8")
      .split("\n")
      .filter(Boolean)
      .map((l) => JSON.parse(l) as CitationResult);
  } catch { return []; }
}

export function getOverallCitationRate(results: CitationResult[]): number {
  if (results.length === 0) return 0;
  const total = results.reduce((s, r) => s + r.totalRetrieved, 0);
  const cited = results.reduce((s, r) => s + r.totalCited, 0);
  return total === 0 ? 0 : cited / total;
}
