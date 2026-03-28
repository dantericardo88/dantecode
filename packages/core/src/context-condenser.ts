// ============================================================================
// @dantecode/core — Context Condenser
// Automatically condenses conversation context when token pressure exceeds 80%.
// Preserves system prompts, recent rounds, receipts, and file paths while
// summarizing middle rounds using a cheap model.
// ============================================================================

import type { CoreMessage } from "ai";
import { estimateTokens } from "./token-counter.js";

// ----------------------------------------------------------------------------
// Types
// ----------------------------------------------------------------------------

export interface ContextPressure {
  /** Estimated tokens currently used */
  usedTokens: number;
  /** Maximum tokens allowed in context window */
  maxTokens: number;
  /** Usage percentage (0-100) */
  percent: number;
  /** Status: green (<50%), yellow (50-80%), red (>80%) */
  status: "green" | "yellow" | "red";
}

export interface CondenseOptions {
  /** Target percentage after condensing (default: 50) */
  targetPercent?: number;
  /** Number of recent rounds to preserve (default: 3) */
  preserveRecentRounds?: number;
  /** Custom LLM summarization function (for testing/DI) */
  summarizeFn?: (rounds: CoreMessage[]) => Promise<string>;
}

export interface CondenseResult {
  /** Condensed message array */
  messages: CoreMessage[];
  /** Original token count */
  beforeTokens: number;
  /** New token count after condensing */
  afterTokens: number;
  /** Number of rounds condensed */
  roundsCondensed: number;
}

// ----------------------------------------------------------------------------
// Constants
// ----------------------------------------------------------------------------

const RECEIPT_MARKERS = [
  "Receipt ID:",
  "Evidence Chain:",
  "Seal ID:",
  "PDSE Score:",
  "Verification:",
  "[RECEIPT]",
  "run.receipt",
];

const FILE_PATH_PATTERNS = [
  /(?:^|\s)([a-zA-Z]:[/\\][\w\-./\\]+)/g, // Windows absolute paths
  /(?:^|\s)(\/[\w\-./]+)/g, // Unix absolute paths
  /(?:^|\s)(\.\/[\w\-./]+)/g, // Relative paths
  /(?:^|\s)([\w\-]+\/[\w\-./]+)/g, // Generic paths
];

// ----------------------------------------------------------------------------
// Pressure Calculation
// ----------------------------------------------------------------------------

/**
 * Calculate current context pressure from message array.
 * Uses estimateTokens for each message content.
 */
export function calculatePressure(messages: CoreMessage[], maxTokens: number): ContextPressure {
  const usedTokens = messages.reduce((sum, msg) => {
    const content = extractMessageContent(msg);
    return sum + estimateTokens(content) + 4; // +4 for message overhead
  }, 0);

  const percent = maxTokens > 0 ? Math.min(100, Math.round((usedTokens / maxTokens) * 100)) : 0;
  const status = percent >= 80 ? "red" : percent >= 50 ? "yellow" : "green";

  return { usedTokens, maxTokens, percent, status };
}

// ----------------------------------------------------------------------------
// Context Condensing
// ----------------------------------------------------------------------------

/**
 * Condense context when pressure is too high.
 *
 * Strategy:
 * - Keep: system prompt (first message), last N rounds, receipts, file paths
 * - Condense: middle rounds into a summary
 * - Target: reduce to <50% of max tokens
 */
