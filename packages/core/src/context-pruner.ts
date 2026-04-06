// ============================================================================
// @dantecode/core — Context Pruner
// Dynamic context pruning: estimates token usage and drops old messages while
// preserving inception (bedrock) messages and the most recent exchanges.
// ============================================================================

export interface PruneResult {
  pruned: Array<{ role: string; content: string }>;
  droppedCount: number;
  summary: string;
}

export class ContextPruner {
  /**
   * Rough token estimate: 1 token ≈ 4 characters.
   */
  estimateTokens(text: string): number {
    return Math.ceil(text.length / 4);
  }

  /**
   * Estimates total tokens for a message array and decides whether pruning
   * is needed. Pruning fires when:
   *   - estimatedTokens > 0.75 * contextWindow, AND
   *   - messageCount > 10  (avoid compacting tiny conversations)
   */
  shouldPrune(
    messages: Array<{ role: string; content: string }>,
    contextWindow: number,
  ): boolean {
    if (messages.length <= 10) return false;

    const totalChars = messages.reduce((sum, m) => {
      const content = typeof m.content === "string" ? m.content : JSON.stringify(m.content);
      return sum + content.length;
    }, 0);

    const estimatedTokens = Math.ceil(totalChars / 4);
    return estimatedTokens > 0.75 * contextWindow;
  }

  /**
   * Prunes a message list, keeping:
   *   1. All inception (bedrock) messages re-injected at the front.
   *   2. The last `keepLast` messages verbatim.
   *   3. A single compaction summary notice for dropped messages.
   *
   * @param messages        Full message history.
   * @param inceptionMessages  Permanent bedrock message contents.
   * @param keepLast        Number of tail messages to preserve (default 6).
   */
  prune(
    messages: Array<{ role: string; content: string }>,
    inceptionMessages: string[],
    keepLast = 6,
  ): PruneResult {
    const effective = Math.max(keepLast, 0);

    // Nothing to prune if the list is already small
    if (messages.length <= effective + inceptionMessages.length) {
      return { pruned: messages.slice(), droppedCount: 0, summary: "" };
    }

    const tail = messages.slice(-effective);
    const middle = messages.slice(0, messages.length - effective);

    // Filter out messages whose content is an inception message (they'll be re-added)
    const droppedMessages = middle.filter(
      (m) => !inceptionMessages.includes(m.content),
    );
    const droppedCount = droppedMessages.length;

    // Build compaction notice
    const summary =
      droppedCount > 0
        ? `[Context compacted: ${droppedCount} earlier message(s) summarized to save context window. Key information preserved in system context.]`
        : "";

    // Reconstruct: inception bedrock + compaction notice + tail
    const pruned: Array<{ role: string; content: string }> = [];

    // 1. Re-inject inception messages
    for (const content of inceptionMessages) {
      pruned.push({ role: "system", content });
    }

    // 2. Compaction notice (only when messages were actually dropped)
    if (droppedCount > 0) {
      pruned.push({
        role: "system",
        content: summary,
      });
    }

    // 3. Tail messages verbatim
    pruned.push(...tail);

    return { pruned, droppedCount, summary };
  }
}
