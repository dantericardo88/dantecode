// ============================================================================
// Sprint D — SWE-bench dry run + failure mode anti-pattern injection tests
// Proves: dryRunValidate validates instances, buildFailureModeAntiPatterns
//   converts failure mode strings into actionable system prompt content.
// ============================================================================

import { describe, it, expect } from "vitest";
import { dryRunValidate, buildFailureModeAntiPatterns, classifyFailureMode, triageInstance, parseStepsFromOutput } from "../swe-bench-runner.js";
import type { SWEInstance, SWERunResult } from "../swe-bench-runner.js";

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeInstance(overrides: Partial<SWEInstance> = {}): SWEInstance {
  return {
    instance_id: "test-instance",
    repo: "astropy/astropy",
    base_commit: "abc1234def5678",
    problem_statement: "Fix the broken calculation in utils.py",
    test_patch: "diff --git a/tests/test_utils.py",
    FAIL_TO_PASS: ["tests/test_utils.py::test_calc"],
    PASS_TO_PASS: [],
    ...overrides,
  };
}

function makeResult(overrides: Partial<SWERunResult> = {}): SWERunResult {
  return {
    instance_id: "test-instance",
    resolved: false,
    model_patch: "",
    test_output: "",
    duration_ms: 100,
    ...overrides,
  };
}

// ── dryRunValidate ────────────────────────────────────────────────────────────

describe("dryRunValidate", () => {
  it("returns one result per instance", () => {
    const instances = [makeInstance({ instance_id: "a" }), makeInstance({ instance_id: "b" })];
    const results = dryRunValidate(instances);
    expect(results).toHaveLength(2);
    expect(results[0]!.instance_id).toBe("a");
    expect(results[1]!.instance_id).toBe("b");
  });

  it("parsedOk is true for valid instances", () => {
    const result = dryRunValidate([makeInstance()])[0]!;
    expect(result.parsedOk).toBe(true);
  });

  it("hasTestSpecs is true when FAIL_TO_PASS is non-empty", () => {
    const result = dryRunValidate([makeInstance()])[0]!;
    expect(result.hasTestSpecs).toBe(true);
  });

  it("hasTestSpecs is false when both test spec arrays are empty", () => {
    const result = dryRunValidate([
      makeInstance({ FAIL_TO_PASS: [], PASS_TO_PASS: [], fail_to_pass: [], pass_to_pass: [] }),
    ])[0]!;
    expect(result.hasTestSpecs).toBe(false);
  });

  it("hasProblemStatement is true when non-empty", () => {
    const result = dryRunValidate([makeInstance()])[0]!;
    expect(result.hasProblemStatement).toBe(true);
  });

  it("hasProblemStatement is false for empty problem statement", () => {
    const result = dryRunValidate([makeInstance({ problem_statement: "   " })])[0]!;
    expect(result.hasProblemStatement).toBe(false);
  });

  it("hasBaseCommit is true for valid SHA", () => {
    const result = dryRunValidate([makeInstance({ base_commit: "abc1234" })])[0]!;
    expect(result.hasBaseCommit).toBe(true);
  });

  it("hasBaseCommit is false for empty base_commit", () => {
    const result = dryRunValidate([makeInstance({ base_commit: "" })])[0]!;
    expect(result.hasBaseCommit).toBe(false);
  });

  it("handles lowercase fail_to_pass field (legacy dataset format)", () => {
    const result = dryRunValidate([
      makeInstance({ FAIL_TO_PASS: undefined, fail_to_pass: ["tests/test_a.py::test_x"] }),
    ])[0]!;
    expect(result.hasTestSpecs).toBe(true);
  });
});

// ── buildFailureModeAntiPatterns ──────────────────────────────────────────────

