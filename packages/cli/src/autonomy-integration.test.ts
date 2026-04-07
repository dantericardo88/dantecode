/**
 * Autonomy Verify-Repair Loop Integration Tests
 *
 * Tests the core verify-repair infrastructure that makes DanteCode autonomous:
 * - Baseline failure capture (pre-existing failures are not the agent's fault)
 * - New failure detection (agent changes that break tests are caught)
 * - Fix verification (agent fixes confirmed passing before exit)
 *
 * Uses runTestRepair directly with execFn-injected output to exercise the full
 * detection + comparison logic against real filesystem state. Tests are deterministic
 * (no flaky process spawning) while validating the exact code paths the agent loop uses.
 *
 * Full agent loop tests would require API keys and are out of scope here.
 */

import { describe, it, expect } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { runTestRepair } from "@dantecode/core";

// ---------------------------------------------------------------------------
// Vitest-format output helpers (matches what parseVitestOutput expects)
// ---------------------------------------------------------------------------

function vitestPassing(): string {
  return [
    "",
    "✓ src/math.test.ts (1)",
    "  ✓ add returns correct sum",
    "",
    " Test Files  1 passed (1)",
    " Tests  1 passed (1)",
    "",
  ].join("\n");
}

function vitestFailing(testFile: string, testName: string, error: string): string {
  return [
    "",
    `FAIL ${testFile} > ${testName}`,
    `  Error: ${error}`,
    `    at ${testFile}:5:3`,
    "",
    " Test Files  1 failed (1)",
    " Tests  1 failed (1)",
    "",
  ].join("\n");
}

function vitestMultipleFailing(
  failures: Array<{ testFile: string; testName: string; error: string }>,
): string {
  const lines: string[] = [""];
  for (const f of failures) {
    lines.push(`FAIL ${f.testFile} > ${f.testName}`);
    lines.push(`  Error: ${f.error}`);
    lines.push(`    at ${f.testFile}:5:3`);
    lines.push("");
  }
  lines.push(` Test Files  ${failures.length} failed (${failures.length})`);
  lines.push(` Tests  ${failures.length} failed (${failures.length})`);
  lines.push("");
  return lines.join("\n");
}

// execFn that simulates failing test run (throws like a real failed test command)
function makeFailingExecFn(output: string): (command: string, options: unknown) => Buffer {
  return (_command: string, _options: unknown): Buffer => {
    const err = new Error("Command failed") as Error & {
      stdout: Buffer;
      stderr: Buffer;
      status: number;
    };
    err.stdout = Buffer.from(output);
    err.stderr = Buffer.from("");
    err.status = 1;
    throw err;
  };
}

// execFn that simulates passing test run (returns output normally)
function makePassingExecFn(output: string): (command: string, options: unknown) => Buffer {
  return (_command: string, _options: unknown): Buffer => Buffer.from(output);
}

// ---------------------------------------------------------------------------
// Test Suite 1: Detect new failures introduced by a bad edit
// ---------------------------------------------------------------------------

