import { estimateMessageTokens } from "./token-counter.js";

export interface TextTranscriptMessage {
  role: "user" | "assistant" | "system" | "tool";
  content: string;
}

export interface TranscriptCompactionResult<TMessage extends TextTranscriptMessage> {
  messages: TMessage[];
  strategy: "none" | "summarize_tool_results" | "summarize_history";
  droppedMessages: number;
}

function isDefaultToolResultMessage(message: TextTranscriptMessage): boolean {
  return (
    message.role === "tool" ||
    (message.role === "user" && message.content.startsWith("Tool execution results:"))
  );
}

function defaultProtectedMessage(message: TextTranscriptMessage, index: number): boolean {
  return index === 0 || message.role === "system";
}

function summarizeToolResult(content: string): string {
  const firstMeaningfulLine =
    content
      .split("\n")
      .map((line) => line.trim())
      .find((line) => line.length > 0 && !/^Tool execution results:?$/i.test(line)) ??
    "tool result";

  return `[Summarized tool result] ${firstMeaningfulLine.slice(0, 180)}`;
}

function summarizeHistory(messages: TextTranscriptMessage[]): string {
  const filesTouched = new Set<string>();
  const commandsRun: string[] = [];

  for (const message of messages) {
    for (const match of message.content.matchAll(/\b([\w./-]+\.(?:ts|tsx|js|jsx|json|md|py|rs|go|yaml|yml))\b/g)) {
      filesTouched.add(match[1]!);
    }

    const commandMatch = message.content.match(/(?:command|ran|running)[:\s`]+([^\n`]{4,120})/i);
    if (commandMatch && commandsRun.length < 5) {
      commandsRun.push(commandMatch[1]!.trim());
    }
  }

  const lines = [
    `[Context compacted: ${messages.length} earlier messages summarized]`,
  ];

  if (filesTouched.size > 0) {
    lines.push(`Files referenced: ${[...filesTouched].slice(0, 12).join(", ")}`);
  }
  if (commandsRun.length > 0) {
    lines.push(`Commands run: ${commandsRun.join("; ")}`);
  }

  return lines.join("\n");
}

export function compactTextTranscript<TMessage extends TextTranscriptMessage>(
  messages: TMessage[],
  options: {
    contextWindow: number;
    reserveTokens?: number;
    preserveRecentMessages?: number;
    preserveRecentToolResults?: number;
    isProtectedMessage?: (message: TMessage, index: number) => boolean;
    isToolResultMessage?: (message: TMessage) => boolean;
  },
): TranscriptCompactionResult<TMessage> {
  const reserveTokens = options.reserveTokens ?? Math.min(20_000, Math.max(2_048, Math.floor(options.contextWindow * 0.15)));
  const maxPromptTokens = Math.max(128, options.contextWindow - reserveTokens);
  const isProtectedMessage =
    options.isProtectedMessage ?? ((message: TMessage, index: number) => defaultProtectedMessage(message, index));
  const isToolResultMessage =
    options.isToolResultMessage ?? ((message: TMessage) => isDefaultToolResultMessage(message));
  const preserveRecentMessages = options.preserveRecentMessages ?? 12;
  const preserveRecentToolResults = options.preserveRecentToolResults ?? 4;

  if (estimateMessageTokens(messages) <= maxPromptTokens) {
    return {
      messages,
      strategy: "none",
      droppedMessages: 0,
    };
  }

  const summarized = [...messages];
  let retainedToolResults = 0;
  let summarizedToolResults = 0;

  for (let index = summarized.length - 1; index >= 0; index--) {
    const message = summarized[index]!;
    if (!isToolResultMessage(message) || isProtectedMessage(message, index)) {
      continue;
    }

    retainedToolResults++;
    if (retainedToolResults <= preserveRecentToolResults) {
      continue;
    }

    summarized[index] = {
      ...message,
      content: summarizeToolResult(message.content),
    };
    summarizedToolResults++;
  }

  if (estimateMessageTokens(summarized) <= maxPromptTokens) {
    return {
      messages: summarized as TMessage[],
      strategy: "summarize_tool_results",
      droppedMessages: summarizedToolResults,
    };
  }

  const protectedHead = summarized.filter((message, index) => isProtectedMessage(message as TMessage, index));
  const recentTail = summarized.slice(-preserveRecentMessages);
  const middleStart = protectedHead.length;
  const middleEnd = Math.max(middleStart, summarized.length - preserveRecentMessages);
  const middle = summarized.slice(middleStart, middleEnd);

  const summaryMessage = {
    role: "system",
    content: summarizeHistory(middle),
  } as TMessage;

  const compacted = [...protectedHead, summaryMessage, ...recentTail];

  return {
    messages: compacted,
    strategy: "summarize_history",
    droppedMessages: middle.length,
  };
}
