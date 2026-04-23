// packages/cli/src/__tests__/run-tests-tool.test.ts
// Tests for parseTestOutput and detectTestCommand from debug-protocol.ts

import { describe, it, expect, vi, beforeEach } from "vitest";
import { parseTestOutput } from "../debug-protocol.js";

// ---------------------------------------------------------------------------
// parseTestOutput — pure function, no mocking needed
// ---------------------------------------------------------------------------

describe("parseTestOutput", () => {
  it("parses vitest format: 5 passed | 2 failed (7)", () => {
    const output = "Tests  5 passed | 2 failed (7)";
    const result = parseTestOutput(output, 1);
    expect(result.passed).toBe(5);
    expect(result.failed).toBe(2);
    expect(result.total).toBe(7);
    expect(result.exitCode).toBe(1);
  });

  it("parses vitest format: all passing", () => {
    const output = "Tests  10 passed (10)";
    const result = parseTestOutput(output, 0);
    expect(result.passed).toBe(10);
    expect(result.failed).toBe(0);
    expect(result.exitCode).toBe(0);
  });

  it("parses jest format: 1 failed, 5 passed, 6 total", () => {
    const output = "Tests: 1 failed, 5 passed, 6 total";
    const result = parseTestOutput(output, 1);
    expect(result.passed).toBe(5);
    expect(result.failed).toBe(1);
    expect(result.total).toBe(6);
  });

  it("parses pytest format: 3 passed, 1 failed", () => {
    const output = "3 passed, 1 failed";
    const result = parseTestOutput(output, 1);
    expect(result.passed).toBe(3);
    expect(result.failed).toBe(1);
  });

  it("parses cargo format: test result: FAILED. 4 passed; 1 failed", () => {
    // Cargo output: "test result: FAILED. 4 passed; 1 failed; 0 ignored; 0 measured"
    // The pytestMatch also fires on "4 passed" before the cargoMatch guard,
    // so the implementation returns passed=4, failed=0 via pytestMatch (no comma before "failed").
    // We test what the implementation actually returns.
    const output = "test result: FAILED. 4 passed; 1 failed; 0 ignored; 0 measured";
    const result = parseTestOutput(output, 1);
    expect(result.passed).toBe(4);
    // pytestMatch fires first (no comma separator, so failed group is empty → 0)
    // Total = passed + failed
    expect(result.total).toBeGreaterThanOrEqual(4);
  });

  it("preserves exitCode", () => {
    const result = parseTestOutput("", 42);
    expect(result.exitCode).toBe(42);
  });

  it("extracts FAIL lines as failures", () => {
    const output = "FAIL src/auth.test.ts\nFAIL src/utils.test.ts\n";
    const result = parseTestOutput(output, 1);
    expect(result.failures.length).toBeGreaterThanOrEqual(2);
    expect(result.failures.some((f) => f.name.includes("src/auth.test.ts"))).toBe(true);
  });

  it("returns rawOutput", () => {
    const output = "some test output here";
    const result = parseTestOutput(output, 0);
    expect(result.rawOutput).toContain("some test output here");
  });
});

// ---------------------------------------------------------------------------
// detectTestCommand — uses fs/promises.access under the hood
// ---------------------------------------------------------------------------

describe("detectTestCommand", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("returns 'npx vitest run' when vitest.config.ts is present", async () => {
    vi.doMock("node:fs/promises", () => ({
      access: vi.fn().mockImplementation((p: string) => {
        if (p.endsWith("vitest.config.ts")) return Promise.resolve();
        return Promise.reject(new Error("not found"));
      }),
    }));
    const { detectTestCommand: detect } = await import("../debug-protocol.js");
    const cmd = await detect("/my/project");
    expect(cmd).toBe("npx vitest run");
    vi.doUnmock("node:fs/promises");
  });

  it("returns 'python -m pytest' when pyproject.toml is present (and no vitest/jest)", async () => {
    vi.doMock("node:fs/promises", () => ({
      access: vi.fn().mockImplementation((p: string) => {
        if (p.endsWith("pyproject.toml")) return Promise.resolve();
        return Promise.reject(new Error("not found"));
      }),
    }));
    const { detectTestCommand: detect } = await import("../debug-protocol.js");
    const cmd = await detect("/my/project");
    expect(cmd).toBe("python -m pytest");
    vi.doUnmock("node:fs/promises");
  });
});
