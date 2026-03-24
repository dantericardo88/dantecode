import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import {
  scorePdseMetrics,
  DEFAULT_PDSE_WEIGHTS,
  type VerificationMetricScore,
  type VerificationMetricName,
  type PdseWeights,
} from "../pdse-scorer.js";
import { MergeConfidenceScorer, type MergeCandidatePatch } from "../council/merge-confidence.js";

// ---------------------------------------------------------------------------
// Arbitraries
// ---------------------------------------------------------------------------

const METRIC_NAMES: VerificationMetricName[] = [
  "faithfulness",
  "correctness",
  "hallucination",
  "completeness",
  "safety",
];

/** A full set of all 5 metrics (one per name). */
const fullMetricsArb: fc.Arbitrary<VerificationMetricScore[]> = fc
  .tuple(
    fc.double({ min: 0, max: 1, noNaN: true }),
    fc.double({ min: 0, max: 1, noNaN: true }),
    fc.double({ min: 0, max: 1, noNaN: true }),
    fc.double({ min: 0, max: 1, noNaN: true }),
    fc.double({ min: 0, max: 1, noNaN: true }),
  )
  .map(([f, c, h, co, s]) =>
    METRIC_NAMES.map((name, i) => ({
      name,
      score: [f, c, h, co, s][i]!,
      passed: [f, c, h, co, s][i]! >= 0.5,
      reason: "auto-generated",
    })),
  );

/** Arbitrary custom weights (all positive). */
const weightsArb: fc.Arbitrary<Partial<PdseWeights>> = fc.record({
  faithfulness: fc.double({ min: 0.01, max: 1, noNaN: true }),
  correctness: fc.double({ min: 0.01, max: 1, noNaN: true }),
  hallucination: fc.double({ min: 0.01, max: 1, noNaN: true }),
  completeness: fc.double({ min: 0.01, max: 1, noNaN: true }),
  safety: fc.double({ min: 0.01, max: 1, noNaN: true }),
});

/** Arbitrary merge candidate patch. */
const candidatePatchArb: fc.Arbitrary<MergeCandidatePatch> = fc.record({
  laneId: fc.string({ minLength: 1, maxLength: 10 }),
  unifiedDiff: fc.string({ maxLength: 200 }),
  changedFiles: fc.array(fc.string({ minLength: 1, maxLength: 30 }), {
    maxLength: 5,
  }),
  passedTests: fc.array(fc.string({ minLength: 1, maxLength: 20 }), {
    maxLength: 5,
  }),
  failedTests: fc.array(fc.string({ minLength: 1, maxLength: 20 }), {
    maxLength: 3,
  }),
});

// ---------------------------------------------------------------------------
// 1. PDSE Scorer: overallScore is always in [0, 1]
// ---------------------------------------------------------------------------

describe("scorePdseMetrics — property-based", () => {
  it("overallScore is always in [0, 1] for any valid metrics", () => {
    fc.assert(
      fc.property(fullMetricsArb, (metrics) => {
        const result = scorePdseMetrics(metrics);
        expect(result.overallScore).toBeGreaterThanOrEqual(0);
        expect(result.overallScore).toBeLessThanOrEqual(1);
      }),
      { numRuns: 300 },
    );
  });

  it("is deterministic: same input always produces same output", () => {
    fc.assert(
      fc.property(fullMetricsArb, (metrics) => {
        const a = scorePdseMetrics(metrics);
        const b = scorePdseMetrics(metrics);
        expect(a.overallScore).toBe(b.overallScore);
        expect(a.passedGate).toBe(b.passedGate);
        expect(a.gate).toBe(b.gate);
      }),
      { numRuns: 200 },
    );
  });

  it("passedGate is true iff overallScore >= gate", () => {
    fc.assert(
      fc.property(fullMetricsArb, fc.double({ min: 0, max: 1, noNaN: true }), (metrics, gate) => {
        const result = scorePdseMetrics(metrics, { gate });
        expect(result.passedGate).toBe(result.overallScore >= gate);
      }),
      { numRuns: 200 },
    );
  });

  it("overallScore equals weighted average of metric scores", () => {
    fc.assert(
      fc.property(fullMetricsArb, weightsArb, (metrics, weights) => {
        const merged: PdseWeights = { ...DEFAULT_PDSE_WEIGHTS, ...weights };
        const result = scorePdseMetrics(metrics, { weights });

        let totalWeight = 0;
        let weightedScore = 0;
        for (const m of metrics) {
          const w = merged[m.name];
          totalWeight += w;
          weightedScore += m.score * w;
        }
        const expected = totalWeight > 0 ? weightedScore / totalWeight : 0;
        expect(result.overallScore).toBeCloseTo(expected, 10);
      }),
      { numRuns: 200 },
    );
  });

  it("empty metrics array produces overallScore 0", () => {
    const result = scorePdseMetrics([]);
    expect(result.overallScore).toBe(0);
  });

  it("all-perfect metrics produce overallScore 1", () => {
    const metrics = METRIC_NAMES.map((name) => ({
      name,
      score: 1.0,
      passed: true,
      reason: "perfect",
    }));
    const result = scorePdseMetrics(metrics);
    expect(result.overallScore).toBeCloseTo(1.0, 10);
  });
});

