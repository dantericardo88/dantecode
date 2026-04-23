// packages/cli/src/__tests__/sprint-bw-bx-context-edit.test.ts
// Sprint BW-BX: RepoContextRanker (dim 4) + InlineEditQualityReport (dim 6)

import { describe, it, expect } from "vitest";
import * as path from "node:path";
import * as os from "node:os";

// ─── fs mock for isolation ─────────────────────────────────────────────────────
// We use real fs in a temp dir — no mock needed.
// Just import directly from source.

import {
  scoreChunkRelevance,
  rankContextChunks,
  recordContextRankingEvent,
  loadContextRankingLog,
  getContextRankingStats,
  type ContextChunk,
} from "@dantecode/core";

import {
  buildInlineEditMetrics,
  buildInlineEditQualityReport,
  recordInlineEditReport,
  loadInlineEditReports,
} from "@dantecode/core";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeTempRoot(): string {
  const dir = path.join(os.tmpdir(), `bw-bx-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  return dir;
}

function chunk(
  filePath: string,
  content: string,
  startLine = 1,
  endLine?: number,
): ContextChunk {
  return { filePath, content, startLine, endLine: endLine ?? startLine + 10 };
}

// ─── Sprint BW: RepoContextRanker ─────────────────────────────────────────────

describe("scoreChunkRelevance", () => {
  it("returns 0 for empty queryTerms", () => {
    const c = chunk("a.ts", "function foo() { return 42; }");
    expect(scoreChunkRelevance(c, [])).toBe(0);
  });

  it("returns higher score when query term appears more often", () => {
    const sparse = chunk("sparse.ts", "function foo() {}");
    const dense = chunk("dense.ts", "function function function function foo() {}");
    const terms = ["function"];
    const sparseScore = scoreChunkRelevance(sparse, terms);
    const denseScore = scoreChunkRelevance(dense, terms);
    expect(denseScore).toBeGreaterThan(sparseScore);
  });

  it("is case-insensitive", () => {
    const c = chunk("a.ts", "FUNCTION foo() {}");
    const score = scoreChunkRelevance(c, ["function"]);
    expect(score).toBeGreaterThan(0);
  });
});

describe("rankContextChunks", () => {
  const chunks: ContextChunk[] = [
    chunk("low.ts", "const x = 1;", 1),
    chunk("mid.ts", "function doWork() { return doWork(); }", 10),
    chunk("high.ts", "function doWork() { doWork(); doWork(); doWork(); }", 20),
  ];

  it("returns chunks sorted by relevance (bm25 default)", () => {
    const result = rankContextChunks(chunks, "doWork function", 100000);
    expect(result.rankingMethod).toBe("bm25");
    // high.ts has most 'doWork' occurrences — should be first
    expect(result.chunks[0]!.filePath).toBe("high.ts");
  });

  it("respects tokenBudget — drops chunks when budget exceeded", () => {
    // Each chunk content.length ~50 chars → ~12 tokens each. Budget = 15 → allows 1 chunk
    const result = rankContextChunks(chunks, "doWork function", 15);
    expect(result.chunks.length).toBeLessThan(chunks.length);
    expect(result.droppedCount).toBeGreaterThan(0);
  });

  it("with 'recency' method sorts by startLine ascending", () => {
    const result = rankContextChunks(chunks, "doWork function", 100000, "recency");
    expect(result.rankingMethod).toBe("recency");
    const lines = result.chunks.map((c) => c.startLine);
    for (let i = 1; i < lines.length; i++) {
      expect(lines[i]!).toBeGreaterThanOrEqual(lines[i - 1]!);
    }
  });

  it("totalTokensEstimate equals sum of included content.length / 4", () => {
    const result = rankContextChunks(chunks, "doWork", 100000);
    const expected = result.chunks.reduce(
      (s, c) => s + Math.ceil(c.content.length / 4),
      0,
    );
    expect(result.totalTokensEstimate).toBe(expected);
  });
});

describe("recordContextRankingEvent / loadContextRankingLog", () => {
  it("creates .danteforge/context-ranking-log.json and reads it back", () => {
    const root = makeTempRoot();
    recordContextRankingEvent("sess-1", "query one", 10, 7, "bm25", root);
    const entries = loadContextRankingLog(root);
    expect(entries.length).toBe(1);
    expect(entries[0]!.sessionId).toBe("sess-1");
    expect(entries[0]!.chunksConsidered).toBe(10);
    expect(entries[0]!.chunksSelected).toBe(7);
    expect(entries[0]!.method).toBe("bm25");
  });
});

describe("getContextRankingStats", () => {
  it("returns correct avgSelectionRate", () => {
    const entries = [
      { chunksConsidered: 10, chunksSelected: 5 },
      { chunksConsidered: 20, chunksSelected: 10 },
    ];
    const stats = getContextRankingStats(entries);
    // rate1 = 0.5, rate2 = 0.5 → avg = 0.5
    expect(stats.avgSelectionRate).toBeCloseTo(0.5);
    expect(stats.totalEvents).toBe(2);
  });

  it("returns 0 for empty entries", () => {
    const stats = getContextRankingStats([]);
    expect(stats.avgSelectionRate).toBe(0);
    expect(stats.totalEvents).toBe(0);
  });
});

// ─── Sprint BX: InlineEditQualityReport ───────────────────────────────────────

describe("buildInlineEditMetrics", () => {
  it("returns acceptanceRate=0 when no edits", () => {
    const metrics = buildInlineEditMetrics("empty-sess", []);
    expect(metrics.acceptanceRate).toBe(0);
    expect(metrics.editCount).toBe(0);
    expect(metrics.qualityScore).toBe(0);
  });

  it("correctly counts accepted/rejected/partial", () => {
    const edits = [
      { accepted: true, partial: false, editDistance: 10 },
      { accepted: false, partial: false, editDistance: 50 },
      { accepted: true, partial: true, editDistance: 5 },
    ];
    const metrics = buildInlineEditMetrics("count-sess", edits);
    expect(metrics.editCount).toBe(3);
    expect(metrics.acceptedCount).toBe(1);
    expect(metrics.rejectedCount).toBe(1);
    expect(metrics.partialCount).toBe(1);
  });

  it("returns qualityScore <= acceptanceRate", () => {
    const edits = [
      { accepted: true, partial: false, editDistance: 100 },
      { accepted: true, partial: false, editDistance: 50 },
      { accepted: false, partial: false, editDistance: 0 },
    ];
    const metrics = buildInlineEditMetrics("quality-sess", edits);
    expect(metrics.qualityScore).toBeLessThanOrEqual(metrics.acceptanceRate);
  });

  it("avgEditDistance is mean of accepted (non-partial) edits only", () => {
    const edits = [
      { accepted: true, partial: false, editDistance: 40 },
      { accepted: true, partial: false, editDistance: 60 },
      { accepted: false, partial: false, editDistance: 200 }, // rejected — excluded
    ];
    const metrics = buildInlineEditMetrics("dist-sess", edits);
    expect(metrics.avgEditDistance).toBeCloseTo(50);
  });
});

describe("buildInlineEditQualityReport", () => {
  it("detects 'improving' trend when recent sessions have higher quality", () => {
    const sessions = [
      { sessionId: "s1", editCount: 5, acceptedCount: 2, rejectedCount: 3, partialCount: 0, avgEditDistance: 80, acceptanceRate: 0.4, qualityScore: 0.24, timestamp: "" },
      { sessionId: "s2", editCount: 5, acceptedCount: 2, rejectedCount: 3, partialCount: 0, avgEditDistance: 80, acceptanceRate: 0.4, qualityScore: 0.24, timestamp: "" },
      { sessionId: "s3", editCount: 5, acceptedCount: 5, rejectedCount: 0, partialCount: 0, avgEditDistance: 10, acceptanceRate: 1.0, qualityScore: 0.95, timestamp: "" },
      { sessionId: "s4", editCount: 5, acceptedCount: 5, rejectedCount: 0, partialCount: 0, avgEditDistance: 10, acceptanceRate: 1.0, qualityScore: 0.95, timestamp: "" },
      { sessionId: "s5", editCount: 5, acceptedCount: 5, rejectedCount: 0, partialCount: 0, avgEditDistance: 10, acceptanceRate: 1.0, qualityScore: 0.95, timestamp: "" },
    ];
    const report = buildInlineEditQualityReport(sessions);
    expect(report.trendDirection).toBe("improving");
  });

  it("detects 'declining' trend when recent sessions have lower quality", () => {
    const sessions = [
      { sessionId: "s1", editCount: 5, acceptedCount: 5, rejectedCount: 0, partialCount: 0, avgEditDistance: 10, acceptanceRate: 1.0, qualityScore: 0.95, timestamp: "" },
      { sessionId: "s2", editCount: 5, acceptedCount: 5, rejectedCount: 0, partialCount: 0, avgEditDistance: 10, acceptanceRate: 1.0, qualityScore: 0.95, timestamp: "" },
      { sessionId: "s3", editCount: 5, acceptedCount: 1, rejectedCount: 4, partialCount: 0, avgEditDistance: 150, acceptanceRate: 0.2, qualityScore: 0.1, timestamp: "" },
    ];
    const report = buildInlineEditQualityReport(sessions);
    expect(report.trendDirection).toBe("declining");
  });

  it("overall scores are mean of session values", () => {
    const sessions = [
      { sessionId: "s1", editCount: 4, acceptedCount: 2, rejectedCount: 2, partialCount: 0, avgEditDistance: 20, acceptanceRate: 0.5, qualityScore: 0.45, timestamp: "" },
      { sessionId: "s2", editCount: 4, acceptedCount: 3, rejectedCount: 1, partialCount: 0, avgEditDistance: 20, acceptanceRate: 0.75, qualityScore: 0.675, timestamp: "" },
    ];
    const report = buildInlineEditQualityReport(sessions);
    expect(report.overallAcceptanceRate).toBeCloseTo(0.625);
    expect(report.overallQualityScore).toBeCloseTo(0.5625);
  });
});

describe("recordInlineEditReport / loadInlineEditReports", () => {
  it("creates .danteforge/inline-edit-quality-report.json and reads it back", () => {
    const root = makeTempRoot();
    const sessions = [
      { sessionId: "r-s1", editCount: 5, acceptedCount: 4, rejectedCount: 1, partialCount: 0, avgEditDistance: 25, acceptanceRate: 0.8, qualityScore: 0.7, timestamp: new Date().toISOString() },
    ];
    const report = buildInlineEditQualityReport(sessions);
    recordInlineEditReport(report, root);
    const loaded = loadInlineEditReports(root);
    expect(loaded.length).toBe(1);
    expect(loaded[0]!.sessions.length).toBe(1);
    expect(loaded[0]!.trendDirection).toBeDefined();
  });

  it("loads seeded entries from .danteforge/inline-edit-quality-report.json", () => {
    // Write and read back two entries in a temp root
    const root = makeTempRoot();
    const s1 = [
      { sessionId: "r-s1", editCount: 5, acceptedCount: 4, rejectedCount: 1, partialCount: 0, avgEditDistance: 25, acceptanceRate: 0.8, qualityScore: 0.7, timestamp: new Date().toISOString() },
    ];
    const s2 = [
      { sessionId: "r-s2", editCount: 8, acceptedCount: 6, rejectedCount: 2, partialCount: 0, avgEditDistance: 30, acceptanceRate: 0.75, qualityScore: 0.6375, timestamp: new Date().toISOString() },
    ];
    recordInlineEditReport(buildInlineEditQualityReport(s1), root);
    recordInlineEditReport(buildInlineEditQualityReport(s2), root);
    const reports = loadInlineEditReports(root);
    expect(reports.length).toBeGreaterThanOrEqual(2);
    expect(reports[0]!.sessions).toBeDefined();
    expect(reports[0]!.generatedAt).toBeDefined();
  });
});
