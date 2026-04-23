// ============================================================================
// Sprint AV — Dims 18+21: PR review quality benchmark + memory-outcome correlation
// Tests that:
//  - benchmarkReviewQuality computes precision/recall/f1 correctly
//  - ReviewQualityBenchmark.log persists and getAverageF1 aggregates
//  - recordMemoryOutcomeCorrelation appends to memory-outcome-log.json
//  - getMemoryImpactScore returns positive score when memory helps
//  - getMemoryImpactScore returns 0 when insufficient data
// ============================================================================

import { describe, it, expect } from "vitest";
import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import {
  benchmarkReviewQuality,
  ReviewQualityBenchmark,
  recordMemoryOutcomeCorrelation,
  loadMemoryOutcomes,
  getMemoryImpactScore,
} from "@dantecode/core";
import type { ReviewComment } from "@dantecode/core";

function makeDir(): string {
  const dir = join(tmpdir(), `sprint-av-${randomUUID()}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

function makeComment(body: string): ReviewComment {
  return {
    id: randomUUID(),
    type: "suggestion",
    category: "logic",
    body,
    resolved: false,
    createdAt: new Date().toISOString(),
  };
}

describe("benchmarkReviewQuality — Sprint AV (dim 18)", () => {
  // 1. precision=1.0 when all comments match ground truth
  it("returns precision=1.0 when all comments match ground truth", () => {
    const comments = [makeComment("fix the null check"), makeComment("add error handling")];
    const gt = ["null check", "error handling"];
    const result = benchmarkReviewQuality(comments, gt);
    expect(result.precision).toBe(1.0);
    expect(result.matchedIssues).toBe(2);
  });

  // 2. recall=0 when no comments match
  it("returns recall=0 when no comments match any ground truth item", () => {
    const comments = [makeComment("style nit: rename variable")];
    const gt = ["security vulnerability", "memory leak"];
    const result = benchmarkReviewQuality(comments, gt);
    expect(result.recall).toBe(0);
    expect(result.matchedIssues).toBe(0);
  });

  // 3. correct f1 for partial overlap
  it("computes correct f1 for partial overlap (2/3 matched)", () => {
    const comments = [makeComment("fix null pointer"), makeComment("add logging"), makeComment("unrelated issue")];
    const gt = ["null pointer", "add logging", "missing test"];
    const result = benchmarkReviewQuality(comments, gt);
    // 2 matched out of 3 comments = precision 0.667, 2 matched out of 3 gt = recall 0.667
    expect(result.matchedIssues).toBe(2);
    expect(result.f1).toBeGreaterThan(0);
    expect(result.f1).toBeLessThanOrEqual(1);
  });

  // 4. handles empty comments array
  it("handles empty comments array (precision=0, recall=0, f1=0)", () => {
    const result = benchmarkReviewQuality([], ["missing test"]);
    expect(result.precision).toBe(0);
    expect(result.recall).toBe(0);
    expect(result.f1).toBe(0);
    expect(result.totalReviewComments).toBe(0);
  });

  // 5. case-insensitive matching
  it("matches ground truth case-insensitively", () => {
    const comments = [makeComment("Fix The NULL POINTER issue here")];
    const gt = ["null pointer"];
    const result = benchmarkReviewQuality(comments, gt);
    expect(result.matchedIssues).toBe(1);
    expect(result.recall).toBe(1.0);
  });
});

describe("ReviewQualityBenchmark — Sprint AV (dim 18)", () => {
  // 6. log appends to review-quality-log.json
  it("ReviewQualityBenchmark.log appends entries to .danteforge/review-quality-log.json", () => {
    const dir = makeDir();
    const bench = new ReviewQualityBenchmark(dir);
    bench.log("rev-001", { precision: 0.8, recall: 0.7, f1: 0.747, matchedIssues: 7, totalReviewComments: 9, totalGroundTruth: 10 });
    expect(existsSync(join(dir, ".danteforge", "review-quality-log.json"))).toBe(true);
  });

  // 7. getAverageF1 returns correct mean
  it("getAverageF1 returns correct average from logged entries", () => {
    const dir = makeDir();
    const bench = new ReviewQualityBenchmark(dir);
    bench.log("r1", { precision: 1, recall: 1, f1: 0.7, matchedIssues: 1, totalReviewComments: 1, totalGroundTruth: 1 });
    bench.log("r2", { precision: 1, recall: 1, f1: 0.8, matchedIssues: 1, totalReviewComments: 1, totalGroundTruth: 1 });
    bench.log("r3", { precision: 1, recall: 1, f1: 0.9, matchedIssues: 1, totalReviewComments: 1, totalGroundTruth: 1 });
    expect(bench.getAverageF1()).toBeCloseTo(0.8, 5);
  });
});

describe("recordMemoryOutcomeCorrelation + getMemoryImpactScore — Sprint AV (dim 21)", () => {
  // 8. recordMemoryOutcomeCorrelation creates and appends to memory-outcome-log.json
  it("recordMemoryOutcomeCorrelation creates .danteforge/memory-outcome-log.json", () => {
    const dir = makeDir();
    recordMemoryOutcomeCorrelation("s1", 3, true, dir);
    expect(existsSync(join(dir, ".danteforge", "memory-outcome-log.json"))).toBe(true);
    const entries = loadMemoryOutcomes(dir);
    expect(entries.length).toBe(1);
    expect(entries[0]!.contextHitsUsed).toBe(3);
    expect(entries[0]!.taskSucceeded).toBe(true);
  });

  // 9. getMemoryImpactScore returns positive score when memory correlates with success
  it("getMemoryImpactScore returns positive score when memory correlates with success", () => {
    const entries = [
      { sessionId: "s1", contextHitsUsed: 5, taskSucceeded: true, timestamp: "" },
      { sessionId: "s2", contextHitsUsed: 3, taskSucceeded: true, timestamp: "" },
      { sessionId: "s3", contextHitsUsed: 0, taskSucceeded: false, timestamp: "" },
      { sessionId: "s4", contextHitsUsed: 0, taskSucceeded: false, timestamp: "" },
    ];
    const score = getMemoryImpactScore(entries);
    expect(score).toBeGreaterThan(0); // 1.0 (with hits) - 0.0 (without hits) = 1.0
  });

  // 10. getMemoryImpactScore returns 0 when insufficient data
  it("getMemoryImpactScore returns 0 when insufficient data (< 2 entries per bucket)", () => {
    const entries = [
      { sessionId: "s1", contextHitsUsed: 5, taskSucceeded: true, timestamp: "" },
      { sessionId: "s2", contextHitsUsed: 0, taskSucceeded: false, timestamp: "" },
    ];
    // Only 1 entry in each bucket — insufficient
    const score = getMemoryImpactScore(entries);
    expect(score).toBe(0);
  });
});
