/**
 * Retry loop detection to prevent agents from getting stuck
 * retrying the same failing operation 5+ times.
 *
 * Pattern extracted from LangGraph retry.ts
 */

export type RetryStatus = 'OK' | 'WARNING' | 'STUCK';

export interface RetryEntry {
  tool: string;
  args: string;
  timestamp: number;
  error?: string;
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }

  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  }

  const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) =>
    a.localeCompare(b),
  );
  return `{${entries
    .map(([key, entryValue]) => `${JSON.stringify(key)}:${stableStringify(entryValue)}`)
    .join(",")}}`;
}

function normalizeText(value: string): string {
  return value.toLowerCase().trim().replace(/\s+/g, " ");
}

function normalizeToolCall(toolCall: { name: string; args: Record<string, unknown> }): string {
  return stableStringify({
    tool: normalizeText(toolCall.name),
    args: toolCall.args,
  });
}

/**
 * Calculate Jaccard similarity between two strings
 * Used to detect semantically similar retries
 * Uses character n-grams for better token matching
 */
function jaccardSimilarity(a: string, b: string): number {
  // Normalize: lowercase and remove extra whitespace
  const normA = a.toLowerCase().trim();
  const normB = b.toLowerCase().trim();

  // If strings are identical, return 1.0
  if (normA === normB) return 1.0;

  // Extract tokens (split on non-alphanumeric characters)
  const tokensA = normA.split(/[^a-z0-9]+/).filter(t => t.length > 0);
  const tokensB = normB.split(/[^a-z0-9]+/).filter(t => t.length > 0);

  const setA = new Set(tokensA);
  const setB = new Set(tokensB);

  const intersection = new Set([...setA].filter(x => setB.has(x)));
  const union = new Set([...setA, ...setB]);

  return union.size === 0 ? 0 : intersection.size / union.size;
}

export class RetryDetector {
  private history: RetryEntry[] = [];
  private readonly maxHistory = 10;
  private readonly warnThreshold = 3;
  private readonly stuckThreshold = 5;
  private readonly similarityThreshold = 0.8;

  /**
   * Detect if the current tool call represents a retry loop
   *
   * @param toolCall - The tool being called
   * @param error - Optional error message from previous attempt
   * @returns RetryStatus indicating OK, WARNING (3+ similar), or STUCK (5+ similar)
   */
  detectLoop(
    toolCall: { name: string; args: Record<string, unknown> },
    error?: string,
  ): RetryStatus {
    return this.recordFailure(toolCall, error);
  }

  /**
   * Get recent retry history for debugging
   */
  getHistory(): RetryEntry[] {
    return [...this.history];
  }

  hydrate(entries: RetryEntry[]): void {
    this.history = entries.slice(-this.maxHistory).map((entry) => ({ ...entry }));
  }

  toJSON(): RetryEntry[] {
    return this.getHistory();
  }

  /**
   * Clear retry history
   */
  reset(): void {
    this.history = [];
  }

  /**
   * Get count of similar attempts for a specific tool call
   */
  getSimilarCount(toolCall: { name: string; args: Record<string, unknown> }): number {
    return this.getSimilarEntries(toolCall).length;
  }

  getSimilarEntries(toolCall: { name: string; args: Record<string, unknown> }): RetryEntry[] {
    const current = normalizeToolCall(toolCall);

    return this.history.filter((entry) => {
      const past = stableStringify({
        tool: normalizeText(entry.tool),
        args: JSON.parse(entry.args) as unknown,
      });
      const similarity = jaccardSimilarity(current, past);
      return similarity > this.similarityThreshold;
    });
  }

  assess(toolCall: { name: string; args: Record<string, unknown> }): RetryStatus {
    return this.statusFromCount(this.getSimilarCount(toolCall));
  }

  recordFailure(
    toolCall: { name: string; args: Record<string, unknown> },
    error?: string,
  ): RetryStatus {
    this.history.push({
      tool: toolCall.name,
      args: stableStringify(toolCall.args),
      timestamp: Date.now(),
      error,
    });

    if (this.history.length > this.maxHistory) {
      this.history.shift();
    }

    return this.assess(toolCall);
  }

  recordSuccess(toolCall: { name: string; args: Record<string, unknown> }): void {
    this.clearSimilar(toolCall);
  }

  clearSimilar(toolCall: { name: string; args: Record<string, unknown> }): void {
    const current = normalizeToolCall(toolCall);
    this.history = this.history.filter((entry) => {
      const past = stableStringify({
        tool: normalizeText(entry.tool),
        args: JSON.parse(entry.args) as unknown,
      });
      const similarity = jaccardSimilarity(current, past);
      return similarity <= this.similarityThreshold;
    });
  }

  private statusFromCount(similarCount: number): RetryStatus {
    if (similarCount >= this.stuckThreshold) {
      return "STUCK";
    }
    if (similarCount >= this.warnThreshold) {
      return "WARNING";
    }
    return "OK";
  }
}

/**
 * Global retry detector instance for cross-module retry tracking
 */
export const globalRetryDetector = new RetryDetector();
