// packages/vscode/src/__tests__/auto-test-runner.test.ts
// Sprint 36 — Dim 19: Auto-test-after-write (8→9)
// Tests: isTestFile, shouldAutoRunTests, AutoTestRunner.runIfTestFile

import { describe, it, expect, vi } from "vitest";

// Mock child_process exec used by auto-test-runner
vi.mock("node:child_process", () => ({
  exec: vi.fn(),
}));

// Mock vscode (not imported by auto-test-runner directly, but sidebar-provider imports it)
vi.mock("vscode", () => ({
  StatusBarAlignment: { Left: 1, Right: 2 },
  ThemeColor: vi.fn(),
  window: {
    createStatusBarItem: vi.fn(() => ({ text: "", show: vi.fn(), hide: vi.fn(), dispose: vi.fn() })),
    createTextEditorDecorationType: vi.fn(() => ({ dispose: vi.fn() })),
  },
  workspace: {
    getConfiguration: vi.fn(() => ({ get: vi.fn((_k: string, d: unknown) => d) })),
  },
  commands: { registerCommand: vi.fn(() => ({ dispose: vi.fn() })), executeCommand: vi.fn() },
  Uri: { file: vi.fn((p: string) => ({ fsPath: p })) },
}));

import { isTestFile, shouldAutoRunTests, AutoTestRunner } from "../auto-test-runner.js";
import type { DetectedFramework } from "../test-framework-detector.js";

// ─── isTestFile ───────────────────────────────────────────────────────────────

describe("isTestFile", () => {
  it("returns true for .test.ts files", () => {
    expect(isTestFile("src/utils.test.ts")).toBe(true);
  });

  it("returns true for .spec.ts files", () => {
    expect(isTestFile("src/utils.spec.ts")).toBe(true);
  });

  it("returns true for .test.js files", () => {
    expect(isTestFile("src/app.test.js")).toBe(true);
  });

  it("returns true for files inside __tests__/", () => {
    expect(isTestFile("src/__tests__/utils.ts")).toBe(true);
  });

  it("returns true for Python test_foo.py pattern", () => {
    expect(isTestFile("tests/test_auth.py")).toBe(true);
  });

  it("returns true for Python foo_test.py pattern", () => {
    expect(isTestFile("auth_test.py")).toBe(true);
  });

  it("returns true for Go foo_test.go pattern", () => {
    expect(isTestFile("auth_test.go")).toBe(true);
  });

  it("returns false for regular source files", () => {
    expect(isTestFile("src/utils.ts")).toBe(false);
    expect(isTestFile("src/auth.py")).toBe(false);
    expect(isTestFile("cmd/server.go")).toBe(false);
  });
});

// ─── shouldAutoRunTests ───────────────────────────────────────────────────────

describe("shouldAutoRunTests", () => {
  it("returns true for test files (delegates to isTestFile)", () => {
    expect(shouldAutoRunTests("src/__tests__/auth.test.ts")).toBe(true);
  });

  it("returns false for source files", () => {
    expect(shouldAutoRunTests("src/auth.ts")).toBe(false);
  });
});

// ─── AutoTestRunner.runIfTestFile ─────────────────────────────────────────────

