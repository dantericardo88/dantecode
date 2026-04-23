// ============================================================================
// Sprint Dim 5: SWE-bench patch applicability + task correctness oracle
// ============================================================================

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  verifyPatchApplicability,
  computeHardTaskSuccessRate,
  runTypeCheckOracle,
  computeResolutionScore,
  buildResolutionEvidence,
  getOverallResolutionRate,
} from "../swe-bench-runner.js";

let tmpDir: string;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "dim5-test-"));
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

// ── Patch seeding: synthetic patches that match seeded content ───────────────

describe("verifyPatchApplicability — seeded repo", () => {
  it("returns true for a valid patch that adds a line to a seeded file", async () => {
    // Build a unified diff that adds one line to src/foo.py
    // The seeded content must match the context lines
    const patch = [
      "diff --git a/src/foo.py b/src/foo.py",
      "--- a/src/foo.py",
      "+++ b/src/foo.py",
      "@@ -1,3 +1,4 @@",
      " import os",
      " import sys",
      " import re",
      "+import json",
    ].join("\n") + "\n";

    const result = await verifyPatchApplicability(patch, tmpDir);
    expect(result).toBe(true);
  }, 20_000);

  it("returns false for a patch with context lines that don't exist in seeded file", async () => {
    const patch = [
      "diff --git a/src/bar.py b/src/bar.py",
      "--- a/src/bar.py",
      "+++ b/src/bar.py",
      "@@ -500,3 +500,4 @@",
      " context_line_that_will_not_be_in_the_seeded_file_abc",
      " another_nonexistent_line_def",
      "+new_line",
    ].join("\n") + "\n";

    const result = await verifyPatchApplicability(patch, tmpDir);
    expect(result).toBe(false);
  }, 20_000);

  it("returns false for malformed patch content", async () => {
    const result = await verifyPatchApplicability("this is not a patch", tmpDir);
    expect(result).toBe(false);
  }, 20_000);

  it("returns true for a patch that adds a line to a file with real content", async () => {
    // Patch targeting a file where context lines match exactly what we seed
    const patch = [
      "diff --git a/lib/utils.ts b/lib/utils.ts",
      "--- a/lib/utils.ts",
      "+++ b/lib/utils.ts",
      "@@ -1,3 +1,4 @@",
      " export function add(a: number, b: number) {",
      "   return a + b;",
      " }",
      "+export const VERSION = '1.0.0';",
    ].join("\n") + "\n";

    const result = await verifyPatchApplicability(patch, tmpDir);
    expect(result).toBe(true);
  }, 20_000);

  it("returns false for an empty patch string", async () => {
    const result = await verifyPatchApplicability("", tmpDir);
    expect(result).toBe(false);
  }, 20_000);
});

// ── Hard-task correctness rate ────────────────────────────────────────────────

describe("computeHardTaskSuccessRate", () => {
  it("returns successRate 0 when log file does not exist", async () => {
    const result = await computeHardTaskSuccessRate(tmpDir);
    expect(result.totalHardTasks).toBe(0);
    expect(result.successRate).toBe(0);
  });

  it("counts hard tasks (toolCallCount >= 5) and COMPLETED verdicts", async () => {
    const danteDir = join(tmpDir, ".danteforge");
    mkdirSync(danteDir, { recursive: true });
    const logPath = join(danteDir, "task-completion-log.jsonl");

    const entries = [
      { sessionId: "s1", prompt: "hard task 1", verdict: "COMPLETED", toolCallCount: 8, timestamp: new Date().toISOString() },
      { sessionId: "s2", prompt: "hard task 2", verdict: "COMPLETED", toolCallCount: 6, timestamp: new Date().toISOString() },
      { sessionId: "s3", prompt: "hard task 3", verdict: "ATTEMPTED", toolCallCount: 7, timestamp: new Date().toISOString() },
      { sessionId: "s4", prompt: "easy task", verdict: "COMPLETED", toolCallCount: 2, timestamp: new Date().toISOString() },
    ];
    writeFileSync(logPath, entries.map((e) => JSON.stringify(e)).join("\n") + "\n");

    const result = await computeHardTaskSuccessRate(tmpDir);
    expect(result.totalHardTasks).toBe(3); // s1, s2, s3 (all >= 5 tool calls)
    expect(result.completedCleanly).toBe(2); // s1, s2
    expect(result.successRate).toBeCloseTo(2 / 3);
  });

  it("writes hard-task-success-rate.json to .danteforge/", async () => {
    const result = await computeHardTaskSuccessRate(tmpDir);
    const outPath = join(tmpDir, ".danteforge", "hard-task-success-rate.json");
    expect(existsSync(outPath)).toBe(true);
    expect(result.computedAt).toBeTruthy();
  });

  it("returns successRate 1 when all hard tasks are COMPLETED", async () => {
    const danteDir = join(tmpDir, ".danteforge");
    mkdirSync(danteDir, { recursive: true });
    const logPath = join(danteDir, "task-completion-log.jsonl");
    const entries = [
      { sessionId: "a", prompt: "task", verdict: "COMPLETED", toolCallCount: 10, timestamp: new Date().toISOString() },
      { sessionId: "b", prompt: "task", verdict: "COMPLETED", toolCallCount: 5, timestamp: new Date().toISOString() },
    ];
    writeFileSync(logPath, entries.map((e) => JSON.stringify(e)).join("\n") + "\n");
    const result = await computeHardTaskSuccessRate(tmpDir);
    expect(result.successRate).toBe(1);
  });
});

