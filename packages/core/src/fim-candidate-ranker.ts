// ============================================================================
// packages/core/src/fim-candidate-ranker.ts
//
// FIM candidate ranking (Sprint BF — dim 1: 7 → 8.5).
// Scores and ranks multiple FIM completions so the best one is presented first.
//
// Scoring factors (weighted):
//   +0.25  completeness: ends with a complete line (not mid-token)
//   +0.20  length quality: 20-200 chars preferred (too short or too long penalized)
//   +0.20  novelty: low Jaccard overlap with the prefix (candidate introduces new tokens)
//   +0.15  indentation match: first visible char matches the expected indent level
//   +0.10  no prefix repetition: doesn't start by repeating the last line of prefix
//   +0.10  syntactic completeness: balanced braces/parens/brackets within candidate
// ============================================================================

import { appendFileSync, mkdirSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";

// ----------------------------------------------------------------------------
// Public types
// ----------------------------------------------------------------------------

export interface FimCandidate {
  text: string;
  score: number; // 0-1 composite
  scoreBreakdown: {
    completeness: number;
    lengthQuality: number;
    novelty: number;
    indentMatch: number;
    noRepetition: number;
    syntacticBalance: number;
  };
}

export interface FimRankingContext {
  prefix: string;
  suffix?: string;
  language: string;
}

export interface FimRankingSession {
  language: string;
  candidateCount: number;
  topScore: number;
  bottomScore: number;
  scoreRange: number; // topScore - bottomScore
  timestamp: string;
}

// ----------------------------------------------------------------------------
// Internal scoring helpers
// ----------------------------------------------------------------------------

/** Tokenize a string into a set of lowercase word-like tokens (length > 1). */
function tokenSet(text: string): Set<string> {
  const tokens = text.toLowerCase().match(/[a-z_][a-z0-9_]*/g) ?? [];
  return new Set(tokens.filter((t) => t.length > 1));
}

/** Jaccard similarity between two token sets (0 = disjoint, 1 = identical). */
function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 1;
  let intersection = 0;
  for (const t of a) { if (b.has(t)) intersection++; }
  const union = a.size + b.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

/** Count net balance of a given pair of open/close characters within text. */
function netBalance(text: string, open: string, close: string): number {
  let balance = 0;
  for (const ch of text) {
    if (ch === open) balance++;
    else if (ch === close) balance--;
  }
  return balance;
}

/** Extract the last non-empty line from a string. */
function lastNonEmptyLine(text: string): string {
  const lines = text.split("\n");
  for (let i = lines.length - 1; i >= 0; i--) {
    const l = lines[i]!.trim();
    if (l.length > 0) return lines[i]!;
  }
  return "";
}

/** Return the leading whitespace of a string's first character. */
function leadingIndent(text: string): string {
  const match = text.match(/^(\s*)/);
  return match ? match[1]! : "";
}

// ----------------------------------------------------------------------------
// scoreFimCandidate
// ----------------------------------------------------------------------------

/**
 * Score a single FIM candidate against the context.
 * Returns a FimCandidate with score in [0, 1] and detailed breakdown.
 */
function scoreCompleteness(candidateText: string): number {
  if (candidateText.endsWith("\n") || candidateText.endsWith("\r\n")) return 0.25;
  return /\w$/.test(candidateText) ? 0.10 : 0;
}

function scoreLengthQuality(len: number): number {
  if (len >= 20 && len <= 200) return 0.20;
  if (len < 5) return 0;
  if (len < 20) return 0.05 + ((len - 5) / 15) * 0.10;
  // len > 200: linear decay from 0.20 down to 0.05 at len=1000
  const excess = Math.min(len - 200, 800);
  return Math.max(0.05, 0.20 - (excess / 800) * 0.15);
}

function scoreIndentMatch(candidateText: string, prefix: string): number {
  const expectedIndent = leadingIndent(lastNonEmptyLine(prefix));
  const candidateIndent = leadingIndent(candidateText);
  if (
    candidateIndent === expectedIndent ||
    candidateIndent.startsWith(expectedIndent) ||
    expectedIndent.startsWith(candidateIndent)
  ) return 0.15;
  return candidateIndent.length === expectedIndent.length ? 0.07 : 0;
}

function scoreNoRepetition(candidateText: string, prefix: string): number {
  const lastLine = lastNonEmptyLine(prefix).trim();
  if (lastLine.length === 0) return 0.10;
  return candidateText.trimStart().startsWith(lastLine) ? 0 : 0.10;
}

function scoreSyntacticBalance(candidateText: string): number {
  const totalImbalance =
    Math.abs(netBalance(candidateText, "{", "}")) +
    Math.abs(netBalance(candidateText, "(", ")")) +
    Math.abs(netBalance(candidateText, "[", "]"));
  if (totalImbalance === 0) return 0.10;
  if (totalImbalance === 1) return 0.05;
  return 0;
}

export function scoreFimCandidate(
  candidateText: string,
  ctx: FimRankingContext,
): FimCandidate {
  const prefixTokens = tokenSet(ctx.prefix);
  const candidateTokens = tokenSet(candidateText);
  const novelty = (1 - jaccard(prefixTokens, candidateTokens)) * 0.20;

  const breakdown = {
    completeness: scoreCompleteness(candidateText),
    lengthQuality: scoreLengthQuality(candidateText.length),
    novelty,
    indentMatch: scoreIndentMatch(candidateText, ctx.prefix),
    noRepetition: scoreNoRepetition(candidateText, ctx.prefix),
    syntacticBalance: scoreSyntacticBalance(candidateText),
  };

  const raw =
    breakdown.completeness +
    breakdown.lengthQuality +
    breakdown.novelty +
    breakdown.indentMatch +
    breakdown.noRepetition +
    breakdown.syntacticBalance;
  const score = Math.min(1, Math.max(0, raw));

  return { text: candidateText, score, scoreBreakdown: breakdown };
}

// ----------------------------------------------------------------------------
// rankFimCandidates
// ----------------------------------------------------------------------------

/**
 * Score and rank multiple candidates. Returns sorted descending by score.
 * Deduplicates candidates with identical trimmed text.
 */
export function rankFimCandidates(
  candidates: string[],
  ctx: FimRankingContext,
): FimCandidate[] {
  if (candidates.length === 0) return [];

  // Deduplicate by trimmed text
  const seen = new Set<string>();
  const unique: string[] = [];
  for (const c of candidates) {
    const key = c.trim();
    if (!seen.has(key)) {
      seen.add(key);
      unique.push(c);
    }
  }

  const scored = unique.map((c) => scoreFimCandidate(c, ctx));
  scored.sort((a, b) => b.score - a.score);
  return scored;
}

// ----------------------------------------------------------------------------
// pickBestFimCandidate
// ----------------------------------------------------------------------------

/**
 * Returns the text of the best candidate, or null if list is empty.
 */
export function pickBestFimCandidate(
  candidates: string[],
  ctx: FimRankingContext,
): string | null {
  if (candidates.length === 0) return null;
  const ranked = rankFimCandidates(candidates, ctx);
  return ranked[0]?.text ?? null;
}

// ----------------------------------------------------------------------------
// Persistence helpers
// ----------------------------------------------------------------------------

const DEFAULT_RANKING_LOG = ".danteforge/fim-ranking-log.json";

function resolveRankingLog(projectRoot: string): string {
  return join(projectRoot, DEFAULT_RANKING_LOG);
}

/**
 * Append a ranking session entry to .danteforge/fim-ranking-log.json (JSONL).
 */
export function recordFimRankingSession(
  session: Omit<FimRankingSession, "timestamp">,
  projectRoot: string,
): void {
  const logPath = resolveRankingLog(projectRoot);
  mkdirSync(dirname(logPath), { recursive: true });
  const entry: FimRankingSession = {
    ...session,
    timestamp: new Date().toISOString(),
  };
  appendFileSync(logPath, JSON.stringify(entry) + "\n", "utf-8");
}

/** Read and parse all JSONL session entries from the ranking log. */
export function loadFimRankingLog(projectRoot: string): FimRankingSession[] {
  const logPath = resolveRankingLog(projectRoot);
  try {
    const raw = readFileSync(logPath, "utf-8");
    return raw
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0)
      .map((line) => JSON.parse(line) as FimRankingSession);
  } catch {
    return [];
  }
}

// ----------------------------------------------------------------------------
// Convenience alias — used by vscode inline-completion.ts wiring (Sprint BI)
// ----------------------------------------------------------------------------

/**
 * Alias for `rankFimCandidates` — score and sort candidates by quality.
 * Returns FimCandidate[] sorted descending by score.
 * This is the canonical entry point used by the VS Code completion provider.
 */
export const rankCandidates = rankFimCandidates;

// ----------------------------------------------------------------------------
// Stats
// ----------------------------------------------------------------------------

export function getFimRankingStats(sessions: FimRankingSession[]): {
  avgTopScore: number;
  avgScoreRange: number;
  avgCandidateCount: number;
} {
  if (sessions.length === 0) {
    return { avgTopScore: 0, avgScoreRange: 0, avgCandidateCount: 0 };
  }
  const n = sessions.length;
  const avgTopScore = sessions.reduce((acc, s) => acc + s.topScore, 0) / n;
  const avgScoreRange = sessions.reduce((acc, s) => acc + s.scoreRange, 0) / n;
  const avgCandidateCount = sessions.reduce((acc, s) => acc + s.candidateCount, 0) / n;
  return { avgTopScore, avgScoreRange, avgCandidateCount };
}
