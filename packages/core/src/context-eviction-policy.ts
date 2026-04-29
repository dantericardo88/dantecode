// packages/core/src/context-eviction-policy.ts
// Context Eviction Policy — smart message priority scoring and tiered eviction.
// Closes dim 24 gap vs Claude Code (9/10) which has sophisticated context management.
//
// Algorithm:
//   1. Score each message by recency, type, content size, and code relevance
//   2. Tier messages: ESSENTIAL (never evict), STANDARD (compress first), DISPENSABLE (evict first)
//   3. When budget exceeded: evict DISPENSABLE first, then compress STANDARD, preserve ESSENTIAL
//
// Pattern: OpenHands condensation_request.py + Aider context window management.

// ─── Types ────────────────────────────────────────────────────────────────────

export type MessageRole = "system" | "user" | "assistant" | "tool";

export interface ScoredMessage {
  role: MessageRole;
  content: string;
  /** Token estimate (content.length / 4) */
  tokens: number;
  /** Priority score: higher = more important to keep */
  score: number;
  /** Tier assignment */
  tier: "essential" | "standard" | "dispensable";
  /** Original index in the message array */
  index: number;
}

export type EvictionTier = "essential" | "standard" | "dispensable";

export interface EvictionResult {
  /** Messages to keep (in original order) */
  kept: Array<{ role: MessageRole; content: string }>;
  /** How many messages were evicted */
  evictedCount: number;
  /** How many tokens were freed */
  tokensFreed: number;
  /** How many tokens remain */
  tokensRemaining: number;
}

// ─── Token Estimation ─────────────────────────────────────────────────────────

const CHARS_PER_TOKEN = 4;

export function estimateTokens(content: string): number {
  return Math.ceil(content.length / CHARS_PER_TOKEN);
}

// ─── Message Scorer ───────────────────────────────────────────────────────────

const CODE_FENCE_RE = /```[\s\S]*?```/g;
const FILE_PATH_RE = /\b\w+\/[\w./]+\.(ts|js|py|rs|go|java|tsx|jsx)\b/;
const STACK_TRACE_RE = /at \w+ \(.+:\d+:\d+\)/;

/**
 * Score a single message for eviction priority.
 * Higher score = keep. Lower score = evict first.
 *
 * Factors:
 * - Recency: recent messages score higher (exponential decay)
 * - Role: system > user > assistant > tool
 * - Code content: messages with code blocks score higher
 * - Error signals: messages with errors score higher (debugging context)
 * - Size: very large messages score lower (big tool dumps are usually skimmable)
 */
export function scoreMessage(
  message: { role: MessageRole; content: string },
  index: number,
  totalMessages: number,
): number {
  let score = 0;

  // Recency factor: exponential — last 10% of messages get highest boost
  const recencyRatio = (index + 1) / totalMessages;
  score += recencyRatio * 40;  // 0–40 points

  // Role weight
  const roleWeights: Record<MessageRole, number> = {
    system: 30,
    user: 25,
    assistant: 15,
    tool: 5,
  };
  score += roleWeights[message.role] ?? 5;

  // Code content bonus
  const codeMatches = message.content.match(CODE_FENCE_RE);
  if (codeMatches && codeMatches.length > 0) {
    score += Math.min(15, codeMatches.length * 5);
  }

  // File path mention bonus
  if (FILE_PATH_RE.test(message.content)) {
    score += 5;
  }

  // Error/stack trace bonus (critical for debugging)
  if (STACK_TRACE_RE.test(message.content) || /error|exception|failed/i.test(message.content)) {
    score += 8;
  }

  // Size penalty: very large messages (>2000 tokens) are penalized
  const tokens = estimateTokens(message.content);
  if (tokens > 2000) {
    score -= Math.min(20, Math.floor((tokens - 2000) / 500) * 5);
  }

  // Tool result with just "OK" or short success messages — dispensable
  if (message.role === "tool" && tokens < 20) {
    score -= 10;
  }

  return Math.max(0, score);
}

// ─── Tier Assignment ──────────────────────────────────────────────────────────

/**
 * Assign eviction tier based on score and position.
 *
 * - essential: system messages + last 2 user/assistant pairs (always keep)
 * - standard: middle conversation (compress before evict)
 * - dispensable: old tool results, very low score messages (evict first)
 */
export function assignTier(
  scored: ScoredMessage,
  totalMessages: number,
  essentialTailCount = 4,
): EvictionTier {
  // System messages are always essential
  if (scored.role === "system") return "essential";

  // Last N messages are essential (preserve recent context)
  if (scored.index >= totalMessages - essentialTailCount) return "essential";

  // Low score → dispensable
  if (scored.score < 20) return "dispensable";

  // Tool results are standard unless they scored high (had code blocks)
  if (scored.role === "tool" && scored.score < 35) return "standard";

  return "standard";
}

// ─── Context Compressor ───────────────────────────────────────────────────────

/**
 * Compress a single message's content to reduce token usage.
 * Strategies:
 * - Tool results: keep first line + last line + "... (N lines omitted)"
 * - Long assistant messages: keep first 500 chars + summary note
 */
export function compressMessageContent(role: MessageRole, content: string, maxTokens = 500): string {
  const maxChars = maxTokens * CHARS_PER_TOKEN;
  if (content.length <= maxChars) return content;

  if (role === "tool") {
    const lines = content.split("\n");
    if (lines.length <= 5) return content.slice(0, maxChars) + "\n… (truncated)";
    const kept = [...lines.slice(0, 3), `… (${lines.length - 6} lines omitted) …`, ...lines.slice(-3)];
    return kept.join("\n");
  }

  // For user/assistant: preserve start
  return content.slice(0, maxChars) + "\n… (content compressed — see earlier context)";
}

