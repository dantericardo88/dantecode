// packages/cli/src/__tests__/bench-results-wiring.test.ts
// Sprint 34 — Dim 5: Bench Results Persistence (SWE-bench 6→measured)
// Tests: classifyFailureMode, extractTopFailureModes, persistBenchResults

import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock fs/promises for persistBenchResults
vi.mock("node:fs/promises", () => ({
  readFile: vi.fn(),
  writeFile: vi.fn().mockResolvedValue(undefined),
  mkdir: vi.fn().mockResolvedValue(undefined),
  rm: vi.fn().mockResolvedValue(undefined),
  access: vi.fn().mockRejectedValue(new Error("ENOENT")),
}));

import { readFile, writeFile, mkdir } from "node:fs/promises";
import {
  classifyFailureMode,
  extractTopFailureModes,
  persistBenchResults,
  type SWERunResult,
  type SWEReport,
  type PersistentBenchResults,
} from "../swe-bench-runner.js";

function makeResult(overrides: Partial<SWERunResult> = {}): SWERunResult {
  return {
    instance_id: "test-instance-1",
    resolved: false,
    model_patch: "--- a/foo.py\n+++ b/foo.py\n@@ -1 +1 @@\n-x\n+y",
    test_output: "",
    duration_ms: 5000,
    ...overrides,
  };
}

function makeReport(overrides: Partial<SWEReport> = {}): SWEReport {
  return {
    run_id: "run-abc-123",
    model: "anthropic/claude-sonnet-4-6",
    total: 10,
    resolved: 6,
    pass_rate: 0.6,
    results: [],
    generated_at: new Date().toISOString(),
    ...overrides,
  };
}

// ─── classifyFailureMode ──────────────────────────────────────────────────────

describe("classifyFailureMode", () => {
  it("returns 'resolved' for resolved instances", () => {
    const result = makeResult({ resolved: true });
    expect(classifyFailureMode(result)).toBe("resolved");
  });

  it("returns 'timeout' when error includes 'timeout'", () => {
    const result = makeResult({ error: "Process timed out after 600000ms" });
    expect(classifyFailureMode(result)).toBe("timeout");
  });

  it("returns 'clone_error' when error includes 'clone'", () => {
    const result = makeResult({ error: "git clone failed: repository not found" });
    expect(classifyFailureMode(result)).toBe("clone_error");
  });

  it("returns 'compile_error' for SyntaxError in test_output", () => {
    const result = makeResult({ test_output: "SyntaxError: invalid syntax" });
    expect(classifyFailureMode(result)).toBe("compile_error");
  });

  it("returns 'import_error' for ImportError in test_output", () => {
    const result = makeResult({ test_output: "ImportError: cannot import name 'foo'" });
    expect(classifyFailureMode(result)).toBe("import_error");
  });

  it("returns 'test_assertion' for FAILED + AssertionError in test_output", () => {
    const result = makeResult({ test_output: "FAILED test_foo::test_bar - AssertionError" });
    expect(classifyFailureMode(result)).toBe("test_assertion");
  });

  it("returns 'no_patch' when model_patch is empty", () => {
    const result = makeResult({ model_patch: "   ", test_output: "" });
    expect(classifyFailureMode(result)).toBe("no_patch");
  });

  it("returns 'unknown' for unclassified failures", () => {
    const result = makeResult({ model_patch: "some diff", test_output: "weird output" });
    expect(classifyFailureMode(result)).toBe("unknown");
  });
});

// ─── extractTopFailureModes ───────────────────────────────────────────────────

describe("extractTopFailureModes", () => {
  it("returns empty array when all instances are resolved", () => {
    const report = makeReport({
      results: [
        makeResult({ resolved: true }),
        makeResult({ resolved: true }),
      ],
    });
    expect(extractTopFailureModes(report)).toEqual([]);
  });

  it("counts failure modes and sorts by frequency descending", () => {
    const report = makeReport({
      results: [
        makeResult({ error: "timeout" }),
        makeResult({ error: "timeout" }),
        makeResult({ test_output: "SyntaxError" }),
      ],
    });
    const modes = extractTopFailureModes(report);
    expect(modes[0]).toMatch(/^timeout:\d+/);
    expect(modes[1]).toMatch(/^compile_error:\d+/);
  });

  it("respects topN limit", () => {
    const results = Array.from({ length: 10 }, (_, i) =>
      makeResult({ test_output: `unique-error-${i}`, model_patch: "x" }),
    );
    const report = makeReport({ results });
    const modes = extractTopFailureModes(report, 3);
    expect(modes.length).toBeLessThanOrEqual(3);
  });

  it("format is 'mode:count'", () => {
    const report = makeReport({
      results: [makeResult({ error: "timeout" })],
    });
    const modes = extractTopFailureModes(report);
    expect(modes[0]).toMatch(/^\w+:\d+$/);
  });
});

// ─── persistBenchResults ──────────────────────────────────────────────────────

