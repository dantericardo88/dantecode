// ============================================================================
// @dantecode/cli — cost-calculator unit tests
// ============================================================================

import { describe, it, expect } from "vitest";
import { computeCost, formatCost } from "./cost-calculator.js";

describe("computeCost", () => {
  it("computes correct cost for claude-sonnet-4-6", () => {
    // 1000 input @ $3/MTok + 500 output @ $15/MTok
    // = 0.003 + 0.0075 = 0.0105
    const cost = computeCost("claude-sonnet-4-6", 1000, 500);
    expect(cost).toBeCloseTo(0.0105, 5);
  });

  it("computes correct cost for claude-haiku-4-5-20251001", () => {
    // 10_000 input @ $0.25/MTok + 2_000 output @ $1.25/MTok
    // = 0.0025 + 0.0025 = 0.005
    const cost = computeCost("claude-haiku-4-5-20251001", 10_000, 2_000);
    expect(cost).toBeCloseTo(0.005, 5);
  });

  it("computes correct cost for claude-opus-4-6", () => {
    // 500 input @ $15/MTok + 100 output @ $75/MTok
    // = 0.0075 + 0.0075 = 0.015
    const cost = computeCost("claude-opus-4-6", 500, 100);
    expect(cost).toBeCloseTo(0.015, 5);
  });

  it("falls back to medium tier for unknown model IDs", () => {
    const cost = computeCost("unknown-model-xyz", 1_000_000, 0);
    // Should use sonnet fallback: 1M × $3/MTok = $3.00
    expect(cost).toBeCloseTo(3.0, 3);
  });

  it("returns 0 for zero tokens", () => {
    expect(computeCost("claude-sonnet-4-6", 0, 0)).toBe(0);
  });

  it("uses haiku pricing for haiku-containing model IDs not in the table", () => {
    const cost = computeCost("claude-haiku-future-model", 1_000_000, 0);
    // Haiku fallback: $0.25/MTok
    expect(cost).toBeCloseTo(0.25, 3);
  });
});

describe("formatCost", () => {
  it("formats zero as $0.00", () => {
    expect(formatCost(0)).toBe("$0.00");
  });

  it("formats small costs with more decimal places", () => {
    const formatted = formatCost(0.000123);
    expect(formatted).toMatch(/^\$0\.0+\d/);
  });

  it("formats larger costs with 2 decimal places", () => {
    expect(formatCost(1.234)).toBe("$1.23");
  });
});