export async function condenseContext(
  messages: CoreMessage[],
  maxTokens: number,
  options: CondenseOptions = {},
): Promise<CondenseResult> {
  const {
    preserveRecentRounds = 3,
    summarizeFn = defaultSummarizeFn,
  } = options;

  if (messages.length === 0) {
    return {
      messages: [],
      beforeTokens: 0,
      afterTokens: 0,
      roundsCondensed: 0,
    };
  }

  const beforePressure = calculatePressure(messages, maxTokens);
  const beforeTokens = beforePressure.usedTokens;

  // Identify segments
  const systemMessage = messages[0]?.role === "system" ? messages[0] : null;
  const conversationStart = systemMessage ? 1 : 0;

  // Calculate how many recent messages to preserve (rounds = user + assistant pairs)
  const preserveCount = preserveRecentRounds * 2; // Each round = user + assistant
  const recentMessages = messages.slice(-preserveCount);

  // Middle messages to condense (excluding system and recent)
  const middleMessages = messages.slice(conversationStart, messages.length - preserveCount);

  // If nothing to condense, return original
  if (middleMessages.length === 0) {
    return {
      messages,
      beforeTokens,
      afterTokens: beforeTokens,
      roundsCondensed: 0,
    };
  }

  // Extract critical information from middle rounds
  const criticalInfo = extractCriticalInfo(middleMessages);

  // Summarize middle rounds
  const summary = await summarizeFn(middleMessages);

  // Build condensed summary message
  const summaryMessage: CoreMessage = {
    role: "system",
    content: buildSummaryContent(summary, criticalInfo),
  };

  // Reconstruct message array
  const condensedMessages: CoreMessage[] = [];

  if (systemMessage) {
    condensedMessages.push(systemMessage);
  }

  condensedMessages.push(summaryMessage);
  condensedMessages.push(...recentMessages);

  const afterPressure = calculatePressure(condensedMessages, maxTokens);
  const afterTokens = afterPressure.usedTokens;
  const roundsCondensed = Math.floor(middleMessages.length / 2);

  return {
    messages: condensedMessages,
    beforeTokens,
    afterTokens,
    roundsCondensed,
  };
}

// ----------------------------------------------------------------------------
// Critical Information Extraction
// ----------------------------------------------------------------------------

interface CriticalInfo {
  receipts: string[];
  filePaths: string[];
  errors: string[];
}

/**
 * Extract receipts, file paths, and errors from messages.
 * These must be preserved even when condensing.
 */
function extractCriticalInfo(messages: CoreMessage[]): CriticalInfo {
  const receipts: string[] = [];
  const filePaths = new Set<string>();
  const errors: string[] = [];

  for (const msg of messages) {
    const content = extractMessageContent(msg);

    // Extract receipts
    for (const marker of RECEIPT_MARKERS) {
      if (content.includes(marker)) {
        const lines = content.split("\n");
        const receiptLines = lines.filter((line) => line.includes(marker));
        receipts.push(...receiptLines);
      }
    }

    // Extract file paths
    for (const pattern of FILE_PATH_PATTERNS) {
      const matches = content.matchAll(pattern);
      for (const match of matches) {
        if (match[1]) {
          filePaths.add(match[1]);
        }
      }
    }

    // Extract errors
    if (content.toLowerCase().includes("error") || content.toLowerCase().includes("failed")) {
      const lines = content.split("\n");
      const errorLines = lines.filter(
        (line) =>
          line.toLowerCase().includes("error") ||
          line.toLowerCase().includes("failed") ||
          line.toLowerCase().includes("exception"),
      );
      errors.push(...errorLines.slice(0, 5)); // Limit to 5 error lines per message
    }
  }

  return {
    receipts: Array.from(new Set(receipts)), // Deduplicate
    filePaths: Array.from(filePaths),
    errors: Array.from(new Set(errors)).slice(0, 10), // Limit total errors to 10
  };
}

/**
 * Build summary content with critical info preserved.
 */
function buildSummaryContent(summary: string, criticalInfo: CriticalInfo): string {
  const parts: string[] = [];

  parts.push("## Context Summary (Condensed)");
  parts.push("");
  parts.push(summary);

  if (criticalInfo.receipts.length > 0) {
    parts.push("");
    parts.push("### Receipts");
    parts.push(criticalInfo.receipts.join("\n"));
  }

  if (criticalInfo.filePaths.length > 0) {
    parts.push("");
    parts.push("### File Paths Referenced");
    parts.push(criticalInfo.filePaths.join("\n"));
  }

  if (criticalInfo.errors.length > 0) {
    parts.push("");
    parts.push("### Errors Encountered");
    parts.push(criticalInfo.errors.join("\n"));
  }

  return parts.join("\n");
}

