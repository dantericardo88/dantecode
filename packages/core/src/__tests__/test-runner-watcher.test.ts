// packages/core/src/__tests__/test-runner-watcher.test.ts
import { describe, it, expect, vi } from "vitest";
import {
  detectTestRunner,
  parseVitestOutput,
  parsePytestOutput,
  parseCargoTestOutput,
  runTests,
  formatTestResultForPrompt,
  getTestStatusLine,
  getFailedTestNames,
} from "../test-runner-watcher.js";

// ─── detectTestRunner ─────────────────────────────────────────────────────────

describe("detectTestRunner", () => {
  function makeReadFile(files: Record<string, string>) {
    return (path: string): string | null => {
      for (const [key, val] of Object.entries(files)) {
        if (path.endsWith(key)) return val;
      }
      return null;
    };
  }

  it("detects vitest from package.json scripts", () => {
    const readFile = makeReadFile({
      "package.json": JSON.stringify({ scripts: { test: "vitest run" } }),
    });
    expect(detectTestRunner("/project", readFile)).toBe("vitest");
  });

  it("detects jest from package.json scripts", () => {
    const readFile = makeReadFile({
      "package.json": JSON.stringify({ scripts: { test: "jest" } }),
    });
    expect(detectTestRunner("/project", readFile)).toBe("jest");
  });

  it("detects vitest from devDependencies", () => {
    const readFile = makeReadFile({
      "package.json": JSON.stringify({ devDependencies: { vitest: "^1.0.0" } }),
    });
    expect(detectTestRunner("/project", readFile)).toBe("vitest");
  });

  it("detects vitest from vitest.config.ts", () => {
    const readFile = makeReadFile({
      "package.json": JSON.stringify({}),
      "vitest.config.ts": "export default {}",
    });
    expect(detectTestRunner("/project", readFile)).toBe("vitest");
  });

  it("detects jest from jest.config.ts", () => {
    const readFile = makeReadFile({
      "package.json": JSON.stringify({}),
      "jest.config.ts": "module.exports = {}",
    });
    expect(detectTestRunner("/project", readFile)).toBe("jest");
  });

  it("detects pytest from pytest.ini", () => {
    const readFile = makeReadFile({
      "pytest.ini": "[pytest]",
    });
    expect(detectTestRunner("/project", readFile)).toBe("pytest");
  });

  it("detects cargo from Cargo.toml", () => {
    const readFile = makeReadFile({
      "Cargo.toml": "[package]",
    });
    expect(detectTestRunner("/project", readFile)).toBe("cargo");
  });

  it("detects go-test from go.mod", () => {
    const readFile = makeReadFile({
      "go.mod": "module example.com/foo",
    });
    expect(detectTestRunner("/project", readFile)).toBe("go-test");
  });

  it("returns 'unknown' when nothing matches", () => {
    const readFile = (): null => null;
    expect(detectTestRunner("/project", readFile)).toBe("unknown");
  });
});

// ─── parseVitestOutput ────────────────────────────────────────────────────────

describe("parseVitestOutput", () => {
  const SAMPLE = `
 ✓ unit > adds numbers (3ms)
 ✓ unit > subtracts numbers
 ✗ unit > throws on null (5ms)
 - unit > skipped test

● unit > throws on null

  AssertionError: expected undefined to be 'Error'

Tests  2 passed | 1 failed | 1 skipped
Duration 0.52s
`;

  it("counts passed tests", () => {
    const result = parseVitestOutput(SAMPLE);
    expect(result.passed).toBe(2);
  });

  it("counts failed tests", () => {
    const result = parseVitestOutput(SAMPLE);
    expect(result.failed).toBe(1);
  });

  it("counts skipped tests", () => {
    const result = parseVitestOutput(SAMPLE);
    expect(result.skipped).toBe(1);
  });

  it("success is false when there are failures", () => {
    const result = parseVitestOutput(SAMPLE);
    expect(result.success).toBe(false);
  });

  it("success is true when no failures", () => {
    const allPass = " ✓ test A\n ✓ test B\nTests  2 passed\n";
    const result = parseVitestOutput(allPass);
    expect(result.success).toBe(true);
  });

  it("parses duration in ms", () => {
    const result = parseVitestOutput(SAMPLE);
    expect(result.durationMs).toBe(520);
  });

  it("returns tests array with correct statuses", () => {
    const result = parseVitestOutput(SAMPLE);
    expect(result.tests.some((t) => t.status === "passed")).toBe(true);
    expect(result.tests.some((t) => t.status === "failed")).toBe(true);
  });

  it("handles empty output gracefully", () => {
    const result = parseVitestOutput("");
    expect(result.passed).toBe(0);
    expect(result.failed).toBe(0);
    expect(result.total).toBe(0);
  });
});