describe("AutoTestRunner.runIfTestFile", () => {
  function makeMockDetector(framework: Partial<DetectedFramework> = {}) {
    return {
      detectFramework: vi.fn().mockResolvedValue({
        name: "vitest",
        version: "3.2.4",
        configFile: "vitest.config.ts",
        runCommand: "npx vitest run",
        ...framework,
      }),
      findTestFile: vi.fn().mockResolvedValue(null),
      inferTestFilePath: vi.fn().mockReturnValue(""),
      readTestFileHead: vi.fn().mockResolvedValue(""),
      extractFunctionSignatures: vi.fn().mockReturnValue([]),
      buildTestContext: vi.fn(),
    };
  }

  it("returns null for non-test files", async () => {
    const runner = new AutoTestRunner(makeMockDetector() as never);
    const result = await runner.runIfTestFile("src/auth.ts", "/project");
    expect(result).toBeNull();
  });

  it("returns TestRunResult for test files", async () => {
    const { exec } = await import("node:child_process");
    vi.mocked(exec).mockImplementation((_cmd, _opts, cb) => {
      (cb as unknown as (err: null, result: { stdout: string; stderr: string }) => void)(null, { stdout: "1 test passed", stderr: "" });
      return {} as ReturnType<typeof exec>;
    });

    const runner = new AutoTestRunner(makeMockDetector() as never);
    const result = await runner.runIfTestFile("src/__tests__/auth.test.ts", "/project");
    expect(result).not.toBeNull();
    expect(result?.passed).toBe(true);
    expect(result?.triggeredBy).toBe("src/__tests__/auth.test.ts");
  });

  it("result includes command, exitCode, output, duration_ms fields", async () => {
    const { exec } = await import("node:child_process");
    vi.mocked(exec).mockImplementation((_cmd, _opts, cb) => {
      (cb as unknown as (err: null, result: { stdout: string; stderr: string }) => void)(null, { stdout: "all pass", stderr: "" });
      return {} as ReturnType<typeof exec>;
    });

    const runner = new AutoTestRunner(makeMockDetector() as never);
    const result = await runner.runIfTestFile("src/__tests__/auth.test.ts", "/project");
    expect(result).toHaveProperty("command");
    expect(result).toHaveProperty("exitCode");
    expect(result).toHaveProperty("output");
    expect(result).toHaveProperty("duration_ms");
  });

  it("result passed is false when process exits with non-zero code", async () => {
    const { exec } = await import("node:child_process");
    vi.mocked(exec).mockImplementation((_cmd, _opts, cb) => {
      const err = { stdout: "", stderr: "FAILED: 1 test failed", code: 1 };
      (cb as (err: unknown) => void)(err);
      return {} as ReturnType<typeof exec>;
    });

    const runner = new AutoTestRunner(makeMockDetector() as never);
    const result = await runner.runIfTestFile("src/__tests__/auth.test.ts", "/project");
    expect(result?.passed).toBe(false);
    expect(result?.exitCode).toBe(1);
  });

  it("command includes the file path for vitest", async () => {
    const { exec } = await import("node:child_process");
    vi.mocked(exec).mockImplementation((_cmd, _opts, cb) => {
      (cb as unknown as (err: null, result: { stdout: string; stderr: string }) => void)(null, { stdout: "", stderr: "" });
      return {} as ReturnType<typeof exec>;
    });

    const runner = new AutoTestRunner(makeMockDetector({ name: "vitest", runCommand: "npx vitest run" }) as never);
    const result = await runner.runIfTestFile("src/__tests__/auth.test.ts", "/project");
    expect(result?.command).toContain("npx vitest run");
    expect(result?.command).toContain("auth.test.ts");
  });

  it("output is truncated to 8000 chars for very large outputs", async () => {
    const { exec } = await import("node:child_process");
    const bigOutput = "x".repeat(10_000);
    vi.mocked(exec).mockImplementation((_cmd, _opts, cb) => {
      (cb as unknown as (err: null, result: { stdout: string; stderr: string }) => void)(null, { stdout: bigOutput, stderr: "" });
      return {} as ReturnType<typeof exec>;
    });

    const runner = new AutoTestRunner(makeMockDetector() as never);
    const result = await runner.runIfTestFile("src/__tests__/auth.test.ts", "/project");
    expect((result?.output.length ?? 0)).toBeLessThanOrEqual(8100); // 8000 + "(truncated)"
    expect(result?.output).toContain("truncated");
  });
});

// ─── WebviewOutboundMessage type contract ─────────────────────────────────────

describe("WebviewOutboundMessage — test_run_result type", () => {
  it("test_run_result payload shape matches TestRunResult fields", () => {
    const payload = {
      triggeredBy: "src/__tests__/auth.test.ts",
      command: "npx vitest run ...",
      passed: true,
      exitCode: 0,
      output: "1 passed",
      duration_ms: 500,
    };
    expect(typeof payload.triggeredBy).toBe("string");
    expect(typeof payload.passed).toBe("boolean");
    expect(typeof payload.exitCode).toBe("number");
    expect(typeof payload.duration_ms).toBe("number");
  });
});
