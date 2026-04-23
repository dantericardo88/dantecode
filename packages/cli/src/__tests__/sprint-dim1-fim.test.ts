// ============================================================================
// Sprint Dim 1: FIM latency histogram + stale suppressor + cancellation rate
// ============================================================================

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, mkdirSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  recordFimLatency,
  loadFimLatencyLog,
  buildFimLatencyHistogram,
  getFimLatencyStats,
  trackSuggestionShown,
  shouldSuppressSuggestion,
  resetSuggestionShown,
  clearSuggestionSuppressCache,
  recordFimCancellation,
  getFimCancellationRate,
  loadFimAcceptanceHistory,
  recordFimAcceptance,
} from "@dantecode/core";

let tmpDir: string;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "dim1-fim-test-"));
  mkdirSync(join(tmpDir, ".danteforge"), { recursive: true });
  clearSuggestionSuppressCache(); // reset in-memory state between tests
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
  clearSuggestionSuppressCache();
});

// ── FIM latency histogram ─────────────────────────────────────────────────────

describe("buildFimLatencyHistogram", () => {
  it("returns correct p50 from sorted entries", () => {
    const entries = [
      { latencyMs: 50, language: "ts", accepted: true, timestamp: "" },
      { latencyMs: 100, language: "ts", accepted: true, timestamp: "" },
      { latencyMs: 200, language: "ts", accepted: false, timestamp: "" },
      { latencyMs: 400, language: "ts", accepted: false, timestamp: "" },
      { latencyMs: 800, language: "ts", accepted: false, timestamp: "" },
    ];
    const hist = buildFimLatencyHistogram(entries);
    // sorted: [50, 100, 200, 400, 800] → p50 = index ceil(50/100*5)-1 = 2 → 200
    expect(hist.p50).toBe(200);
    expect(hist.totalSamples).toBe(5);
  });

  it("buckets entries into sub100/sub300/sub1000/over1000 correctly", () => {
    const entries = [
      { latencyMs: 50, language: "ts", accepted: true, timestamp: "" },    // sub100
      { latencyMs: 150, language: "ts", accepted: true, timestamp: "" },   // sub300
      { latencyMs: 250, language: "ts", accepted: false, timestamp: "" },  // sub300
      { latencyMs: 600, language: "ts", accepted: false, timestamp: "" },  // sub1000
      { latencyMs: 1500, language: "ts", accepted: false, timestamp: "" }, // over1000
    ];
    const hist = buildFimLatencyHistogram(entries);
    expect(hist.buckets.sub100).toBe(1);
    expect(hist.buckets.sub300).toBe(2);
    expect(hist.buckets.sub1000).toBe(1);
    expect(hist.buckets.over1000).toBe(1);
  });

  it("returns all zeros for empty entries", () => {
    const hist = buildFimLatencyHistogram([]);
    expect(hist.p50).toBe(0);
    expect(hist.p90).toBe(0);
    expect(hist.totalSamples).toBe(0);
  });

  it("p90 is higher than p50 for spread data", () => {
    const entries = Array.from({ length: 10 }, (_, i) => ({
      latencyMs: (i + 1) * 100,
      language: "ts",
      accepted: true,
      timestamp: "",
    }));
    const hist = buildFimLatencyHistogram(entries);
    expect(hist.p90).toBeGreaterThan(hist.p50);
  });
});

describe("recordFimLatency + loadFimLatencyLog", () => {
  it("appends to fim-latency-log.jsonl", () => {
    recordFimLatency(120, "typescript", true, tmpDir);
    expect(existsSync(join(tmpDir, ".danteforge", "fim-latency-log.jsonl"))).toBe(true);
  });

  it("reads back entries from the log", () => {
    recordFimLatency(80, "python", false, tmpDir);
    recordFimLatency(250, "rust", true, tmpDir);
    const entries = loadFimLatencyLog(tmpDir);
    expect(entries).toHaveLength(2);
    expect(entries[0]!.latencyMs).toBe(80);
    expect(entries[1]!.language).toBe("rust");
  });

  it("returns empty array when log does not exist", () => {
    expect(loadFimLatencyLog(tmpDir)).toEqual([]);
  });
});

describe("getFimLatencyStats", () => {
  it("returns histogram built from the seeded log", () => {
    recordFimLatency(60, "ts", true, tmpDir);
    recordFimLatency(150, "ts", false, tmpDir);
    recordFimLatency(1100, "ts", false, tmpDir);
    const hist = getFimLatencyStats(tmpDir);
    expect(hist.totalSamples).toBe(3);
    expect(hist.buckets.sub100).toBe(1);
    expect(hist.buckets.over1000).toBe(1);
  });
});

