// ============================================================================
// Sprint Memory — Dim 21: memory influence joined to task outcomes
// ============================================================================

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  joinMemoryToOutcomes,
  computeMemoryOutcomeCorrelation,
  recordMemoryCorrelation,
  loadMemoryOutcomeCorrelation,
  detectStaleMemoryFacts,
} from "@dantecode/core";
import { getMemoryInfluenceStats, loadMemoryDecisionLog } from "@dantecode/core";

let tmpDir: string;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "mem-outcome-test-"));
  mkdirSync(join(tmpDir, ".danteforge"), { recursive: true });
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

// ── Helpers ───────────────────────────────────────────────────────────────────

function seedMemDecision(entries: Array<{ sessionId: string; influenceRate: number }>) {
  const lines = entries.map((e) =>
    JSON.stringify({
      sessionId: e.sessionId,
      injectedFactCount: 4,
      influencedFactCount: Math.round(e.influenceRate * 4),
      influenceRate: e.influenceRate,
      influencedSnippets: [],
      timestamp: new Date().toISOString(),
    }),
  );
  writeFileSync(join(tmpDir, ".danteforge", "memory-decision-log.json"), lines.join("\n") + "\n");
}

function seedCompletionLog(entries: Array<{ sessionId: string; verdict: string; toolCallCount: number }>) {
  const lines = entries.map((e) =>
    JSON.stringify({
      sessionId: e.sessionId,
      prompt: "test prompt",
      verdict: e.verdict,
      reason: "test",
      toolCallCount: e.toolCallCount,
      timestamp: new Date().toISOString(),
    }),
  );
  writeFileSync(join(tmpDir, ".danteforge", "task-completion-log.jsonl"), lines.join("\n") + "\n");
}

// ── joinMemoryToOutcomes ──────────────────────────────────────────────────────

describe("joinMemoryToOutcomes", () => {
  it("returns joined rows where sessionId is present in both logs", () => {
    seedMemDecision([
      { sessionId: "s1", influenceRate: 0.8 },
      { sessionId: "s2", influenceRate: 0.2 },
    ]);
    seedCompletionLog([
      { sessionId: "s1", verdict: "COMPLETED", toolCallCount: 5 },
      { sessionId: "s3", verdict: "COMPLETED", toolCallCount: 3 }, // not in memory log
    ]);

    const joined = joinMemoryToOutcomes(tmpDir);
    expect(joined).toHaveLength(1);
    expect(joined[0]!.sessionId).toBe("s1");
    expect(joined[0]!.influenceRate).toBe(0.8);
    expect(joined[0]!.verdict).toBe("COMPLETED");
  });

  it("returns empty array when either log is missing", () => {
    const joined = joinMemoryToOutcomes(tmpDir);
    expect(joined).toEqual([]);
  });

  it("joins all overlapping sessions correctly", () => {
    seedMemDecision([
      { sessionId: "a", influenceRate: 0.9 },
      { sessionId: "b", influenceRate: 0.1 },
      { sessionId: "c", influenceRate: 0.6 },
    ]);
    seedCompletionLog([
      { sessionId: "a", verdict: "COMPLETED", toolCallCount: 6 },
      { sessionId: "b", verdict: "FAILED", toolCallCount: 2 },
      { sessionId: "c", verdict: "ATTEMPTED", toolCallCount: 8 },
    ]);
    const joined = joinMemoryToOutcomes(tmpDir);
    expect(joined).toHaveLength(3);
    expect(joined.find((j) => j.sessionId === "b")!.verdict).toBe("FAILED");
  });
});

// ── computeMemoryOutcomeCorrelation ──────────────────────────────────────────

describe("computeMemoryOutcomeCorrelation", () => {
  it("returns correct highInfluenceCompletionRate from seeded joined data", () => {
    const joined = [
      { sessionId: "h1", influenceRate: 0.8, verdict: "COMPLETED" as const, toolCallCount: 5 },
      { sessionId: "h2", influenceRate: 0.7, verdict: "COMPLETED" as const, toolCallCount: 6 },
      { sessionId: "h3", influenceRate: 0.9, verdict: "ATTEMPTED" as const, toolCallCount: 7 },
      { sessionId: "l1", influenceRate: 0.1, verdict: "FAILED" as const, toolCallCount: 2 },
      { sessionId: "l2", influenceRate: 0.2, verdict: "COMPLETED" as const, toolCallCount: 3 },
    ];
    const result = computeMemoryOutcomeCorrelation(joined);
    // high (>0.5): h1, h2, h3 — 2/3 completed
    expect(result.highInfluenceCompletionRate).toBeCloseTo(2 / 3, 2);
    // low (<0.3): l1, l2 — 1/2 completed
    expect(result.lowInfluenceCompletionRate).toBe(0.5);
  });

  it("returns isSignificant=true when delta > 0.15", () => {
    const joined = [
      { sessionId: "h1", influenceRate: 0.8, verdict: "COMPLETED" as const, toolCallCount: 5 },
      { sessionId: "h2", influenceRate: 0.9, verdict: "COMPLETED" as const, toolCallCount: 6 },
      { sessionId: "l1", influenceRate: 0.1, verdict: "FAILED" as const, toolCallCount: 2 },
      { sessionId: "l2", influenceRate: 0.2, verdict: "FAILED" as const, toolCallCount: 3 },
    ];
    const result = computeMemoryOutcomeCorrelation(joined);
    // high: 2/2 = 1.0, low: 0/2 = 0.0, delta = 1.0
    expect(result.delta).toBeGreaterThan(0.15);
    expect(result.isSignificant).toBe(true);
  });

  it("returns isSignificant=false when delta <= 0.15", () => {
    const joined = [
      { sessionId: "h1", influenceRate: 0.8, verdict: "COMPLETED" as const, toolCallCount: 5 },
      { sessionId: "l1", influenceRate: 0.1, verdict: "COMPLETED" as const, toolCallCount: 3 },
    ];
    const result = computeMemoryOutcomeCorrelation(joined);
    // both 1.0 completion, delta = 0
    expect(result.delta).toBe(0);
    expect(result.isSignificant).toBe(false);
  });

  it("handles empty joined array gracefully", () => {
    const result = computeMemoryOutcomeCorrelation([]);
    expect(result.highInfluenceSessionCount).toBe(0);
    expect(result.lowInfluenceSessionCount).toBe(0);
    expect(result.highInfluenceCompletionRate).toBe(0);
    expect(result.isSignificant).toBe(false);
  });

  it("handles missing low-influence bucket (no low sessions)", () => {
    const joined = [
      { sessionId: "h1", influenceRate: 0.8, verdict: "COMPLETED" as const, toolCallCount: 5 },
    ];
    const result = computeMemoryOutcomeCorrelation(joined);
    expect(result.lowInfluenceSessionCount).toBe(0);
    expect(result.lowInfluenceCompletionRate).toBe(0);
  });
});

