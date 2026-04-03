// ============================================================================
// @dantecode/cli — Agent Loop Constants Tests
// Tests for helper functions in agent-loop-constants.ts
// ============================================================================

import { describe, it, expect } from "vitest";
import { estimatePromptComplexity } from "./agent-loop-constants.js";

describe("estimatePromptComplexity", () => {
  it("returns 5 for simple prompts", () => {
    expect(estimatePromptComplexity("fix typo")).toBe(5);
    expect(estimatePromptComplexity("update config")).toBe(5);
    expect(estimatePromptComplexity("small change")).toBe(5);
  });

  it("returns 10 for medium complexity prompts", () => {
    expect(estimatePromptComplexity("fix bug in authentication")).toBe(10);
    expect(estimatePromptComplexity("implement new feature for dashboard")).toBe(10);
    expect(estimatePromptComplexity("add feature to user profile")).toBe(10);
    expect(estimatePromptComplexity("update logic in payment processor")).toBe(10);
  });

  it("returns 10 for prompts over 100 words", () => {
    const longPrompt = "word ".repeat(101);
    expect(estimatePromptComplexity(longPrompt)).toBe(10);
  });

  it("returns 20 for complex architectural changes", () => {
    expect(estimatePromptComplexity("refactor the entire authentication system")).toBe(20);
    expect(estimatePromptComplexity("migrate from REST to GraphQL")).toBe(20);
    expect(estimatePromptComplexity("redesign the architecture")).toBe(20);
    expect(estimatePromptComplexity("restructure the project layout")).toBe(20);
  });

  it("returns 20 for prompts over 200 words", () => {
    const veryLongPrompt = "word ".repeat(201);
    expect(estimatePromptComplexity(veryLongPrompt)).toBe(20);
  });

  it("is case insensitive", () => {
    expect(estimatePromptComplexity("REFACTOR the code")).toBe(20);
    expect(estimatePromptComplexity("Fix Bug in module")).toBe(10);
    expect(estimatePromptComplexity("MIGRATE to new API")).toBe(20);
  });

  it("handles empty string", () => {
    expect(estimatePromptComplexity("")).toBe(5);
  });

  it("prioritizes complexity keywords over word count", () => {
    // Short but complex keyword should return 20
    expect(estimatePromptComplexity("refactor")).toBe(20);
    // Medium keyword should return 10
    expect(estimatePromptComplexity("fix bug")).toBe(10);
  });
});