// ── Stale suggestion suppressor ───────────────────────────────────────────────

describe("trackSuggestionShown + shouldSuppressSuggestion", () => {
  it("returns false initially (suggestion not yet shown)", () => {
    expect(shouldSuppressSuggestion("function foo() {}", "typescript")).toBe(false);
  });

  it("returns false after 1 and 2 shows", () => {
    trackSuggestionShown("function foo() {}", "typescript");
    expect(shouldSuppressSuggestion("function foo() {}", "typescript")).toBe(false);
    trackSuggestionShown("function foo() {}", "typescript");
    expect(shouldSuppressSuggestion("function foo() {}", "typescript")).toBe(false);
  });

  it("returns true after 3 shows (default maxShown)", () => {
    for (let i = 0; i < 3; i++) trackSuggestionShown("function foo() {}", "typescript");
    expect(shouldSuppressSuggestion("function foo() {}", "typescript")).toBe(true);
  });

  it("respects custom maxShown parameter", () => {
    trackSuggestionShown("const x = 1;", "typescript");
    expect(shouldSuppressSuggestion("const x = 1;", "typescript", 1)).toBe(true);
    expect(shouldSuppressSuggestion("const x = 1;", "typescript", 5)).toBe(false);
  });

  it("tracks different languages independently", () => {
    for (let i = 0; i < 3; i++) trackSuggestionShown("def foo():", "python");
    expect(shouldSuppressSuggestion("def foo():", "python")).toBe(true);
    expect(shouldSuppressSuggestion("def foo():", "typescript")).toBe(false);
  });
});

describe("resetSuggestionShown", () => {
  it("resets counter so same suggestion is not suppressed after reset", () => {
    for (let i = 0; i < 3; i++) trackSuggestionShown("return true;", "typescript");
    expect(shouldSuppressSuggestion("return true;", "typescript")).toBe(true);
    resetSuggestionShown("return true;", "typescript");
    expect(shouldSuppressSuggestion("return true;", "typescript")).toBe(false);
  });
});

describe("clearSuggestionSuppressCache", () => {
  it("wipes all counters", () => {
    for (let i = 0; i < 3; i++) {
      trackSuggestionShown("suggestion A", "typescript");
      trackSuggestionShown("suggestion B", "python");
    }
    expect(shouldSuppressSuggestion("suggestion A", "typescript")).toBe(true);
    clearSuggestionSuppressCache();
    expect(shouldSuppressSuggestion("suggestion A", "typescript")).toBe(false);
    expect(shouldSuppressSuggestion("suggestion B", "python")).toBe(false);
  });
});

// ── Cancellation rate tracking ────────────────────────────────────────────────

describe("recordFimCancellation + getFimCancellationRate", () => {
  it("creates a new entry when language not yet in history", () => {
    recordFimCancellation("typescript", tmpDir);
    const history = loadFimAcceptanceHistory(tmpDir);
    const entry = history.find((h) => h.language === "typescript");
    expect(entry).toBeDefined();
    expect(entry!.cancellationCount).toBe(1);
  });

  it("increments cancellationCount on subsequent calls", () => {
    recordFimCancellation("python", tmpDir);
    recordFimCancellation("python", tmpDir);
    recordFimCancellation("python", tmpDir);
    const history = loadFimAcceptanceHistory(tmpDir);
    const entry = history.find((h) => h.language === "python");
    expect(entry!.cancellationCount).toBe(3);
  });

  it("returns correct cancellation rate", () => {
    // 2 cancellations, 0 totalSessions → rate = 2/(0+2) = 1.0
    recordFimCancellation("rust", tmpDir);
    recordFimCancellation("rust", tmpDir);
    const rate = getFimCancellationRate("rust", tmpDir);
    expect(rate).toBe(1.0);
  });

  it("accounts for totalSessions in cancellation rate denominator", () => {
    // simulate 2 sessions + 1 cancellation via recordFimAcceptance + recordFimCancellation
    recordFimAcceptance("typescript", true, {}, tmpDir);
    recordFimAcceptance("typescript", true, {}, tmpDir);
    recordFimCancellation("typescript", tmpDir);
    // total = 2 sessions + 1 cancel = 3; cancellationRate = 1/3 ≈ 0.333
    const rate = getFimCancellationRate("typescript", tmpDir);
    expect(rate).toBeCloseTo(1 / 3, 2);
  });

  it("returns 0 when language has no history", () => {
    expect(getFimCancellationRate("haskell", tmpDir)).toBe(0);
  });
});
