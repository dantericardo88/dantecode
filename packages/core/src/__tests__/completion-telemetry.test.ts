// ============================================================================
// packages/core/src/__tests__/completion-telemetry.test.ts
// 20 tests for CompletionTelemetryService + CompletionTelemetryStore.
// ============================================================================

import { describe, it, expect, vi, beforeEach } from "vitest";
import { CompletionTelemetryService } from "../completion-telemetry/telemetry-service.js";
import { CompletionTelemetryStore } from "../completion-telemetry/telemetry-store.js";
import type { CompletionEvent } from "../completion-telemetry/types.js";

// ── Helpers ────────────────────────────────────────────────────────────────────

function makeEvent(overrides: Partial<CompletionEvent> = {}): CompletionEvent {
  return {
    completionId: "cmp_aabbccdd1122",
    eventType: "view",
    language: "typescript",
    modelId: "grok/grok-3",
    elapsedMs: 150,
    completionLength: 42,
    timestamp: Date.now(),
    ...overrides,
  };
}

function makeService(): CompletionTelemetryService {
  const svc = new CompletionTelemetryService("/tmp/test-telemetry");
  // Suppress disk I/O in unit tests
  vi.spyOn(svc.store, "persist").mockResolvedValue(undefined);
  return svc;
}

// ── Tests ──────────────────────────────────────────────────────────────────────

