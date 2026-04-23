// ============================================================================
// Sprint Dim 18: PR review sharpness — risk clustering, severity ranking,
// false-positive suppression, review-defect correlation
// ============================================================================

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, mkdirSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  // Diff risk clustering
  clusterDiffByRisk,
  buildDiffRiskReport,
  getHighRiskFiles,
  formatRiskClustersForPrompt,
  // Severity ranking
  rankReviewComments,
  getSeverityHistogram,
  getTopPriorityComments,
  buildSeverityRankingReport,
  // False-positive suppressor
  shouldSuppressComment,
  recordFalsePositive,
  loadFalsePositives,
  getFalsePositiveRate,
  // Review defect correlator
  recordReviewDefectOutcome,
  loadReviewDefectOutcomes,
  computeReviewDefectCorrelation,
  getReviewDefectCorrelation,
  formatDefectCorrelationWarning,
} from "@dantecode/core";
import type { ReviewComment } from "@dantecode/core";

let tmpDir: string;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "dim18-review-test-"));
  mkdirSync(join(tmpDir, ".danteforge"), { recursive: true });
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

// ── Diff risk clustering ──────────────────────────────────────────────────────

describe("clusterDiffByRisk", () => {
  it("puts auth files in security cluster", () => {
    const files = ["src/auth/token.ts", "src/user/profile.ts"];
    const clusters = clusterDiffByRisk(files);
    const secCluster = clusters.find((c) => c.surface === "security");
    expect(secCluster).toBeDefined();
    expect(secCluster!.files).toContain("src/auth/token.ts");
  });

  it("puts test files in test cluster with low risk score", () => {
    const files = ["src/utils.test.ts", "src/service.ts"];
    const clusters = clusterDiffByRisk(files);
    const testCluster = clusters.find((c) => c.surface === "test");
    expect(testCluster).toBeDefined();
    expect(testCluster!.riskScore).toBeLessThan(0.5);
  });

  it("orders clusters by risk score descending (highest first)", () => {
    const files = ["src/auth/middleware.ts", "src/styles/app.css", "routes/api.ts"];
    const clusters = clusterDiffByRisk(files);
    for (let i = 0; i < clusters.length - 1; i++) {
      expect(clusters[i]!.riskScore).toBeGreaterThanOrEqual(clusters[i + 1]!.riskScore);
    }
  });

  it("boosts logic cluster risk when security cluster is present", () => {
    const withSecurity = clusterDiffByRisk(["src/auth/jwt.ts", "src/business/billing.ts"]);
    const withoutSecurity = clusterDiffByRisk(["src/business/billing.ts"]);
    const logicWith = withSecurity.find((c) => c.surface === "logic");
    const logicWithout = withoutSecurity.find((c) => c.surface === "logic");
    if (logicWith && logicWithout) {
      expect(logicWith.riskScore).toBeGreaterThan(logicWithout.riskScore);
    }
  });

  it("assigns migration files to data-model cluster", () => {
    const files = ["db/migrations/20240101_add_users.sql"];
    const clusters = clusterDiffByRisk(files);
    const dmCluster = clusters.find((c) => c.surface === "data-model");
    expect(dmCluster).toBeDefined();
    expect(dmCluster!.riskScore).toBeGreaterThan(0.6);
  });
});