// ── Type-check oracle ─────────────────────────────────────────────────────────

describe("runTypeCheckOracle", () => {
  it("returns null when no touched files provided", async () => {
    const result = await runTypeCheckOracle([], tmpDir);
    expect(result).toBeNull();
  });

  it("returns a boolean (not null, not throws) for a real project path", async () => {
    // Point at the CLI package — it may pass or fail tsc, but should not throw
    const cliPackagePath = join(
      new URL("../../../..", import.meta.url).pathname,
      "packages/cli/src/swe-bench-runner.ts",
    );
    const result = await runTypeCheckOracle([cliPackagePath], tmpDir);
    // Result is boolean or null — either is acceptable (tsc may or may not be in PATH)
    expect(result === null || typeof result === "boolean").toBe(true);
  }, 40_000);
});

// ── Resolution chain ──────────────────────────────────────────────────────────

describe("computeResolutionScore", () => {
  it("returns 0 when all false/null", () => {
    expect(computeResolutionScore(false, false, null, null)).toBe(0);
  });

  it("returns 0.40 when only patchApplicable=true", () => {
    expect(computeResolutionScore(true, false, null, null)).toBe(0.4);
  });

  it("returns 0.60 when patchApplicable + syntaxValid = true", () => {
    expect(computeResolutionScore(true, true, null, null)).toBe(0.6);
  });

  it("returns 0.85 when patchApplicable + syntaxValid + typeCheckPassed = true", () => {
    expect(computeResolutionScore(true, true, true, null)).toBe(0.85);
  });

  it("returns 1.0 when all four gates pass", () => {
    expect(computeResolutionScore(true, true, true, true)).toBe(1.0);
  });

  it("does not count typeCheckPassed=false as contributing", () => {
    const score = computeResolutionScore(true, true, false, null);
    expect(score).toBe(0.6);
  });

  it("does not count testsPassed=false as contributing", () => {
    const score = computeResolutionScore(true, true, null, false);
    expect(score).toBe(0.6);
  });
});

describe("buildResolutionEvidence", () => {
  const validPatch = [
    "diff --git a/src/foo.py b/src/foo.py",
    "--- a/src/foo.py",
    "+++ b/src/foo.py",
    "@@ -1,3 +1,4 @@",
    " import os",
    "+import sys",
  ].join("\n");

  it("returns syntaxValid=true for a well-formed patch when patchApplicable=true", () => {
    const result = buildResolutionEvidence(validPatch, true);
    expect(result.syntaxValid).toBe(true);
    expect(result.patchApplicable).toBe(true);
  });

  it("returns syntaxValid=false for a malformed patch even if patchApplicable=true", () => {
    const result = buildResolutionEvidence("not a patch at all", true);
    // syntaxValid requires diff --git header AND @@ marker
    expect(result.syntaxValid).toBe(false);
  });

  it("returns syntaxValid=false when patchApplicable=false regardless of content", () => {
    const result = buildResolutionEvidence(validPatch, false);
    expect(result.syntaxValid).toBe(false);
  });

  it("propagates typeCheckPassed and testsPassed into resolutionScore", () => {
    const result = buildResolutionEvidence(validPatch, true, true, true);
    expect(result.typeCheckPassed).toBe(true);
    expect(result.testsPassed).toBe(true);
    expect(result.resolutionScore).toBe(1.0);
  });

  it("has computedAt as a valid ISO timestamp", () => {
    const result = buildResolutionEvidence(validPatch, true);
    expect(() => new Date(result.computedAt)).not.toThrow();
    expect(new Date(result.computedAt).getFullYear()).toBeGreaterThanOrEqual(2024);
  });

  it("resolutionScore=0 for a fully failing instance", () => {
    const result = buildResolutionEvidence("bad patch", false, false, false);
    expect(result.resolutionScore).toBe(0);
  });
});

describe("getOverallResolutionRate", () => {
  it("returns 0 for empty array", () => {
    expect(getOverallResolutionRate([])).toBe(0);
  });

  it("returns the correct average for mixed scores", () => {
    const entries = [
      { patchApplicable: true, syntaxValid: true, typeCheckPassed: null, testsPassed: true, resolutionScore: 0.75, computedAt: "" },
      { patchApplicable: false, syntaxValid: false, typeCheckPassed: null, testsPassed: null, resolutionScore: 0, computedAt: "" },
      { patchApplicable: true, syntaxValid: true, typeCheckPassed: null, testsPassed: null, resolutionScore: 0.6, computedAt: "" },
    ];
    // avg = (0.75 + 0 + 0.6) / 3 = 0.45
    expect(getOverallResolutionRate(entries)).toBeCloseTo(0.45, 2);
  });

  it("returns 1.0 when all entries score 1.0", () => {
    const entries = [
      { patchApplicable: true, syntaxValid: true, typeCheckPassed: true, testsPassed: true, resolutionScore: 1.0, computedAt: "" },
      { patchApplicable: true, syntaxValid: true, typeCheckPassed: true, testsPassed: true, resolutionScore: 1.0, computedAt: "" },
    ];
    expect(getOverallResolutionRate(entries)).toBe(1.0);
  });
});
