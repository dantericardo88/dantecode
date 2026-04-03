import { describe, expect, it, beforeEach } from "vitest";
import { VerificationBootstrapper, type LabeledExample } from "./verification-bootstrapping.js";
import { VerificationTuner, type VerifierOutcome } from "./verification-tuning.js";

const EXAMPLES: LabeledExample[] = [
  {
    id: "ex-1",
    task: "Provide deployment steps and rollback guidance",
    output:
      "Steps:\n1. Build release.\n2. Deploy to staging.\n3. Deploy to production.\nRollback: revert artifact if health checks fail.",
    expectedDecision: "pass",
  },
  {
    id: "ex-2",
    task: "Explain authentication flow",
    output: "TODO: fill this in later.",
    expectedDecision: "block",
  },
  {
    id: "ex-3",
    task: "Summarize migration plan",
    output:
      "Migration:\n1. Take backup.\n2. Apply schema migration.\n3. Verify row counts.\n4. Rollback if errors.",
    expectedDecision: "pass",
  },
  {
    id: "ex-4",
    task: "Write rollback procedure",
    output: "TBD",
    expectedDecision: "block",
  },
];

// ---------------------------------------------------------------------------
// VerificationBootstrapper
// ---------------------------------------------------------------------------

describe("VerificationBootstrapper", () => {
  let bootstrapper: VerificationBootstrapper;

  beforeEach(() => {
    bootstrapper = new VerificationBootstrapper();
  });

  it("returns perfect accuracy with no examples", () => {
    const result = bootstrapper.calibrate();
    expect(result.accuracy).toBe(1);
    expect(result.exampleCount).toBe(0);
    expect(result.iterationsRun).toBe(0);
  });

  it("calibrates on labeled examples and returns weights + thresholds", () => {
    bootstrapper.addExamples(EXAMPLES);
    const result = bootstrapper.calibrate({ maxIterations: 5 });
    expect(result.exampleCount).toBe(4);
    expect(result.accuracy).toBeGreaterThanOrEqual(0);
    expect(result.accuracy).toBeLessThanOrEqual(1);
    expect(result.calibratedWeights.faithfulness).toBeGreaterThan(0);
    expect(result.calibratedWeights.correctness).toBeGreaterThan(0);
    expect(result.calibratedThresholds.passGate).toBeGreaterThan(0);
  });

  it("adds examples individually", () => {
    bootstrapper.addExample(EXAMPLES[0]!);
    bootstrapper.addExample(EXAMPLES[1]!);
    expect(bootstrapper.exampleCount).toBe(2);
  });

  it("clears examples", () => {
    bootstrapper.addExamples(EXAMPLES);
    bootstrapper.clearExamples();
    expect(bootstrapper.exampleCount).toBe(0);
  });

  it("produces decision breakdown", () => {
    bootstrapper.addExamples(EXAMPLES);
    const result = bootstrapper.calibrate({ maxIterations: 2 });
    expect(result.decisionBreakdown.pass).toBeDefined();
    expect(result.decisionBreakdown.block).toBeDefined();
    expect(
      result.decisionBreakdown.pass.total + result.decisionBreakdown.block.total,
    ).toBeLessThanOrEqual(4);
  });

  it("respects maxIterations", () => {
    bootstrapper.addExamples(EXAMPLES);
    const result = bootstrapper.calibrate({ maxIterations: 3 });
    expect(result.iterationsRun).toBeLessThanOrEqual(3);
  });

  it("calibrated weights sum to approximately 1 (normalized)", () => {
    bootstrapper.addExamples(EXAMPLES);
    const result = bootstrapper.calibrate({ maxIterations: 5 });
    const sum = Object.values(result.calibratedWeights).reduce((s, v) => s + v, 0);
    expect(sum).toBeCloseTo(1.0, 1);
  });
});

// ---------------------------------------------------------------------------
// VerificationTuner
// ---------------------------------------------------------------------------