// ----------------------------------------------------------------------------
// Summarization
// ----------------------------------------------------------------------------

/**
 * Default summarization function.
 * In production, this should call a cheap LLM (e.g., Haiku).
 * For now, provides a structured extraction-based summary.
 */
async function defaultSummarizeFn(messages: CoreMessage[]): Promise<string> {
  const userActions: string[] = [];
  const assistantActions: string[] = [];
  const tools = new Set<string>();

  for (const msg of messages) {
    const content = extractMessageContent(msg);

    if (msg.role === "user") {
      // Extract user intent (first 100 chars)
      const intent = content.split("\n")[0]?.trim().slice(0, 100) ?? "";
      if (intent && intent.length > 10) {
        userActions.push(intent);
      }
    } else if (msg.role === "assistant") {
      // Extract tool usage
      const toolMatches = content.match(/<invoke name="([^"]+)">/g);
      if (toolMatches) {
        for (const match of toolMatches) {
          const toolName = match.match(/name="([^"]+)"/)?.[1];
          if (toolName) tools.add(toolName);
        }
      }

      // Extract key actions (lines starting with action verbs)
      const lines = content.split("\n");
      const actionLines = lines.filter((line) =>
        /^(Created|Modified|Updated|Added|Removed|Fixed|Implemented|Built|Tested|Verified)/i.test(
          line,
        ),
      );
      assistantActions.push(...actionLines.slice(0, 3)); // Limit to 3 per message
    }
  }

  const parts: string[] = [];

  parts.push(`Summarizing ${messages.length} messages (${Math.floor(messages.length / 2)} rounds).`);

  if (userActions.length > 0) {
    parts.push("");
    parts.push("**User Requests:**");
    parts.push(...userActions.slice(0, 5).map((a) => `- ${a}`));
    if (userActions.length > 5) {
      parts.push(`- ... and ${userActions.length - 5} more`);
    }
  }

  if (tools.size > 0) {
    parts.push("");
    parts.push("**Tools Used:**");
    parts.push(Array.from(tools).join(", "));
  }

  if (assistantActions.length > 0) {
    parts.push("");
    parts.push("**Actions Completed:**");
    parts.push(...assistantActions.slice(0, 10).map((a) => `- ${a}`));
    if (assistantActions.length > 10) {
      parts.push(`- ... and ${assistantActions.length - 10} more`);
    }
  }

  return parts.join("\n");
}

// ----------------------------------------------------------------------------
// Helpers
// ----------------------------------------------------------------------------

/**
 * Extract string content from CoreMessage (handles string or content block array).
 */
function extractMessageContent(msg: CoreMessage): string {
  if (typeof msg.content === "string") {
    return msg.content;
  }

  // Handle content block array (from AI SDK)
  if (Array.isArray(msg.content)) {
    return msg.content
      .map((block) => {
        if ("text" in block) return block.text;
        if ("image" in block) return "[image]";
        if ("toolCall" in block) {
          const toolCall = block.toolCall as { toolName?: string };
          return `[tool: ${toolCall.toolName ?? "unknown"}]`;
        }
        if ("toolResult" in block) {
          const toolResult = block.toolResult as { toolCallId?: string };
          return `[result: ${toolResult.toolCallId ?? "unknown"}]`;
        }
        return "";
      })
      .join("\n");
  }

  return "";
}

/**
 * Estimate tokens for a message (for testing/validation).
 */
export function estimateMessageTokens(msg: CoreMessage): number {
  const content = extractMessageContent(msg);
  return estimateTokens(content) + 4; // +4 for message overhead
}
