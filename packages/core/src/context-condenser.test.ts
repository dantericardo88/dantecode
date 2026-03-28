// ============================================================================
// @dantecode/core — Context Condenser Tests
// ============================================================================

import { describe, it, expect, vi } from "vitest";
import type { CoreMessage } from "ai";
import {
  calculatePressure,
  condenseContext,
  estimateMessageTokens,
} from "./context-condenser.js";

// ----------------------------------------------------------------------------
// Test Helpers
// ----------------------------------------------------------------------------

function createMessage(role: CoreMessage["role"], content: string): CoreMessage {
  return { role, content };
}

function createConversation(rounds: number): CoreMessage[] {
  const messages: CoreMessage[] = [
    createMessage("system", "You are a helpful assistant."),
  ];

  for (let i = 0; i < rounds; i++) {
    messages.push(createMessage("user", `User request ${i + 1}`));
    messages.push(createMessage("assistant", `Assistant response ${i + 1}`));
  }

  return messages;
}

// ----------------------------------------------------------------------------
// Pressure Calculation Tests
// ----------------------------------------------------------------------------

describe("calculatePressure", () => {
  it("should calculate pressure for empty messages", () => {
    const pressure = calculatePressure([], 100000);
    expect(pressure.usedTokens).toBe(0);
    expect(pressure.percent).toBe(0);
    expect(pressure.status).toBe("green");
  });

  it("should calculate pressure for single message", () => {
    const messages = [createMessage("system", "Hello world")];
    const pressure = calculatePressure(messages, 100000);
    expect(pressure.usedTokens).toBeGreaterThan(0);
    expect(pressure.percent).toBeLessThan(1);
    expect(pressure.status).toBe("green");
  });

  it("should return green status for <50% usage", () => {
    const messages = createConversation(5);
    const pressure = calculatePressure(messages, 100000);
    expect(pressure.status).toBe("green");
    expect(pressure.percent).toBeLessThan(50);
  });

  it("should return yellow status for 50-80% usage", () => {
    const messages = createConversation(20);
    const maxTokens = 500; // Force high pressure
    const pressure = calculatePressure(messages, maxTokens);
    expect(pressure.status).toBe("yellow");
    expect(pressure.percent).toBeGreaterThanOrEqual(50);
    expect(pressure.percent).toBeLessThan(80);
  });

  it("should return red status for >80% usage", () => {
    const messages = createConversation(30);
    const maxTokens = 400; // Force very high pressure
    const pressure = calculatePressure(messages, maxTokens);
    expect(pressure.status).toBe("red");
    expect(pressure.percent).toBeGreaterThanOrEqual(80);
  });

  it("should cap percent at 100", () => {
    const messages = createConversation(50);
    const maxTokens = 10; // Extremely low limit
    const pressure = calculatePressure(messages, maxTokens);
    expect(pressure.percent).toBe(100);
  });

  it("should handle zero maxTokens gracefully", () => {
    const messages = createConversation(5);
    const pressure = calculatePressure(messages, 0);
    expect(pressure.percent).toBe(0);
    expect(pressure.status).toBe("green");
  });

  it("should include message overhead in token count", () => {
    const messages = [createMessage("user", "")];
    const pressure = calculatePressure(messages, 100000);
    // Empty content should still have 4 tokens overhead
    expect(pressure.usedTokens).toBe(4);
  });
});

// ----------------------------------------------------------------------------
// Condensing Logic Tests
// ----------------------------------------------------------------------------