// ─── parsePytestOutput ────────────────────────────────────────────────────────

describe("parsePytestOutput", () => {
  const SAMPLE = `
test_module.py::test_add PASSED
test_module.py::test_sub PASSED
test_module.py::test_mul FAILED
test_module.py::test_skip SKIPPED

3 passed, 1 failed, 1 skipped in 0.32s
`;

  it("counts passed tests", () => {
    const result = parsePytestOutput(SAMPLE);
    expect(result.passed).toBe(3);
  });

  it("counts failed tests", () => {
    const result = parsePytestOutput(SAMPLE);
    expect(result.failed).toBe(1);
  });

  it("counts skipped tests", () => {
    const result = parsePytestOutput(SAMPLE);
    expect(result.skipped).toBe(1);
  });

  it("success is false when failures present", () => {
    const result = parsePytestOutput(SAMPLE);
    expect(result.success).toBe(false);
  });

  it("parses duration from summary line", () => {
    const result = parsePytestOutput(SAMPLE);
    expect(result.durationMs).toBe(320);
  });

  it("handles all-pass output", () => {
    const allPass = "test_a.py::test_1 PASSED\n2 passed in 0.1s\n";
    const result = parsePytestOutput(allPass);
    expect(result.success).toBe(true);
  });
});

// ─── parseCargoTestOutput ─────────────────────────────────────────────────────

describe("parseCargoTestOutput", () => {
  const SAMPLE = `
test tests::test_add ... ok
test tests::test_sub ... ok
test tests::test_fail ... FAILED
test tests::test_skip ... ignored

test result: FAILED. 2 passed; 1 failed; 1 ignored; 0 measured; 0 filtered out
`;

  it("counts passed tests", () => {
    const result = parseCargoTestOutput(SAMPLE);
    expect(result.passed).toBe(2);
  });

  it("counts failed tests", () => {
    const result = parseCargoTestOutput(SAMPLE);
    expect(result.failed).toBe(1);
  });

  it("counts skipped (ignored) tests", () => {
    const result = parseCargoTestOutput(SAMPLE);
    expect(result.skipped).toBe(1);
  });

  it("success is false when failures present", () => {
    const result = parseCargoTestOutput(SAMPLE);
    expect(result.success).toBe(false);
  });

  it("handles all-pass output", () => {
    const allPass = `test a::b ... ok\ntest result: ok. 1 passed; 0 failed; 0 ignored; 0 measured\n`;
    const result = parseCargoTestOutput(allPass);
    expect(result.success).toBe(true);
    expect(result.passed).toBe(1);
  });

  it("handles empty output", () => {
    const result = parseCargoTestOutput("");
    expect(result.total).toBe(0);
  });
});

// ─── runTests ─────────────────────────────────────────────────────────────────

describe("runTests", () => {
  function makeSpawnSync(stdout: string, status: number = 0) {
    return vi.fn(() => ({ stdout, stderr: "", status, signal: null }));
  }

  function makeReadFile(files: Record<string, string>) {
    return (path: string): string | null => {
      for (const [key, val] of Object.entries(files)) {
        if (path.endsWith(key)) return val;
      }
      return null;
    };
  }

  it("runs vitest and returns parsed result", () => {
    const spawnFn = makeSpawnSync("✓ test A\nTests  1 passed\n");
    const result = runTests({
      projectRoot: "/project",
      runner: "vitest",
      spawnSyncFn: spawnFn as never,
    });
    expect(result.runner).toBe("vitest");
    expect(result.passed).toBeGreaterThanOrEqual(0);
  });

  it("auto-detects runner from package.json", () => {
    const spawnFn = makeSpawnSync("✓ test A\nTests  1 passed\n");
    const readFile = makeReadFile({
      "package.json": JSON.stringify({ scripts: { test: "vitest run" } }),
    });
    const result = runTests({
      projectRoot: "/project",
      spawnSyncFn: spawnFn as never,
      readFileFn: readFile,
    });
    expect(result.runner).toBe("vitest");
  });

  it("includes rawOutput in result", () => {
    const output = "✓ test A\nTests  1 passed\n";
    const spawnFn = makeSpawnSync(output);
    const result = runTests({
      projectRoot: "/project",
      runner: "vitest",
      spawnSyncFn: spawnFn as never,
    });
    expect(result.rawOutput).toContain("test A");
  });

  it("truncates rawOutput to maxOutputChars", () => {
    const longOutput = "x".repeat(50000);
    const spawnFn = makeSpawnSync(longOutput);
    const result = runTests({
      projectRoot: "/project",
      runner: "vitest",
      maxOutputChars: 100,
      spawnSyncFn: spawnFn as never,
    });
    expect(result.rawOutput.length).toBeLessThanOrEqual(100 + 5); // +5 for newline concat
  });

  it("passes extraArgs to spawn", () => {
    const spawnFn = makeSpawnSync("");
    runTests({
      projectRoot: "/project",
      runner: "jest",
      extraArgs: ["--testPathPattern=foo"],
      spawnSyncFn: spawnFn as never,
    });
    const callArgs = spawnFn.mock.calls[0] as unknown as [string, string[]];
    expect(callArgs[1]).toContain("--testPathPattern=foo");
  });
});