describe("CompletionTelemetryService", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ── generateCompletionId ──────────────────────────────────────────────────

  it('generateCompletionId returns "cmp_" + 12 hex chars', () => {
    const svc = makeService();
    const id = svc.generateCompletionId();
    expect(id).toMatch(/^cmp_[0-9a-f]{12}$/);
  });

  it("generateCompletionId returns unique ids on successive calls", () => {
    const svc = makeService();
    const ids = new Set(Array.from({ length: 20 }, () => svc.generateCompletionId()));
    expect(ids.size).toBe(20);
  });

  // ── record + getStats ─────────────────────────────────────────────────────

  it('record("view") increments totalViewed', () => {
    const svc = makeService();
    svc.record(makeEvent({ eventType: "view" }));
    expect(svc.getStats().totalViewed).toBe(1);
  });

  it('record("select") increments totalAccepted', () => {
    const svc = makeService();
    svc.record(makeEvent({ eventType: "view" }));
    svc.record(makeEvent({ eventType: "select" }));
    expect(svc.getStats().totalAccepted).toBe(1);
  });

  it('record("dismiss") increments totalDismissed', () => {
    const svc = makeService();
    svc.record(makeEvent({ eventType: "dismiss" }));
    expect(svc.getStats().totalDismissed).toBe(1);
  });

  it('record("partial") increments totalPartial independently of select', () => {
    const svc = makeService();
    svc.record(makeEvent({ eventType: "view" }));
    svc.record(makeEvent({ eventType: "partial" }));
    expect(svc.getStats().totalPartial).toBe(1);
    expect(svc.getStats().totalAccepted).toBe(0);
  });

  it("acceptanceRate = accepted / viewed", () => {
    const svc = makeService();
    svc.record(makeEvent({ eventType: "view" }));
    svc.record(makeEvent({ eventType: "view" }));
    svc.record(makeEvent({ eventType: "select" }));
    expect(svc.getStats().acceptanceRate).toBeCloseTo(0.5, 2);
  });

  it("acceptanceRate is 0 when no views recorded", () => {
    const svc = makeService();
    svc.record(makeEvent({ eventType: "select" }));
    // select without a view pair → viewed=0, rate=0
    expect(svc.getStats().totalViewed).toBe(0);
    expect(svc.getStats().acceptanceRate).toBe(0);
  });

  it("avgElapsedMs computed from view events only", () => {
    const svc = makeService();
    svc.record(makeEvent({ eventType: "view", elapsedMs: 100 }));
    svc.record(makeEvent({ eventType: "view", elapsedMs: 200 }));
    svc.record(makeEvent({ eventType: "select", elapsedMs: 999 })); // should not count
    expect(svc.getStats().avgElapsedMs).toBe(150);
  });

  it("byLanguage groups correctly across multiple events", () => {
    const svc = makeService();
    svc.record(makeEvent({ eventType: "view", language: "typescript" }));
    svc.record(makeEvent({ eventType: "select", language: "typescript" }));
    svc.record(makeEvent({ eventType: "view", language: "python" }));
    const stats = svc.getStats();
    expect(stats.byLanguage["typescript"]?.viewed).toBe(1);
    expect(stats.byLanguage["typescript"]?.accepted).toBe(1);
    expect(stats.byLanguage["python"]?.viewed).toBe(1);
    expect(stats.byLanguage["python"]?.accepted).toBe(0);
  });

  it("byLanguage.typescript.rate rounds to 2 decimal places", () => {
    const svc = makeService();
    // 1 accepted out of 3 viewed = 0.33...
    for (let i = 0; i < 3; i++) svc.record(makeEvent({ eventType: "view", language: "typescript" }));
    svc.record(makeEvent({ eventType: "select", language: "typescript" }));
    const stats = svc.getStats();
    expect(stats.byLanguage["typescript"]?.rate).toBe(0.33);
  });

  it("byModel groups correctly", () => {
    const svc = makeService();
    svc.record(makeEvent({ eventType: "view", modelId: "grok/grok-3" }));
    svc.record(makeEvent({ eventType: "select", modelId: "grok/grok-3" }));
    svc.record(makeEvent({ eventType: "view", modelId: "ollama/qwen" }));
    const stats = svc.getStats();
    expect(stats.byModel["grok/grok-3"]?.viewed).toBe(1);
    expect(stats.byModel["grok/grok-3"]?.accepted).toBe(1);
    expect(stats.byModel["ollama/qwen"]?.viewed).toBe(1);
  });

  it("getStats(windowHours) filters events outside the window", () => {
    const svc = makeService();
    const oldTimestamp = Date.now() - 25 * 3_600_000; // 25 hours ago
    svc.record(makeEvent({ eventType: "view", timestamp: oldTimestamp }));
    svc.record(makeEvent({ eventType: "view" })); // recent
    // Default 24h window should only see the recent one
    expect(svc.getStats(24).totalViewed).toBe(1);
  });

  it("getStats(0) returns empty stats", () => {
    const svc = makeService();
    svc.record(makeEvent({ eventType: "view" }));
    const stats = svc.getStats(0);
    expect(stats.totalViewed).toBe(0);
    expect(stats.totalAccepted).toBe(0);
    expect(stats.acceptanceRate).toBe(0);
  });

  // ── ring buffer eviction ──────────────────────────────────────────────────

  it("ring buffer evicts oldest when > 5000 events", () => {
    const svc = makeService();
    const firstId = "cmp_first00000000";
    svc.record(makeEvent({ completionId: firstId, eventType: "view" }));
    // Push 5000 more to force eviction
    for (let i = 0; i < 5000; i++) {
      svc.record(makeEvent({ completionId: `cmp_${i.toString().padStart(12, "0")}`, eventType: "view" }));
    }
    const recent = svc.getRecentEvents(5000);
    const ids = recent.map((e) => e.completionId);
    expect(ids).not.toContain(firstId);
  });

  // ── getRecentEvents ───────────────────────────────────────────────────────

  it("getRecentEvents(n) returns last N in chronological order", () => {
    const svc = makeService();
    for (let i = 0; i < 5; i++) {
      svc.record(makeEvent({ completionId: `cmp_${i.toString().padStart(12, "0")}`, eventType: "view" }));
    }
    const recent = svc.getRecentEvents(3);
    expect(recent).toHaveLength(3);
    // Last 3 items — ids ending in 2, 3, 4
    expect(recent[0]?.completionId).toContain("000000000002");
    expect(recent[2]?.completionId).toContain("000000000004");
  });

  // ── clearStats ────────────────────────────────────────────────────────────

  it("clearStats empties the ring", () => {
    const svc = makeService();
    svc.record(makeEvent({ eventType: "view" }));
    svc.record(makeEvent({ eventType: "select" }));
    svc.clearStats();
    expect(svc.getStats().totalViewed).toBe(0);
    expect(svc.getRecentEvents(100)).toHaveLength(0);
  });

  // ── p50/p95 latency percentiles ──────────────────────────────────────────

  it("p50LatencyMs is 0 when no view events have firstChunkMs", () => {
    const svc = makeService();
    svc.record(makeEvent({ eventType: "view" })); // no firstChunkMs
    expect(svc.getStats().p50LatencyMs).toBe(0);
  });

  it("p50LatencyMs equals median of firstChunkMs values", () => {
    const svc = makeService();
    // Record 5 view events with firstChunkMs: 100, 200, 300, 400, 500
    for (const ms of [100, 200, 300, 400, 500]) {
      svc.record(makeEvent({ eventType: "view", firstChunkMs: ms }));
    }
    // Median of [100,200,300,400,500] = 300
    expect(svc.getStats().p50LatencyMs).toBe(300);
  });

  it("p95LatencyMs is the 95th-percentile of firstChunkMs values", () => {
    const svc = makeService();
    // 20 values: 10, 20, ..., 200
    for (let i = 1; i <= 20; i++) {
      svc.record(makeEvent({ eventType: "view", firstChunkMs: i * 10 }));
    }
    // p95 of 20 items: ceil(0.95 * 20) - 1 = 19 - 1 = 18 → sorted[18] = 190
    expect(svc.getStats().p95LatencyMs).toBe(190);
  });

  it("p50/p95 respect windowHours filter (old events excluded)", () => {
    const svc = makeService();
    const oldTimestamp = Date.now() - 25 * 3_600_000; // 25 hours ago
    // Old event with high firstChunkMs — should be excluded by 24h window
    svc.record(makeEvent({ eventType: "view", firstChunkMs: 9999, timestamp: oldTimestamp }));
    // Recent event with low firstChunkMs
    svc.record(makeEvent({ eventType: "view", firstChunkMs: 50 }));
    const stats = svc.getStats(24);
    expect(stats.p50LatencyMs).toBe(50);
    expect(stats.p95LatencyMs).toBe(50);
  });

  it("firstChunkMs stored and returned in getRecentEvents", () => {
    const svc = makeService();
    svc.record(makeEvent({ eventType: "view", firstChunkMs: 123 }));
    const events = svc.getRecentEvents(1);
    expect(events[0]?.firstChunkMs).toBe(123);
  });

  // ── store integration ─────────────────────────────────────────────────────

  it("record calls store.persist with the event", () => {
    const svc = makeService();
    const evt = makeEvent({ eventType: "view" });
    svc.record(evt);
    expect(svc.store.persist).toHaveBeenCalledWith(evt);
  });
});

