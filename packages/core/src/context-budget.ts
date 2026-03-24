// ============================================================================
// @dantecode/core — Context Window Budget Tracker
// Proactive context window management. Tracks token usage and provides
// dynamic output truncation limits based on remaining budget.
// ============================================================================

import { estimateMessageTokens } from "./token-counter.js";

export interface ContextBudget {
  /** Maximum tokens the model's context window supports. */
  maxTokens: number;
  /** Tokens reserved for the model's response (default 4096). */
  reservedForResponse: number;
  /** Percentage at which to start truncating tool output (default 70). */
  warningThreshold: number;
  /** Percentage at which to aggressively truncate (default 90). */
  hardLimitThreshold: number;
}

export type BudgetTier = "green" | "yellow" | "red" | "critical";

export interface ContextBudgetState {
  /** Estimated current token count across all messages. */
  currentTokens: number;
  /** Usage as a percentage of available budget (0-100). */
  percent: number;
  /** Budget tier based on usage percentage. */
  tier: BudgetTier;
  /** Whether additional tokens of the given count can be added. */
  canAddTokens: (additional: number) => boolean;
  /** Remaining tokens before hitting the hard limit. */
  remainingBudget: () => number;
}

export interface TruncationAdvice {
  /** Whether the output should be truncated. */
  truncate: boolean;
  /** Maximum characters to allow (only meaningful when truncate is true). */
  maxChars: number;
}

const DEFAULT_BUDGET: ContextBudget = {
  maxTokens: 200_000,
  reservedForResponse: 4096,
  warningThreshold: 70,
  hardLimitThreshold: 90,
};

/**
 * Creates a context budget with defaults for unspecified fields.
 */
export function createContextBudget(opts?: Partial<ContextBudget>): ContextBudget {
  return { ...DEFAULT_BUDGET, ...opts };
}

/**
 * Determines the budget tier based on usage percentage.
 */
export function getBudgetTier(percent: number, budget: ContextBudget): BudgetTier {
  if (percent >= budget.hardLimitThreshold) return "critical";
  if (percent >= 80) return "red";
  if (percent >= budget.warningThreshold) return "yellow";
  return "green";
}

/**
 * Check the current context budget state given a set of messages.
 * Uses the existing estimateMessageTokens from token-counter.ts.
 */
export function checkBudget(
  messages: Array<{ role: string; content: string }>,
  budget: ContextBudget,
): ContextBudgetState {
  const currentTokens = estimateMessageTokens(messages);
  const availableTokens = budget.maxTokens - budget.reservedForResponse;
  const percent = availableTokens > 0 ? (currentTokens / availableTokens) * 100 : 100;
  const tier = getBudgetTier(percent, budget);

  return {
    currentTokens,
    percent: Math.min(percent, 100),
    tier,
    canAddTokens: (additional: number) => currentTokens + additional < availableTokens,
    remainingBudget: () => Math.max(0, availableTokens - currentTokens),
  };
}

/**
 * Determines whether tool output should be truncated and to what size.
 * Returns dynamic limits based on remaining budget:
 * - green (<70%): no truncation (50KB max, existing default)
 * - yellow (70-80%): truncate to 10KB
 * - red (80-90%): truncate to 5KB
 * - critical (>90%): truncate to 2KB
 */
export function shouldTruncateToolOutput(
  toolOutput: string,
  budgetState: ContextBudgetState,
): TruncationAdvice {
  const charLimits: Record<BudgetTier, number> = {
    green: 50 * 1024, // 50KB — current default
    yellow: 10 * 1024, // 10KB
    red: 5 * 1024, // 5KB
    critical: 2 * 1024, // 2KB
  };

  const maxChars = charLimits[budgetState.tier];
  return {
    truncate: toolOutput.length > maxChars,
    maxChars,
  };
}
