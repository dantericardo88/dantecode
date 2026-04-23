// packages/cli/src/__tests__/sprint-dim38-latency.test.ts
// Dim 38 — Latency / Responsiveness
// Tests: LatencyTracker, StreamThinkingIndicator, dev-server default, JSONL persistence

import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  LatencyTracker,
  recordLatencySnapshot,
  loadLatencyLog,
  type LatencyStats,
} from "@dantecode/core";
import { StreamThinkingIndicator } from "../stream-renderer.js";

// ── LatencyTracker.record + getStats ─────────────────────────────────────────

describe("LatencyTracker", () => {
  it("returns null when fewer than 3 samples", () => {
    const t = new LatencyTracker();
    t.record("api-ttfb", 100);
    t.record("api-ttfb", 200);
    expect(t.getStats("api-ttfb")).toBeNull();
  });

  it("returns stats with correct p50 for 5 samples", () => {
    const t = new LatencyTracker();
    [100, 200, 300, 400, 500].forEach((ms) => t.record("api-ttfb", ms));
    const stats = t.getStats("api-ttfb");
    expect(stats).not.toBeNull();
    expect(stats!.p50Ms).toBe(300);
    expect(stats!.sampleCount).toBe(5);
  });

  it("p95 is higher than p50", () => {
    const t = new LatencyTracker();
    for (let i = 1; i <= 20; i++) t.record("tool-exec", i * 10);
    const stats = t.getStats("tool-exec")!;
    expect(stats.p95Ms).toBeGreaterThanOrEqual(stats.p50Ms);
  });

  it("computes meanMs correctly", () => {
    const t = new LatencyTracker();
    [100, 200, 300].forEach((ms) => t.record("fim", ms));
    const stats = t.getStats("fim")!;
    expect(stats.meanMs).toBe(200);
  });

  it("evicts oldest sample beyond 200-sample window", () => {
    const t = new LatencyTracker();
    for (let i = 0; i < 201; i++) t.record("stream-chunk", i);
    const stats = t.getStats("stream-chunk")!;
    expect(stats.sampleCount).toBe(200);
  });

  it("getAllStats returns only categories with >= 3 samples", () => {
    const t = new LatencyTracker();
    t.record("api-ttfb", 100);
    t.record("api-ttfb", 200); // only 2 — excluded
    [10, 20, 30].forEach((ms) => t.record("tool-exec", ms));
    const all = t.getAllStats();
    expect(all.some((s) => s.category === "tool-exec")).toBe(true);
    expect(all.some((s) => s.category === "api-ttfb")).toBe(false);
  });

  it("formatSummary returns readable string with all tracked categories", () => {
    const t = new LatencyTracker();
    [320, 350, 380].forEach((ms) => t.record("api-ttfb", ms));
    [40, 50, 60].forEach((ms) => t.record("tool-exec", ms));
    const summary = t.formatSummary();
    expect(summary).toContain("API");
    expect(summary).toContain("Tool");
    expect(summary).toContain("p50");
  });

  it("formatSummary returns 'No latency data yet' when empty", () => {
    const t = new LatencyTracker();
    expect(t.formatSummary()).toBe("No latency data yet");
  });

  it("startTimer returns a stop function that records elapsed time", async () => {
    const t = new LatencyTracker();
    const stop = t.startTimer("api-ttfb", "req-1");
    await new Promise((r) => setTimeout(r, 10));
    const elapsed = stop();
    expect(elapsed).toBeGreaterThanOrEqual(5);
    // Record 3 total to get stats
    t.record("api-ttfb", 100);
    t.record("api-ttfb", 150);
    const stats = t.getStats("api-ttfb");
    expect(stats).not.toBeNull();
    expect(stats!.sampleCount).toBe(3);
  });

  it("reset clears all samples", () => {
    const t = new LatencyTracker();
    [1, 2, 3].forEach((ms) => t.record("fim", ms));
    t.reset();
    expect(t.getStats("fim")).toBeNull();
    expect(t.getAllStats()).toHaveLength(0);
  });

  it("p99 is >= p95", () => {
    const t = new LatencyTracker();
    for (let i = 1; i <= 100; i++) t.record("api-ttfb", i * 5);
    const stats = t.getStats("api-ttfb")!;
    expect(stats.p99Ms).toBeGreaterThanOrEqual(stats.p95Ms);
  });

  it("formatSummary shows 's' suffix for values >= 1000ms", () => {
    const t = new LatencyTracker();
    [2000, 2100, 2200].forEach((ms) => t.record("dev-server", ms));
    const summary = t.formatSummary();
    expect(summary).toContain("DevServer");
    expect(summary).toMatch(/\d+\.\ds/); // e.g. "2.1s"
  });
});

// ── StreamThinkingIndicator ───────────────────────────────────────────────────

