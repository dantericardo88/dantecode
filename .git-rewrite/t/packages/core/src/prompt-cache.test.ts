import { describe, it, expect } from "vitest";
import {
  shouldUsePromptCache,
  buildCacheablePrompt,
  toCacheControlBlocks,
  estimateCacheSavings,
} from "./prompt-cache.js";

describe("shouldUsePromptCache", () => {
  it("returns true for anthropic provider", () => {
    expect(shouldUsePromptCache("anthropic")).toBe(true);
  });

  it("returns false for non-anthropic providers", () => {
    expect(shouldUsePromptCache("openai")).toBe(false);
    expect(shouldUsePromptCache("ollama")).toBe(false);
    expect(shouldUsePromptCache("groq")).toBe(false);
  });
});

describe("buildCacheablePrompt", () => {
  it("marks static sections as cacheable", () => {
    const sections = buildCacheablePrompt("system prompt", "tool defs");
    expect(sections).toHaveLength(2);
    expect(sections[0]!.cacheable).toBe(true);
    expect(sections[1]!.cacheable).toBe(true);
  });

  it("marks dynamic context as non-cacheable", () => {
    const sections = buildCacheablePrompt("system", "tools", "dynamic repo map");
    expect(sections).toHaveLength(3);
    expect(sections[2]!.cacheable).toBe(false);
    expect(sections[2]!.content).toBe("dynamic repo map");
  });

  it("omits dynamic context when not provided", () => {
    const sections = buildCacheablePrompt("system", "tools");
    expect(sections).toHaveLength(2);
  });
});

describe("toCacheControlBlocks", () => {
  it("adds cache_control to cacheable sections", () => {
    const sections = buildCacheablePrompt("system", "tools");
    const blocks = toCacheControlBlocks(sections);
    expect(blocks[0]!.cache_control).toEqual({ type: "ephemeral" });
    expect(blocks[1]!.cache_control).toEqual({ type: "ephemeral" });
  });

  it("does not add cache_control to non-cacheable sections", () => {
    const sections = buildCacheablePrompt("system", "tools", "dynamic");
    const blocks = toCacheControlBlocks(sections);
    expect(blocks[2]!.cache_control).toBeUndefined();
  });

  it("sets type to 'text' for all blocks", () => {
    const sections = buildCacheablePrompt("sys", "tools", "dyn");
    const blocks = toCacheControlBlocks(sections);
    expect(blocks.every((b) => b.type === "text")).toBe(true);
  });
});

describe("estimateCacheSavings", () => {
  it("returns 1.0 when everything is cacheable", () => {
    const sections = [
      { content: "aaaa", cacheable: true },
      { content: "bbbb", cacheable: true },
    ];
    expect(estimateCacheSavings(sections)).toBe(1);
  });

  it("returns 0 when nothing is cacheable", () => {
    const sections = [{ content: "aaaa", cacheable: false }];
    expect(estimateCacheSavings(sections)).toBe(0);
  });

  it("returns correct ratio for mixed sections", () => {
    const sections = [
      { content: "aaaa", cacheable: true }, // 4 chars
      { content: "bb", cacheable: false }, // 2 chars
    ];
    // 4/6 = 0.666...
    expect(estimateCacheSavings(sections)).toBeCloseTo(0.667, 2);
  });

  it("returns 0 for empty sections", () => {
    expect(estimateCacheSavings([])).toBe(0);
  });
});
