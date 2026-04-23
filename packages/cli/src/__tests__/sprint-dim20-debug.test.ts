// ============================================================================
// Sprint Dim 20: Debug / runtime context assembler + outcome delta
// ============================================================================

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, mkdirSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  hasStackTrace,
  assembleDebugContext,
  formatDebugContextForPrompt,
  recordDebugRepairOutcome,
  loadDebugRepairOutcomes,
  computeDebugRepairImpact,
  getDebugRepairSuccessRate,
} from "@dantecode/core";

let tmpDir: string;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "dim20-debug-test-"));
  mkdirSync(join(tmpDir, ".danteforge"), { recursive: true });
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

// ── hasStackTrace ─────────────────────────────────────────────────────────────

describe("hasStackTrace", () => {
  it("detects JS/TS at-style stack traces", () => {
    const output = `TypeError: Cannot read properties of undefined\n    at foo (src/utils.ts:42:10)\n    at bar (src/index.ts:10:5)`;
    expect(hasStackTrace(output)).toBe(true);
  });

  it("detects Python tracebacks", () => {
    const output = `Traceback (most recent call last):\n  File "main.py", line 5, in <module>\nTypeError: 'NoneType'`;
    expect(hasStackTrace(output)).toBe(true);
  });

  it("returns false for plain error messages without stack trace", () => {
    expect(hasStackTrace("Error: command not found")).toBe(false);
    expect(hasStackTrace("Build failed with 3 errors")).toBe(false);
  });

  it("detects vitest FAILED output with stack frames", () => {
    const output = `FAIL src/foo.test.ts\n    at Object.<anonymous> (src/foo.test.ts:12:7)`;
    expect(hasStackTrace(output)).toBe(true);
  });
});

// ── assembleDebugContext ───────────────────────────────────────────────────────

describe("assembleDebugContext", () => {
  it("extracts errorType from TypeError exception", () => {
    const raw = `TypeError: Cannot read properties of undefined (reading 'map')\n    at processItems (src/processor.ts:55:12)`;
    const ctx = assembleDebugContext(raw, {}, "session-1");
    expect(ctx.errorType).toContain("TypeError");
  });

  it("assigns severityScore=0.9 for exception with stack", () => {
    const raw = `ReferenceError: foo is not defined\n    at main (src/app.ts:10:1)`;
    const ctx = assembleDebugContext(raw, {}, "session-1");
    expect(ctx.severityScore).toBe(0.9);
  });

  it("assigns severityScore=0.6 for test failure without exception class", () => {
    const raw = `FAILED\n  ● myTest › should return true\n    Expected: true, Received: false`;
    const ctx = assembleDebugContext(raw, {}, "session-1");
    expect(ctx.severityScore).toBe(0.6);
  });

  it("parses JS stack frames and marks user code vs library", () => {
    const raw = `Error: broken\n    at myFn (src/mymod.ts:33:5)\n    at Object.<anonymous> (node_modules/jest/lib/run.js:100:10)`;
    const ctx = assembleDebugContext(raw, {}, "session-1");
    const userFrame = ctx.stackFrames.find((f) => f.filePath.includes("mymod.ts"));
    expect(userFrame).toBeDefined();
    expect(userFrame!.isUserCode).toBe(true);
    const libFrame = ctx.stackFrames.find((f) => f.filePath.includes("node_modules"));
    expect(libFrame?.isUserCode).toBe(false);
  });

  it("stores watch values in context", () => {
    const raw = `Error: unexpected value\n    at check (src/validator.ts:8:3)`;
    const ctx = assembleDebugContext(raw, { counter: "42", isActive: "true" }, "s-2");
    expect(ctx.watchValues["counter"]).toBe("42");
    expect(ctx.watchValues["isActive"]).toBe("true");
  });

  it("extracts failingTestName from vitest/jest style output", () => {
    const raw = `● myModule › should handle edge case\n\n    Expected: 1\n    Received: 0\n\n    at Object.<anonymous> (src/test.ts:20:5)`;
    const ctx = assembleDebugContext(raw, {}, "s-3");
    expect(ctx.failingTestName).toContain("should handle edge case");
  });
});

// ── formatDebugContextForPrompt ───────────────────────────────────────────────

