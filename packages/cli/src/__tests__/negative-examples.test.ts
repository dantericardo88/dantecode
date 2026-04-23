// ============================================================================
// packages/cli/src/__tests__/negative-examples.test.ts
//
// Unit tests for the negative-examples behavioral guardrail bank.
//
// Design rules:
//   - Zero mocks — all tests call the real exported functions
//   - Trigger tests confirm the correct examples are selected
//   - Format tests check for expected substrings
// ============================================================================

import { describe, it, expect } from "vitest";
import {
  NEGATIVE_EXAMPLES,
  selectNegativeExamples,
  formatNegativeExamples,
} from "../negative-examples.js";

// ---------------------------------------------------------------------------
// 1. NEGATIVE_EXAMPLES constant
// ---------------------------------------------------------------------------

describe("NEGATIVE_EXAMPLES", () => {
  it("has at least 10 entries", () => {
    expect(NEGATIVE_EXAMPLES.length).toBeGreaterThanOrEqual(10);
  });

  it("every entry has a trigger (RegExp) and instruction (string starting with 'Do NOT')", () => {
    for (const ex of NEGATIVE_EXAMPLES) {
      expect(ex.trigger).toBeInstanceOf(RegExp);
      expect(ex.instruction).toMatch(/^Do NOT/);
    }
  });
});

// ---------------------------------------------------------------------------
// 2. selectNegativeExamples — trigger matching
// ---------------------------------------------------------------------------

describe("selectNegativeExamples — trigger matching", () => {
  it("always includes the universal guardrail (last entry)", () => {
    const results = selectNegativeExamples("please organize my desk");
    const universal = NEGATIVE_EXAMPLES[NEGATIVE_EXAMPLES.length - 1]!;
    expect(results.some((r) => r.instruction === universal.instruction)).toBe(true);
  });

  it("matches 'implement' prompt and selects relevant examples", () => {
    const results = selectNegativeExamples("implement a new user auth system", 3);
    // Should match scope enforcement + blind editing + universal
    expect(results.length).toBe(3);
    expect(results.some((r) => r.instruction.includes("no more"))).toBe(true);
  });

  it("matches 'fix error' prompt and selects debug-relevant example", () => {
    const results = selectNegativeExamples("fix the error in auth.ts", 3);
    expect(results.some((r) => r.instruction.includes("guess at the cause"))).toBe(true);
  });

  it("matches 'refactor' prompt and includes rename guardrail", () => {
    const results = selectNegativeExamples("refactor the database layer", 3);
    expect(results.some((r) => r.instruction.includes("Grep"))).toBe(true);
  });

  it("deduplicates when multiple triggers match the same instruction", () => {
    // "implement" matches both scope enforcement and blind editing guardrails
    const results = selectNegativeExamples("implement and build a new feature");
    const instructions = results.map((r) => r.instruction);
    const unique = new Set(instructions);
    expect(unique.size).toBe(instructions.length);
  });

  it("respects the limit parameter", () => {
    const results = selectNegativeExamples("implement build create write", 2);
    expect(results.length).toBeLessThanOrEqual(2);
  });
});

// ---------------------------------------------------------------------------
// 3. formatNegativeExamples
// ---------------------------------------------------------------------------

describe("formatNegativeExamples", () => {
  it("returns empty string for empty array", () => {
    expect(formatNegativeExamples([])).toBe("");
  });

  it("includes the section header", () => {
    const examples = selectNegativeExamples("fix this bug", 2);
    const result = formatNegativeExamples(examples);
    expect(result).toContain("## What NOT to Do");
  });

  it("includes each instruction as a bullet point", () => {
    const examples = selectNegativeExamples("implement a feature", 3);
    const result = formatNegativeExamples(examples);
    for (const ex of examples) {
      expect(result).toContain(`- ${ex.instruction}`);
    }
  });
});
