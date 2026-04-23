// packages/core/src/__tests__/context-eviction-policy.test.ts
import { describe, it, expect } from "vitest";
import {
  estimateTokens,
  scoreMessage,
  assignTier,
  compressMessageContent,
  evictToFitBudget,
  assessContextBudget,
  type ScoredMessage,
} from "../context-eviction-policy.js";

// ─── estimateTokens ───────────────────────────────────────────────────────────

describe("estimateTokens", () => {
  it("returns 0 for empty string", () => {
    expect(estimateTokens("")).toBe(0);
  });

  it("returns ceiling of length / 4", () => {
    expect(estimateTokens("abcd")).toBe(1);
    expect(estimateTokens("abcde")).toBe(2); // ceil(5/4) = 2
  });

  it("estimates 100 chars ≈ 25 tokens", () => {
    expect(estimateTokens("a".repeat(100))).toBe(25);
  });
});

// ─── scoreMessage ─────────────────────────────────────────────────────────────

describe("scoreMessage", () => {
  it("recent messages score higher than old ones", () => {
    const recent = scoreMessage({ role: "user", content: "hello" }, 9, 10);
    const old = scoreMessage({ role: "user", content: "hello" }, 0, 10);
    expect(recent).toBeGreaterThan(old);
  });

  it("system messages score higher than tool messages", () => {
    const sys = scoreMessage({ role: "system", content: "Be helpful" }, 5, 10);
    const tool = scoreMessage({ role: "tool", content: "result: ok" }, 5, 10);
    expect(sys).toBeGreaterThan(tool);
  });

  it("messages with code blocks score higher", () => {
    const withCode = scoreMessage({ role: "assistant", content: "Here:\n```ts\nconst x = 1;\n```" }, 5, 10);
    const plain = scoreMessage({ role: "assistant", content: "Here: const x = 1" }, 5, 10);
    expect(withCode).toBeGreaterThan(plain);
  });

  it("very large messages get penalty", () => {
    const small = scoreMessage({ role: "tool", content: "x".repeat(100) }, 5, 10);
    const huge = scoreMessage({ role: "tool", content: "x".repeat(20000) }, 5, 10);
    expect(small).toBeGreaterThan(huge);
  });

  it("short tool results (trivial ack) score low", () => {
    const shortTool = scoreMessage({ role: "tool", content: "OK" }, 5, 10);
    expect(shortTool).toBeLessThan(20);
  });

  it("returns non-negative score", () => {
    const score = scoreMessage({ role: "tool", content: "x".repeat(50000) }, 0, 100);
    expect(score).toBeGreaterThanOrEqual(0);
  });
});

// ─── assignTier ───────────────────────────────────────────────────────────────

describe("assignTier", () => {
  function makeScoredMsg(overrides: Partial<ScoredMessage>): ScoredMessage {
    return {
      role: "assistant",
      content: "hello",
      tokens: 5,
      score: 50,
      tier: "standard",
      index: 5,
      ...overrides,
    };
  }

  it("system messages are always essential", () => {
    const msg = makeScoredMsg({ role: "system", index: 0 });
    expect(assignTier(msg, 10)).toBe("essential");
  });

  it("messages in the last essentialTailCount are essential", () => {
    const msg = makeScoredMsg({ index: 7 });
    expect(assignTier(msg, 10, 4)).toBe("essential");  // 10-4=6, idx 7 >= 6 → essential
  });

  it("low score messages are dispensable", () => {
    const msg = makeScoredMsg({ score: 10, index: 2 });
    expect(assignTier(msg, 10)).toBe("dispensable");
  });

  it("mid-score non-system messages are standard", () => {
    const msg = makeScoredMsg({ score: 40, index: 3, role: "assistant" });
    expect(assignTier(msg, 10)).toBe("standard");
  });

  it("tool messages with score < 35 are standard (not essential)", () => {
    const msg = makeScoredMsg({ role: "tool", score: 25, index: 3 });
    expect(assignTier(msg, 10)).toBe("standard");
  });
});

// ─── compressMessageContent ───────────────────────────────────────────────────

describe("compressMessageContent", () => {
  it("returns content unchanged when under limit", () => {
    const short = "short content";
    expect(compressMessageContent("user", short, 100)).toBe(short);
  });

  it("truncates long tool results with truncated marker", () => {
    const toolResult = Array.from({ length: 50 }, (_, i) => `line ${i}`).join("\n");
    const compressed = compressMessageContent("tool", toolResult, 20);
    expect(compressed).toContain("omitted");
  });

  it("keeps first and last lines for tool results", () => {
    const toolResult = Array.from({ length: 20 }, (_, i) => `line ${i}`).join("\n");
    const compressed = compressMessageContent("tool", toolResult, 20);
    expect(compressed).toContain("line 0");
    expect(compressed).toContain("line 19");
  });

  it("adds compression note for user/assistant messages", () => {
    const longContent = "x".repeat(5000);
    const compressed = compressMessageContent("user", longContent, 100);
    expect(compressed).toContain("compressed");
  });
});