describe("persistBenchResults", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(writeFile).mockResolvedValue(undefined);
    vi.mocked(mkdir).mockResolvedValue(undefined);
  });

  it("creates a new file when bench-results.json does not exist", async () => {
    vi.mocked(readFile).mockRejectedValue(new Error("ENOENT"));

    const report = makeReport({ pass_rate: 0.6, resolved: 6, total: 10 });
    const result = await persistBenchResults(report, "/test/project");

    expect(result.runs).toHaveLength(1);
    expect(result.runs[0]?.run_id).toBe(report.run_id);
    expect(mkdir).toHaveBeenCalledWith(expect.stringContaining(".danteforge"), { recursive: true });
    expect(writeFile).toHaveBeenCalledWith(
      expect.stringContaining("bench-results.json"),
      expect.any(String),
      "utf-8",
    );
  });

  it("accumulates runs (prepends new run to existing runs)", async () => {
    const existing: PersistentBenchResults = {
      last_updated: "2026-01-01T00:00:00.000Z",
      best_pass_rate: 0.4,
      best_model: "old-model",
      runs: [
        {
          run_id: "old-run",
          timestamp: "2026-01-01T00:00:00.000Z",
          model: "old-model",
          total: 10,
          resolved: 4,
          pass_rate: 0.4,
          failure_modes: [],
          instance_outcomes: [],
        },
      ],
    };
    vi.mocked(readFile).mockResolvedValue(JSON.stringify(existing));

    const report = makeReport({ pass_rate: 0.6, resolved: 6, total: 10, run_id: "new-run" });
    const result = await persistBenchResults(report, "/test/project");

    expect(result.runs).toHaveLength(2);
    expect(result.runs[0]?.run_id).toBe("new-run"); // newest first
    expect(result.runs[1]?.run_id).toBe("old-run");
  });

  it("updates best_pass_rate when new run beats the record", async () => {
    vi.mocked(readFile).mockRejectedValue(new Error("ENOENT"));

    const report = makeReport({ pass_rate: 0.75, model: "anthropic/claude-opus-4-6" });
    const result = await persistBenchResults(report, "/test/project");

    expect(result.best_pass_rate).toBe(0.75);
    expect(result.best_model).toBe("anthropic/claude-opus-4-6");
  });

  it("does not update best_pass_rate when new run is worse", async () => {
    const existing: PersistentBenchResults = {
      last_updated: "2026-01-01T00:00:00.000Z",
      best_pass_rate: 0.9,
      best_model: "best-model",
      runs: [],
    };
    vi.mocked(readFile).mockResolvedValue(JSON.stringify(existing));

    const report = makeReport({ pass_rate: 0.5, model: "worse-model" });
    const result = await persistBenchResults(report, "/test/project");

    expect(result.best_pass_rate).toBe(0.9);
    expect(result.best_model).toBe("best-model");
  });

  it("evicts oldest runs when maxRuns exceeded (FIFO)", async () => {
    const existing: PersistentBenchResults = {
      last_updated: "2026-01-01T00:00:00.000Z",
      best_pass_rate: 0,
      best_model: "",
      runs: Array.from({ length: 3 }, (_, i) => ({
        run_id: `run-${i}`,
        timestamp: "2026-01-01T00:00:00.000Z",
        model: "model",
        total: 10,
        resolved: 5,
        pass_rate: 0.5,
        failure_modes: [],
        instance_outcomes: [],
      })),
    };
    vi.mocked(readFile).mockResolvedValue(JSON.stringify(existing));

    const report = makeReport({ run_id: "new-run" });
    const result = await persistBenchResults(report, "/test/project", 3);

    expect(result.runs).toHaveLength(3);
    expect(result.runs[0]?.run_id).toBe("new-run");
    // run-2 (highest original index = oldest insertion order) should have been evicted
    // because we prepend new runs and slice(0, maxRuns), trimming the tail
    expect(result.runs.find((r) => r.run_id === "run-2")).toBeUndefined();
  });

  it("includes instance_outcomes with failure classification", async () => {
    vi.mocked(readFile).mockRejectedValue(new Error("ENOENT"));

    const report = makeReport({
      results: [
        makeResult({ instance_id: "inst-1", resolved: true }),
        makeResult({ instance_id: "inst-2", resolved: false, error: "timeout" }),
      ],
    });
    const result = await persistBenchResults(report, "/test/project");

    const outcomes = result.runs[0]?.instance_outcomes ?? [];
    expect(outcomes).toHaveLength(2);
    const resolved = outcomes.find((o) => o.id === "inst-1");
    const failed = outcomes.find((o) => o.id === "inst-2");
    expect(resolved?.resolved).toBe(true);
    expect(resolved?.failure).toBeUndefined();
    expect(failed?.failure).toBe("timeout");
  });

  it("updates last_updated timestamp on every run", async () => {
    vi.mocked(readFile).mockRejectedValue(new Error("ENOENT"));

    const before = new Date().toISOString();
    const result = await persistBenchResults(makeReport(), "/test/project");
    const after = new Date().toISOString();

    expect(result.last_updated >= before).toBe(true);
    expect(result.last_updated <= after).toBe(true);
  });
});
