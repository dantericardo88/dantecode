import { describe, it, expect } from "vitest";
import {
  createContextBudget,
  checkBudget,
  shouldTruncateToolOutput,
  getBudgetTier,
} from "./context-budget.js";
// Helper: generate content that produces a known number of tokens.
// estimateTokens uses word-based: ~1.3 tokens/word. So 1000 words ≈ 1300 tokens.
function makeWords(n: number): string {
  return Array.from({ length: n }, (_, i) => `word${i}`).join(" ");
}

describe("context-budget", () => {
  describe("getBudgetTier", () => {
    const budget = createContextBudget();

    it("returns green below warning threshold", () => {
      expect(getBudgetTier(50, budget)).toBe("green");
      expect(getBudgetTier(69, budget)).toBe("green");
    });

    it("returns yellow at warning threshold", () => {
      expect(getBudgetTier(70, budget)).toBe("yellow");
      expect(getBudgetTier(79, budget)).toBe("yellow");
    });

    it("returns red at 80-90%", () => {
      expect(getBudgetTier(80, budget)).toBe("red");
      expect(getBudgetTier(89, budget)).toBe("red");
    });

    it("returns critical at hard limit threshold", () => {
      expect(getBudgetTier(90, budget)).toBe("critical");
      expect(getBudgetTier(99, budget)).toBe("critical");
    });
  });

  describe("checkBudget", () => {
    it("returns green tier for small message sets", () => {
      const budget = createContextBudget({ maxTokens: 200_000 });
      const msgs = [{ role: "user", content: "Hello world" }];
      const state = checkBudget(msgs, budget);
      expect(state.tier).toBe("green");
      expect(state.percent).toBeLessThan(1);
      expect(state.canAddTokens(1000)).toBe(true);
      expect(state.remainingBudget()).toBeGreaterThan(100_000);
    });

    it("returns critical tier when tokens exceed hard limit", () => {
      // Budget: 100 max, 10 reserved → 90 available. Need >90% = >81 tokens.
      // 100 words ≈ 130 tokens + 4 overhead = 134 tokens → 134/90 = 148% → critical
      const budget = createContextBudget({ maxTokens: 100, reservedForResponse: 10 });
      const msgs = [{ role: "user", content: makeWords(100) }];
      const state = checkBudget(msgs, budget);
      expect(state.tier).toBe("critical");
      expect(state.canAddTokens(10)).toBe(false);
    });

    it("caps percent at 100", () => {
      const budget = createContextBudget({ maxTokens: 10, reservedForResponse: 5 });
      // 5 available, but we'll send way more tokens
      const msgs = [{ role: "user", content: makeWords(50) }];
      const state = checkBudget(msgs, budget);
      expect(state.percent).toBe(100);
    });

    it("remainingBudget returns 0 when over limit", () => {
      const budget = createContextBudget({ maxTokens: 10, reservedForResponse: 5 });
      const msgs = [{ role: "user", content: makeWords(50) }];
      const state = checkBudget(msgs, budget);
      expect(state.remainingBudget()).toBe(0);
    });
  });

  describe("shouldTruncateToolOutput", () => {
    it("does not truncate small output in green tier", () => {
      const state = checkBudget(
        [{ role: "user", content: "hi" }],
        createContextBudget({ maxTokens: 200_000 }),
      );
      const advice = shouldTruncateToolOutput("short output", state);
      expect(advice.truncate).toBe(false);
      expect(advice.maxChars).toBe(50 * 1024); // green = 50KB
    });

    it("truncates large output in critical tier to 2KB", () => {
      const budget = createContextBudget({ maxTokens: 100, reservedForResponse: 10 });
      const msgs = [{ role: "user", content: makeWords(100) }];
      const state = checkBudget(msgs, budget);
      expect(state.tier).toBe("critical");
      const advice = shouldTruncateToolOutput("y".repeat(5000), state);
      expect(advice.truncate).toBe(true);
      expect(advice.maxChars).toBe(2 * 1024);
    });

    it("returns tier-specific maxChars", () => {
      // Construct a state directly to test each tier
      const greenState = {
        currentTokens: 0,
        percent: 30,
        tier: "green" as const,
        canAddTokens: () => true,
        remainingBudget: () => 1000,
      };
      const yellowState = { ...greenState, percent: 75, tier: "yellow" as const };
      const redState = { ...greenState, percent: 85, tier: "red" as const };
      const criticalState = { ...greenState, percent: 95, tier: "critical" as const };

      expect(shouldTruncateToolOutput("x", greenState).maxChars).toBe(50 * 1024);
      expect(shouldTruncateToolOutput("x", yellowState).maxChars).toBe(10 * 1024);
      expect(shouldTruncateToolOutput("x", redState).maxChars).toBe(5 * 1024);
      expect(shouldTruncateToolOutput("x", criticalState).maxChars).toBe(2 * 1024);
    });
  });

  describe("createContextBudget", () => {
    it("uses defaults when no options provided", () => {
      const budget = createContextBudget();
      expect(budget.maxTokens).toBe(200_000);
      expect(budget.reservedForResponse).toBe(4096);
      expect(budget.warningThreshold).toBe(70);
      expect(budget.hardLimitThreshold).toBe(90);
    });

    it("overrides specified fields", () => {
      const budget = createContextBudget({ maxTokens: 100_000 });
      expect(budget.maxTokens).toBe(100_000);
      expect(budget.reservedForResponse).toBe(4096);
    });
  });
});
