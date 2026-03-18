import { describe, expect, it } from "vitest";
import { estimateTokens, estimateMessageTokens, getContextUtilization } from "./token-counter.js";

describe("estimateTokens", () => {
  it("returns 0 for empty string", () => {
    expect(estimateTokens("")).toBe(0);
  });

  it("estimates tokens for plain text", () => {
    const tokens = estimateTokens("Hello world this is a test");
    expect(tokens).toBeGreaterThan(0);
  });
});

describe("estimateMessageTokens", () => {
  it("returns 0 for empty array", () => {
    expect(estimateMessageTokens([])).toBe(0);
  });

  it("includes per-message overhead", () => {
    const tokens = estimateMessageTokens([{ role: "user", content: "hi" }]);
    // Should be at least 4 (overhead) + some token estimate for "hi"
    expect(tokens).toBeGreaterThanOrEqual(4);
  });
});

describe("getContextUtilization", () => {
  it("returns green tier for <50% usage", () => {
    const messages = [{ role: "user", content: "Hello" }];
    const result = getContextUtilization(messages, 128_000);
    expect(result.tier).toBe("green");
    expect(result.percent).toBeLessThan(50);
    expect(result.maxTokens).toBe(128_000);
    expect(result.tokens).toBeGreaterThan(0);
  });

  it("returns yellow tier for 50-75% usage", () => {
    // Build enough messages to hit 50-75% of a small context window
    const longContent = "word ".repeat(500); // ~650 tokens per message
    const messages = Array.from({ length: 10 }, () => ({
      role: "user",
      content: longContent,
    }));
    // Total tokens ~ 10 * (4 + 650) = ~6540
    // Use a context window that puts us in the 50-75% range
    const contextWindow = 10_000;
    const result = getContextUtilization(messages, contextWindow);
    expect(result.tier).toBe("yellow");
    expect(result.percent).toBeGreaterThanOrEqual(50);
    expect(result.percent).toBeLessThan(75);
  });

  it("returns red tier for >75% usage", () => {
    const longContent = "word ".repeat(500);
    const messages = Array.from({ length: 10 }, () => ({
      role: "user",
      content: longContent,
    }));
    // Use a small context window that forces >75%
    const contextWindow = 7_000;
    const result = getContextUtilization(messages, contextWindow);
    expect(result.tier).toBe("red");
    expect(result.percent).toBeGreaterThanOrEqual(75);
  });

  it("calculates percent correctly", () => {
    const messages = [{ role: "user", content: "test" }];
    const result = getContextUtilization(messages, 1_000);
    // percent should be (tokens / 1000) * 100, rounded
    const expectedPercent = Math.min(100, Math.round((result.tokens / 1_000) * 100));
    expect(result.percent).toBe(expectedPercent);
  });

  it("handles empty messages array", () => {
    const result = getContextUtilization([], 128_000);
    expect(result.tokens).toBe(0);
    expect(result.percent).toBe(0);
    expect(result.tier).toBe("green");
    expect(result.maxTokens).toBe(128_000);
  });

  it("handles 0 context window (edge case)", () => {
    const messages = [{ role: "user", content: "hello" }];
    const result = getContextUtilization(messages, 0);
    expect(result.percent).toBe(0);
    expect(result.maxTokens).toBe(0);
    expect(result.tier).toBe("green");
    expect(result.tokens).toBeGreaterThan(0);
  });

  it("caps percent at 100", () => {
    // Many messages with a very small context window
    const messages = Array.from({ length: 50 }, () => ({
      role: "user",
      content: "This is a moderately long message that should consume tokens",
    }));
    const result = getContextUtilization(messages, 100);
    expect(result.percent).toBeLessThanOrEqual(100);
  });
});