describe("condenseContext", () => {
  it("should return original messages if array is empty", async () => {
    const result = await condenseContext([], 100000);
    expect(result.messages).toHaveLength(0);
    expect(result.beforeTokens).toBe(0);
    expect(result.afterTokens).toBe(0);
    expect(result.roundsCondensed).toBe(0);
  });

  it("should preserve system message", async () => {
    const messages = createConversation(10);
    const result = await condenseContext(messages, 500);
    const systemMsg = result.messages.find((m) => m.role === "system" && m.content.includes("helpful assistant"));
    expect(systemMsg).toBeDefined();
  });

  it("should preserve last 3 rounds by default", async () => {
    const messages = createConversation(10);
    const result = await condenseContext(messages, 500);

    // Check for last 3 rounds (6 messages: 3 user + 3 assistant)
    const recentMessages = result.messages.slice(-6);
    expect(recentMessages).toHaveLength(6);
    expect(recentMessages[0]?.role).toBe("user");
    expect(recentMessages[1]?.role).toBe("assistant");
  });

  it("should condense middle rounds into summary", async () => {
    const messages = createConversation(10);
    const result = await condenseContext(messages, 500);

    // Should have: system + summary + 6 recent messages
    expect(result.messages.length).toBeLessThan(messages.length);
    const summaryMsg = result.messages.find((m) => m.content.includes("Context Summary"));
    expect(summaryMsg).toBeDefined();
  });

  it("should reduce token count after condensing", async () => {
    const messages = createConversation(20);
    const result = await condenseContext(messages, 1000);

    expect(result.afterTokens).toBeLessThan(result.beforeTokens);
    const reduction = ((result.beforeTokens - result.afterTokens) / result.beforeTokens) * 100;
    expect(reduction).toBeGreaterThan(0);
  });

  it("should accept custom preserveRecentRounds option", async () => {
    const messages = createConversation(10);
    const result = await condenseContext(messages, 500, { preserveRecentRounds: 2 });

    // Should preserve last 2 rounds (4 messages)
    const recentMessages = result.messages.slice(-4);
    expect(recentMessages).toHaveLength(4);
  });

  it("should accept custom targetPercent option", async () => {
    const messages = createConversation(20);
    const result = await condenseContext(messages, 1000, { targetPercent: 30 });

    const finalPercent = (result.afterTokens / 1000) * 100;
    expect(finalPercent).toBeLessThan(50); // Should be significantly reduced
  });

  it("should preserve receipts in condensed content", async () => {
    const messages = [
      createMessage("system", "System prompt"),
      createMessage("user", "Request 1"),
      createMessage("assistant", "Response with Receipt ID: abc123"),
      createMessage("user", "Request 2"),
      createMessage("assistant", "Response 2"),
      createMessage("user", "Request 3"),
      createMessage("assistant", "Response 3"),
      createMessage("user", "Request 4"),
      createMessage("assistant", "Response 4"),
      createMessage("user", "Request 5"),
      createMessage("assistant", "Response 5"),
    ];

    const result = await condenseContext(messages, 200, { preserveRecentRounds: 1 });
    const summaryMsg = result.messages.find((m) => {
      const content = typeof m.content === "string" ? m.content : "";
      return content.includes("Context Summary");
    });
    const summaryContent = typeof summaryMsg?.content === "string" ? summaryMsg.content : "";
    expect(summaryContent).toContain("Receipt ID: abc123");
  });

  it("should preserve file paths in condensed content", async () => {
    const messages = [
      createMessage("system", "System prompt"),
      createMessage("user", "Request 1"),
      createMessage("assistant", "Modified C:\\Projects\\test.ts"),
      createMessage("user", "Request 2"),
      createMessage("assistant", "Response 2"),
      createMessage("user", "Request 3"),
      createMessage("assistant", "Response 3"),
      createMessage("user", "Request 4"),
      createMessage("assistant", "Response 4"),
      createMessage("user", "Request 5"),
      createMessage("assistant", "Response 5"),
    ];

    const result = await condenseContext(messages, 200, { preserveRecentRounds: 1 });
    const summaryMsg = result.messages.find((m) => {
      const content = typeof m.content === "string" ? m.content : "";
      return content.includes("Context Summary");
    });
    const summaryContent = typeof summaryMsg?.content === "string" ? summaryMsg.content : "";
    expect(summaryContent).toContain("C:\\Projects\\test.ts");
  });

  it("should return original if nothing to condense", async () => {
    // Only system + exactly enough to match preserveRecentRounds
    const messages = [
      createMessage("system", "System prompt"),
      createMessage("user", "Request 1"),
      createMessage("assistant", "Response 1"),
      createMessage("user", "Request 2"),
      createMessage("assistant", "Response 2"),
      createMessage("user", "Request 3"),
      createMessage("assistant", "Response 3"),
    ];

    const result = await condenseContext(messages, 100000);
    // With default preserveRecentRounds=3, all 3 rounds are preserved
    expect(result.roundsCondensed).toBe(0);
  });

  it("should count roundsCondensed correctly", async () => {
    const messages = createConversation(10); // 1 system + 20 conversation messages
    const result = await condenseContext(messages, 500, { preserveRecentRounds: 3 });

    // Total rounds: 10, preserved: 3, condensed: 7
    expect(result.roundsCondensed).toBe(7);
  });

  it("should accept custom summarizeFn", async () => {
    const customSummarize = vi.fn(async (_msgs: CoreMessage[]) => "Custom summary");
    const messages = createConversation(10);

    const result = await condenseContext(messages, 500, { summarizeFn: customSummarize });

    expect(customSummarize).toHaveBeenCalledOnce();
    const summaryMsg = result.messages.find((m) => {
      const content = typeof m.content === "string" ? m.content : "";
      return content.includes("Custom summary");
    });
    expect(summaryMsg).toBeDefined();
  });
});

