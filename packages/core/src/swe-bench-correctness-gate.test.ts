import { describe, expect, it } from "vitest";
import {
  classifySWEFailure,
  evaluateSWEBenchCorrectnessGate,
  formatSWEBenchCorrectnessMarkdown,
} from "./swe-bench-correctness-gate.js";
import type { SWEBenchCorrectnessGateInput } from "./swe-bench-correctness-gate.js";

function passingInput(overrides: Partial<SWEBenchCorrectnessGateInput> = {}): SWEBenchCorrectnessGateInput {
  return {
    dimensionId: "swe_bench_correctness",
    generatedAt: "2026-04-29T12:00:00.000Z",
    suite: "verified",
    dataset: {
      path: "benchmarks/swe-bench/swe-bench-verified.jsonl",
      sha256: "dataset-sha",
      seed: 5,
      selectedInstanceIds: Array.from({ length: 100 }, (_, i) => `repo__issue-${i + 1}`),
    },
    calibration: {
      total: 100,
      reproducedBaseline: 100,
      goldResolved: 98,
      passRate: 0.98,
      threshold: 0.95,
      artifactPath: ".danteforge/evidence/swe-bench-calibration-dim5.json",
    },
    agentRun: {
      total: 100,
      resolved: 68,
      passRate: 0.68,
      requiredPassRate: 0.65,
      attempts: 3,
      artifactPath: ".danteforge/evidence/swe-bench-run-dim5.json",
    },
    comparison: {
      baselinePassRate: 0.52,
      candidatePassRate: 0.68,
      delta: 0.16,
      requiredDelta: 0.1,
      artifactPath: ".danteforge/evidence/swe-bench-comparison-dim5.json",
    },
    repeatedRuns: [
      { runId: "run-a", passRate: 0.68 },
      { runId: "run-b", passRate: 0.66 },
    ],
    artifactCompleteness: {
      trajectoryCount: 100,
      patchCount: 100,
      baselineLogCount: 100,
      verificationLogCount: 100,
      environmentLogCount: 100,
      classifiedFailureCount: 100,
      manifestPath: "benchmarks/swe-bench/runs/run-a/manifest.json",
    },
    failureTaxonomy: {
      resolved: 68,
      agent_wrong_patch: 20,
      timeout: 12,
    },
    limitations: [
      "Verified tranche only; SWE-bench Pro required before any 9.5+ claim.",
    ],
    ...overrides,
  };
}

describe("SWE-bench correctness gate", () => {
  it("fails without dataset hash, calibration, pass-rate, trajectories, A/B, or repeated-run evidence", () => {
    const result = evaluateSWEBenchCorrectnessGate({
      ...passingInput(),
      dataset: { path: "", sha256: "", seed: Number.NaN, selectedInstanceIds: [] },
      calibration: { total: 0, reproducedBaseline: 0, goldResolved: 0, passRate: 0, threshold: 0.95 },
      agentRun: { total: 0, resolved: 0, passRate: 0, requiredPassRate: 0.65, attempts: 0 },
      comparison: { baselinePassRate: 0, candidatePassRate: 0, delta: 0, requiredDelta: 0.1 },
      repeatedRuns: [],
      artifactCompleteness: {
        trajectoryCount: 0,
        patchCount: 0,
        baselineLogCount: 0,
        verificationLogCount: 0,
        environmentLogCount: 0,
        classifiedFailureCount: 0,
      },
      limitations: [],
    });

    expect(result.pass).toBe(false);
    expect(result.maxEligibleScore).toBeLessThan(9);
    expect(result.blockers).toEqual(
      expect.arrayContaining([
        "dataset sha256 is required",
        "gold-patch calibration is below 95%",
        "agent run pass rate is below 65%",
        "A/B delta is below 10 percentage points",
        "at least two repeated runs are required",
        "limitations are required",
      ]),
    );
  });

  it("rejects score claims when calibration is below 95%", () => {
    const result = evaluateSWEBenchCorrectnessGate({
      ...passingInput(),
      calibration: {
        total: 100,
        reproducedBaseline: 100,
        goldResolved: 90,
        passRate: 0.9,
        threshold: 0.95,
      },
    });

    expect(result.pass).toBe(false);
    expect(result.maxEligibleScore).toBe(7);
    expect(result.blockers).toContain("gold-patch calibration is below 95%");
  });

  it("allows 9.0 only when the full public-proof threshold is satisfied", () => {
    const result = evaluateSWEBenchCorrectnessGate(passingInput(), { threshold: 90 });

    expect(result.pass).toBe(true);
    expect(result.score).toBeGreaterThanOrEqual(90);
    expect(result.maxEligibleScore).toBe(9);
    expect(result.proof.calibrationGreen).toBe(true);
    expect(result.proof.abImprovementGreen).toBe(true);
    expect(result.proof.repeatedRunStable).toBe(true);
    expect(result.proof.artifactsComplete).toBe(true);
  });

  it("classifies failures deterministically", () => {
    expect(classifySWEFailure({ error: "Environment setup failed", test_output: "" })).toBe("env_error");
    expect(classifySWEFailure({ error: "Test patch failed to apply", test_output: "" })).toBe("test_patch_error");
    expect(classifySWEFailure({ error: "Baseline did not reproduce", test_output: "" })).toBe("baseline_not_reproduced");
    expect(classifySWEFailure({ error: "agent produced no patch", test_output: "" })).toBe("agent_no_patch");
    expect(classifySWEFailure({ error: "timed out after 600000ms", test_output: "" })).toBe("timeout");
    expect(classifySWEFailure({ error: "intermittent flaky test", test_output: "" })).toBe("flaky");
    expect(classifySWEFailure({ error: undefined, test_output: "FAILED tests/test_x.py::test_bug" })).toBe("agent_wrong_patch");
    expect(classifySWEFailure({ resolved: true, test_output: "passed" })).toBe("resolved");
  });

  it("renders markdown with calibration, pass rate, A/B, and blockers", () => {
    const result = evaluateSWEBenchCorrectnessGate(passingInput());
    const markdown = formatSWEBenchCorrectnessMarkdown(result);

    expect(markdown).toContain("SWE-bench Correctness Gate");
    expect(markdown).toContain("Gold calibration");
    expect(markdown).toContain("Agent pass rate");
    expect(markdown).toContain("A/B delta");
    expect(markdown).toContain("Blockers");
  });
});
