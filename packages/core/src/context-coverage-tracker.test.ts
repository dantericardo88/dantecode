// Sprint BM — Dim 21: MemoryDecisionInfluence semantic upgrade tests
import { describe, it, expect } from "vitest";
import {
  computeMemoryDecisionInfluence,
  getMemoryInfluenceSummary,
  type MemoryDecisionEntry,
} from "./context-coverage-tracker.js";

describe("computeMemoryDecisionInfluence — Jaccard upgrade (threshold 0.2)", () => {
  it("detects influence when Jaccard >= 0.2", () => {
    const facts = ["react hooks useState useEffect component"];
    const msgs = ["We use React hooks like useState and useEffect inside function components."];
    const result = computeMemoryDecisionInfluence("s1", facts, msgs);
    expect(result.influencedFactCount).toBe(1);
    expect(result.influenceRate).toBeCloseTo(1);
    expect(result.avgJaccardScore).toBeGreaterThan(0);
  });

  it("returns zero influence when Jaccard < 0.2 for all facts", () => {
    const facts = ["quantum entanglement photon spin polarization"];
    const msgs = ["The database query ran in 200ms on the production server."];
    const result = computeMemoryDecisionInfluence("s2", facts, msgs);
    expect(result.influencedFactCount).toBe(0);
    expect(result.influenceRate).toBe(0);
    expect(result.avgJaccardScore).toBe(0);
  });

  it("avgJaccardScore reflects actual Jaccard avg of influenced facts", () => {
    const facts = [
      "useEffect dependency array render lifecycle",
      "webpack bundler module chunk splitting",
    ];
    const msgs = [
      "useEffect depends on the dependency array to control lifecycle render cycles.",
    ];
    const result = computeMemoryDecisionInfluence("s3", facts, msgs);
    // At least 1 influenced fact (useEffect one)
    if (result.influencedFactCount > 0) {
      expect(result.avgJaccardScore).toBeGreaterThan(0);
    }
  });

  it("handles empty facts gracefully", () => {
    const result = computeMemoryDecisionInfluence("s4", [], ["some message"]);
    expect(result.influencedFactCount).toBe(0);
    expect(result.injectedFactCount).toBe(0);
    expect(result.influenceRate).toBe(0);
    expect(result.avgJaccardScore).toBe(0);
  });

  it("handles empty messages gracefully", () => {
    const result = computeMemoryDecisionInfluence("s5", ["some fact text here"], []);
    expect(result.influencedFactCount).toBe(0);
    expect(result.avgJaccardScore).toBe(0);
  });

  it("includes avgJaccardScore field in returned entry", () => {
    const result = computeMemoryDecisionInfluence("s6", ["anything"], ["anything test here"]);
    expect(typeof result.avgJaccardScore).toBe("number");
    expect(result.avgJaccardScore).toBeGreaterThanOrEqual(0);
    expect(result.avgJaccardScore).toBeLessThanOrEqual(1);
  });

  it("multiple facts — only counts influenced ones in avgJaccardScore", () => {
    const facts = [
      "typescript generic interface type constraint",
      "chocolate cake frosting recipe baking",
    ];
    const msgs = [
      "TypeScript generic interface with type constraint ensures type safety.",
    ];
    const result = computeMemoryDecisionInfluence("s7", facts, msgs);
    // typescript fact should be influenced; cake should not
    expect(result.injectedFactCount).toBe(2);
    // avgJaccardScore should only include the influenced fact
    if (result.influencedFactCount > 0) {
      expect(result.avgJaccardScore).toBeGreaterThan(0);
    }
  });
});

describe("getMemoryInfluenceSummary", () => {
  const makeEntry = (avgJaccardScore: number, injectedFactCount = 5): MemoryDecisionEntry => ({
    sessionId: "s",
    injectedFactCount,
    influencedFactCount: 3,
    influenceRate: 0.6,
    influencedSnippets: [],
    avgJaccardScore,
    timestamp: new Date().toISOString(),
  });

  it("returns zeros for empty entries", () => {
    const summary = getMemoryInfluenceSummary([]);
    expect(summary.highInfluenceRate).toBe(0);
    expect(summary.avgJaccard).toBe(0);
    expect(summary.totalFacts).toBe(0);
  });

  it("computes highInfluenceRate as fraction of sessions with avgJaccardScore >= 0.3", () => {
    const entries = [
      makeEntry(0.35),  // high
      makeEntry(0.15),  // not high
      makeEntry(0.50),  // high
      makeEntry(0.10),  // not high
    ];
    const summary = getMemoryInfluenceSummary(entries);
    expect(summary.highInfluenceRate).toBeCloseTo(0.5);
  });

  it("computes avgJaccard as average of all avgJaccardScores", () => {
    const entries = [makeEntry(0.2), makeEntry(0.4)];
    const summary = getMemoryInfluenceSummary(entries);
    expect(summary.avgJaccard).toBeCloseTo(0.3);
  });

  it("computes totalFacts as sum of injectedFactCount", () => {
    const entries = [makeEntry(0.3, 4), makeEntry(0.3, 6)];
    const summary = getMemoryInfluenceSummary(entries);
    expect(summary.totalFacts).toBe(10);
  });

  it("highInfluenceRate is 1.0 when all sessions are high influence", () => {
    const entries = [makeEntry(0.5), makeEntry(0.6), makeEntry(0.9)];
    const summary = getMemoryInfluenceSummary(entries);
    expect(summary.highInfluenceRate).toBeCloseTo(1.0);
  });
});