// ── CompletionTelemetryStore ───────────────────────────────────────────────────

describe("CompletionTelemetryStore", () => {
  it("loadRecent returns events from mocked file", async () => {
    const fakeEvent = makeEvent({ eventType: "view" });
    const mockReadFile = vi.fn().mockResolvedValueOnce(JSON.stringify(fakeEvent) + "\n");
    const store = new CompletionTelemetryStore("/tmp/test-store", mockReadFile);

    const events = await store.loadRecent(1);
    expect(events).toHaveLength(1);
    expect(events[0]?.completionId).toBe(fakeEvent.completionId);
  });

  it("loadRecent skips missing files gracefully", async () => {
    const mockReadFile = vi.fn().mockRejectedValue(new Error("ENOENT"));
    const store = new CompletionTelemetryStore("/nonexistent/path", mockReadFile);

    const events = await store.loadRecent(3);
    expect(events).toHaveLength(0);
  });

  it("loadRecent skips malformed JSONL lines", async () => {
    const validEvent = makeEvent({ eventType: "dismiss" });
    const mockReadFile = vi
      .fn()
      .mockResolvedValueOnce(`not-json\n${JSON.stringify(validEvent)}\n{broken\n`);
    const store = new CompletionTelemetryStore("/tmp/test-store", mockReadFile);

    const events = await store.loadRecent(1);
    expect(events).toHaveLength(1);
    expect(events[0]?.eventType).toBe("dismiss");
  });
});