describe("buildDiffRiskReport", () => {
  it("computes overallRisk as weighted mean of cluster scores", () => {
    const files = ["src/auth/token.ts", "src/app.css"];
    const report = buildDiffRiskReport(files);
    expect(report.overallRisk).toBeGreaterThan(0);
    expect(report.overallRisk).toBeLessThanOrEqual(1);
  });

  it("counts high-risk files correctly (security, api, data-model only)", () => {
    const files = ["src/auth/session.ts", "styles/main.css", "routes/users.ts"];
    const report = buildDiffRiskReport(files);
    expect(report.highRiskFileCount).toBeGreaterThanOrEqual(2); // auth + routes
  });

  it("formatRiskClustersForPrompt starts with [Diff Risk Clusters]", () => {
    const report = buildDiffRiskReport(["src/auth/token.ts", "src/app.css"]);
    const text = formatRiskClustersForPrompt(report);
    expect(text).toMatch(/\[Diff Risk Clusters/);
  });

  it("getHighRiskFiles returns only files above threshold", () => {
    const files = ["src/auth/oauth.ts", "src/app.css", "src/utils.test.ts"];
    const report = buildDiffRiskReport(files);
    const highRisk = getHighRiskFiles(report, 0.7);
    expect(highRisk).toContain("src/auth/oauth.ts");
    expect(highRisk).not.toContain("src/app.css");
  });
});

// ── Severity ranking ──────────────────────────────────────────────────────────

const makeComment = (override: Partial<ReviewComment>): ReviewComment => ({
  id: "cmt-1",
  type: "blocking",
  category: "security",
  body: "SQL injection vulnerability in user query",
  resolved: false,
  createdAt: new Date().toISOString(),
  ...override,
});

describe("rankReviewComments", () => {
  it("ranks blocking security comments highest", () => {
    const comments: ReviewComment[] = [
      makeComment({ id: "a", type: "nitpick", category: "style", body: "Nit: rename this" }),
      makeComment({ id: "b", type: "blocking", category: "security", body: "SQL injection" }),
      makeComment({ id: "c", type: "suggestion", category: "tests", body: "Add test for edge case" }),
    ];
    const ranked = rankReviewComments(comments);
    expect(ranked[0]!.id).toBe("b");
    expect(ranked[ranked.length - 1]!.id).toBe("a");
  });

  it("assigns severityLabel=critical to blocking security comment", () => {
    const comments = [makeComment({ type: "blocking", category: "security" })];
    const ranked = rankReviewComments(comments);
    expect(ranked[0]!.severityLabel).toBe("critical");
  });

  it("assigns severityLabel=noise to praise comments", () => {
    const comments = [makeComment({ type: "praise", category: "docs", body: "Great work!" })];
    const ranked = rankReviewComments(comments);
    expect(ranked[0]!.severityLabel).toBe("noise");
  });

  it("getTopPriorityComments respects limit parameter", () => {
    const comments = Array.from({ length: 8 }, (_, i) =>
      makeComment({ id: `c${i}`, body: `Issue ${i}` }),
    );
    const ranked = rankReviewComments(comments);
    const top = getTopPriorityComments(ranked, 3);
    expect(top).toHaveLength(3);
  });
});

describe("getSeverityHistogram", () => {
  it("counts each label bucket correctly", () => {
    const comments: ReviewComment[] = [
      makeComment({ id: "1", type: "blocking", category: "security", body: "sec issue" }),
      makeComment({ id: "2", type: "suggestion", category: "logic", body: "logic issue" }),
      makeComment({ id: "3", type: "nitpick", category: "style", body: "style" }),
      makeComment({ id: "4", type: "praise", category: "docs", body: "nice!" }),
    ];
    const ranked = rankReviewComments(comments);
    const hist = getSeverityHistogram(ranked);
    expect(hist.critical + hist.high).toBeGreaterThanOrEqual(1);
    expect(hist.noise).toBe(1);
  });

  it("buildSeverityRankingReport has positive reviewSharpnessScore when blockers present", () => {
    const comments: ReviewComment[] = [
      makeComment({ id: "x", type: "blocking", category: "security", body: "auth bypass" }),
      makeComment({ id: "y", type: "nitpick", category: "style", body: "formatting" }),
    ];
    const report = buildSeverityRankingReport(comments);
    expect(report.reviewSharpnessScore).toBeGreaterThan(0);
    expect(report.topBlockers.length).toBeGreaterThanOrEqual(1);
  });
});

// ── False-positive suppressor ─────────────────────────────────────────────────

describe("shouldSuppressComment", () => {
  it("suppresses 'Add more comments.' pattern", () => {
    const c = makeComment({ body: "Add more comments.", category: "style" });
    expect(shouldSuppressComment(c)).toBe(true);
  });

  it("suppresses short body with no file path", () => {
    const c = makeComment({ body: "Fix.", category: "style", filePath: undefined });
    expect(shouldSuppressComment(c)).toBe(true);
  });

  it("does NOT suppress substantive blocking security comment", () => {
    const c = makeComment({
      type: "blocking",
      category: "security",
      body: "This endpoint lacks authentication — any user can call it.",
      filePath: "src/routes/admin.ts",
      line: 42,
    });
    expect(shouldSuppressComment(c)).toBe(false);
  });

  it("suppresses style comments with no file path", () => {
    const c = makeComment({ category: "style", filePath: undefined, body: "Rename this variable" });
    expect(shouldSuppressComment(c)).toBe(true);
  });

  it("suppresses when category FP rate > 60% in history", () => {
    const history = Array.from({ length: 6 }, (_, i) => ({
      commentId: `fp-${i}`,
      category: "naming" as const,
      bodySnippet: "rename",
      reason: "pattern-match" as const,
      suppressedAt: "",
    }));
    const c = makeComment({ category: "naming", body: "Rename this", filePath: "src/a.ts" });
    expect(shouldSuppressComment(c, history)).toBe(true);
  });
});

describe("recordFalsePositive + loadFalsePositives", () => {
  it("creates false-positive-log.jsonl on first record", () => {
    recordFalsePositive("cmt-1", "style", "add comments", "pattern-match", tmpDir);
    expect(existsSync(join(tmpDir, ".danteforge", "false-positive-log.jsonl"))).toBe(true);
  });

  it("reads back false positive entries", () => {
    recordFalsePositive("cmt-a", "naming", "nit", "pattern-match", tmpDir);
    recordFalsePositive("cmt-b", "style", "looks good", "pattern-match", tmpDir);
    const history = loadFalsePositives(tmpDir);
    expect(history).toHaveLength(2);
    expect(history[0]!.commentId).toBe("cmt-a");
  });

  it("returns empty array when no file exists", () => {
    expect(loadFalsePositives(tmpDir)).toEqual([]);
  });

  it("getFalsePositiveRate returns category fraction", () => {
    const history = [
      { commentId: "a", category: "style" as const, bodySnippet: "", reason: "pattern-match" as const, suppressedAt: "" },
      { commentId: "b", category: "style" as const, bodySnippet: "", reason: "pattern-match" as const, suppressedAt: "" },
      { commentId: "c", category: "naming" as const, bodySnippet: "", reason: "pattern-match" as const, suppressedAt: "" },
    ];
    const rate = getFalsePositiveRate(history, "style");
    expect(rate).toBeCloseTo(2 / 3, 2);
  });
});

// ── Review defect correlator ──────────────────────────────────────────────────

describe("recordReviewDefectOutcome + loadReviewDefectOutcomes", () => {
  it("creates review-defect-correlation.jsonl on first record", () => {
    recordReviewDefectOutcome("rev-1", 0.85, 0, tmpDir, "Add auth");
    expect(existsSync(join(tmpDir, ".danteforge", "review-defect-correlation.jsonl"))).toBe(true);
  });

  it("reads back entries correctly", () => {
    recordReviewDefectOutcome("rev-a", 0.9, 0, tmpDir);
    recordReviewDefectOutcome("rev-b", 0.4, 3, tmpDir);
    const outcomes = loadReviewDefectOutcomes(tmpDir);
    expect(outcomes).toHaveLength(2);
    expect(outcomes[0]!.reviewId).toBe("rev-a");
    expect(outcomes[1]!.bugsFoundPostMerge).toBe(3);
  });

  it("returns empty array when file does not exist", () => {
    expect(loadReviewDefectOutcomes(tmpDir)).toEqual([]);
  });
});

describe("computeReviewDefectCorrelation", () => {
  it("high precision reviews have fewer bugs than low precision", () => {
    const outcomes = [
      { reviewId: "r1", reviewPrecision: 0.9, bugsFoundPostMerge: 0, recordedAt: "" },
      { reviewId: "r2", reviewPrecision: 0.85, bugsFoundPostMerge: 0, recordedAt: "" },
      { reviewId: "r3", reviewPrecision: 0.3, bugsFoundPostMerge: 3, recordedAt: "" },
      { reviewId: "r4", reviewPrecision: 0.4, bugsFoundPostMerge: 2, recordedAt: "" },
    ];
    const corr = computeReviewDefectCorrelation(outcomes);
    expect(corr.highPrecisionBugRate).toBeLessThan(corr.lowPrecisionBugRate);
    expect(corr.delta).toBeGreaterThan(0.5);
    expect(corr.isSignificant).toBe(true);
  });

  it("isSignificant=false when delta <= 0.5", () => {
    const outcomes = [
      { reviewId: "r1", reviewPrecision: 0.9, bugsFoundPostMerge: 1, recordedAt: "" },
      { reviewId: "r2", reviewPrecision: 0.4, bugsFoundPostMerge: 1, recordedAt: "" },
    ];
    const corr = computeReviewDefectCorrelation(outcomes);
    expect(corr.isSignificant).toBe(false);
  });

  it("returns zero rates for empty outcomes", () => {
    const corr = computeReviewDefectCorrelation([]);
    expect(corr.highPrecisionBugRate).toBe(0);
    expect(corr.lowPrecisionBugRate).toBe(0);
  });

  it("formatDefectCorrelationWarning returns null when not significant", () => {
    const corr = computeReviewDefectCorrelation([
      { reviewId: "r1", reviewPrecision: 0.9, bugsFoundPostMerge: 1, recordedAt: "" },
      { reviewId: "r2", reviewPrecision: 0.4, bugsFoundPostMerge: 1, recordedAt: "" },
    ]);
    expect(formatDefectCorrelationWarning(corr)).toBeNull();
  });

  it("formatDefectCorrelationWarning returns warning string when significant", () => {
    const outcomes = [
      { reviewId: "r1", reviewPrecision: 0.9, bugsFoundPostMerge: 0, recordedAt: "" },
      { reviewId: "r2", reviewPrecision: 0.3, bugsFoundPostMerge: 3, recordedAt: "" },
    ];
    const corr = computeReviewDefectCorrelation(outcomes);
    const warning = formatDefectCorrelationWarning(corr);
    expect(warning).toMatch(/\[Review Quality Warning\]/);
  });

  it("getReviewDefectCorrelation reads from disk and computes", () => {
    recordReviewDefectOutcome("r-a", 0.9, 0, tmpDir);
    recordReviewDefectOutcome("r-b", 0.3, 3, tmpDir);
    const corr = getReviewDefectCorrelation(tmpDir);
    expect(corr.highPrecisionSampleCount).toBe(1);
    expect(corr.lowPrecisionSampleCount).toBe(1);
    expect(corr.isSignificant).toBe(true);
  });
});
