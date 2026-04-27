// Context compaction utilities — prevent overflow before LLM calls.
// Three-phase strategy used by sidebar-provider: prune tool outputs,
// then LLM-compact remaining history if still too large.

export interface CompactorMessage {
  role: "user" | "assistant" | "system";
  content: string;
}

/** Rough token estimate: 4 chars per token. */
function estimateTokens(messages: CompactorMessage[]): number {
  return Math.ceil(messages.reduce((sum, m) => sum + m.content.length, 0) / 4);
}

/**
 * Returns true if the current messages would exceed
 * contextWindow minus the reserved buffer.
 */
export function wouldOverflow(
  messages: CompactorMessage[],
  contextWindow: number,
  reservedTokens: number,
): boolean {
  return estimateTokens(messages) > contextWindow - reservedTokens;
}

/**
 * Truncates tool-result content in older messages to reduce context size.
 * Preserves the 4 most-recent messages untouched so live context is intact.
 *
 * Returns the pruned array and the approximate number of tokens saved.
 */
export function pruneToolOutputs(messages: CompactorMessage[]): {
  pruned: CompactorMessage[];
  savedTokens: number;
} {
  const KEEP_RECENT = 4;
  const TOOL_RESULT_RE = /^(Tool execution results|Running:|\[TRUNCATED)/;
  const MAX_TOOL_LEN = 600;

  let saved = 0;
  const pruned = messages.map((msg, idx) => {
    if (idx >= messages.length - KEEP_RECENT) return msg;
    if (msg.role === "user" && TOOL_RESULT_RE.test(msg.content.trimStart())) {
      const original = msg.content;
      const lines = original.split("\n");
      if (lines.length > 10 || original.length > MAX_TOOL_LEN) {
        const truncated = original.slice(0, MAX_TOOL_LEN) + "\n[...pruned for context economy]";
        saved += Math.ceil((original.length - truncated.length) / 4);
        return { ...msg, content: truncated };
      }
    }
    return msg;
  });

  return { pruned, savedTokens: saved };
}

/**
 * Compacts older messages by asking the LLM to summarize them.
 * Preserves the 6 most-recent messages as-is and replaces the rest
 * with a single summary injected at position 0.
 */
export async function compactContext(
  messages: CompactorMessage[],
  currentTask: string,
  llmCall: (prompt: string) => Promise<string>,
): Promise<CompactorMessage[]> {
  const KEEP_RECENT = 6;
  if (messages.length <= KEEP_RECENT) return messages;

  const older = messages.slice(0, messages.length - KEEP_RECENT);
  const recent = messages.slice(messages.length - KEEP_RECENT);

  const transcript = older.map((m) => `[${m.role}]: ${m.content}`).join("\n\n");
  const prompt =
    `Summarize the following conversation transcript in 3-5 bullet points. ` +
    `Focus on what was decided, what tools were executed, and what their results were. ` +
    `The current task is: ${currentTask}\n\nTranscript:\n${transcript}`;

  let summary: string;
  try {
    summary = await llmCall(prompt);
  } catch {
    // Compaction is best-effort; return original on failure.
    return messages;
  }

  const summaryMessage: CompactorMessage = {
    role: "user",
    content: `[Context summary — earlier session history]\n${summary}`,
  };

  return [summaryMessage, ...recent];
}
