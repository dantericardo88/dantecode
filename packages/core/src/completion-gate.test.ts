// ============================================================================
// @dantecode/core — CompletionGate tests
// Covers adversarial bypass attempts and legitimate completion scenarios.
// ============================================================================

import { describe, it, expect } from "vitest";
import { CompletionGate } from "./completion-gate.js";

describe("CompletionGate", () => {
  const gate = new CompletionGate();

  // ── Adversarial bypass attempts ──────────────────────────────────────────

  it("REJECTS: zero tool calls regardless of soft signals", () => {
    const result = gate.evaluate(
      "I have completed the task successfully. Implementation done. Task complete.",
      0,
    );
    expect(result.shouldExit).toBe(false);
    expect(result.reason).toContain("no tools called");
  });

  it("REJECTS: pure completion claim with 3 soft signals and 1 tool call", () => {
    // Previously: 3 × 0.2 = 0.6 confidence → passes. Now must not pass.
    const result = gate.evaluate(
      "I have successfully completed this task. Everything is done and implemented correctly.",
      1,
    );
    expect(result.shouldExit).toBe(false);
    expect(result.reason).toContain("completion claimed without evidence");
  });

  it("REJECTS: minimal claim with only 'done' and no evidence", () => {
    const result = gate.evaluate("Done.", 1);
    expect(result.shouldExit).toBe(false);
  });

  it("REJECTS: stub pattern overrides high soft-signal confidence", () => {
    const result = gate.evaluate(
      "Successfully implemented. All tests pass. Fixed.\n// TODO: fill this in",
      5,
    );
    expect(result.shouldExit).toBe(false);
    expect(result.reason).toContain("stub detected");
  });

  it("REJECTS: short response with 1 tool call and no evidence", () => {
    const result = gate.evaluate("Task complete.", 1);
    expect(result.shouldExit).toBe(false);
  });

  // ── Legitimate completion scenarios ─────────────────────────────────────

  it("PASSES: response with code block + tools called", () => {
    const result = gate.evaluate(
      `I've implemented the function:\n\`\`\`typescript\nfunction truncate(s: string, n: number) {\n  return s.slice(0, n);\n}\n\`\`\`\nAll tests pass.`,
      3,
    );
    expect(result.shouldExit).toBe(true);
    expect(result.confidence).toBeGreaterThanOrEqual(0.6);
  });

  it("PASSES: response with file reference + diff output + tools called", () => {
    const result = gate.evaluate(
      `Fixed packages/core/src/utils.ts:\n+function clamp(v, min, max) { return Math.min(Math.max(v, min), max); }\nImplementation done.`,
      2,
    );
    expect(result.shouldExit).toBe(true);
  });

  it("PASSES: response with test output confirming success", () => {
    const result = gate.evaluate(
      `Ran the test suite:\n✓ clamp handles min > max (3ms)\n✓ clamp normal values (1ms)\nAll 2 tests passed. The fix is implemented.`,
      4,
    );
    expect(result.shouldExit).toBe(true);
  });

  it("PASSES: response with actual code keywords + completion language", () => {
    const result = gate.evaluate(
      `The function is now implemented:\nconst result = arr.filter(x => x > 0);\nReturns filtered array. Fixed the edge case.`,
      2,
    );
    expect(result.shouldExit).toBe(true);
  });

  // ── Edge cases ──────────────────────────────────────────────────────────

  it("REJECTS: no tool calls + code block (code in response doesn't substitute for tool calls)", () => {
    const result = gate.evaluate(
      "```typescript\nfunction foo() { return 42; }\n```\nDone.",
      0,
    );
    expect(result.shouldExit).toBe(false);
    expect(result.reason).toContain("no tools called");
  });

  it("confidence is 0 for zero-tool-call response", () => {
    const result = gate.evaluate("Task complete.", 0);
    expect(result.confidence).toBe(0.0);
  });

  it("GateVerdict shape is correct", () => {
    const result = gate.evaluate("done", 1);
    expect(typeof result.shouldExit).toBe("boolean");
    expect(typeof result.confidence).toBe("number");
    expect(typeof result.reason).toBe("string");
    expect(result.confidence).toBeGreaterThanOrEqual(0);
    expect(result.confidence).toBeLessThanOrEqual(1);
  });
});