// ─── Main Eviction Engine ─────────────────────────────────────────────────────

export interface EvictionOptions {
  /** Target token budget after eviction */
  targetTokenBudget: number;
  /** Preserve this many messages at the tail (default: 4) */
  essentialTailCount?: number;
  /** Compress instead of evict standard messages when possible */
  preferCompression?: boolean;
  /** Max tokens per compressed message (default: 500) */
  compressionMaxTokens?: number;
}

/**
 * Evict messages from a conversation to fit within a token budget.
 * Uses tiered priority scoring to preserve the most important context.
 *
 * Algorithm:
 * 1. Score and tier all messages
 * 2. Evict DISPENSABLE messages until budget is met
 * 3. If still over budget: compress STANDARD messages
 * 4. If still over budget: evict STANDARD messages (lowest score first)
 * 5. ESSENTIAL messages are never removed
 */
interface EvictionAccumulator {
  scored: ScoredMessage[];
  totalTokens: number;
  evictedCount: number;
  tokensFreed: number;
}

/** Drop messages of `tier`, lowest-score first, until the running total is at
 *  or under `targetTokenBudget`. Mutates the accumulator. */
function evictByTier(
  acc: EvictionAccumulator,
  tier: EvictionTier,
  targetTokenBudget: number,
): void {
  if (acc.totalTokens <= targetTokenBudget) return;
  const candidates = acc.scored
    .filter((m) => m.tier === tier)
    .sort((a, b) => a.score - b.score);
  for (const msg of candidates) {
    if (acc.totalTokens <= targetTokenBudget) break;
    const idx = acc.scored.findIndex((s) => s.index === msg.index);
    if (idx === -1) continue;
    acc.totalTokens -= acc.scored[idx]!.tokens;
    acc.tokensFreed += acc.scored[idx]!.tokens;
    acc.scored.splice(idx, 1);
    acc.evictedCount++;
  }
}

/** Compress oversized standard messages largest-first until at budget. */
function compressOversizedStandard(
  acc: EvictionAccumulator,
  targetTokenBudget: number,
  compressionMaxTokens: number,
): void {
  if (acc.totalTokens <= targetTokenBudget) return;
  const compressible = acc.scored
    .filter((m) => m.tier === "standard" && m.tokens > compressionMaxTokens)
    .sort((a, b) => b.tokens - a.tokens);
  for (const msg of compressible) {
    if (acc.totalTokens <= targetTokenBudget) break;
    const compressed = compressMessageContent(msg.role, msg.content, compressionMaxTokens);
    const newTokens = estimateTokens(compressed);
    const saved = msg.tokens - newTokens;
    if (saved <= 0) continue;
    acc.totalTokens -= saved;
    acc.tokensFreed += saved;
    const idx = acc.scored.findIndex((s) => s.index === msg.index);
    if (idx !== -1) {
      acc.scored[idx]!.content = compressed;
      acc.scored[idx]!.tokens = newTokens;
    }
  }
}

export function evictToFitBudget(
  messages: Array<{ role: MessageRole; content: string }>,
  opts: EvictionOptions,
): EvictionResult {
  const { targetTokenBudget, essentialTailCount = 4, preferCompression = true, compressionMaxTokens = 500 } = opts;

  const scored: ScoredMessage[] = messages.map((m, i) => ({
    ...m,
    tokens: estimateTokens(m.content),
    score: scoreMessage(m, i, messages.length),
    tier: "standard" as EvictionTier,
    index: i,
  }));
  for (const sm of scored) sm.tier = assignTier(sm, messages.length, essentialTailCount);

  const acc: EvictionAccumulator = {
    scored,
    totalTokens: scored.reduce((sum, m) => sum + m.tokens, 0),
    evictedCount: 0,
    tokensFreed: 0,
  };

  evictByTier(acc, "dispensable", targetTokenBudget);
  if (preferCompression) compressOversizedStandard(acc, targetTokenBudget, compressionMaxTokens);
  evictByTier(acc, "standard", targetTokenBudget);

  acc.scored.sort((a, b) => a.index - b.index);
  return {
    kept: acc.scored.map((m) => ({ role: m.role, content: m.content })),
    evictedCount: acc.evictedCount,
    tokensFreed: acc.tokensFreed,
    tokensRemaining: acc.totalTokens,
  };
}

// ─── Context Budget Advisor ───────────────────────────────────────────────────

export type ContextPressure = "normal" | "elevated" | "high" | "critical";

export interface ContextBudgetStatus {
  usedTokens: number;
  maxTokens: number;
  utilization: number;  // 0.0–1.0
  pressure: ContextPressure;
  /** Recommended action */
  recommendation: string;
}

/**
 * Assess context pressure and recommend action.
 * Used to drive adaptive behavior in the agent loop.
 */
export function assessContextBudget(usedTokens: number, maxTokens: number): ContextBudgetStatus {
  const utilization = maxTokens > 0 ? usedTokens / maxTokens : 0;
  let pressure: ContextPressure;
  let recommendation: string;

  if (utilization < 0.60) {
    pressure = "normal";
    recommendation = "No action needed";
  } else if (utilization < 0.75) {
    pressure = "elevated";
    recommendation = "Consider compressing old tool results";
  } else if (utilization < 0.90) {
    pressure = "high";
    recommendation = "Evict dispensable messages and compress standard messages";
  } else {
    pressure = "critical";
    recommendation = "Immediate eviction required — compact all dispensable and standard messages";
  }

  return { usedTokens, maxTokens, utilization, pressure, recommendation };
}
