import { describe, expect, it } from "vitest";
import {
  compactTextTranscript,
  type TextTranscriptMessage,
} from "./transcript-compaction.js";

function makeToolResult(index: number): TextTranscriptMessage {
  return {
    role: "user",
    content:
      `Tool execution results:\n\nTool "Read" result:\n` +
      `src/file-${index}.ts\n` +
      "token ".repeat(180),
  };
}

describe("compactTextTranscript", () => {
  it("keeps protected system messages and recent activity intact", () => {
    const messages: TextTranscriptMessage[] = [
      { role: "system", content: "system policy" },
      { role: "user", content: "Please fix the bug." },
      ...Array.from({ length: 8 }, (_, index) => makeToolResult(index)),
      { role: "assistant", content: "I found the root cause." },
      makeToolResult(99),
    ];

    const result = compactTextTranscript(messages, {
      contextWindow: 500,
      reserveTokens: 80,
    });

    expect(result.strategy).not.toBe("none");
    expect(result.messages[0]).toEqual(messages[0]);
    expect(result.messages.some((message) => message.content.includes("[Context compacted"))).toBe(
      true,
    );
    expect(result.messages.at(-1)).toEqual(messages.at(-1));
  });

  it("summarizes older tool results before collapsing the whole history", () => {
    const messages: TextTranscriptMessage[] = [
      { role: "system", content: "system policy" },
      ...Array.from({ length: 6 }, (_, index) => makeToolResult(index)),
      { role: "assistant", content: "recent assistant response" },
      makeToolResult(42),
      { role: "user", content: "continue" },
    ];

    const result = compactTextTranscript(messages, {
      contextWindow: 900,
      reserveTokens: 200,
      preserveRecentToolResults: 1,
      preserveRecentMessages: 3,
    });

    expect(result.messages.some((message) => message.content.startsWith("[Summarized tool result]"))).toBe(
      true,
    );
    expect(result.messages.at(-2)).toEqual(messages.at(-2));
    expect(result.messages.at(-1)).toEqual(messages.at(-1));
  });
});
