import { describe, it, expect } from "vitest";
import { fuzzyScore, fuzzyFilter, type FuzzyItem } from "./fuzzy-finder.js";

describe("fuzzyScore", () => {
  it("returns score 1 for empty query", () => {
    const result = fuzzyScore("hello", "");
    expect(result.score).toBe(1);
    expect(result.matchedIndices).toEqual([]);
  });

  it("returns score 0 for empty string", () => {
    const result = fuzzyScore("", "hello");
    expect(result.score).toBe(0);
    expect(result.matchedIndices).toEqual([]);
  });

  it("returns score 0 when not all characters match", () => {
    const result = fuzzyScore("hello", "xyz");
    expect(result.score).toBe(0);
    expect(result.matchedIndices).toEqual([]);
  });

  it("scores consecutive matches higher than scattered", () => {
    const consecutive = fuzzyScore("hello", "hel");
    const scattered = fuzzyScore("hello world", "hlw");

    expect(consecutive.score).toBeGreaterThan(scattered.score);
    expect(consecutive.matchedIndices).toEqual([0, 1, 2]);
  });

  it("scores early matches higher than late matches", () => {
    const early = fuzzyScore("hello", "hel");
    const late = fuzzyScore("world hello", "hel");

    expect(early.score).toBeGreaterThan(late.score);
  });

  it("is case-insensitive by default", () => {
    const result = fuzzyScore("HelloWorld", "helloworld");
    expect(result.score).toBeGreaterThan(0);
    expect(result.matchedIndices.length).toBe(10);
  });

  it("respects caseSensitive option", () => {
    const insensitive = fuzzyScore("HelloWorld", "helloworld", { caseSensitive: false });
    const sensitive = fuzzyScore("HelloWorld", "helloworld", { caseSensitive: true });

    expect(insensitive.score).toBeGreaterThan(0);
    expect(sensitive.score).toBe(0); // Won't match due to case mismatch
  });

  it("gives bonus for exact case matches", () => {
    // Use partial match so score doesn't get capped at 1.0
    const exactCase = fuzzyScore("HelloWorldFooBar", "HWF", { caseSensitive: false });
    const wrongCase = fuzzyScore("HelloWorldFooBar", "hwf", { caseSensitive: false });

    // exactCase should have higher score due to case match bonuses
    expect(exactCase.score).toBeGreaterThan(wrongCase.score);
  });

  it("returns correct matched indices", () => {
    const result = fuzzyScore("packages/cli/src/index.ts", "pkg");
    expect(result.score).toBeGreaterThan(0);
    expect(result.matchedIndices).toEqual([0, 3, 5]); // p at 0, k at 3, g at 5 (all in "packages")
  });

  it("handles special characters", () => {
    const result = fuzzyScore("my-file_name.test.ts", "mfn");
    expect(result.score).toBeGreaterThan(0);
    expect(result.matchedIndices.length).toBe(3);
  });
});

