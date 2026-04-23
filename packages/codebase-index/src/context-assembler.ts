// ============================================================================
// packages/codebase-index/src/context-assembler.ts
// Priority-ordered context assembly within a token budget.
//
// Harvest: Continue.dev context provider token-budget pattern.
// Higher-priority sources are always included first.
// The last source may be truncated to fit the remaining budget.
// ============================================================================

import type { ContextSource } from "./types.js";

const CHARS_PER_TOKEN = 3.5;

/**
 * Compute approximate token cost for a string.
 * Uses the same 3.5 chars/token estimate as inline-completion.ts.
 */
export function tokenCostOf(text: string): number {
  return Math.ceil(text.length / CHARS_PER_TOKEN);
}

/**
 * Assemble multiple context sources into a single string within a token budget.
 *
 * Algorithm:
 * 1. Sort sources by priority descending (highest first).
 * 2. Include each source in full until budget exhausted.
 * 3. The source that would exceed the budget is truncated to fit.
 * 4. Sources after that are omitted.
 *
 * @param sources      - Context sources to assemble.
 * @param budgetTokens - Maximum total token budget.
 * @returns Assembled context string (may be empty if budget is 0 or sources empty).
 */
export function assembleContext(sources: ContextSource[], budgetTokens: number): string {
  if (budgetTokens <= 0 || sources.length === 0) return "";

  const sorted = [...sources].sort((a, b) => b.priority - a.priority);
  const parts: string[] = [];
  let remaining = budgetTokens;

  for (const source of sorted) {
    if (remaining <= 0) break;
    if (!source.content) continue;

    const cost = tokenCostOf(source.content);
    if (cost <= remaining) {
      parts.push(source.content);
      remaining -= cost;
    } else {
      // Truncate to fit remaining budget
      const maxChars = Math.floor(remaining * CHARS_PER_TOKEN);
      if (maxChars > 0) {
        parts.push(source.content.slice(0, maxChars));
      }
      break;
    }
  }

  return parts.join("\n");
}
