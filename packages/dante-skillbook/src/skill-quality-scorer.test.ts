import { describe, it, expect } from "vitest";
import { SkillQualityScorer } from "./skill-quality-scorer.js";
import type { SkillQualityInput } from "./skill-quality-scorer.js";

const scorer = new SkillQualityScorer();

function makeSkill(overrides: Partial<SkillQualityInput> = {}): SkillQualityInput {
  return {
    id: "skill-001",
    testCoverage: 0.8,
    usageCount: 30,
    successRate: 0.9,
    documentationCompleteness: 0.85,
    ...overrides,
  };
}

describe("SkillQualityScorer", () => {
  it("scoring is deterministic: same input yields same output", () => {
    const skill = makeSkill();
    const a = scorer.score(skill);
    const b = scorer.score(skill);
    expect(a).toEqual(b);
  });

  it("high-quality skill scores above 80", () => {
    const skill = makeSkill({
      testCoverage: 0.95,
      usageCount: 80,
      successRate: 0.98,
      documentationCompleteness: 0.95,
    });
    const result = scorer.score(skill);
    expect(result.total).toBeGreaterThan(80);
  });

  it("low-quality skill is flagged for improvement (< 50)", () => {
    const skill = makeSkill({
      testCoverage: 0.1,
      usageCount: 2,
      successRate: 0.3,
      documentationCompleteness: 0.1,
    });
    const result = scorer.score(skill);
    expect(result.total).toBeLessThan(50);
    expect(scorer.flagForImprovement(result)).toBe(true);
  });

  it("excellent skill is promoted to proven (> 90)", () => {
    const skill = makeSkill({
      testCoverage: 1.0,
      usageCount: 100,
      successRate: 1.0,
      documentationCompleteness: 1.0,
    });
    const result = scorer.score(skill);
    expect(result.total).toBeGreaterThan(90);
    expect(scorer.promoteToProven(result)).toBe(true);
  });

  it("each dimension is clamped to 0-25 range", () => {
    const extreme = scorer.score(
      makeSkill({
        testCoverage: 2.0, // over 1
        usageCount: 999,
        successRate: 1.5,
        documentationCompleteness: -0.5,
      }),
    );
    expect(extreme.testCoverage).toBeLessThanOrEqual(25);
    expect(extreme.usageFrequency).toBeLessThanOrEqual(25);
    expect(extreme.successRate).toBeLessThanOrEqual(25);
    expect(extreme.documentationCompleteness).toBeGreaterThanOrEqual(0);
    expect(extreme.total).toBeLessThanOrEqual(100);
  });

  it("usage frequency uses logarithmic scale (diminishing returns)", () => {
    const zero = scorer.score(makeSkill({ usageCount: 0 }));
    const low = scorer.score(makeSkill({ usageCount: 1 }));
    const mid = scorer.score(makeSkill({ usageCount: 10 }));
    const high = scorer.score(makeSkill({ usageCount: 100 }));
    // Monotonically increasing
    expect(zero.usageFrequency).toBe(0);
    expect(low.usageFrequency).toBeGreaterThan(zero.usageFrequency);
    expect(mid.usageFrequency).toBeGreaterThan(low.usageFrequency);
    expect(high.usageFrequency).toBeGreaterThan(mid.usageFrequency);
    // Maximum at max count (100) = 25
    expect(high.usageFrequency).toBe(25);
  });
});
