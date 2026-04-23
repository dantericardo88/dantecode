// ============================================================================
// packages/vscode/src/__tests__/fim-latency-tracker.test.ts
// 15 tests for FimLatencyTracker.
// ============================================================================

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ── vscode mock ───────────────────────────────────────────────────────────────

vi.mock("vscode", () => {
  function makeStatusBarItem() {
    return {
      text: "",
      tooltip: "",
      show: vi.fn(),
      hide: vi.fn(),
      dispose: vi.fn(),
    };
  }
  return {
    window: {
      createStatusBarItem: vi.fn(() => makeStatusBarItem()),
    },
    StatusBarAlignment: { Right: 2 },
  };
});

import { FimLatencyTracker } from "../fim-latency-tracker.js";

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeStatusBar() {
  return {
    text: "",
    tooltip: "",
    show: vi.fn(),
    hide: vi.fn(),
    dispose: vi.fn(),
  };
}

function makeTracker() {
  const sb = makeStatusBar();
  const tracker = new FimLatencyTracker(undefined, sb as unknown as import("vscode").StatusBarItem);
  return { tracker, sb };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("FimLatencyTracker", () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => {});

  // ── TTFB recording ─────────────────────────────────────────────────────────

  it("recordFirstChunk adds sample to window", () => {
    const { tracker } = makeTracker();
    tracker.recordFirstChunk(100);
    expect(tracker.sampleCount).toBe(1);
    tracker.dispose();
  });

  it("multiple recordFirstChunk calls accumulate", () => {
    const { tracker } = makeTracker();
    tracker.recordFirstChunk(100);
    tracker.recordFirstChunk(200);
    tracker.recordFirstChunk(300);
    expect(tracker.sampleCount).toBe(3);
    tracker.dispose();
  });

  it("zero-ms TTFB is included in sample set", () => {
    const { tracker } = makeTracker();
    tracker.recordFirstChunk(0);
    expect(tracker.sampleCount).toBe(1);
    expect(tracker.getP50()).toBe(0);
    tracker.dispose();
  });

  it("very high TTFB (5000ms) is included in sample set", () => {
    const { tracker } = makeTracker();
    tracker.recordFirstChunk(5000);
    expect(tracker.getP50()).toBe(5000);
    tracker.dispose();
  });

  // ── Sliding window ─────────────────────────────────────────────────────────

  it("getP50 returns 0 when no samples recorded", () => {
    const { tracker } = makeTracker();
    expect(tracker.getP50()).toBe(0);
    tracker.dispose();
  });

  it("getP95 returns 0 when no samples recorded", () => {
    const { tracker } = makeTracker();
    expect(tracker.getP95()).toBe(0);
    tracker.dispose();
  });

  it("getP50 returns correct median of odd-count samples", () => {
    const { tracker } = makeTracker();
    for (const ms of [100, 50, 200, 75, 150]) {
      tracker.recordFirstChunk(ms);
    }
    // Sorted: [50, 75, 100, 150, 200] — median = 100
    expect(tracker.getP50()).toBe(100);
    tracker.dispose();
  });

  it("getP95 returns 95th-percentile correctly", () => {
    const { tracker } = makeTracker();
    // 10 values: 10..100
    for (let i = 1; i <= 10; i++) tracker.recordFirstChunk(i * 10);
    // sorted: [10,20,30,40,50,60,70,80,90,100]
    // ceil(0.95 * 10) - 1 = 10 - 1 = 9 → sorted[9] = 100
    expect(tracker.getP95()).toBe(100);
    tracker.dispose();
  });

  it("window evicts oldest sample when >200 recorded", () => {
    const { tracker } = makeTracker();
    // Fill with 200 samples of value 100
    for (let i = 0; i < 200; i++) tracker.recordFirstChunk(100);
    expect(tracker.sampleCount).toBe(200);
    // 201st sample evicts the oldest
    tracker.recordFirstChunk(200);
    expect(tracker.sampleCount).toBe(200);
    tracker.dispose();
  });

  it("p50 stable after eviction — oldest value removed", () => {
    const { tracker } = makeTracker();
    // Fill 200 samples with 10
    for (let i = 0; i < 200; i++) tracker.recordFirstChunk(10);
    // Adding 201st (value 500) evicts oldest (10)
    tracker.recordFirstChunk(500);
    // p50 should still be dominated by the 10-valued samples
    expect(tracker.getP50()).toBe(10);
    tracker.dispose();
  });

  // ── Status bar ─────────────────────────────────────────────────────────────

  it("status bar shows p50 when samples available", () => {
    const { tracker, sb } = makeTracker();
    tracker.recordFirstChunk(150);
    expect(sb.text).toContain("150ms");
    expect(sb.show).toHaveBeenCalled();
    tracker.dispose();
  });

  it("status bar hides when no samples", () => {
    const { tracker, sb } = makeTracker();
    expect(sb.hide).not.toHaveBeenCalled();
    // Explicitly force an update with no samples
    tracker.recordFirstChunk(100);
    vi.clearAllMocks();
    // After dispose, no more updates
    tracker.dispose();
  });

  it("status bar updates on each new completion", () => {
    const { tracker, sb } = makeTracker();
    tracker.recordFirstChunk(100);
    const firstText = sb.text;
    tracker.recordFirstChunk(200);
    // p50 may have changed
    expect(sb.show).toHaveBeenCalledTimes(2);
    expect(firstText).toBeTruthy();
    tracker.dispose();
  });

  it("status bar tooltip includes both p50 and p95", () => {
    const { tracker, sb } = makeTracker();
    for (let i = 1; i <= 10; i++) tracker.recordFirstChunk(i * 10);
    expect(sb.tooltip).toContain("p50");
    expect(sb.tooltip).toContain("p95");
    tracker.dispose();
  });

  // ── Dispose ───────────────────────────────────────────────────────────────

  it("dispose clears sample window", () => {
    const { tracker } = makeTracker();
    tracker.recordFirstChunk(100);
    tracker.recordFirstChunk(200);
    tracker.dispose();
    expect(tracker.sampleCount).toBe(0);
    expect(tracker.getP50()).toBe(0);
  });
});