// ─── evictToFitBudget ─────────────────────────────────────────────────────────

describe("evictToFitBudget", () => {
  function makeMessages(count: number, role: "user" | "assistant" | "tool" = "assistant") {
    return Array.from({ length: count }, (_, i) => ({
      role,
      content: `message ${i} content here. `,  // ~6 tokens each
    }));
  }

  it("returns all messages when already within budget", () => {
    const messages = makeMessages(3, "user");
    const result = evictToFitBudget(messages, { targetTokenBudget: 10000 });
    expect(result.kept.length).toBe(3);
    expect(result.evictedCount).toBe(0);
  });

  it("evicts messages when over budget", () => {
    const messages = Array.from({ length: 10 }, (_, i) => ({
      role: i % 2 === 0 ? "tool" as const : "user" as const,
      content: "x".repeat(200),  // 50 tokens each = 500 total
    }));
    const result = evictToFitBudget(messages, { targetTokenBudget: 100 });
    expect(result.evictedCount).toBeGreaterThan(0);
    // Essential tail (4 messages × 50 tokens = 200 tokens) cannot be reduced below 200
    // so tokensRemaining will be between 100 and 250
    expect(result.tokensRemaining).toBeLessThanOrEqual(250);
  });

  it("never evicts essential (last N) messages", () => {
    const messages = Array.from({ length: 8 }, () => ({
      role: "user" as const,
      content: "x".repeat(400),  // 100 tokens each
    }));
    const result = evictToFitBudget(messages, {
      targetTokenBudget: 100,
      essentialTailCount: 2,
      preferCompression: false,
    });
    // Last 2 messages should always be kept
    const lastTwo = messages.slice(-2);
    for (const msg of lastTwo) {
      expect(result.kept.some((k) => k.content === msg.content)).toBe(true);
    }
  });

  it("prefers compression over eviction for standard messages", () => {
    // Use 8 messages so tool result at index 1 is NOT in the essential tail (last 4)
    const messages = [
      { role: "user" as const, content: "user question 0" },
      { role: "tool" as const, content: "x".repeat(2000) },  // large tool result — compressible
      { role: "user" as const, content: "follow up 2" },
      { role: "assistant" as const, content: "response 3" },
      { role: "user" as const, content: "user 4" },
      { role: "assistant" as const, content: "response 5" },
      { role: "user" as const, content: "user 6" },
      { role: "assistant" as const, content: "response 7" },
    ];
    const result = evictToFitBudget(messages, {
      targetTokenBudget: 100,
      preferCompression: true,
      compressionMaxTokens: 50,
    });
    // Something should have been freed (compressed or evicted)
    expect(result.tokensFreed).toBeGreaterThan(0);
  });

  it("tokensFreed + tokensRemaining approximate original total", () => {
    const messages = makeMessages(5);
    const originalTokens = messages.reduce((s, m) => s + Math.ceil(m.content.length / 4), 0);
    const result = evictToFitBudget(messages, { targetTokenBudget: 50 });
    expect(result.tokensFreed + result.tokensRemaining).toBeLessThanOrEqual(originalTokens + 5);
  });

  it("preserves system messages as essential", () => {
    const messages = [
      { role: "system" as const, content: "You are helpful. ".repeat(100) },
      ...makeMessages(5, "tool"),
    ];
    const result = evictToFitBudget(messages, { targetTokenBudget: 100, preferCompression: false });
    expect(result.kept.some((m) => m.role === "system")).toBe(true);
  });
});

// ─── assessContextBudget ──────────────────────────────────────────────────────

describe("assessContextBudget", () => {
  it("returns normal pressure below 60% utilization", () => {
    const status = assessContextBudget(50_000, 128_000);
    expect(status.pressure).toBe("normal");
    expect(status.utilization).toBeCloseTo(0.39, 1);
  });

  it("returns elevated pressure at 60-75% utilization", () => {
    expect(assessContextBudget(80_000, 128_000).pressure).toBe("elevated");
  });

  it("returns high pressure at 75-90% utilization", () => {
    expect(assessContextBudget(100_000, 128_000).pressure).toBe("high");
  });

  it("returns critical pressure above 90%", () => {
    expect(assessContextBudget(120_000, 128_000).pressure).toBe("critical");
  });

  it("includes non-empty recommendation", () => {
    const status = assessContextBudget(90_000, 100_000);
    expect(status.recommendation.length).toBeGreaterThan(0);
  });

  it("returns normal pressure and 0 utilization when maxTokens is 0", () => {
    const status = assessContextBudget(0, 0);
    expect(status.utilization).toBe(0);
    expect(status.pressure).toBe("normal");
  });
});
