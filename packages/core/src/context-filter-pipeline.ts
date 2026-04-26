// packages/core/src/context-filter-pipeline.ts
// PRD-26: Context Filter Pipeline — ranks and filters messages by task relevance
// so only high-signal context is kept in the context window (contextEconomy dim).
//
// Pipeline stages:
//   1. Extract code/content chunks from tool-result messages
//   2. Score each message by BM25 relevance to the task query
//   3. Replace low-relevance, large tool outputs with a short summary stub
//   4. Return filtered message array preserving order and all non-tool messages

import { scoreChunkRelevance } from "./repo-context-ranker.js";
import { estimateTokens } from "./token-counter.js";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface FilterableMessage {
  role: string;
  content: string;
}

export interface FilterPipelineOptions {
  /** Token budget: messages above this total before filtering will be filtered. Default: 20000. */
  tokenBudgetThreshold?: number;
  /** BM25 relevance score below which a large tool message is compressed. Default: 0.05. */
  relevanceThreshold?: number;
  /** Messages larger than this token count are candidates for compression. Default: 500. */
  largeMessageTokens?: number;
  /** Always preserve the last N messages regardless of score. Default: 6. */
  preserveRecentCount?: number;
}

export interface FilterPipelineResult {
  messages: FilterableMessage[];
  /** Number of messages that were compressed. */
  compressedCount: number;
  /** Estimated tokens saved. */
  tokensSaved: number;
  /** Whether the pipeline ran (false if budget not exceeded). */
  ran: boolean;
}

// ─── Term extraction ──────────────────────────────────────────────────────────

function extractQueryTerms(query: string): string[] {
  return query
    .split(/\W+/)
    .map((t) => t.toLowerCase())
    .filter((t) => t.length >= 3);
}

// ─── Tool result detection ────────────────────────────────────────────────────

const TOOL_RESULT_PREFIX = /^(Tool execution results:|```[\s\S]{0,20}\n|<tool_result)/;

function isLargeToolMessage(msg: FilterableMessage, largeTokenThreshold: number): boolean {
  if (msg.role !== "user" && msg.role !== "tool") return false;
  if (!TOOL_RESULT_PREFIX.test(msg.content.trimStart())) return false;
  return estimateTokens(msg.content) > largeTokenThreshold;
}

// ─── Relevance scoring ────────────────────────────────────────────────────────

function scoreMessageRelevance(content: string, queryTerms: string[]): number {
  if (queryTerms.length === 0) return 1;
  const chunk = { filePath: "", content, startLine: 0, endLine: 0 };
  return scoreChunkRelevance(chunk, queryTerms, Math.max(content.length, 200));
}

// ─── Compression stub ─────────────────────────────────────────────────────────

function compressMessage(msg: FilterableMessage): FilterableMessage {
  const originalTokens = estimateTokens(msg.content);
  const stub = `[context filtered — ${originalTokens} tokens, low relevance to current task]`;
  return { ...msg, content: stub };
}

// ─── Pipeline ─────────────────────────────────────────────────────────────────

/**
 * Filter a message array to keep only task-relevant context within the token budget.
 *
 * Large tool-result messages that score below the relevance threshold are replaced
 * with a short stub. System, user-intent, and recent messages are always preserved.
 */
export function filterContextByRelevance(
  messages: FilterableMessage[],
  taskQuery: string,
  options: FilterPipelineOptions = {},
): FilterPipelineResult {
  const {
    tokenBudgetThreshold = 20_000,
    relevanceThreshold = 0.05,
    largeMessageTokens = 500,
    preserveRecentCount = 6,
  } = options;

  // Check if filtering is needed
  const totalTokens = messages.reduce((sum, m) => sum + estimateTokens(m.content), 0);
  if (totalTokens <= tokenBudgetThreshold) {
    return { messages, compressedCount: 0, tokensSaved: 0, ran: false };
  }

  const queryTerms = extractQueryTerms(taskQuery);
  const cutoff = Math.max(0, messages.length - preserveRecentCount);

  let compressedCount = 0;
  let tokensSaved = 0;

  const filtered = messages.map((msg, idx): FilterableMessage => {
    // Always preserve recent messages and system messages
    if (idx >= cutoff || msg.role === "system") return msg;

    // Only compress large tool-result messages with low relevance
    if (!isLargeToolMessage(msg, largeMessageTokens)) return msg;

    const relevance = scoreMessageRelevance(msg.content, queryTerms);
    if (relevance < relevanceThreshold) {
      const before = estimateTokens(msg.content);
      const compressed = compressMessage(msg);
      tokensSaved += before - estimateTokens(compressed.content);
      compressedCount++;
      return compressed;
    }

    return msg;
  });

  return { messages: filtered, compressedCount, tokensSaved, ran: true };
}
