// packages/core/src/__tests__/cache-metrics.test.ts
import { describe, it, expect } from "vitest";
import {
  CacheMetricsTracker,
  estimateCachingSavings,
  isCacheLikelyValid,
  globalCacheMetrics,
} from "../cache-metrics.js";

// ─── CacheMetricsTracker — basic recording ────────────────────────────────────

describe("CacheMetricsTracker — record and summary", () => {
  it("returns zero summary when no records", () => {
    const tracker = new CacheMetricsTracker();
    const s = tracker.summary();
    expect(s.requestCount).toBe(0);
    expect(s.cacheHitRate).toBe(0);
    expect(s.estimatedSavingsUsd).toBe(0);
    expect(s.isCacheWarm).toBe(false);
  });

  it("records a single request", () => {
    const tracker = new CacheMetricsTracker();
    tracker.record({ cacheReadTokens: 5000, cacheCreationTokens: 1000, uncachedInputTokens: 200, outputTokens: 300 });
    expect(tracker.requestCount).toBe(1);
  });

  it("computes cache hit rate correctly", () => {
    const tracker = new CacheMetricsTracker();
    tracker.record({ cacheReadTokens: 8000, cacheCreationTokens: 1000, uncachedInputTokens: 2000, outputTokens: 100 });
    const s = tracker.summary();
    // hitRate = 8000 / (8000 + 2000) = 0.8
    expect(s.cacheHitRate).toBeCloseTo(0.8, 2);
  });

  it("computes estimated savings USD", () => {
    const tracker = new CacheMetricsTracker({
      costModel: { inputCostPerMTok: 3.0, cacheReadCostPerMTok: 0.3, cacheWriteCostPerMTok: 3.75 }
    });
    tracker.record({ cacheReadTokens: 1_000_000, cacheCreationTokens: 0, uncachedInputTokens: 0, outputTokens: 0 });
    const s = tracker.summary();
    // savings = (1M/1M * 3.0) - (1M/1M * 0.3) = 3.0 - 0.3 = 2.7
    expect(s.estimatedSavingsUsd).toBeCloseTo(2.7, 4);
  });

  it("accumulates across multiple records", () => {
    const tracker = new CacheMetricsTracker();
    tracker.record({ cacheReadTokens: 1000, cacheCreationTokens: 0, uncachedInputTokens: 0, outputTokens: 0 });
    tracker.record({ cacheReadTokens: 2000, cacheCreationTokens: 0, uncachedInputTokens: 0, outputTokens: 0 });
    expect(tracker.summary().totalCacheReadTokens).toBe(3000);
    expect(tracker.summary().requestCount).toBe(2);
  });

  it("isCacheWarm is false below warmThreshold", () => {
    const tracker = new CacheMetricsTracker({ cacheWarmThreshold: 5 });
    for (let i = 0; i < 3; i++) {
      tracker.record({ cacheReadTokens: 1000, cacheCreationTokens: 0, uncachedInputTokens: 0, outputTokens: 0 });
    }
    expect(tracker.summary().isCacheWarm).toBe(false);
  });

  it("isCacheWarm is true at or above warmThreshold with hits", () => {
    const tracker = new CacheMetricsTracker({ cacheWarmThreshold: 3 });
    for (let i = 0; i < 3; i++) {
      tracker.record({ cacheReadTokens: 1000, cacheCreationTokens: 100, uncachedInputTokens: 100, outputTokens: 50 });
    }
    expect(tracker.summary().isCacheWarm).toBe(true);
  });

  it("estimatedSavingsUsd is 0 when there are no cache reads", () => {
    const tracker = new CacheMetricsTracker();
    tracker.record({ cacheReadTokens: 0, cacheCreationTokens: 1000, uncachedInputTokens: 5000, outputTokens: 200 });
    expect(tracker.summary().estimatedSavingsUsd).toBe(0);
  });
});

// ─── CacheMetricsTracker — format methods ────────────────────────────────────