describe("VerificationTuner", () => {
  let tuner: VerificationTuner;

  function makeOutcome(
    id: string,
    decision: VerifierOutcome["decision"],
    pdseScore = 0.8,
  ): Omit<VerifierOutcome, "recordedAt"> {
    return { id, task: "task", decision, pdseScore };
  }

  beforeEach(() => {
    tuner = new VerificationTuner();
  });

  it("tracks outcomes and counts them", () => {
    tuner.track(makeOutcome("o1", "pass"));
    tuner.track(makeOutcome("o2", "block"));
    expect(tuner.outcomeCount).toBe(2);
  });

  it("returns no suggestions when no feedback given", () => {
    tuner.track(makeOutcome("o1", "pass"));
    const report = tuner.suggestTuning();
    expect(report.suggestions).toHaveLength(0);
    expect(report.falsePositiveRate).toBe(0);
    expect(report.falseNegativeRate).toBe(0);
  });

  it("applies user feedback to an outcome", () => {
    tuner.track(makeOutcome("o1", "block"));
    const applied = tuner.applyFeedback("o1", "false_positive");
    expect(applied).toBe(true);
    const outcomes = tuner.getOutcomes();
    expect(outcomes.find((o) => o.id === "o1")?.feedback).toBe("false_positive");
  });

  it("returns false for applyFeedback on unknown id", () => {
    expect(tuner.applyFeedback("unknown", "confirmed_correct")).toBe(false);
  });

  it("suggests lowering passGate when false positive rate is high", () => {
    for (let i = 0; i < 10; i++) {
      tuner.track(makeOutcome(`o${i}`, "block", 0.6));
      tuner.applyFeedback(`o${i}`, "false_positive");
    }
    const report = tuner.suggestTuning();
    expect(report.falsePositiveRate).toBeGreaterThan(0.15);
    const decreaseSugg = report.suggestions.find(
      (s) => s.dimension === "passGate" && s.direction === "decrease",
    );
    expect(decreaseSugg).toBeDefined();
  });

  it("suggests raising reviewGate when false negative rate is high", () => {
    for (let i = 0; i < 10; i++) {
      tuner.track(makeOutcome(`o${i}`, "pass", 0.9));
      tuner.applyFeedback(`o${i}`, "false_negative");
    }
    const report = tuner.suggestTuning();
    expect(report.falseNegativeRate).toBeGreaterThan(0.15);
    const increaseSugg = report.suggestions.find(
      (s) => s.dimension === "reviewGate" && s.direction === "increase",
    );
    expect(increaseSugg).toBeDefined();
  });

  it("applySuggestion returns new values without mutating input", () => {
    const current = {
      passGate: 0.85,
      softPassGate: 0.7,
      reviewGate: 0.45,
    };
    const suggestion = {
      dimension: "passGate" as const,
      direction: "decrease" as const,
      magnitude: 0.05,
      confidence: 0.8,
      reason: "Too strict",
    };
    const updated = tuner.applySuggestion(suggestion, current);
    expect(updated.passGate).toBeCloseTo(0.8);
    expect(current.passGate).toBe(0.85); // original not mutated
  });

  it("respects maxOutcomes LRU eviction", () => {
    const smallTuner = new VerificationTuner(3);
    smallTuner.track(makeOutcome("a", "pass"));
    smallTuner.track(makeOutcome("b", "pass"));
    smallTuner.track(makeOutcome("c", "pass"));
    smallTuner.track(makeOutcome("d", "pass")); // evicts "a"
    const ids = smallTuner.getOutcomes().map((o) => o.id);
    expect(ids).not.toContain("a");
    expect(ids).toContain("d");
  });

  it("clears all outcomes", () => {
    tuner.track(makeOutcome("o1", "pass"));
    tuner.clear();
    expect(tuner.outcomeCount).toBe(0);
  });
});