// ─── formatTestResultForPrompt ────────────────────────────────────────────────

describe("formatTestResultForPrompt", () => {
  function makeResult(overrides = {}): Parameters<typeof formatTestResultForPrompt>[0] {
    return {
      runner: "vitest",
      tests: [
        { name: "passes correctly", status: "passed" },
        { name: "fails badly", status: "failed", errorMessage: "Expected 1 to be 2" },
      ],
      passed: 1,
      failed: 1,
      skipped: 0,
      total: 2,
      success: false,
      rawOutput: "raw output here",
      ...overrides,
    };
  }

  it("includes '## Test Results' header", () => {
    const output = formatTestResultForPrompt(makeResult());
    expect(output).toContain("## Test Results");
  });

  it("shows pass/fail/skip counts", () => {
    const output = formatTestResultForPrompt(makeResult());
    expect(output).toContain("1/2 passed");
    expect(output).toContain("1 failed");
  });

  it("shows ✅ for passing runs", () => {
    const output = formatTestResultForPrompt(makeResult({ success: true, failed: 0 }));
    expect(output).toContain("✅");
  });

  it("shows ❌ for failing runs", () => {
    const output = formatTestResultForPrompt(makeResult());
    expect(output).toContain("❌");
  });

  it("shows failure names in Failures section", () => {
    const output = formatTestResultForPrompt(makeResult());
    expect(output).toContain("fails badly");
  });

  it("shows error message for failures", () => {
    const output = formatTestResultForPrompt(makeResult());
    expect(output).toContain("Expected 1 to be 2");
  });

  it("omits Failures section when no failures", () => {
    const output = formatTestResultForPrompt(makeResult({ failed: 0, success: true, tests: [{ name: "ok", status: "passed" }] }));
    expect(output).not.toContain("Failures:");
  });

  it("shows all tests when showAllTests=true", () => {
    const output = formatTestResultForPrompt(makeResult(), { showAllTests: true });
    expect(output).toContain("passes correctly");
  });

  it("omits all tests when showAllTests=false (default)", () => {
    const output = formatTestResultForPrompt(makeResult());
    expect(output).not.toContain("All tests:");
  });

  it("shows raw output when rawOutputLines > 0", () => {
    const output = formatTestResultForPrompt(makeResult(), { rawOutputLines: 5 });
    expect(output).toContain("raw output here");
  });

  it("shows duration when available", () => {
    const output = formatTestResultForPrompt(makeResult({ durationMs: 1500 }));
    expect(output).toContain("1.50s");
  });
});

// ─── getTestStatusLine ────────────────────────────────────────────────────────

describe("getTestStatusLine", () => {
  it("returns ✅ for success", () => {
    const result = {
      runner: "vitest" as const,
      tests: [],
      passed: 5,
      failed: 0,
      skipped: 0,
      total: 5,
      success: true,
      rawOutput: "",
    };
    const line = getTestStatusLine(result);
    expect(line).toContain("✅");
    expect(line).toContain("5/5");
    expect(line).toContain("0 failed");
  });

  it("returns ❌ for failure", () => {
    const result = {
      runner: "vitest" as const,
      tests: [],
      passed: 3,
      failed: 2,
      skipped: 0,
      total: 5,
      success: false,
      rawOutput: "",
    };
    const line = getTestStatusLine(result);
    expect(line).toContain("❌");
    expect(line).toContain("2 failed");
  });
});

// ─── getFailedTestNames ───────────────────────────────────────────────────────

describe("getFailedTestNames", () => {
  it("returns names of failed tests only", () => {
    const result = {
      runner: "vitest" as const,
      tests: [
        { name: "passes", status: "passed" as const },
        { name: "fails A", status: "failed" as const },
        { name: "fails B", status: "failed" as const },
        { name: "skipped", status: "skipped" as const },
      ],
      passed: 1,
      failed: 2,
      skipped: 1,
      total: 4,
      success: false,
      rawOutput: "",
    };
    const names = getFailedTestNames(result);
    expect(names).toEqual(["fails A", "fails B"]);
  });

  it("returns empty array when no failures", () => {
    const result = {
      runner: "vitest" as const,
      tests: [{ name: "passes", status: "passed" as const }],
      passed: 1,
      failed: 0,
      skipped: 0,
      total: 1,
      success: true,
      rawOutput: "",
    };
    expect(getFailedTestNames(result)).toEqual([]);
  });
});
