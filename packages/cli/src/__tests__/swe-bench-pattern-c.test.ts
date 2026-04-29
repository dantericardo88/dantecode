// Tests for Pattern C mitigation — pre-flight pytest --collect-only and
// the env_error classification path. Verifies:
//   - classifyFailureMode recognizes the env_error: prefix in result.error
//     and returns it as a distinct bucket (not test_assertion / not
//     import_error which is reserved for in-test failures).
//   - runPytestCollectOnly is exported (so failure-analysis tooling can
//     reuse it).

import { describe, it, expect } from "vitest";
import {
  classifyFailureMode,
  runPytestCollectOnly,
  type SWERunResult,
} from "../swe-bench-runner.js";

function makeResult(overrides: Partial<SWERunResult> = {}): SWERunResult {
  return {
    instance_id: "test/repo-1",
    resolved: false,
    model_patch: "",
    test_output: "",
    duration_ms: 0,
    ...overrides,
  };
}

describe("classifyFailureMode — env_error", () => {
  it("returns env_error for pre-flight collection failure", () => {
    const r = makeResult({ error: "env_error: pytest collection failed (import error in conftest)" });
    expect(classifyFailureMode(r)).toBe("env_error");
  });

  it("env_error wins over test_output content (agent never ran)", () => {
    const r = makeResult({
      error: "env_error: pytest collection failed (plugin validation error)",
      test_output: "ImportError: while loading plugin foo", // would otherwise match import_error
    });
    expect(classifyFailureMode(r)).toBe("env_error");
  });

  it("does NOT confuse env_error with timeout", () => {
    const r = makeResult({ error: "agent timed out after 600s" });
    expect(classifyFailureMode(r)).toBe("timeout");
  });

  it("does NOT match arbitrary error strings as env_error", () => {
    // Provide a non-empty model_patch so the no_patch classifier (which
    // would otherwise win for empty patches) doesn't shadow this test.
    const r = makeResult({
      error: "some other failure (not env)",
      model_patch: "diff --git a/x b/x\n",
    });
    expect(classifyFailureMode(r)).toBe("unknown");
  });

  it("env_error case is case-insensitive on the prefix", () => {
    const r = makeResult({ error: "ENV_ERROR: missing module" });
    expect(classifyFailureMode(r)).toBe("env_error");
  });
});

describe("runPytestCollectOnly", () => {
  it("is an exported async function", () => {
    expect(typeof runPytestCollectOnly).toBe("function");
    // Returns a promise — call it on a non-existent dir just to verify
    // the return shape, not real pytest behavior.
    const p = runPytestCollectOnly("/nonexistent/dir");
    expect(p).toBeInstanceOf(Promise);
    return p.then((res) => {
      expect(res).toHaveProperty("failed");
      expect(res).toHaveProperty("output");
    });
  });
});
