// Sprint BL — Dim 20: DebugRepairAdvisor — generateRepairSuggestions tests
import { describe, it, expect } from "vitest";
import {
  generateRepairSuggestions,
  formatRepairSuggestionsForPrompt,
  type RepairSuggestion,
} from "./debug-repair-advisor.js";

describe("generateRepairSuggestions", () => {
  it("returns null-check suggestion for 'Cannot read' message", () => {
    const suggestions = generateRepairSuggestions({
      exceptionMessage: "Cannot read properties of null (reading 'length')",
    });
    expect(suggestions.length).toBeGreaterThan(0);
    const nullCheck = suggestions.find((s) => s.category === "null-check");
    expect(nullCheck).toBeDefined();
    expect(nullCheck!.priority).toBe("critical");
    expect(nullCheck!.confidence).toBeGreaterThan(0.5);
    expect(nullCheck!.codeHint).toContain("null");
  });

  it("returns undefined suggestion for 'undefined is not' message", () => {
    const suggestions = generateRepairSuggestions({
      exceptionMessage: "undefined is not an object",
    });
    const undef = suggestions.find((s) => s.category === "undefined");
    expect(undef).toBeDefined();
    expect(undef!.priority).toBe("critical");
  });

  it("returns type-error suggestion for 'is not a function' message", () => {
    const suggestions = generateRepairSuggestions({
      exceptionMessage: "foo.bar is not a function",
    });
    const te = suggestions.find((s) => s.category === "type-error");
    expect(te).toBeDefined();
    expect(te!.priority).toBe("high");
    expect(te!.codeHint).toContain("typeof");
  });

  it("returns boundary suggestion for 'RangeError' message", () => {
    const suggestions = generateRepairSuggestions({
      exceptionMessage: "RangeError: Maximum call stack size exceeded",
    });
    const boundary = suggestions.find((s) => s.category === "boundary");
    expect(boundary).toBeDefined();
    expect(boundary!.priority).toBe("high");
  });

  it("returns async suggestion for 'Promise' in message", () => {
    const suggestions = generateRepairSuggestions({
      exceptionMessage: "UnhandledPromiseRejectionWarning: error in async call",
    });
    const async_ = suggestions.find((s) => s.category === "async");
    expect(async_).toBeDefined();
    expect(async_!.priority).toBe("medium");
    expect(async_!.codeHint).toContain("await");
  });

  it("returns empty array for snapshot with no exceptionMessage", () => {
    const suggestions = generateRepairSuggestions({ stopReason: "breakpoint" });
    expect(suggestions).toHaveLength(0);
  });

  it("sorts results so critical comes before high and medium", () => {
    const suggestions = generateRepairSuggestions({
      exceptionMessage: "Cannot read properties of null and is not a function and Promise rejected",
    });
    const priorities = suggestions.map((s) => s.priority);
    const ORDER: Record<string, number> = { critical: 0, high: 1, medium: 2 };
    for (let i = 1; i < priorities.length; i++) {
      expect(ORDER[priorities[i]!] ?? 99).toBeGreaterThanOrEqual(ORDER[priorities[i - 1]!] ?? 99);
    }
  });
});

describe("formatRepairSuggestionsForPrompt", () => {
  it("formats suggestions as markdown bullet list", () => {
    const suggestions: RepairSuggestion[] = [
      {
        priority: "critical",
        category: "null-check",
        description: "Object is null.",
        codeHint: "if (x !== null) {}",
        confidence: 0.85,
      },
    ];
    const output = formatRepairSuggestionsForPrompt(suggestions);
    expect(output).toContain("[CRITICAL]");
    expect(output).toContain("null-check");
    expect(output).toContain("85%");
  });

  it("returns fallback message for empty suggestions", () => {
    const output = formatRepairSuggestionsForPrompt([]);
    expect(output).toContain("No repair suggestions");
  });
});