// ----------------------------------------------------------------------------
// Critical Info Preservation Tests
// ----------------------------------------------------------------------------

describe("critical info extraction", () => {
  it("should preserve PDSE scores", async () => {
    const messages = [
      createMessage("system", "System"),
      createMessage("user", "Task 1"),
      createMessage("assistant", "PDSE Score: 95"),
      createMessage("user", "Task 2"),
      createMessage("assistant", "Response"),
      createMessage("user", "Task 3"),
      createMessage("assistant", "Final"),
      createMessage("user", "Task 4"),
      createMessage("assistant", "Response 4"),
      createMessage("user", "Task 5"),
      createMessage("assistant", "Response 5"),
    ];

    const result = await condenseContext(messages, 200, { preserveRecentRounds: 1 });
    const summaryMsg = result.messages.find((m) => {
      const content = typeof m.content === "string" ? m.content : "";
      return content.includes("Context Summary");
    });
    const summary = typeof summaryMsg?.content === "string" ? summaryMsg.content : "";
    expect(summary).toContain("PDSE Score: 95");
  });

  it("should preserve multiple receipt formats", async () => {
    const messages = [
      createMessage("system", "System"),
      createMessage("user", "Task"),
      createMessage("assistant", "Evidence Chain: chain-123\n[RECEIPT]\nrun.receipt: receipt-456"),
      createMessage("user", "Task 2"),
      createMessage("assistant", "Response"),
      createMessage("user", "Task 3"),
      createMessage("assistant", "Final"),
      createMessage("user", "Task 4"),
      createMessage("assistant", "Response 4"),
      createMessage("user", "Task 5"),
      createMessage("assistant", "Response 5"),
    ];

    const result = await condenseContext(messages, 200, { preserveRecentRounds: 1 });
    const summaryMsg = result.messages.find((m) => {
      const content = typeof m.content === "string" ? m.content : "";
      return content.includes("Context Summary");
    });
    const summary = typeof summaryMsg?.content === "string" ? summaryMsg.content : "";
    expect(summary).toContain("Evidence Chain");
    expect(summary).toContain("RECEIPT");
  });

  it("should preserve Unix file paths", async () => {
    const messages = [
      createMessage("system", "System"),
      createMessage("user", "Task"),
      createMessage("assistant", "Modified /usr/local/bin/test.sh"),
      createMessage("user", "Task 2"),
      createMessage("assistant", "Response"),
      createMessage("user", "Task 3"),
      createMessage("assistant", "Final"),
      createMessage("user", "Task 4"),
      createMessage("assistant", "Response 4"),
      createMessage("user", "Task 5"),
      createMessage("assistant", "Response 5"),
    ];

    const result = await condenseContext(messages, 200, { preserveRecentRounds: 1 });
    const summaryMsg = result.messages.find((m) => {
      const content = typeof m.content === "string" ? m.content : "";
      return content.includes("File Paths");
    });
    const summary = typeof summaryMsg?.content === "string" ? summaryMsg.content : "";
    expect(summary).toContain("/usr/local/bin/test.sh");
  });

  it("should preserve relative file paths", async () => {
    const messages = [
      createMessage("system", "System"),
      createMessage("user", "Task"),
      createMessage("assistant", "Created ./src/components/Button.tsx"),
      createMessage("user", "Task 2"),
      createMessage("assistant", "Response"),
      createMessage("user", "Task 3"),
      createMessage("assistant", "Final"),
      createMessage("user", "Task 4"),
      createMessage("assistant", "Response 4"),
      createMessage("user", "Task 5"),
      createMessage("assistant", "Response 5"),
    ];

    const result = await condenseContext(messages, 200, { preserveRecentRounds: 1 });
    const summaryMsg = result.messages.find((m) => {
      const content = typeof m.content === "string" ? m.content : "";
      return content.includes("File Paths");
    });
    const summary = typeof summaryMsg?.content === "string" ? summaryMsg.content : "";
    expect(summary).toContain("./src/components/Button.tsx");
  });

  it("should deduplicate file paths", async () => {
    const messages = [
      createMessage("system", "System"),
      createMessage("user", "Task"),
      createMessage("assistant", "Modified ./test.ts"),
      createMessage("user", "Task 2"),
      createMessage("assistant", "Updated ./test.ts again"),
      createMessage("user", "Task 3"),
      createMessage("assistant", "Final"),
      createMessage("user", "Task 4"),
      createMessage("assistant", "Response 4"),
      createMessage("user", "Task 5"),
      createMessage("assistant", "Response 5"),
    ];

    const result = await condenseContext(messages, 200, { preserveRecentRounds: 1 });
    const summaryMsg = result.messages.find((m) => {
      const content = typeof m.content === "string" ? m.content : "";
      return content.includes("File Paths");
    });
    const summary = typeof summaryMsg?.content === "string" ? summaryMsg.content : "";

    // Extract the file paths section only
    const pathsSection = summary.split("### File Paths Referenced")[1]?.split("###")[0] ?? "";
    const matches = (pathsSection.match(/\.\/test\.ts/g) || []).length;
    expect(matches).toBe(1); // Should appear only once in the paths list
  });

  it("should extract and preserve error messages", async () => {
    const messages = [
      createMessage("system", "System"),
      createMessage("user", "Task"),
      createMessage("assistant", "Error: Failed to compile\nTypeError: undefined is not a function"),
      createMessage("user", "Task 2"),
      createMessage("assistant", "Response"),
      createMessage("user", "Task 3"),
      createMessage("assistant", "Final"),
      createMessage("user", "Task 4"),
      createMessage("assistant", "Response 4"),
      createMessage("user", "Task 5"),
      createMessage("assistant", "Response 5"),
    ];

    const result = await condenseContext(messages, 200, { preserveRecentRounds: 1 });
    const summaryMsg = result.messages.find((m) => {
      const content = typeof m.content === "string" ? m.content : "";
      return content.includes("Errors Encountered");
    });
    const summary = typeof summaryMsg?.content === "string" ? summaryMsg.content : "";
    expect(summary).toContain("Error");
    expect(summary).toContain("TypeError");
  });
});

