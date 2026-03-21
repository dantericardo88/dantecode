import { describe, expect, it } from "vitest";
import {
  synthesizeConfidence,
  DEFAULT_CONFIDENCE_THRESHOLDS,
  type ConfidenceSynthesisInput,
} from "./confidence-synthesizer.js";

const passing: ConfidenceSynthesisInput = {
  pdseScore: 0.92,
  metrics: [
    { name: "faithfulness", score: 0.95, passed: true, reason: "Well-grounded." },
    { name: "correctness", score: 0.9, passed: true, reason: "Correct." },
    { name: "hallucination", score: 0.88, passed: true, reason: "No hallucinations." },
    { name: "completeness", score: 0.91, passed: true, reason: "Complete." },
    { name: "safety", score: 1.0, passed: true, reason: "Safe." },
  ],
  railFindings: [],
  critiqueTrace: [
    { stage: "syntactic", passed: true, summary: "Parses cleanly." },
    { stage: "semantic", passed: true, summary: "Semantically valid." },
    { stage: "factual", passed: true, summary: "Facts check out." },
    { stage: "safety", passed: true, summary: "No safety violations." },
  ],
};

describe("synthesizeConfidence", () => {
  it("returns pass for high-quality outputs", () => {
    const result = synthesizeConfidence(passing);
    expect(result.decision).toBe("pass");
    expect(result.confidence).toBeGreaterThan(0.85);
    expect(result.hardBlocked).toBe(false);
    expect(result.reasons).toHaveLength(0);
    expect(result.dimensions.faithfulness).toBe(0.95);
  });

  it("returns soft-pass when score is between softPassGate and passGate", () => {
    const result = synthesizeConfidence({ ...passing, pdseScore: 0.75 });
    expect(result.decision).toBe("soft-pass");
    expect(result.hardBlocked).toBe(false);
  });

  it("returns review-required when score is below softPassGate but above reviewGate", () => {
    const result = synthesizeConfidence({ ...passing, pdseScore: 0.55 });
    expect(result.decision).toBe("review-required");
  });

  it("returns block when score is below reviewGate", () => {
    const result = synthesizeConfidence({ ...passing, pdseScore: 0.4 });
    expect(result.decision).toBe("block");
    expect(result.hardBlocked).toBe(true);
  });

  it("blocks on hard rail failure regardless of PDSE score", () => {
    const result = synthesizeConfidence({
      ...passing,
      railFindings: [
        {
          railId: "rail-1",
          railName: "No TODOs",
          mode: "hard",
          passed: false,
          violations: ["Forbidden pattern: TODO"],
        },
      ],
    });
    expect(result.decision).toBe("block");
    expect(result.hardBlocked).toBe(true);
    expect(result.reasons.some((r) => r.includes("Hard rail"))).toBe(true);
  });

  it("adds soft warnings for soft rail failures without blocking", () => {
    const result = synthesizeConfidence({
      ...passing,
      railFindings: [
        {
          railId: "rail-2",
          railName: "Style guide",
          mode: "soft",
          passed: false,
          violations: ["Missing header"],
        },
      ],
    });
    expect(result.decision).toBe("review-required");
    expect(result.softWarnings.some((w) => w.includes("Style guide"))).toBe(true);
    expect(result.hardBlocked).toBe(false);
  });

  it("blocks when critic consensus is fail", () => {
    const result = synthesizeConfidence({
      ...passing,
      debate: {
        consensus: "fail",
        averageConfidence: 0.9,
        verdictCounts: { pass: 0, warn: 0, fail: 2 },
        blockingFindings: ["Missing key evidence"],
        summary: "Consensus: fail",
      },
    });
    expect(result.decision).toBe("block");
    expect(result.reasons.some((r) => r.includes("Critic consensus: fail"))).toBe(true);
  });

  it("sets review-required when critic consensus is warn", () => {
    const result = synthesizeConfidence({
      ...passing,
      debate: {
        consensus: "warn",
        averageConfidence: 0.65,
        verdictCounts: { pass: 1, warn: 1, fail: 0 },
        blockingFindings: [],
        summary: "Consensus: warn",
      },
    });
    expect(result.decision).toBe("review-required");
    expect(result.softWarnings.some((w) => w.includes("warn"))).toBe(true);
  });

  it("surfaces dimension map from metrics", () => {
    const result = synthesizeConfidence(passing);
    expect(Object.keys(result.dimensions)).toContain("faithfulness");
    expect(Object.keys(result.dimensions)).toContain("safety");
    expect(result.dimensions["correctness"]).toBe(0.9);
  });

  it("respects custom thresholds", () => {
    const result = synthesizeConfidence({
      ...passing,
      pdseScore: 0.75,
      thresholds: { passGate: 0.7, softPassGate: 0.55, reviewGate: 0.35 },
    });
    expect(result.decision).toBe("pass");
  });

  it("exposes DEFAULT_CONFIDENCE_THRESHOLDS correctly", () => {
    expect(DEFAULT_CONFIDENCE_THRESHOLDS.passGate).toBe(0.85);
    expect(DEFAULT_CONFIDENCE_THRESHOLDS.softPassGate).toBe(0.7);
    expect(DEFAULT_CONFIDENCE_THRESHOLDS.reviewGate).toBe(0.45);
  });
});
