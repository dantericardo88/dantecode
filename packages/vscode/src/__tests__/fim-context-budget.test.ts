// ============================================================================
// packages/vscode/src/__tests__/fim-context-budget.test.ts
// 10 tests for FimContextBudget token slot allocation.
// ============================================================================

import { describe, it, expect } from "vitest";
import {
  FimContextBudget,
  BUDGET_128K,
} from "../fim-context-budget.js";

describe("FimContextBudget", () => {
  it("default slots sum to less than contextWindowTokens", () => {
    const budget = FimContextBudget.forContextWindow(8_192, 256);
    const slotSum =
      budget.slots.prefix +
      budget.slots.suffix +
      budget.slots.lsp +
      budget.slots.rag +
      budget.slots.crossFile +
      budget.slots.reserved;
    expect(slotSum).toBeLessThanOrEqual(8_192);
  });

  it("BUDGET_128K prefix slot equals expected calculation", () => {
    // available = 131072 - 512 - 50 = 130510; prefix = floor(130510 * 0.60) = 78306
    expect(BUDGET_128K.slots.prefix).toBe(Math.floor((131_072 - 512 - 50) * 0.60));
  });

  it("prunePrefix returns LAST maxTokens*4 chars (tail of prefix)", () => {
    const longPrefix = "a".repeat(1000);
    const pruned = FimContextBudget.prunePrefix(longPrefix, 10); // max 40 chars
    expect(pruned).toHaveLength(40);
    expect(pruned).toBe(longPrefix.slice(-40));
  });

  it("pruneSuffix returns FIRST maxTokens*4 chars (head of suffix)", () => {
    const longSuffix = "b".repeat(1000);
    const pruned = FimContextBudget.pruneSuffix(longSuffix, 10); // max 40 chars
    expect(pruned).toHaveLength(40);
    expect(pruned).toBe(longSuffix.slice(0, 40));
  });

  it("short strings shorter than budget are returned unchanged", () => {
    const short = "hello world";
    expect(FimContextBudget.prunePrefix(short, 1000)).toBe(short);
    expect(FimContextBudget.pruneSuffix(short, 1000)).toBe(short);
  });

  it("forContextWindow(8192, 256) produces correct 8K slot sizes", () => {
    const b = FimContextBudget.forContextWindow(8_192, 256);
    const available = 8_192 - 256 - 50; // 7886
    expect(b.slots.prefix).toBe(Math.floor(available * 0.60));
    expect(b.slots.suffix).toBe(Math.floor(available * 0.15));
    expect(b.slots.rag).toBe(Math.floor(available * 0.10));
  });

  it("custom slotRatios override defaults", () => {
    const b = new FimContextBudget({
      contextWindowTokens: 10_000,
      completionMaxTokens: 256,
      slotRatios: { prefix: 0.70, suffix: 0.10, lsp: 0.10, rag: 0.05, crossFile: 0.05 },
    });
    const available = 10_000 - 256 - 50;
    expect(b.slots.prefix).toBe(Math.floor(available * 0.70));
  });

  it("constructor throws when slot ratios do not sum to 1.0", () => {
    expect(() => new FimContextBudget({
      contextWindowTokens: 8_192,
      completionMaxTokens: 256,
      slotRatios: { prefix: 0.90, suffix: 0.90, lsp: 0.10, rag: 0.10, crossFile: 0.10 },
    })).toThrow(/slot ratios must sum to 1\.0/);
  });

  it("slots.reserved equals completionMaxTokens + 50", () => {
    const b = FimContextBudget.forContextWindow(32_768, 512);
    expect(b.slots.reserved).toBe(512 + 50);
  });

  it("available is clamped to 0 when completionMaxTokens exceeds budget", () => {
    // completionMaxTokens larger than context window — should not produce negative slots
    const b = FimContextBudget.forContextWindow(100, 500);
    expect(b.slots.prefix).toBeGreaterThanOrEqual(0);
    expect(b.slots.suffix).toBeGreaterThanOrEqual(0);
  });
});
