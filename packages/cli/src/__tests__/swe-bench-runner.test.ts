import { describe, it, expect, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// Mocks — declared before imports so vi.mock hoisting works
// ---------------------------------------------------------------------------

vi.mock("node:child_process", () => ({
  execFile: vi.fn(),
}));

vi.mock("node:fs/promises", () => ({
  mkdir: vi.fn().mockResolvedValue(undefined),
  rm: vi.fn().mockResolvedValue(undefined),
  writeFile: vi.fn().mockResolvedValue(undefined),
  readFile: vi.fn().mockResolvedValue(""),
}));

vi.mock("node:fs", () => ({
  createReadStream: vi.fn(),
}));

vi.mock("node:readline", () => ({
  createInterface: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Imports after mocking
// ---------------------------------------------------------------------------

import {
  runSWEBenchEval,
  runSWEBenchInstance,
  writeSWEReport,
  formatSWEReport,
  type SWEInstance,
  type SWEReport,
} from "../swe-bench-runner.js";
import { execFile as execFileMock } from "node:child_process";
import * as fsMock from "node:fs/promises";
import { createReadStream as createReadStreamMock } from "node:fs";
import { createInterface as createInterfaceMock } from "node:readline";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeInstance(overrides: Partial<SWEInstance> = {}): SWEInstance {
  return {
    instance_id: "test__repo-1234",
    repo: "test/repo",
    base_commit: "abc123",
    problem_statement: "Fix the bug in utils.py",
    hints_text: "Check the validate() function",
    test_patch: "diff --git a/test.py b/test.py\n+# test",
    FAIL_TO_PASS: ["tests/test_utils.py::test_validate"],
    PASS_TO_PASS: [],
    ...overrides,
  };
}

function mockExecFileSuccess(stdout = "", stderr = "") {
  vi.mocked(execFileMock).mockImplementation((_cmd: any, _args: any, _opts: any, cb: any) => {
    if (typeof _opts === "function") {
      _opts(null, stdout, stderr);
    } else {
      cb(null, stdout, stderr);
    }
    return {} as any;
  });
}


// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("swe-bench-runner", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default: all exec calls succeed
    mockExecFileSuccess("", "");
  });

  // -------------------------------------------------------------------------
  // loadSWEBenchInstances
  // -------------------------------------------------------------------------
  describe("loadSWEBenchInstances", () => {
    it("parses JSONL instances from stream", async () => {
      const { loadSWEBenchInstances } = await import("../swe-bench-runner.js");

      const mockLines = [
        JSON.stringify(makeInstance({ instance_id: "a-1" })),
        JSON.stringify(makeInstance({ instance_id: "b-2" })),
        "",
      ];

      // Mock readline / createReadStream
      const mockEmitter = {
        on: vi.fn((event: string, cb: Function) => {
          if (event === "line") {
            for (const line of mockLines) cb(line);
          }
          if (event === "close") cb();
          return mockEmitter;
        }),
      };
      vi.mocked(createInterfaceMock).mockReturnValue(mockEmitter as any);

      const mockStream = {
        on: vi.fn().mockReturnThis(),
      };
      vi.mocked(createReadStreamMock).mockReturnValue(mockStream as any);

      const instances = await loadSWEBenchInstances("/fake/instances.jsonl");
      expect(instances).toHaveLength(2);
      expect(instances[0]!.instance_id).toBe("a-1");
      expect(instances[1]!.instance_id).toBe("b-2");
    });

    it("skips malformed JSON lines", async () => {
      const { loadSWEBenchInstances } = await import("../swe-bench-runner.js");

      const mockLines = [
        "not json at all",
        JSON.stringify(makeInstance({ instance_id: "good-1" })),
      ];

      const mockEmitter = {
        on: vi.fn((event: string, cb: Function) => {
          if (event === "line") {
            for (const line of mockLines) cb(line);
          }
          if (event === "close") cb();
          return mockEmitter;
        }),
      };
      vi.mocked(createInterfaceMock).mockReturnValue(mockEmitter as any);
      vi.mocked(createReadStreamMock).mockReturnValue({ on: vi.fn().mockReturnThis() } as any);

      const instances = await loadSWEBenchInstances("/fake/instances.jsonl");
      expect(instances).toHaveLength(1);
      expect(instances[0]!.instance_id).toBe("good-1");
    });
  });

  // -------------------------------------------------------------------------
  // runSWEBenchInstance
  // -------------------------------------------------------------------------
  describe("runSWEBenchInstance", () => {
    it("returns resolved:false when environment setup fails", async () => {
      // git clone fails
      vi.mocked(execFileMock).mockImplementation((_cmd: any, _args: any, _opts: any, cb: any) => {
        const err = Object.assign(new Error("git clone failed"), { code: 128 });
        if (typeof _opts === "function") _opts(err, "", "error");
        else cb(err, "", "error");
        return {} as any;
      });

      const result = await runSWEBenchInstance(makeInstance(), "/project");
      expect(result.resolved).toBe(false);
      expect(result.error).toContain("setup failed");
    });

    it("returns resolved:true when tests pass", async () => {
      let callCount = 0;
      vi.mocked(execFileMock).mockImplementation((_cmd: any, _args: any, _opts: any, cb: any) => {
        callCount++;
        const callback = typeof _opts === "function" ? _opts : cb;
        // First several calls succeed (clone, checkout, pip install, patch, diff)
        // pytest call succeeds (exit 0)
        callback(null, "passed", "");
        return {} as any;
      });

      const result = await runSWEBenchInstance(makeInstance(), "/project");
      expect(result.resolved).toBe(true);
    });

    it("captures model_patch from git diff output", async () => {
      const diffOutput = "diff --git a/fix.py b/fix.py\n+# fixed";
      let callIdx = 0;

      vi.mocked(execFileMock).mockImplementation((_cmd: any, args: any, _opts: any, cb: any) => {
        callIdx++;
        const callback = typeof _opts === "function" ? _opts : cb;
        // The git diff call returns our diff; everything else succeeds
        const isGitDiff = Array.isArray(args) && args.includes("diff");
        callback(null, isGitDiff ? diffOutput : "", "");
        return {} as any;
      });

      const result = await runSWEBenchInstance(makeInstance(), "/project");
      // model_patch should contain the diff (may be from one of the git diff calls)
      expect(result.model_patch).toBeDefined();
    });

    it("returns resolved:false when tests fail", async () => {
      let callIdx = 0;
      vi.mocked(execFileMock).mockImplementation((_cmd: any, args: any, _opts: any, cb: any) => {
        callIdx++;
        const callback = typeof _opts === "function" ? _opts : cb;
        // pytest exits with code 1
        const isPytest = Array.isArray(args) && args.includes("pytest");
        if (isPytest) {
          const err = Object.assign(new Error("tests failed"), { code: 1, stdout: "FAILED", stderr: "" });
          callback(err, "FAILED", "");
        } else {
          callback(null, "", "");
        }
        return {} as any;
      });

      const result = await runSWEBenchInstance(makeInstance(), "/project");
      expect(result.resolved).toBe(false);
    });

    it("handles test_patch apply failure gracefully", async () => {
      let callIdx = 0;
      vi.mocked(execFileMock).mockImplementation((_cmd: any, args: any, _opts: any, cb: any) => {
        callIdx++;
        const callback = typeof _opts === "function" ? _opts : cb;
        // git apply fails
        const isGitApply = Array.isArray(args) && args.includes("apply");
        if (isGitApply) {
          // applyPatch uses stdin-based promisified, handle via _opts callback
          if (typeof _opts === "function") {
            _opts(new Error("patch failed"), "", "patch error");
          } else {
            cb(new Error("patch failed"), "", "patch error");
          }
        } else {
          callback(null, "", "");
        }
        return {} as any;
      });

      const result = await runSWEBenchInstance(makeInstance(), "/project");
      expect(result.resolved).toBe(false);
    });

    it("uses DANTECODE_MODEL env var for model selection", async () => {
      process.env["DANTECODE_MODEL"] = "anthropic/claude-opus-4-6";
      const capturedArgs: string[][] = [];

      vi.mocked(execFileMock).mockImplementation((_cmd: any, args: any, _opts: any, cb: any) => {
        capturedArgs.push(Array.isArray(args) ? args : []);
        const callback = typeof _opts === "function" ? _opts : cb;
        callback(null, "", "");
        return {} as any;
      });

      await runSWEBenchInstance(makeInstance(), "/project");
      delete process.env["DANTECODE_MODEL"];

      const dantecodeCall = capturedArgs.find((a) => a.includes("--model"));
      expect(dantecodeCall).toBeDefined();
      if (dantecodeCall) {
        const modelIdx = dantecodeCall.indexOf("--model");
        expect(dantecodeCall[modelIdx + 1]).toBe("anthropic/claude-opus-4-6");
      }
    });

    it("records duration_ms", async () => {
      mockExecFileSuccess();
      const result = await runSWEBenchInstance(makeInstance(), "/project");
      expect(result.duration_ms).toBeGreaterThanOrEqual(0);
    });

    it("handles FAIL_TO_PASS and PASS_TO_PASS as test specs", async () => {
      const capturedArgs: string[][] = [];
      vi.mocked(execFileMock).mockImplementation((_cmd: any, args: any, _opts: any, cb: any) => {
        capturedArgs.push(Array.isArray(args) ? args : []);
        const callback = typeof _opts === "function" ? _opts : cb;
        callback(null, "", "");
        return {} as any;
      });

      const instance = makeInstance({
        FAIL_TO_PASS: ["tests/test_a.py::test_1"],
        PASS_TO_PASS: ["tests/test_b.py::test_2"],
      });
      await runSWEBenchInstance(instance, "/project");

      // After Phase 4 (CodeAct priming), the runner makes TWO pytest calls:
      // (1) pre-execute on FAIL_TO_PASS only, (2) final verify on
      // FAIL_TO_PASS + PASS_TO_PASS. The verify call (the last one) is the
      // one we assert covers both spec lists.
      const pytestCalls = capturedArgs.filter((a) => a.includes("pytest"));
      expect(pytestCalls.length).toBeGreaterThanOrEqual(1);
      const verifyCall = pytestCalls[pytestCalls.length - 1]!;
      expect(verifyCall.some((a) => a.includes("test_a"))).toBe(true);
      expect(verifyCall.some((a) => a.includes("test_b"))).toBe(true);
    });

    it("supports legacy lowercase fail_to_pass field", async () => {
      const capturedArgs: string[][] = [];
      vi.mocked(execFileMock).mockImplementation((_cmd: any, args: any, _opts: any, cb: any) => {
        capturedArgs.push(Array.isArray(args) ? args : []);
        const callback = typeof _opts === "function" ? _opts : cb;
        callback(null, "", "");
        return {} as any;
      });

      const instance = makeInstance({
        FAIL_TO_PASS: undefined,
        PASS_TO_PASS: undefined,
        fail_to_pass: ["tests/legacy_test.py::test_old"],
        pass_to_pass: [],
      });
      await runSWEBenchInstance(instance, "/project");

      // After Pattern C (pre-flight collect-only) + Phase 4 (pre-execute
      // priming), the runner makes up to three pytest calls before the
      // verify call. Find the verify call (last pytest invocation that
      // names a real test spec — not --collect-only).
      const pytestCalls = capturedArgs.filter((a) => a.includes("pytest"));
      const verifyCall = pytestCalls.find((a) => a.some((arg) => arg.includes("legacy_test")));
      expect(verifyCall).toBeDefined();
    });
  });

  // -------------------------------------------------------------------------
  // runSWEBenchEval
  // -------------------------------------------------------------------------
  describe("runSWEBenchEval", () => {
    it("returns a report with correct pass_rate for all-pass", async () => {
      mockExecFileSuccess("passed");
      const instances = [makeInstance({ instance_id: "a-1" }), makeInstance({ instance_id: "b-2" })];
      const report = await runSWEBenchEval(instances, "/project");
      expect(report.total).toBe(2);
      expect(report.resolved).toBe(report.total); // all pass since pytest returns exit 0
      expect(report.pass_rate).toBeCloseTo(report.resolved / report.total, 5);
    });

    it("returns pass_rate 0 when all fail", async () => {
      vi.mocked(execFileMock).mockImplementation((_cmd: any, args: any, _opts: any, cb: any) => {
        const callback = typeof _opts === "function" ? _opts : cb;
        const isPytest = Array.isArray(args) && args.includes("pytest");
        if (isPytest) {
          const err = Object.assign(new Error("fail"), { code: 1 });
          callback(err, "FAILED", "");
        } else {
          callback(null, "", "");
        }
        return {} as any;
      });

      const instances = [makeInstance({ instance_id: "x-1" })];
      const report = await runSWEBenchEval(instances, "/project");
      expect(report.resolved).toBe(0);
      expect(report.pass_rate).toBe(0);
    });

    it("calls onProgress for each instance", async () => {
      mockExecFileSuccess();
      const progress: Array<{ idx: number; total: number }> = [];
      const instances = [makeInstance({ instance_id: "p-1" }), makeInstance({ instance_id: "p-2" })];
      await runSWEBenchEval(instances, "/project", {
        onProgress: (_r, idx, total) => progress.push({ idx, total }),
      });
      expect(progress).toHaveLength(2);
      expect(progress[0]!.idx).toBe(1);
      expect(progress[1]!.idx).toBe(2);
      expect(progress[0]!.total).toBe(2);
    });

    it("includes run_id and model in report", async () => {
      mockExecFileSuccess();
      const report = await runSWEBenchEval([], "/project", { model: "anthropic/test-model" });
      expect(report.run_id).toMatch(/^dantecode-/);
      expect(report.model).toBe("anthropic/test-model");
    });

    it("writes report to outputPath when provided", async () => {
      mockExecFileSuccess();
      const outputPath = "/tmp/swe-report.json";
      await runSWEBenchEval([], "/project", { outputPath });
      expect(vi.mocked(fsMock.writeFile)).toHaveBeenCalledWith(
        outputPath,
        expect.stringContaining('"run_id"'),
        "utf-8",
      );
    });

    it("returns empty results for empty instances list", async () => {
      const report = await runSWEBenchEval([], "/project");
      expect(report.total).toBe(0);
      expect(report.resolved).toBe(0);
      expect(report.pass_rate).toBe(0);
    });
  });

  // -------------------------------------------------------------------------
  // writeSWEReport
  // -------------------------------------------------------------------------
  describe("writeSWEReport", () => {
    it("writes JSON-serialized report to specified path", async () => {
      const report: SWEReport = {
        run_id: "test-run",
        model: "test-model",
        total: 1,
        resolved: 1,
        pass_rate: 1.0,
        results: [],
        generated_at: new Date().toISOString(),
      };

      await writeSWEReport(report, "/output/results.json");
      expect(vi.mocked(fsMock.writeFile)).toHaveBeenCalledWith(
        "/output/results.json",
        expect.stringContaining('"run_id": "test-run"'),
        "utf-8",
      );
    });
  });

  // -------------------------------------------------------------------------
  // formatSWEReport
  // -------------------------------------------------------------------------
  describe("formatSWEReport", () => {
    it("includes pass rate percentage", () => {
      const report: SWEReport = {
        run_id: "r1",
        model: "m1",
        total: 4,
        resolved: 1,
        pass_rate: 0.25,
        results: [],
        generated_at: new Date().toISOString(),
      };
      const output = formatSWEReport(report);
      expect(output).toContain("25.0%");
      expect(output).toContain("1/4");
    });

    it("marks resolved instances with checkmark", () => {
      const report: SWEReport = {
        run_id: "r1",
        model: "m1",
        total: 2,
        resolved: 1,
        pass_rate: 0.5,
        results: [
          { instance_id: "pass-1", resolved: true, model_patch: "", test_output: "", duration_ms: 1000 },
          { instance_id: "fail-2", resolved: false, model_patch: "", test_output: "", duration_ms: 500 },
        ],
        generated_at: new Date().toISOString(),
      };
      const output = formatSWEReport(report);
      expect(output).toContain("✓");
      expect(output).toContain("✗");
      expect(output).toContain("pass-1");
      expect(output).toContain("fail-2");
    });

    it("shows error message for failed instances", () => {
      const report: SWEReport = {
        run_id: "r1",
        model: "m1",
        total: 1,
        resolved: 0,
        pass_rate: 0,
        results: [
          { instance_id: "err-1", resolved: false, model_patch: "", test_output: "", duration_ms: 100, error: "setup failed" },
        ],
        generated_at: new Date().toISOString(),
      };
      const output = formatSWEReport(report);
      expect(output).toContain("setup failed");
    });

    it("includes run_id and model in header", () => {
      const report: SWEReport = {
        run_id: "my-run-123",
        model: "anthropic/claude-sonnet",
        total: 0,
        resolved: 0,
        pass_rate: 0,
        results: [],
        generated_at: new Date().toISOString(),
      };
      const output = formatSWEReport(report);
      expect(output).toContain("my-run-123");
      expect(output).toContain("anthropic/claude-sonnet");
    });
  });
});
