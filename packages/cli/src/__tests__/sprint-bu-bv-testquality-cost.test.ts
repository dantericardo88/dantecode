// Sprint BU-BV tests — test generation quality (dim 19) + cost optimization report (dim 27)
import { describe, it, expect } from "vitest";
import { mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";

import {
  analyzeTestSuite,
  scoreTestQuality,
  recordTestQualityScore,
  loadTestQualityScores,
  getTestQualityReport,
  type GeneratedTestSuite,
  type TestQualityScore,
} from "@dantecode/core";

import {
  buildCostOptimizationReport,
  recordCostOptimizationReport,
  loadCostOptimizationReports,
  getCostOptimizationStats,
} from "@dantecode/core";

function tempDir(): string {
  const dir = join(tmpdir(), `bu-bv-test-${randomUUID()}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

// ─── Sprint BU — Dim 19: Test Generation Quality ─────────────────────────────

describe("analyzeTestSuite", () => {
  it("counts test blocks from content with it( patterns", () => {
    const content = `
      it('adds numbers', () => {
        expect(add(1, 2)).toBe(3);
      });
      it('handles zero', () => {
        expect(add(0, 0)).toBe(0);
      });
      test('subtracts', () => {
        expect(sub(5, 3)).toBe(2);
      });
    `;
    const suite = analyzeTestSuite(content, "math.test.ts");
    expect(suite.testCount).toBe(3);
  });

  it("counts assertions from expect( patterns", () => {
    const content = `
      it('multi assert', () => {
        expect(foo()).toBe(1);
        expect(bar()).toBe(2);
        expect(baz()).toBe(3);
      });
    `;
    const suite = analyzeTestSuite(content, "foo.test.ts");
    expect(suite.assertionCount).toBe(3);
  });

  it("detects hasMocks when vi.fn( is present", () => {
    const content = `
      const mockFn = vi.fn();
      it('calls mock', () => {
        mockFn();
        expect(mockFn).toHaveBeenCalled();
      });
    `;
    const suite = analyzeTestSuite(content, "mock.test.ts");
    expect(suite.hasMocks).toBe(true);
  });

  it("detects hasEdgeCases when description contains 'null'", () => {
    const content = `
      it('handles null input gracefully', () => {
        expect(fn(null)).toBe(null);
      });
    `;
    const suite = analyzeTestSuite(content, "edge.test.ts");
    expect(suite.hasEdgeCases).toBe(true);
  });

  it("detects hasHappyPath when description contains 'should'", () => {
    const content = `
      it('should return the correct value', () => {
        expect(compute(5)).toBe(25);
      });
    `;
    const suite = analyzeTestSuite(content, "happy.test.ts");
    expect(suite.hasHappyPath).toBe(true);
  });
});

describe("scoreTestQuality", () => {
  function makeSuite(overrides: Partial<GeneratedTestSuite> = {}): GeneratedTestSuite {
    return {
      filePath: "test.ts",
      language: "typescript",
      testCount: 5,
      assertionCount: 10,
      hasMocks: true,
      hasEdgeCases: true,
      hasHappyPath: true,
      coverageHint: 0.67,
      ...overrides,
    };
  }

  it("returns score between 0 and 1", () => {
    const suite = makeSuite();
    const result = scoreTestQuality(suite, 50);
    expect(result.score).toBeGreaterThanOrEqual(0);
    expect(result.score).toBeLessThanOrEqual(1);
  });

  it("assigns grade A when score >= 0.8", () => {
    // High test density: 10 tests / 10 lines = 1.0 (capped)
    // High assertion ratio: 30 assertions / 10 tests = 3.0 -> capped at 1
    // hasEdgeCases = true -> 1, hasMocks = true -> 1
    // score = 0.3*1 + 0.3*1 + 0.2*1 + 0.2*1 = 1.0
    const suite = makeSuite({
      testCount: 10,
      assertionCount: 30,
      hasMocks: true,
      hasEdgeCases: true,
    });
    const result = scoreTestQuality(suite, 10);
    expect(result.grade).toBe("A");
    expect(result.score).toBeGreaterThanOrEqual(0.8);
  });

  it("assigns grade D when score < 0.4", () => {
    // testDensity: 1 / 200 = 0.005
    // assertionRatio: 1 / 1 = 1 (capped)
    // edgeCoverage: 0
    // mockUsage: 0
    // score = 0.3*0.005 + 0.3*1 + 0 + 0 = 0.3015 < 0.4
    const suite = makeSuite({
      testCount: 1,
      assertionCount: 1,
      hasMocks: false,
      hasEdgeCases: false,
    });
    const result = scoreTestQuality(suite, 200);
    expect(result.grade).toBe("D");
    expect(result.score).toBeLessThan(0.4);
  });
});

describe("recordTestQualityScore + loadTestQualityScores", () => {
  it("creates .danteforge/test-quality-log.json in the project root", () => {
    const root = tempDir();
    const score: TestQualityScore = {
      filePath: "src/utils.test.ts",
      score: 0.75,
      breakdown: {
        testDensity: 0.8,
        assertionRatio: 1,
        edgeCoverage: 1,
        mockUsage: 0,
      },
      grade: "B",
    };

    recordTestQualityScore(score, root);

    expect(existsSync(join(root, ".danteforge/test-quality-log.json"))).toBe(true);

    const loaded = loadTestQualityScores(root);
    expect(loaded).toHaveLength(1);
    expect(loaded[0]!.filePath).toBe("src/utils.test.ts");
    expect(loaded[0]!.grade).toBe("B");
  });
});

describe("getTestQualityReport", () => {
  it("returns correct gradeDistribution", () => {
    const scores: TestQualityScore[] = [
      { filePath: "a.ts", score: 0.9, breakdown: { testDensity: 1, assertionRatio: 1, edgeCoverage: 1, mockUsage: 0.5 }, grade: "A" },
      { filePath: "b.ts", score: 0.65, breakdown: { testDensity: 0.7, assertionRatio: 0.8, edgeCoverage: 0, mockUsage: 1 }, grade: "B" },
      { filePath: "c.ts", score: 0.45, breakdown: { testDensity: 0.5, assertionRatio: 0.5, edgeCoverage: 0, mockUsage: 0.5 }, grade: "C" },
      { filePath: "d1.ts", score: 0.2, breakdown: { testDensity: 0.2, assertionRatio: 0.3, edgeCoverage: 0, mockUsage: 0 }, grade: "D" },
      { filePath: "d2.ts", score: 0.1, breakdown: { testDensity: 0.1, assertionRatio: 0.2, edgeCoverage: 0, mockUsage: 0 }, grade: "D" },
    ];

    const report = getTestQualityReport(scores);

    expect(report.totalFiles).toBe(5);
    expect(report.gradeDistribution.A).toBe(1);
    expect(report.gradeDistribution.B).toBe(1);
    expect(report.gradeDistribution.C).toBe(1);
    expect(report.gradeDistribution.D).toBe(2);
    expect(report.lowQualityFiles).toEqual(["d1.ts", "d2.ts"]);
  });
});

// ─── Sprint BV — Dim 27: Cost Optimization Report ────────────────────────────

describe("buildCostOptimizationReport", () => {
  it("generates model_downgrade opportunity when avgModelTier is 'best'", () => {
    const report = buildCostOptimizationReport(
      "sess-001",
      2.0,
      0.5,
      0.8,  // cacheHitRate >= 0.5, no cache opportunity
      "best",
      0.9,  // contextUtilizationRate >= 0.6, no trim opportunity
    );

    const downgrade = report.opportunities.find(
      (o) => o.category === "model_downgrade",
    );
    expect(downgrade).toBeDefined();
    expect(downgrade!.estimatedSavingsUsd).toBeCloseTo(2.0 * 0.4, 3);
  });

  it("generates cache_hit opportunity when cacheHitRate < 0.5", () => {
    const report = buildCostOptimizationReport(
      "sess-002",
      1.0,
      0.2,
      0.3,         // cacheHitRate < 0.5 → cache_hit opportunity
      "balanced",  // no model_downgrade
      0.9,         // no context_trim
    );

    const cacheOpp = report.opportunities.find(
      (o) => o.category === "cache_hit",
    );
    expect(cacheOpp).toBeDefined();
    expect(cacheOpp!.estimatedSavingsUsd).toBeCloseTo(1.0 * 0.3, 3);
  });

  it("generates context_trim opportunity when contextUtilizationRate < 0.6", () => {
    const report = buildCostOptimizationReport(
      "sess-003",
      1.0,
      0.0,
      0.9,         // no cache opp
      "balanced",  // no model_downgrade
      0.4,         // contextUtilizationRate < 0.6 → context_trim
    );

    const trimOpp = report.opportunities.find(
      (o) => o.category === "context_trim",
    );
    expect(trimOpp).toBeDefined();
    expect(trimOpp!.estimatedSavingsUsd).toBeCloseTo(1.0 * 0.2, 3);
  });

  it("computes savingsRate correctly", () => {
    // savingsRate = totalSavedUsd / (totalSpentUsd + totalSavedUsd)
    // = 1 / (3 + 1) = 0.25
    const report = buildCostOptimizationReport(
      "sess-004",
      3.0,
      1.0,
      0.9,
      "balanced",
      0.9,
    );
    expect(report.savingsRate).toBeCloseTo(0.25, 3);
  });
});

describe("recordCostOptimizationReport + loadCostOptimizationReports", () => {
  it("creates .danteforge/cost-optimization-report.json in the project root", () => {
    const root = tempDir();
    const report = buildCostOptimizationReport(
      "sess-record-test",
      1.5,
      0.5,
      0.3,
      "best",
      0.4,
    );

    recordCostOptimizationReport(report, root);

    expect(
      existsSync(join(root, ".danteforge/cost-optimization-report.json")),
    ).toBe(true);

    const loaded = loadCostOptimizationReports(root);
    expect(loaded).toHaveLength(1);
    expect(loaded[0]!.sessionId).toBe("sess-record-test");
  });
});

describe("getCostOptimizationStats", () => {
  it("returns correct avgSavingsRate", () => {
    const root = tempDir();

    const r1 = buildCostOptimizationReport("s1", 2.0, 1.0, 0.3, "best", 0.4);
    const r2 = buildCostOptimizationReport("s2", 1.0, 0.0, 0.9, "balanced", 0.9);
    const r3 = buildCostOptimizationReport("s3", 4.0, 2.0, 0.3, "best", 0.3);

    recordCostOptimizationReport(r1, root);
    recordCostOptimizationReport(r2, root);
    recordCostOptimizationReport(r3, root);

    const reports = loadCostOptimizationReports(root);
    const stats = getCostOptimizationStats(reports);

    // r1 savingsRate = 1/(2+1) = 0.333
    // r2 savingsRate = 0/(1+0) = 0
    // r3 savingsRate = 2/(4+2) = 0.333
    const expectedAvg = (r1.savingsRate + r2.savingsRate + r3.savingsRate) / 3;
    expect(stats.avgSavingsRate).toBeCloseTo(expectedAvg, 2);
    expect(stats.totalSpentUsd).toBeCloseTo(7.0, 2);
    expect(stats.totalSavedUsd).toBeCloseTo(3.0, 2);
  });

  it("returns mostCommonOpportunity across all reports", () => {
    const r1 = buildCostOptimizationReport("s1", 2.0, 0.5, 0.3, "best", 0.9);
    // r1 has cache_hit (cacheHitRate<0.5) + model_downgrade (best)
    const r2 = buildCostOptimizationReport("s2", 1.0, 0.0, 0.3, "balanced", 0.9);
    // r2 has only cache_hit

    const stats = getCostOptimizationStats([r1, r2]);
    expect(stats.mostCommonOpportunity).toBe("cache_hit");
  });
});