describe("buildFailureModeAntiPatterns", () => {
  it("returns empty string for empty failure modes", () => {
    expect(buildFailureModeAntiPatterns([])).toBe("");
  });

  it("returns a non-empty block for known failure modes", () => {
    const result = buildFailureModeAntiPatterns(["timeout:3", "compile_error:2"]);
    expect(result).toContain("Anti-Pattern");
    expect(result).toContain("timeout");
    expect(result).toContain("compile_error");
  });

  it("includes specific actionable advice for timeout failures", () => {
    const result = buildFailureModeAntiPatterns(["timeout:5"]);
    expect(result).toContain("minimal patch");
  });

  it("includes advice for no_patch failures", () => {
    const result = buildFailureModeAntiPatterns(["no_patch:3"]);
    expect(result).toContain("concrete file change");
  });

  it("handles unknown failure modes gracefully", () => {
    const result = buildFailureModeAntiPatterns(["mystery_failure:1"]);
    expect(result).toContain("mystery_failure");
    expect(result).not.toBe("");
  });

  it("produces markdown with ## heading", () => {
    const result = buildFailureModeAntiPatterns(["compile_error:1"]);
    expect(result).toMatch(/^## SWE-bench/);
  });
});

// ── classifyFailureMode ───────────────────────────────────────────────────────

describe("classifyFailureMode (regression coverage)", () => {
  it("classifies resolved as 'resolved'", () => {
    expect(classifyFailureMode(makeResult({ resolved: true }))).toBe("resolved");
  });

  it("classifies timeout error", () => {
    const mode = classifyFailureMode(makeResult({ error: "Process timed out" }));
    expect(mode).toBe("timeout");
  });

  it("classifies compile error from test output", () => {
    const mode = classifyFailureMode(makeResult({ test_output: "SyntaxError: unexpected EOF" }));
    expect(mode).toBe("compile_error");
  });

  it("classifies no_patch when model_patch is empty", () => {
    const mode = classifyFailureMode(makeResult({ model_patch: "" }));
    expect(mode).toBe("no_patch");
  });

  it("classifies test_assertion from FAILED in output", () => {
    const mode = classifyFailureMode(makeResult({ model_patch: "some diff", test_output: "FAILED tests/test_a.py::test_x" }));
    expect(mode).toBe("test_assertion");
  });
});

// ── Sprint C — triageInstance ─────────────────────────────────────────────────

describe("triageInstance()", () => {
  it("returns easy for short problem statement and ≤2 FAIL_TO_PASS tests", () => {
    const inst = makeInstance({
      problem_statement: "Fix one-line bug", // < 500 chars
      FAIL_TO_PASS: ["tests/test_a.py::test_x"],
    });
    expect(triageInstance(inst)).toBe("easy");
  });

  it("returns hard for long problem statement", () => {
    const inst = makeInstance({
      problem_statement: "x".repeat(600), // > 500 chars
      FAIL_TO_PASS: ["tests/test_a.py::test_x"],
    });
    expect(triageInstance(inst)).toBe("hard");
  });

  it("returns hard when FAIL_TO_PASS has more than 2 tests", () => {
    const inst = makeInstance({
      problem_statement: "Short fix", // < 500 chars
      FAIL_TO_PASS: ["tests/a.py::t1", "tests/a.py::t2", "tests/a.py::t3"],
    });
    expect(triageInstance(inst)).toBe("hard");
  });

  it("returns easy when exactly 2 FAIL_TO_PASS tests", () => {
    const inst = makeInstance({
      problem_statement: "Small fix",
      FAIL_TO_PASS: ["tests/a.py::t1", "tests/a.py::t2"],
    });
    expect(triageInstance(inst)).toBe("easy");
  });

  it("dryRunValidate includes triage field in each result", () => {
    const easy = makeInstance({ problem_statement: "tiny", FAIL_TO_PASS: ["tests/t.py::test"] });
    const hard = makeInstance({ problem_statement: "x".repeat(600), FAIL_TO_PASS: [] });
    const results = dryRunValidate([easy, hard]);
    expect(results[0]?.triage).toBe("easy");
    expect(results[1]?.triage).toBe("hard");
  });
});

// ── Sprint C — parseStepsFromOutput ──────────────────────────────────────────

describe("parseStepsFromOutput()", () => {
  it("returns empty array when no TOOL patterns found", () => {
    const steps = parseStepsFromOutput("some random output without tools", 1000);
    expect(steps).toEqual([]);
  });

  it("parses TOOL: name: input pattern into step records", () => {
    const output = "[TOOL]: Read: src/auth.ts\n[TOOL]: Edit: added null check";
    const steps = parseStepsFromOutput(output, 2000);
    expect(steps.length).toBeGreaterThanOrEqual(1);
    expect(steps[0]).toHaveProperty("tool");
    expect(steps[0]).toHaveProperty("durationMs");
  });

  it("step records have required fields", () => {
    const output = "[TOOL]: Bash: npm test";
    const steps = parseStepsFromOutput(output, 500);
    if (steps.length > 0) {
      expect(steps[0]).toMatchObject({
        tool: expect.any(String),
        input: expect.any(String),
        output: expect.any(String),
        durationMs: expect.any(Number),
      });
    }
  });
});
