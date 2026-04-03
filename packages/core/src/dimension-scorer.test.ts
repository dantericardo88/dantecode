// ============================================================================
// @dantecode/core — Dimension Scorer Tests
// ============================================================================

import { describe, it, expect } from "vitest";
import { DimensionScorer } from "./dimension-scorer.js";
import type { DimensionScore, DimensionScorerOptions } from "./dimension-scorer.js";

// ────────────────────────────────────────────────────────────────────────────
// Concrete test subclass
// ────────────────────────────────────────────────────────────────────────────

interface TestInput {
  a: number;
  b: number;
  c: number;
  d: number;
}

class TestScorer extends DimensionScorer<TestInput> {
  constructor(options?: DimensionScorerOptions) {
    super(options);
  }

  protected scoreDimensions(input: TestInput): [number, number, number, number] {
    return [
      this.clamp25(input.a),
      this.clamp25(input.b),
      this.clamp25(input.c),
      this.clamp25(input.d),
    ];
  }

  protected dimensionNames(): [string, string, string, string] {
    return ["alpha", "beta", "gamma", "delta"];
  }
}

// ────────────────────────────────────────────────────────────────────────────
// Tests
// ────────────────────────────────────────────────────────────────────────────

describe("DimensionScorer", () => {
  const scorer = new TestScorer();

  it("computeDimensions() returns named dimensions and correct total", () => {
    const result = scorer.computeDimensions({ a: 0.5, b: 0.8, c: 0.2, d: 1.0 });
    expect(result.dimensions.alpha).toBe(13);
    expect(result.dimensions.beta).toBe(20);
    expect(result.dimensions.gamma).toBe(5);
    expect(result.dimensions.delta).toBe(25);
    expect(result.total).toBe(13 + 20 + 5 + 25);
  });

  it("clamp25 clamps values to 0-25 range", () => {
    const low = scorer.computeDimensions({ a: -0.5, b: 0, c: 0, d: 0 });
    expect(low.dimensions.alpha).toBe(0);

    const high = scorer.computeDimensions({ a: 2.0, b: 0, c: 0, d: 0 });
    expect(high.dimensions.alpha).toBe(25);
  });

  it("isBelow returns true when total is below threshold", () => {
    const result: DimensionScore = { dimensions: { x: 5 }, total: 30 };
    expect(scorer.isBelow(result, 40)).toBe(true);
    expect(scorer.isBelow(result, 30)).toBe(false);
  });

  it("isAbove returns true when total is above threshold", () => {
    const result: DimensionScore = { dimensions: { x: 20 }, total: 80 };
    expect(scorer.isAbove(result, 70)).toBe(true);
    expect(scorer.isAbove(result, 80)).toBe(false);
  });

  it("nowFn defaults to Date.now", () => {
    const defaultScorer = new TestScorer();
    const before = Date.now();
    const ts = defaultScorer["nowFn"]();
    const after = Date.now();
    expect(ts).toBeGreaterThanOrEqual(before);
    expect(ts).toBeLessThanOrEqual(after);
  });

  it("nowFn can be injected via options", () => {
    const custom = new TestScorer({ nowFn: () => 42 });
    expect(custom["nowFn"]()).toBe(42);
  });
});