// ── recordMemoryCorrelation / loadMemoryOutcomeCorrelation ────────────────────

describe("recordMemoryCorrelation + loadMemoryOutcomeCorrelation", () => {
  it("writes .danteforge/memory-outcome-correlation.json", () => {
    const result = computeMemoryOutcomeCorrelation([
      { sessionId: "x", influenceRate: 0.9, verdict: "COMPLETED", toolCallCount: 5 },
      { sessionId: "y", influenceRate: 0.1, verdict: "FAILED", toolCallCount: 2 },
    ]);
    recordMemoryCorrelation(result, tmpDir);
    expect(existsSync(join(tmpDir, ".danteforge", "memory-outcome-correlation.json"))).toBe(true);
  });

  it("reads back the written correlation result", () => {
    const result = computeMemoryOutcomeCorrelation([
      { sessionId: "x", influenceRate: 0.9, verdict: "COMPLETED", toolCallCount: 5 },
      { sessionId: "y", influenceRate: 0.1, verdict: "FAILED", toolCallCount: 2 },
    ]);
    recordMemoryCorrelation(result, tmpDir);
    const loaded = loadMemoryOutcomeCorrelation(tmpDir);
    expect(loaded).not.toBeNull();
    expect(loaded!.isSignificant).toBe(result.isSignificant);
    expect(loaded!.delta).toBe(result.delta);
  });

  it("returns null when no correlation file exists", () => {
    expect(loadMemoryOutcomeCorrelation(tmpDir)).toBeNull();
  });
});

// ── detectStaleMemoryFacts ────────────────────────────────────────────────────

describe("detectStaleMemoryFacts", () => {
  it("returns staleFacts=0 when all sources are fresh files", () => {
    // Write a fresh file
    writeFileSync(join(tmpDir, "fresh.ts"), "export const x = 1;");
    const facts = [{ key: "k1", text: "some text", source: join(tmpDir, "fresh.ts") }];
    const report = detectStaleMemoryFacts(facts, tmpDir, 7);
    expect(report.staleFacts).toBe(0);
    expect(report.staleKeys).toHaveLength(0);
  });

  it("returns staleFacts=1 when source file does not exist", () => {
    const facts = [
      { key: "k1", text: "some text", source: join(tmpDir, "nonexistent.ts") },
    ];
    const report = detectStaleMemoryFacts(facts, tmpDir, 7);
    expect(report.staleFacts).toBe(1);
    expect(report.staleKeys).toContain("k1");
  });

  it("counts multiple missing files correctly", () => {
    const facts = [
      { key: "k1", text: "text1", source: join(tmpDir, "a.ts") },
      { key: "k2", text: "text2", source: join(tmpDir, "b.ts") },
      { key: "k3", text: "text3", source: "lesson" }, // non-file source, skip
    ];
    const report = detectStaleMemoryFacts(facts, tmpDir, 7);
    expect(report.staleFacts).toBe(2);
  });

  it("returns an ISO checkedAt timestamp", () => {
    const report = detectStaleMemoryFacts([], tmpDir);
    expect(() => new Date(report.checkedAt)).not.toThrow();
  });
});

// ── getMemoryInfluenceStats (existing context-coverage-tracker) ───────────────

describe("getMemoryInfluenceStats", () => {
  it("returns correct avgInfluenceRate from seeded log", () => {
    seedMemDecision([
      { sessionId: "s1", influenceRate: 0.8 },
      { sessionId: "s2", influenceRate: 0.4 },
      { sessionId: "s3", influenceRate: 0.0 },
    ]);
    const entries = loadMemoryDecisionLog(tmpDir);
    expect(entries).toHaveLength(3);
    const stats = getMemoryInfluenceStats(entries);
    // avg = (0.8 + 0.4 + 0.0) / 3 = 0.4
    expect(stats.avgInfluenceRate).toBeCloseTo(0.4, 2);
  });

  it("returns sessionsWithInfluence count correctly", () => {
    seedMemDecision([
      { sessionId: "s1", influenceRate: 0.8 },
      { sessionId: "s2", influenceRate: 0.0 },
      { sessionId: "s3", influenceRate: 0.5 },
    ]);
    const entries = loadMemoryDecisionLog(tmpDir);
    const stats = getMemoryInfluenceStats(entries);
    // sessions with influenceRate > 0: s1 and s3
    expect(stats.sessionsWithInfluence).toBe(2);
  });
});