// ----------------------------------------------------------------------------
// Edge Cases
// ----------------------------------------------------------------------------

describe("edge cases", () => {
  it("should handle messages with no system prompt", async () => {
    const messages = [
      createMessage("user", "Request 1"),
      createMessage("assistant", "Response 1"),
      createMessage("user", "Request 2"),
      createMessage("assistant", "Response 2"),
      createMessage("user", "Request 3"),
      createMessage("assistant", "Response 3"),
    ];

    const result = await condenseContext(messages, 200);
    expect(result.messages.length).toBeGreaterThan(0);
  });

  it("should handle content block arrays", async () => {
    const messages: CoreMessage[] = [
      { role: "system", content: "System" },
      {
        role: "user",
        content: [{ type: "text", text: "Hello" }],
      },
      {
        role: "assistant",
        content: [{ type: "text", text: "Hi there" }],
      },
      { role: "user", content: "Request" },
      { role: "assistant", content: "Response" },
    ];

    const result = await condenseContext(messages, 200);
    expect(result.messages.length).toBeGreaterThan(0);
  });

  it("should handle very large context (stress test)", async () => {
    const messages = createConversation(100);
    const result = await condenseContext(messages, 5000);

    expect(result.afterTokens).toBeLessThan(result.beforeTokens);
    expect(result.roundsCondensed).toBeGreaterThan(0);
  });
});

// ----------------------------------------------------------------------------
// Helper Function Tests
// ----------------------------------------------------------------------------

describe("estimateMessageTokens", () => {
  it("should estimate tokens for string content", () => {
    const msg = createMessage("user", "Hello world");
    const tokens = estimateMessageTokens(msg);
    expect(tokens).toBeGreaterThan(4); // At least overhead
  });

  it("should include 4 token overhead", () => {
    const msg = createMessage("user", "");
    const tokens = estimateMessageTokens(msg);
    expect(tokens).toBe(4);
  });

  it("should estimate tokens for content blocks", () => {
    const msg: CoreMessage = {
      role: "assistant",
      content: [
        { type: "text", text: "Hello world this is a test message" },
        { type: "text", text: "Another line with more content here" },
      ],
    };
    const tokens = estimateMessageTokens(msg);
    expect(tokens).toBeGreaterThan(10);
  });
});