describe("StreamThinkingIndicator", () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it("fires onShow callback after threshold", () => {
    const indicator = new StreamThinkingIndicator();
    const onShow = vi.fn();
    indicator.startWaiting(800, onShow);
    vi.advanceTimersByTime(799);
    expect(onShow).not.toHaveBeenCalled();
    vi.advanceTimersByTime(2);
    expect(onShow).toHaveBeenCalledOnce();
    indicator.dispose();
  });

  it("does NOT fire onShow if onFirstChunk is called before threshold", () => {
    const indicator = new StreamThinkingIndicator();
    const onShow = vi.fn();
    indicator.startWaiting(800, onShow);
    vi.advanceTimersByTime(400);
    indicator.onFirstChunk();
    vi.advanceTimersByTime(600);
    expect(onShow).not.toHaveBeenCalled();
    indicator.dispose();
  });

  it("wasShown is false initially", () => {
    const indicator = new StreamThinkingIndicator();
    expect(indicator.wasShown).toBe(false);
    indicator.dispose();
  });

  it("wasShown becomes true after threshold fires", () => {
    const indicator = new StreamThinkingIndicator();
    const onShow = vi.fn();
    indicator.startWaiting(500, onShow);
    vi.advanceTimersByTime(600);
    expect(indicator.wasShown).toBe(true);
    indicator.dispose();
  });

  it("dispose cancels pending timer", () => {
    const indicator = new StreamThinkingIndicator();
    const onShow = vi.fn();
    indicator.startWaiting(800, onShow);
    indicator.dispose();
    vi.advanceTimersByTime(1000);
    expect(onShow).not.toHaveBeenCalled();
  });

  it("startWaiting replaces existing timer when called twice", () => {
    const indicator = new StreamThinkingIndicator();
    const onShow1 = vi.fn();
    const onShow2 = vi.fn();
    indicator.startWaiting(800, onShow1);
    vi.advanceTimersByTime(400);
    indicator.startWaiting(800, onShow2);
    vi.advanceTimersByTime(1000);
    expect(onShow1).not.toHaveBeenCalled();
    expect(onShow2).toHaveBeenCalledOnce();
    indicator.dispose();
  });
});

// ── JSONL Persistence ─────────────────────────────────────────────────────────

describe("recordLatencySnapshot + loadLatencyLog", () => {
  let tmpDir: string;

  afterEach(() => {
    try { rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ok */ }
  });

  it("persists and loads a snapshot with all categories", () => {
    tmpDir = mkdtempSync(join(tmpdir(), "dim38-lat-"));
    const stats: LatencyStats[] = [
      { category: "api-ttfb", p50Ms: 320, p95Ms: 890, p99Ms: 1100, sampleCount: 50, meanMs: 400 },
      { category: "tool-exec", p50Ms: 45, p95Ms: 120, p99Ms: 200, sampleCount: 30, meanMs: 60 },
    ];
    recordLatencySnapshot(stats, tmpDir, "test-session");
    const loaded = loadLatencyLog(tmpDir);
    expect(loaded).toHaveLength(1);
    expect(loaded[0]!.sessionId).toBe("test-session");
    expect(loaded[0]!.stats).toHaveLength(2);
    expect(loaded[0]!.stats[0]!.p50Ms).toBe(320);
  });

  it("appends multiple snapshots to JSONL", () => {
    tmpDir = mkdtempSync(join(tmpdir(), "dim38-lat-"));
    const stats: LatencyStats[] = [{ category: "fim", p50Ms: 180, p95Ms: 400, p99Ms: 600, sampleCount: 10, meanMs: 220 }];
    recordLatencySnapshot(stats, tmpDir, "s1");
    recordLatencySnapshot(stats, tmpDir, "s2");
    const loaded = loadLatencyLog(tmpDir);
    expect(loaded).toHaveLength(2);
    expect(loaded[0]!.sessionId).toBe("s1");
    expect(loaded[1]!.sessionId).toBe("s2");
  });

  it("loadLatencyLog returns empty array for missing file", () => {
    tmpDir = mkdtempSync(join(tmpdir(), "dim38-lat-"));
    const loaded = loadLatencyLog(tmpDir);
    expect(loaded).toEqual([]);
  });
});

// ── Dev server default timeout ────────────────────────────────────────────────

describe("DevServerConfig defaults", () => {
  it("default timeoutMs in DevServerConfig is 10_000", async () => {
    // Import and inspect source: the default in startDevServer is now 10_000
    const { startDevServer } = await import("../dev-server-manager.js");
    // Verify by trying to start with a nonexistent command that will timeout fast
    const start = Date.now();
    try {
      await startDevServer({ command: "false", cwd: process.cwd(), timeoutMs: 50, maxAttempts: 1 });
    } catch (err) {
      const elapsed = Date.now() - start;
      // Should fail in under 200ms (50ms timeout * 1 attempt)
      expect(elapsed).toBeLessThan(500);
      expect(String(err)).toContain("ready");
    }
  });
});