describe("fuzzyFilter", () => {
  const items: FuzzyItem[] = [
    { label: "packages/cli/src/index.ts", value: "file1" },
    { label: "packages/core/src/index.ts", value: "file2" },
    { label: "packages/cli/src/repl.ts", value: "file3" },
    { label: "README.md", value: "file4" },
    { label: "package.json", value: "file5" },
  ];

  it("returns all items when query is empty", () => {
    const matches = fuzzyFilter(items, "");
    expect(matches.length).toBe(items.length);
    expect(matches.every((m) => m.score === 1)).toBe(true);
  });

  it("filters items by query", () => {
    const matches = fuzzyFilter(items, "cli");
    expect(matches.length).toBe(2);
    expect(matches.every((m) => m.label.includes("cli"))).toBe(true);
  });

  it("sorts by score descending", () => {
    const matches = fuzzyFilter(items, "pkg");
    expect(matches.length).toBeGreaterThan(0);
    for (let i = 1; i < matches.length; i++) {
      expect(matches[i - 1]!.score).toBeGreaterThanOrEqual(matches[i]!.score);
    }
  });

  it("respects minScore threshold", () => {
    const matches = fuzzyFilter(items, "xyz", { minScore: 0.5 });
    expect(matches.length).toBe(0);
  });

  it("respects maxResults limit", () => {
    const matches = fuzzyFilter(items, "", { maxResults: 2 });
    expect(matches.length).toBe(2);
  });

  it("includes matched indices in results", () => {
    const matches = fuzzyFilter(items, "cli");
    expect(matches[0]!.matchedIndices.length).toBeGreaterThan(0);
  });

  it("handles empty items array", () => {
    const matches = fuzzyFilter([], "test");
    expect(matches.length).toBe(0);
  });

  it("handles items with descriptions", () => {
    const itemsWithDesc: FuzzyItem[] = [
      { label: "commit", description: "Create a commit", value: "commit" },
      { label: "checkout", description: "Switch branches", value: "checkout" },
    ];
    const matches = fuzzyFilter(itemsWithDesc, "com");
    expect(matches.length).toBe(1);
    expect(matches[0]!.label).toBe("commit");
    expect(matches[0]!.description).toBe("Create a commit");
  });

  it("prioritizes better matches", () => {
    const testItems: FuzzyItem[] = [
      { label: "packages/cli/src/fuzzy-finder.ts", value: "exact" },
      { label: "packages/cli/src/confirm-flow.ts", value: "partial" },
      { label: "packages/core/src/index.ts", value: "weak" },
    ];
    const matches = fuzzyFilter(testItems, "fuzzy");
    expect(matches[0]!.value).toBe("exact");
  });

  it("matches scattered characters", () => {
    const testItems: FuzzyItem[] = [
      { label: "packages/cli/src/index.ts", value: "1" },
      { label: "packages/core/src/repl.ts", value: "2" },
    ];
    const matches = fuzzyFilter(testItems, "pcs");
    expect(matches.length).toBe(2); // Both have p, c, s
  });
});

describe("fuzzyScore edge cases", () => {
  it("handles unicode characters", () => {
    const result = fuzzyScore("hello wörld", "hel");
    expect(result.score).toBeGreaterThan(0);
    expect(result.matchedIndices).toEqual([0, 1, 2]);
  });

  it("handles very long strings efficiently", () => {
    const longStr = "a".repeat(10000);
    const result = fuzzyScore(longStr, "aaa");
    expect(result.score).toBeGreaterThan(0);
    expect(result.matchedIndices).toEqual([0, 1, 2]);
  });

  it("handles query longer than string", () => {
    const result = fuzzyScore("hi", "hello");
    expect(result.score).toBe(0);
  });

  it("handles all special characters", () => {
    const result = fuzzyScore("!@#$%^&*()", "!@#");
    expect(result.score).toBeGreaterThan(0);
    expect(result.matchedIndices).toEqual([0, 1, 2]);
  });
});

describe("fuzzyFilter edge cases", () => {
  it("handles items with same label", () => {
    const items: FuzzyItem[] = [
      { label: "test", value: "1" },
      { label: "test", value: "2" },
      { label: "test", value: "3" },
    ];
    const matches = fuzzyFilter(items, "test");
    expect(matches.length).toBe(3);
  });

  it("handles items without value field", () => {
    const items: FuzzyItem[] = [{ label: "test" }, { label: "testing" }];
    const matches = fuzzyFilter(items, "test");
    expect(matches.length).toBe(2);
    expect(matches[0]!.value).toBeUndefined();
  });

  it("preserves metadata in matches", () => {
    const items: FuzzyItem[] = [
      { label: "test", value: "1", metadata: { foo: "bar" } },
    ];
    const matches = fuzzyFilter(items, "test");
    expect(matches[0]!.metadata).toEqual({ foo: "bar" });
  });
});