// ---------------------------------------------------------------------------
// 2. MergeConfidenceScorer: score is always in [0, 100]
// ---------------------------------------------------------------------------

describe("MergeConfidenceScorer — property-based", () => {
  const scorer = new MergeConfidenceScorer();

  it("score is always in [0, 100] for any candidates", () => {
    fc.assert(
      fc.property(fc.array(candidatePatchArb, { minLength: 0, maxLength: 3 }), (candidates) => {
        const result = scorer.score(candidates);
        expect(result.score).toBeGreaterThanOrEqual(0);
        expect(result.score).toBeLessThanOrEqual(100);
      }),
      { numRuns: 100 },
    );
  });

  it("bucket is always one of high/medium/low", () => {
    fc.assert(
      fc.property(fc.array(candidatePatchArb, { minLength: 0, maxLength: 3 }), (candidates) => {
        const result = scorer.score(candidates);
        expect(["high", "medium", "low"]).toContain(result.bucket);
      }),
      { numRuns: 100 },
    );
  });

  it("decision matches bucket thresholds", () => {
    fc.assert(
      fc.property(fc.array(candidatePatchArb, { minLength: 0, maxLength: 3 }), (candidates) => {
        const result = scorer.score(candidates);
        if (result.score >= 75) {
          expect(result.bucket).toBe("high");
          expect(result.decision).toBe("auto-merge");
        } else if (result.score >= 50) {
          expect(result.bucket).toBe("medium");
          expect(result.decision).toBe("review-required");
        } else {
          expect(result.bucket).toBe("low");
          expect(result.decision).toBe("blocked");
        }
      }),
      { numRuns: 100 },
    );
  });

  it("is deterministic: same candidates produce same score", () => {
    fc.assert(
      fc.property(fc.array(candidatePatchArb, { minLength: 1, maxLength: 3 }), (candidates) => {
        const a = scorer.score(candidates);
        const b = scorer.score(candidates);
        expect(a.score).toBe(b.score);
        expect(a.bucket).toBe(b.bucket);
        expect(a.decision).toBe(b.decision);
      }),
      { numRuns: 100 },
    );
  });

  it("all four confidence factors are in [0, 1]", () => {
    fc.assert(
      fc.property(fc.array(candidatePatchArb, { minLength: 0, maxLength: 3 }), (candidates) => {
        const result = scorer.score(candidates);
        const { structuralSafety, testCoverage, intentCompatibility, contractPreservation } =
          result.factors;
        for (const val of [
          structuralSafety,
          testCoverage,
          intentCompatibility,
          contractPreservation,
        ]) {
          expect(val).toBeGreaterThanOrEqual(0);
          expect(val).toBeLessThanOrEqual(1);
        }
      }),
      { numRuns: 100 },
    );
  });

  it("single candidate always has structuralSafety = 1, intentCompatibility = 1, contractPreservation = 1", () => {
    fc.assert(
      fc.property(candidatePatchArb, (candidate) => {
        const result = scorer.score([candidate]);
        expect(result.factors.structuralSafety).toBe(1.0);
        expect(result.factors.intentCompatibility).toBe(1.0);
        expect(result.factors.contractPreservation).toBe(1.0);
      }),
      { numRuns: 100 },
    );
  });
});