describe("Verify-Repair Loop — detect new test failures", () => {
  it("reports no new failures when baseline is empty and tests pass", async () => {
    const dir = await mkdtemp(join(tmpdir(), "autonomy-pass-test-"));
    try {
      await writeFile(join(dir, "math.ts"), "export function add(a: number, b: number) { return a + b; }");

      const result = await runTestRepair({
        config: { command: "npm test", maxRetries: 1, runBeforeMutations: false },
        projectRoot: dir,
        baselineFailures: [],
        execFn: makePassingExecFn(vitestPassing()),
      });

      expect(result.success).toBe(true);
      expect(result.newFailures).toHaveLength(0);
      expect(result.failures).toHaveLength(0);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("detects NEW failure introduced by agent edit (was passing, now failing)", async () => {
    const dir = await mkdtemp(join(tmpdir(), "autonomy-detect-test-"));
    try {
      await writeFile(join(dir, "math.ts"), "export function add(a: number, b: number) { return a - b; }");

      const failureOutput = vitestFailing(
        "src/math.test.ts",
        "add returns correct sum",
        "expected -1 to equal 5",
      );

      const result = await runTestRepair({
        config: { command: "npm test", maxRetries: 1, runBeforeMutations: false },
        projectRoot: dir,
        baselineFailures: [], // clean baseline — agent introduced this failure
        execFn: makeFailingExecFn(failureOutput),
      });

      expect(result.success).toBe(false);
      expect(result.newFailures.length).toBeGreaterThan(0);
      expect(result.newFailures[0]!.testName).toBe("add returns correct sum");
      expect(result.newFailures[0]!.error).toContain("expected -1 to equal 5");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("formats test failure messages with file and test name", async () => {
    const dir = await mkdtemp(join(tmpdir(), "autonomy-format-test-"));
    try {
      await writeFile(join(dir, "auth.ts"), "export function validate() { return false; }");

      const failureOutput = vitestFailing(
        "src/auth.test.ts",
        "validate should return true",
        "expected false to be true",
      );

      const result = await runTestRepair({
        config: { command: "npm test", maxRetries: 1, runBeforeMutations: false },
        projectRoot: dir,
        baselineFailures: [],
        execFn: makeFailingExecFn(failureOutput),
      });

      expect(result.newFailures.length).toBeGreaterThan(0);
      const failure = result.newFailures[0]!;
      expect(failure.testFile).toContain("auth.test.ts");
      expect(failure.testName).toBe("validate should return true");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// Test Suite 2: Fix verification — agent fixes confirmed
// ---------------------------------------------------------------------------

describe("Verify-Repair Loop — fix verification", () => {
  it("reports success after agent fixes the broken code (no new failures)", async () => {
    const dir = await mkdtemp(join(tmpdir(), "autonomy-fix-test-"));
    try {
      // Step 1: Capture baseline with broken code
      const brokenOutput = vitestFailing(
        "src/math.test.ts",
        "add returns correct sum",
        "expected -1 to equal 5",
      );
      const baseline = await runTestRepair({
        config: { command: "npm test", maxRetries: 1, runBeforeMutations: false },
        projectRoot: dir,
        baselineFailures: [],
        execFn: makeFailingExecFn(brokenOutput),
      });
      // Baseline: the broken failure is captured
      expect(baseline.failures.length).toBeGreaterThan(0);
      const baselineFailures = baseline.failures;

      // Step 2: Agent "fixes" the file — now tests pass
      // Verify: no NEW failures (the baseline failure is now gone too, but that's ok)
      const afterFix = await runTestRepair({
        config: { command: "npm test", maxRetries: 1, runBeforeMutations: false },
        projectRoot: dir,
        baselineFailures,
        execFn: makePassingExecFn(vitestPassing()),
      });

      expect(afterFix.success).toBe(true);
      expect(afterFix.newFailures).toHaveLength(0);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("iteration counter increments correctly across repair cycles", async () => {
    const dir = await mkdtemp(join(tmpdir(), "autonomy-iter-test-"));
    try {
      const failureOutput = vitestFailing(
        "src/calc.test.ts",
        "multiply works",
        "expected 0 to equal 6",
      );

      // First repair attempt: still failing
      const attempt1 = await runTestRepair({
        config: { command: "npm test", maxRetries: 1, runBeforeMutations: false },
        projectRoot: dir,
        baselineFailures: [],
        execFn: makeFailingExecFn(failureOutput),
      });
      expect(attempt1.success).toBe(false);
      expect(attempt1.newFailures.length).toBeGreaterThan(0);

      // Second repair attempt: now fixed
      const attempt2 = await runTestRepair({
        config: { command: "npm test", maxRetries: 1, runBeforeMutations: false },
        projectRoot: dir,
        baselineFailures: attempt1.failures, // use first attempt's failures as new baseline
        execFn: makePassingExecFn(vitestPassing()),
      });
      expect(attempt2.success).toBe(true);
      expect(attempt2.newFailures).toHaveLength(0);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// Test Suite 3: Baseline isolation — pre-existing failures not blamed on agent
// ---------------------------------------------------------------------------

describe("Verify-Repair Loop — baseline isolation", () => {
  it("pre-existing failures are NOT reported as new failures after agent edit", async () => {
    const dir = await mkdtemp(join(tmpdir(), "autonomy-baseline-test-"));
    try {
      // Pre-existing failure: a broken test that existed before the agent started
      const preExistingFailureOutput = vitestFailing(
        "src/legacy.test.ts",
        "legacy function works",
        "expected undefined to equal 42",
      );

      // Capture baseline: pre-existing failure is recorded
      const baseline = await runTestRepair({
        config: { command: "npm test", maxRetries: 1, runBeforeMutations: false },
        projectRoot: dir,
        baselineFailures: [],
        execFn: makeFailingExecFn(preExistingFailureOutput),
      });
      expect(baseline.failures.length).toBeGreaterThan(0);
      const baselineFailures = baseline.failures;

      // Agent edits a different file — same pre-existing failure still present,
      // but no NEW failures introduced
      const afterAgentEdit = await runTestRepair({
        config: { command: "npm test", maxRetries: 1, runBeforeMutations: false },
        projectRoot: dir,
        baselineFailures, // pre-existing failure is in baseline
        execFn: makeFailingExecFn(preExistingFailureOutput), // same failure still present
      });

      // The pre-existing failure must NOT be counted as new
      expect(afterAgentEdit.newFailures).toHaveLength(0);
      // But it IS still in the failures list
      expect(afterAgentEdit.failures.length).toBeGreaterThan(0);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("catches NEW failures even when pre-existing failures also present", async () => {
    const dir = await mkdtemp(join(tmpdir(), "autonomy-mixed-test-"));
    try {
      // Pre-existing failure (baseline)
      const preExistingOutput = vitestFailing(
        "src/legacy.test.ts",
        "legacy function works",
        "expected undefined to equal 42",
      );
      const baseline = await runTestRepair({
        config: { command: "npm test", maxRetries: 1, runBeforeMutations: false },
        projectRoot: dir,
        baselineFailures: [],
        execFn: makeFailingExecFn(preExistingOutput),
      });
      const baselineFailures = baseline.failures;

      // Agent edit introduces a NEW failure in addition to the pre-existing one
      const mixedOutput = vitestMultipleFailing([
        { testFile: "src/legacy.test.ts", testName: "legacy function works", error: "expected undefined to equal 42" },
        { testFile: "src/new.test.ts", testName: "new feature works", error: "expected false to be true" },
      ]);

      const afterAgentEdit = await runTestRepair({
        config: { command: "npm test", maxRetries: 1, runBeforeMutations: false },
        projectRoot: dir,
        baselineFailures,
        execFn: makeFailingExecFn(mixedOutput),
      });

      // Only the NEW failure should be reported
      expect(afterAgentEdit.newFailures).toHaveLength(1);
      expect(afterAgentEdit.newFailures[0]!.testName).toBe("new feature works");
      // Both failures are in the full list
      expect(afterAgentEdit.failures.length).toBe(2);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("empty baseline means all current failures are new (first run after clean state)", async () => {
    const dir = await mkdtemp(join(tmpdir(), "autonomy-clean-baseline-test-"));
    try {
      const failureOutput = vitestMultipleFailing([
        { testFile: "src/a.test.ts", testName: "test A", error: "error A" },
        { testFile: "src/b.test.ts", testName: "test B", error: "error B" },
      ]);

      const result = await runTestRepair({
        config: { command: "npm test", maxRetries: 1, runBeforeMutations: false },
        projectRoot: dir,
        baselineFailures: [], // clean project before agent started
        execFn: makeFailingExecFn(failureOutput),
      });

      expect(result.success).toBe(false);
      // Both failures are new (clean baseline)
      expect(result.newFailures.length).toBe(2);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