describe("formatDebugContextForPrompt", () => {
  it("starts with [Debug Repair Context]", () => {
    const raw = `TypeError: null is not an object\n    at run (src/runner.ts:5:1)`;
    const ctx = assembleDebugContext(raw, {}, "s-fmt");
    const prompt = formatDebugContextForPrompt(ctx);
    expect(prompt).toMatch(/\[Debug Repair Context/);
  });

  it("includes severity score", () => {
    const raw = `TypeError: undefined\n    at fn (src/a.ts:1:1)`;
    const ctx = assembleDebugContext(raw, {}, "s-fmt");
    const prompt = formatDebugContextForPrompt(ctx);
    expect(prompt).toContain("severity:");
  });

  it("includes watch values when present", () => {
    const raw = `Error: bad state\n    at check (src/state.ts:10:3)`;
    const ctx = assembleDebugContext(raw, { myVar: "unexpected_value" }, "s-fmt");
    const prompt = formatDebugContextForPrompt(ctx);
    expect(prompt).toContain("myVar");
    expect(prompt).toContain("unexpected_value");
  });
});

// ── recordDebugRepairOutcome + loadDebugRepairOutcomes ────────────────────────

describe("recordDebugRepairOutcome + loadDebugRepairOutcomes", () => {
  it("creates debug-repair-outcomes.jsonl on first record", () => {
    recordDebugRepairOutcome({
      sessionId: "s-test-1",
      hadDebugContext: true,
      debugContextCount: 1,
      verdict: "COMPLETED",
      severityScore: 0.9,
      timestamp: new Date().toISOString(),
    }, tmpDir);
    expect(existsSync(join(tmpDir, ".danteforge", "debug-repair-outcomes.jsonl"))).toBe(true);
  });

  it("appends multiple entries and reads them back", () => {
    recordDebugRepairOutcome({ sessionId: "a", hadDebugContext: true, debugContextCount: 1, verdict: "COMPLETED", severityScore: 0.9, timestamp: "" }, tmpDir);
    recordDebugRepairOutcome({ sessionId: "b", hadDebugContext: false, debugContextCount: 0, verdict: "FAILED", severityScore: 0, timestamp: "" }, tmpDir);
    const outcomes = loadDebugRepairOutcomes(tmpDir);
    expect(outcomes).toHaveLength(2);
    expect(outcomes[0]!.sessionId).toBe("a");
    expect(outcomes[1]!.verdict).toBe("FAILED");
  });

  it("returns empty array when file does not exist", () => {
    expect(loadDebugRepairOutcomes(tmpDir)).toEqual([]);
  });
});

// ── computeDebugRepairImpact ──────────────────────────────────────────────────

describe("computeDebugRepairImpact", () => {
  it("returns higher completion rate for withDebugContext sessions", () => {
    const outcomes = [
      { sessionId: "a", hadDebugContext: true, debugContextCount: 1, verdict: "COMPLETED" as const, severityScore: 0.9, timestamp: "" },
      { sessionId: "b", hadDebugContext: true, debugContextCount: 1, verdict: "COMPLETED" as const, severityScore: 0.9, timestamp: "" },
      { sessionId: "c", hadDebugContext: false, debugContextCount: 0, verdict: "FAILED" as const, severityScore: 0, timestamp: "" },
      { sessionId: "d", hadDebugContext: false, debugContextCount: 0, verdict: "FAILED" as const, severityScore: 0, timestamp: "" },
    ];
    const report = computeDebugRepairImpact(outcomes);
    expect(report.withDebugContextRate).toBe(1.0);
    expect(report.withoutDebugContextRate).toBe(0.0);
    expect(report.delta).toBeGreaterThan(0.15);
    expect(report.isSignificant).toBe(true);
  });

  it("returns isSignificant=false when delta <= 0.15", () => {
    const outcomes = [
      { sessionId: "a", hadDebugContext: true, debugContextCount: 1, verdict: "COMPLETED" as const, severityScore: 0.5, timestamp: "" },
      { sessionId: "b", hadDebugContext: false, debugContextCount: 0, verdict: "COMPLETED" as const, severityScore: 0, timestamp: "" },
    ];
    const report = computeDebugRepairImpact(outcomes);
    expect(report.isSignificant).toBe(false);
  });

  it("returns zero rates for empty outcomes", () => {
    const report = computeDebugRepairImpact([]);
    expect(report.withDebugContextRate).toBe(0);
    expect(report.withoutDebugContextRate).toBe(0);
    expect(report.sampleCount).toBe(0);
  });

  it("sampleCount reflects total entries", () => {
    const outcomes = [
      { sessionId: "a", hadDebugContext: true, debugContextCount: 1, verdict: "COMPLETED" as const, severityScore: 0.9, timestamp: "" },
      { sessionId: "b", hadDebugContext: false, debugContextCount: 0, verdict: "ATTEMPTED" as const, severityScore: 0, timestamp: "" },
      { sessionId: "c", hadDebugContext: true, debugContextCount: 2, verdict: "FAILED" as const, severityScore: 0.6, timestamp: "" },
    ];
    const report = computeDebugRepairImpact(outcomes);
    expect(report.sampleCount).toBe(3);
  });
});

// ── getDebugRepairSuccessRate ─────────────────────────────────────────────────

describe("getDebugRepairSuccessRate", () => {
  it("reads seeded outcomes and returns positive delta (withDebug > withoutDebug)", () => {
    // Seed with debug=true→COMPLETED, debug=false→FAILED
    recordDebugRepairOutcome({ sessionId: "x", hadDebugContext: true, debugContextCount: 1, verdict: "COMPLETED", severityScore: 0.9, timestamp: "" }, tmpDir);
    recordDebugRepairOutcome({ sessionId: "y", hadDebugContext: false, debugContextCount: 0, verdict: "FAILED", severityScore: 0, timestamp: "" }, tmpDir);
    const report = getDebugRepairSuccessRate(tmpDir);
    expect(report.withDebugContextRate).toBeGreaterThan(report.withoutDebugContextRate);
    expect(report.isSignificant).toBe(true);
  });

  it("returns all-zero report when no outcomes exist", () => {
    const report = getDebugRepairSuccessRate(tmpDir);
    expect(report.sampleCount).toBe(0);
    expect(report.withDebugContextRate).toBe(0);
  });
});
