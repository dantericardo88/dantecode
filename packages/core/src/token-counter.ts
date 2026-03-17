// ============================================================================
// @dantecode/core — Token Estimation Utility
// Provides more accurate token estimation than chars/4 for context management.
// ============================================================================

/**
 * Estimates the number of tokens in a text string.
 * Uses word-based estimation (GPT-4 class models average ~1.3 tokens per word
 * for English text, with higher density for code).
 */
export function estimateTokens(text: string): number {
  if (!text) return 0;

  // Split on whitespace and punctuation boundaries
  const words = text.split(/\s+/).filter((w) => w.length > 0);
  const wordCount = words.length;

  // Code tends to have more tokens per word due to punctuation, operators, etc.
  const codeIndicators = /[{}\[\]();=><|&!~^%+\-*\/]/g;
  const codeMatches = text.match(codeIndicators);
  const codeCharCount = codeMatches?.length ?? 0;
  const codeRatio = text.length > 0 ? codeCharCount / text.length : 0;

  // Base: 1.3 tokens per word, add code density bonus
  const baseTokens = wordCount * 1.3;
  const codeBonusMultiplier = 1 + codeRatio * 0.5; // Up to 1.5x for heavy code

  return Math.ceil(baseTokens * codeBonusMultiplier);
}

/**
 * Estimates total tokens across an array of messages.
 */
export function estimateMessageTokens(
  messages: Array<{ role: string; content: string }>,
): number {
  let total = 0;
  for (const msg of messages) {
    // Each message has ~4 tokens of overhead (role, delimiters)
    total += 4 + estimateTokens(msg.content);
  }
  return total;
}
