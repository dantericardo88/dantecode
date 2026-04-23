// ============================================================================
// packages/codebase-index/src/__tests__/context-assembler.test.ts
// ============================================================================

import { describe, it, expect } from "vitest";
import { assembleContext, tokenCostOf } from "../context-assembler.js";
import type { ContextSource } from "../types.js";

function src(id: string, content: string, priority: number): ContextSource {
  return { id, content, priority, tokenCost: tokenCostOf(content) };
}

describe("tokenCostOf", () => {
  it("returns ceiling of length / 3.5", () => {
    expect(tokenCostOf("abc")).toBe(1);        // 3/3.5 → ceil(0.857) = 1
    expect(tokenCostOf("abcde")).toBe(2);      // 5/3.5 → ceil(1.43) = 2
    expect(tokenCostOf("")).toBe(0);
  });
});

describe("assembleContext", () => {
  it("returns empty string for zero budget", () => {
    const sources = [src("a", "hello world", 1)];
    expect(assembleContext(sources, 0)).toBe("");
  });

  it("returns empty string for empty sources", () => {
    expect(assembleContext([], 1000)).toBe("");
  });

  it("includes all sources when under budget", () => {
    const sources = [
      src("a", "aaa", 1),
      src("b", "bbb", 2),
    ];
    const result = assembleContext(sources, 1000);
    expect(result).toContain("aaa");
    expect(result).toContain("bbb");
  });

  it("respects priority order (higher priority first)", () => {
    const sources = [
      src("low",  "LOW",  1),
      src("high", "HIGH", 10),
      src("mid",  "MID",  5),
    ];
    const result = assembleContext(sources, 1000);
    expect(result.indexOf("HIGH")).toBeLessThan(result.indexOf("MID"));
    expect(result.indexOf("MID")).toBeLessThan(result.indexOf("LOW"));
  });

  it("omits lowest-priority source when over budget", () => {
    // Each "aaa" costs tokenCostOf("aaa") = ceil(3/3.5) = 1 token
    const sources = [
      src("a", "aaa", 3),
      src("b", "bbb", 2),
      src("c", "ccc", 1),
    ];
    // Budget 2 tokens: fits "a" (1) + "b" (1) but not "c"
    const result = assembleContext(sources, 2);
    expect(result).toContain("aaa");
    expect(result).toContain("bbb");
    expect(result).not.toContain("ccc");
  });

  it("truncates the last fitting source to fill remaining budget", () => {
    // Long content that partially fits
    const longContent = "x".repeat(35); // tokenCostOf = ceil(35/3.5) = 10 tokens
    const sources = [
      src("short", "abc", 2),  // 1 token
      src("long",  longContent, 1), // 10 tokens
    ];
    // Budget 4 tokens: "abc"=1 + 3 tokens remain → 3*3.5=10.5 → floor=10 chars of long
    const result = assembleContext(sources, 4);
    expect(result).toContain("abc");
    // The long content should be truncated
    expect(result.length).toBeLessThan("abc".length + longContent.length + 2);
  });

  it("handles a single source within budget", () => {
    const result = assembleContext([src("x", "hello", 5)], 100);
    expect(result).toBe("hello");
  });

  it("joins parts with newline", () => {
    const sources = [
      src("a", "first",  2),
      src("b", "second", 1),
    ];
    const result = assembleContext(sources, 1000);
    expect(result).toBe("first\nsecond");
  });
});
