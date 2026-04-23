// packages/core/src/__tests__/model-router-cache.test.ts
// Sprint B — Dim 27: Prompt cache activation in model-router tests
import { describe, it, expect } from "vitest";
import { shouldUsePromptCache, buildCacheablePrompt, estimateCacheSavings } from "../prompt-cache.js";
import { globalCacheMetrics, CacheMetricsTracker } from "../cache-metrics.js";

// ─── shouldUsePromptCache ─────────────────────────────────────────────────────

describe("shouldUsePromptCache", () => {
  it("returns true for anthropic provider", () => {
    expect(shouldUsePromptCache("anthropic")).toBe(true);
  });

  it("returns false for openai provider", () => {
    expect(shouldUsePromptCache("openai")).toBe(false);
  });

  it("returns false for ollama provider", () => {
    expect(shouldUsePromptCache("ollama")).toBe(false);
  });

  it("returns false for groq provider", () => {
    expect(shouldUsePromptCache("groq")).toBe(false);
  });

  it("returns false for empty string", () => {
    expect(shouldUsePromptCache("")).toBe(false);
  });
});

// ─── buildCacheablePrompt ─────────────────────────────────────────────────────

describe("buildCacheablePrompt", () => {
  it("marks system prompt section as cacheable", () => {
    const sections = buildCacheablePrompt("You are a helpful assistant.", "");
    const systemSection = sections.find((s) => s.content === "You are a helpful assistant.");
    expect(systemSection?.cacheable).toBe(true);
  });

  it("marks tool definitions section as cacheable", () => {
    const sections = buildCacheablePrompt("system", "tool_defs_json");
    const toolSection = sections.find((s) => s.content === "tool_defs_json");
    expect(toolSection?.cacheable).toBe(true);
  });

  it("marks dynamic context as not cacheable", () => {
    const sections = buildCacheablePrompt("system", "tools", "dynamic context here");
    const dynamicSection = sections.find((s) => s.content === "dynamic context here");
    expect(dynamicSection?.cacheable).toBe(false);
  });

  it("returns sections array with correct length when all args provided", () => {
    const sections = buildCacheablePrompt("sys", "tools", "dynamic");
    expect(sections.length).toBeGreaterThanOrEqual(2);
  });

  it("cacheable sections have cacheType 'ephemeral'", () => {
    const sections = buildCacheablePrompt("system prompt content", "tool defs");
    const cacheableSections = sections.filter((s) => s.cacheable);
    for (const s of cacheableSections) {
      expect(s.cacheType).toBe("ephemeral");
    }
  });
});

// ─── estimateCacheSavings ─────────────────────────────────────────────────────

describe("estimateCacheSavings", () => {
  it("returns a value between 0 and 1", () => {
    const sections = buildCacheablePrompt("a very long system prompt", "tools");
    const ratio = estimateCacheSavings(sections);
    expect(ratio).toBeGreaterThanOrEqual(0);
    expect(ratio).toBeLessThanOrEqual(1);
  });

  it("returns 0 for empty sections array", () => {
    expect(estimateCacheSavings([])).toBe(0);
  });

  it("returns higher ratio when more content is cacheable", () => {
    const allCacheable = [
      { content: "a".repeat(200), cacheable: true },
      { content: "b".repeat(200), cacheable: true },
    ];
    const halfCacheable = [
      { content: "a".repeat(200), cacheable: true },
      { content: "b".repeat(200), cacheable: false },
    ];
    expect(estimateCacheSavings(allCacheable)).toBeGreaterThan(estimateCacheSavings(halfCacheable));
  });
});

// ─── CacheMetricsTracker ──────────────────────────────────────────────────────

describe("CacheMetricsTracker", () => {
  it("starts with zero request count", () => {
    const tracker = new CacheMetricsTracker();
    expect(tracker.summary().requestCount).toBe(0);
  });

  it("records requests and accumulates totals", () => {
    const tracker = new CacheMetricsTracker();
    tracker.record({ cacheReadTokens: 5000, cacheCreationTokens: 1000, uncachedInputTokens: 200, outputTokens: 300 });
    tracker.record({ cacheReadTokens: 3000, cacheCreationTokens: 0, uncachedInputTokens: 100, outputTokens: 150 });
    const s = tracker.summary();
    expect(s.requestCount).toBe(2);
    expect(s.totalCacheReadTokens).toBe(8000);
    expect(s.totalCacheCreationTokens).toBe(1000);
    expect(s.totalUncachedInputTokens).toBe(300);
  });

  it("computes non-zero estimatedSavingsUsd when cache read tokens present", () => {
    const tracker = new CacheMetricsTracker();
    tracker.record({ cacheReadTokens: 100_000, cacheCreationTokens: 0, uncachedInputTokens: 10_000, outputTokens: 5_000 });
    expect(tracker.summary().estimatedSavingsUsd).toBeGreaterThan(0);
  });

  it("cacheHitRate is 1.0 when all inputs are cache reads", () => {
    const tracker = new CacheMetricsTracker();
    tracker.record({ cacheReadTokens: 10_000, cacheCreationTokens: 0, uncachedInputTokens: 0, outputTokens: 500 });
    expect(tracker.summary().cacheHitRate).toBe(1);
  });

  it("isCacheWarm becomes true after threshold requests", () => {
    const tracker = new CacheMetricsTracker({ cacheWarmThreshold: 2 });
    tracker.record({ cacheReadTokens: 1000, cacheCreationTokens: 0, uncachedInputTokens: 0, outputTokens: 100 });
    expect(tracker.summary().isCacheWarm).toBe(false);
    tracker.record({ cacheReadTokens: 1000, cacheCreationTokens: 0, uncachedInputTokens: 0, outputTokens: 100 });
    expect(tracker.summary().isCacheWarm).toBe(true);
  });
});

// ─── globalCacheMetrics singleton ────────────────────────────────────────────

describe("globalCacheMetrics", () => {
  it("is a CacheMetricsTracker instance", () => {
    expect(globalCacheMetrics).toBeInstanceOf(CacheMetricsTracker);
  });

  it("record() does not throw", () => {
    expect(() =>
      globalCacheMetrics.record({
        cacheReadTokens: 100,
        cacheCreationTokens: 0,
        uncachedInputTokens: 50,
        outputTokens: 25,
      }),
    ).not.toThrow();
  });
});
