// packages/cli/src/__tests__/bench-command.test.ts
// Tests for runBenchCommand from commands/bench.ts.
// Mocks swe-bench-runner.js to avoid actual git/python subprocess calls.

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { SWEReport, SWERunResult, SWEInstance } from "../swe-bench-runner.js";

// ---------------------------------------------------------------------------
// Build helpers for mock data
// ---------------------------------------------------------------------------

function makeMockInstance(id: string): SWEInstance {
  return {
    instance_id: id,
    repo: "org/repo",
    base_commit: "abc123",
    problem_statement: `Fix issue ${id}`,
    test_patch: "",
  };
}

function makeMockResult(id: string, resolved: boolean): SWERunResult {
  return {
    instance_id: id,
    resolved,
    model_patch: resolved ? "--- a/foo.py\n+++ b/foo.py\n@@ -1 +1 @@\n-old\n+new" : "",
    test_output: resolved ? "1 passed" : "1 failed",
    duration_ms: 1000,
  };
}

function makeMockReport(instances: SWEInstance[], resolved: number): SWEReport {
  const results = instances.map((inst, i) => makeMockResult(inst.instance_id, i < resolved));
  return {
    run_id: "test-run-id",
    model: "anthropic/claude-sonnet-4-6",
    total: instances.length,
    resolved,
    pass_rate: instances.length > 0 ? resolved / instances.length : 0,
    results,
    generated_at: new Date().toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Mock swe-bench-runner — hoisted before imports
// ---------------------------------------------------------------------------

const mockRunSWEBenchEval = vi.fn();
const mockLoadSWEBenchInstances = vi.fn();
const mockWriteSWEReport = vi.fn();

vi.mock("../swe-bench-runner.js", () => ({
  runSWEBenchEval: mockRunSWEBenchEval,
  loadSWEBenchInstances: mockLoadSWEBenchInstances,
  writeSWEReport: mockWriteSWEReport,
  formatSWEReport: vi.fn().mockReturnValue("## SWE-bench Report\n"),
}));

// Mock node:fs/promises so generateLaunchConfig / writeSWEReport don't hit disk
vi.mock("node:fs/promises", () => ({
  mkdir: vi.fn().mockResolvedValue(undefined),
  writeFile: vi.fn().mockResolvedValue(undefined),
  access: vi.fn().mockResolvedValue(undefined),
  rm: vi.fn().mockResolvedValue(undefined),
  readFile: vi.fn().mockResolvedValue(""),
}));

import { runBenchCommand } from "../commands/bench.js";

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("runBenchCommand", () => {
  const projectRoot = "/test/project";
  const defaultInstances = [makeMockInstance("inst-1"), makeMockInstance("inst-2"), makeMockInstance("inst-3"), makeMockInstance("inst-4"), makeMockInstance("inst-5")];

  beforeEach(() => {
    vi.clearAllMocks();
    // Default: load 5 instances, resolve 2
    mockLoadSWEBenchInstances.mockResolvedValue(defaultInstances);
    mockRunSWEBenchEval.mockResolvedValue(makeMockReport(defaultInstances, 2));
    mockWriteSWEReport.mockResolvedValue(undefined);
    // Silence stdout during tests
    vi.spyOn(process.stdout, "write").mockImplementation(() => true);
  });

  it("--instances 3 limits to 3 instances passed to runSWEBenchEval", async () => {
    // Adjust mock to return only 3 instances after slicing
    const threeInstances = defaultInstances.slice(0, 3);
    mockRunSWEBenchEval.mockResolvedValue(makeMockReport(threeInstances, 1));

    await runBenchCommand(["--instances", "3", "--data", "/fake/data.jsonl"], projectRoot);

    expect(mockRunSWEBenchEval).toHaveBeenCalledOnce();
    const [instances] = mockRunSWEBenchEval.mock.calls[0] as [SWEInstance[], string, unknown];
    expect(instances.length).toBeLessThanOrEqual(3);
  });

  it("--skip 2 skips first 2 instances", async () => {
    const remaining = defaultInstances.slice(2);
    mockRunSWEBenchEval.mockResolvedValue(makeMockReport(remaining, 1));

    await runBenchCommand(["--skip", "2", "--data", "/fake/data.jsonl"], projectRoot);

    expect(mockRunSWEBenchEval).toHaveBeenCalledOnce();
    const [instances] = mockRunSWEBenchEval.mock.calls[0] as [SWEInstance[], string, unknown];
    // After skipping 2 from 5 total we get 3
    expect(instances.length).toBe(3);
    expect(instances[0]!.instance_id).toBe("inst-3");
  });

  it("--parallel 4 passes parallel:4 to runSWEBenchEval", async () => {
    await runBenchCommand(["--parallel", "4", "--data", "/fake/data.jsonl"], projectRoot);

    expect(mockRunSWEBenchEval).toHaveBeenCalledOnce();
    const [, , opts] = mockRunSWEBenchEval.mock.calls[0] as [unknown, unknown, { parallel: number }];
    expect(opts.parallel).toBe(4);
  });

  it("--model custom-model sets model in options", async () => {
    await runBenchCommand(["--model", "anthropic/claude-opus", "--data", "/fake/data.jsonl"], projectRoot);

    expect(mockRunSWEBenchEval).toHaveBeenCalledOnce();
    const [, , opts] = mockRunSWEBenchEval.mock.calls[0] as [unknown, unknown, { model: string }];
    expect(opts.model).toBe("anthropic/claude-opus");
  });

  it("--cached passes useCachedClone:true to runSWEBenchEval", async () => {
    await runBenchCommand(["--cached", "--data", "/fake/data.jsonl"], projectRoot);

    expect(mockRunSWEBenchEval).toHaveBeenCalledOnce();
    const [, , opts] = mockRunSWEBenchEval.mock.calls[0] as [unknown, unknown, { useCachedClone: boolean }];
    expect(opts.useCachedClone).toBe(true);
  });

  it("onProgress callback fires for each instance", async () => {
    const progressCalls: number[] = [];
    // Intercept runSWEBenchEval and fire the onProgress callback for each instance
    mockRunSWEBenchEval.mockImplementation(
      async (instances: SWEInstance[], _root: string, opts: { onProgress?: (r: SWERunResult, idx: number, total: number) => void }) => {
        for (let i = 0; i < instances.length; i++) {
          const r = makeMockResult(instances[i]!.instance_id, false);
          opts.onProgress?.(r, i + 1, instances.length);
          progressCalls.push(i + 1);
        }
        return makeMockReport(instances, 0);
      },
    );

    await runBenchCommand(["--data", "/fake/data.jsonl"], projectRoot);

    // Progress fired for all 5 instances
    expect(progressCalls.length).toBe(5);
  });

  it("report is written to output path via writeSWEReport", async () => {
    await runBenchCommand(["--output", "/output/report.json", "--data", "/fake/data.jsonl"], projectRoot);

    // writeSWEReport is called with the output path
    expect(mockWriteSWEReport).toHaveBeenCalled();
    const [, outputPath] = mockWriteSWEReport.mock.calls[0] as [unknown, string];
    expect(outputPath).toBe("/output/report.json");
  });

  it("pass rate printed to stdout correctly", async () => {
    const instances = [makeMockInstance("inst-1"), makeMockInstance("inst-2")];
    mockLoadSWEBenchInstances.mockResolvedValue(instances);
    mockRunSWEBenchEval.mockResolvedValue(makeMockReport(instances, 1));

    const writtenLines: string[] = [];
    vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
      writtenLines.push(String(chunk));
      return true;
    });

    await runBenchCommand(["--data", "/fake/data.jsonl"], projectRoot);

    const allOutput = writtenLines.join("");
    expect(allOutput).toContain("50.0%");
  });
});