describe("CacheMetricsTracker — formatStatusLine and formatDetailBlock", () => {
  it("formatStatusLine returns no-data string when empty", () => {
    const tracker = new CacheMetricsTracker();
    expect(tracker.formatStatusLine()).toContain("no data");
  });

  it("formatStatusLine includes hit rate and savings", () => {
    const tracker = new CacheMetricsTracker();
    tracker.record({ cacheReadTokens: 5000, cacheCreationTokens: 0, uncachedInputTokens: 5000, outputTokens: 0 });
    const line = tracker.formatStatusLine();
    expect(line).toContain("50%");  // 50% hit rate
    expect(line).toContain("saved");
  });

  it("formatDetailBlock contains all key sections", () => {
    const tracker = new CacheMetricsTracker();
    tracker.record({ cacheReadTokens: 1000, cacheCreationTokens: 100, uncachedInputTokens: 500, outputTokens: 200 });
    const block = tracker.formatDetailBlock();
    expect(block).toContain("Cache Metrics");
    expect(block).toContain("hit rate");
    expect(block).toContain("savings");
    expect(block).toContain("Requests:");
  });

  it("formatDetailBlock shows No data when empty", () => {
    const tracker = new CacheMetricsTracker();
    expect(tracker.formatDetailBlock()).toContain("No data");
  });
});

// ─── CacheMetricsTracker — getRecentRecords ───────────────────────────────────

describe("CacheMetricsTracker — getRecentRecords", () => {
  it("returns last N records", () => {
    const tracker = new CacheMetricsTracker();
    for (let i = 0; i < 5; i++) {
      tracker.record({ cacheReadTokens: i * 100, cacheCreationTokens: 0, uncachedInputTokens: 0, outputTokens: 0 });
    }
    const recent = tracker.getRecentRecords(3);
    expect(recent).toHaveLength(3);
    expect(recent[2]!.cacheReadTokens).toBe(400);  // last record
  });
});

// ─── CacheMetricsTracker — reset ─────────────────────────────────────────────

describe("CacheMetricsTracker — reset", () => {
  it("clears all records", () => {
    const tracker = new CacheMetricsTracker();
    tracker.record({ cacheReadTokens: 1000, cacheCreationTokens: 0, uncachedInputTokens: 0, outputTokens: 0 });
    tracker.reset();
    expect(tracker.requestCount).toBe(0);
    expect(tracker.summary().requestCount).toBe(0);
  });
});

// ─── estimateCachingSavings ───────────────────────────────────────────────────

describe("estimateCachingSavings", () => {
  it("returns 0 savings for 1-request session (payback not reached)", () => {
    const result = estimateCachingSavings(10_000, 1);
    expect(result.savingsUsd).toBe(0);
  });

  it("returns positive savings for multi-request session", () => {
    const result = estimateCachingSavings(100_000, 20);
    expect(result.savingsUsd).toBeGreaterThan(0);
  });

  it("paybackRequests is at least 1", () => {
    const result = estimateCachingSavings(100_000, 20);
    expect(result.paybackRequests).toBeGreaterThanOrEqual(1);
  });

  it("larger stable tokens = higher savings", () => {
    const small = estimateCachingSavings(10_000, 20);
    const large = estimateCachingSavings(100_000, 20);
    expect(large.savingsUsd).toBeGreaterThan(small.savingsUsd);
  });
});

// ─── isCacheLikelyValid ───────────────────────────────────────────────────────

describe("isCacheLikelyValid", () => {
  it("returns true for recent cache writes", () => {
    const recent = new Date(Date.now() - 60_000);  // 1 min ago
    expect(isCacheLikelyValid(recent, 300)).toBe(true);
  });

  it("returns false for old cache writes beyond TTL", () => {
    const old = new Date(Date.now() - 600_000);  // 10 min ago
    expect(isCacheLikelyValid(old, 300)).toBe(false);
  });

  it("returns false for exactly TTL boundary", () => {
    const atBoundary = new Date(Date.now() - 300_001);
    expect(isCacheLikelyValid(atBoundary, 300)).toBe(false);
  });
});

// ─── globalCacheMetrics ───────────────────────────────────────────────────────

describe("globalCacheMetrics", () => {
  it("is an instance of CacheMetricsTracker", () => {
    expect(globalCacheMetrics).toBeInstanceOf(CacheMetricsTracker);
  });
});
