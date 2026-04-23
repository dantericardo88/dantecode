// ============================================================================
// @dantecode/core — Test Generation Quality (dim 19)
// Analyzes generated test suites and produces quality scores.
// ============================================================================

import { appendFileSync, mkdirSync, readFileSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";

export interface GeneratedTestSuite {
  filePath: string;
  language: string;
  testCount: number;
  assertionCount: number;
  hasMocks: boolean;
  hasEdgeCases: boolean;
  hasHappyPath: boolean;
  coverageHint: number;
}

export interface TestQualityScore {
  filePath: string;
  score: number;
  breakdown: {
    testDensity: number;
    assertionRatio: number;
    edgeCoverage: number;
    mockUsage: number;
  };
  grade: "A" | "B" | "C" | "D";
}

const QUALITY_LOG = ".danteforge/test-quality-log.json";

export function analyzeTestSuite(
  testFileContent: string,
  filePath: string,
  language?: string,
): GeneratedTestSuite {
  const detectedLanguage = language ?? detectLanguage(filePath);

  const testCount = (
    testFileContent.match(/\bit\s*\(|\btest\s*\(|\bspec\s*\(/g) ?? []
  ).length;

  const assertionCount = (
    testFileContent.match(/expect\s*\(|assert\s*\(|should\./g) ?? []
  ).length;

  const hasMocks =
    testFileContent.includes("vi.fn(") ||
    testFileContent.includes("jest.fn(") ||
    testFileContent.includes("mock(") ||
    testFileContent.includes("sinon.");

  const hasEdgeCases = /\b(edge|null|empty|boundary|invalid)\b/i.test(
    testFileContent,
  );

  const hasHappyPath = /\b(should|returns|works|success)\b/i.test(
    testFileContent,
  );

  const coverageHint = Math.min(
    1,
    assertionCount / Math.max(testCount * 3, 1),
  );

  return {
    filePath,
    language: detectedLanguage,
    testCount,
    assertionCount,
    hasMocks,
    hasEdgeCases,
    hasHappyPath,
    coverageHint,
  };
}

function detectLanguage(filePath: string): string {
  if (filePath.endsWith(".ts") || filePath.endsWith(".tsx")) return "typescript";
  if (filePath.endsWith(".js") || filePath.endsWith(".jsx")) return "javascript";
  if (filePath.endsWith(".py")) return "python";
  if (filePath.endsWith(".go")) return "go";
  if (filePath.endsWith(".rs")) return "rust";
  return "unknown";
}

export function scoreTestQuality(
  suite: GeneratedTestSuite,
  linesOfCode: number,
): TestQualityScore {
  const testDensity = Math.min(
    1,
    suite.testCount / Math.max(linesOfCode, 1),
  );
  const assertionRatio = Math.min(
    1,
    suite.assertionCount / Math.max(suite.testCount, 1),
  );
  const edgeCoverage = suite.hasEdgeCases ? 1 : 0;
  const mockUsage = suite.hasMocks ? 1 : 0;

  const score =
    0.3 * testDensity +
    0.3 * assertionRatio +
    0.2 * edgeCoverage +
    0.2 * mockUsage;

  const grade: "A" | "B" | "C" | "D" =
    score >= 0.8
      ? "A"
      : score >= 0.6
        ? "B"
        : score >= 0.4
          ? "C"
          : "D";

  return {
    filePath: suite.filePath,
    score: Math.round(score * 10000) / 10000,
    breakdown: { testDensity, assertionRatio, edgeCoverage, mockUsage },
    grade,
  };
}

export function recordTestQualityScore(
  score: TestQualityScore,
  projectRoot?: string,
): void {
  const root = projectRoot ?? resolve(process.cwd());
  try {
    mkdirSync(join(root, ".danteforge"), { recursive: true });
    appendFileSync(
      join(root, QUALITY_LOG),
      JSON.stringify(score) + "\n",
      "utf-8",
    );
  } catch {
    // non-fatal
  }
}

export function loadTestQualityScores(projectRoot?: string): TestQualityScore[] {
  const root = projectRoot ?? resolve(process.cwd());
  const logPath = join(root, QUALITY_LOG);
  if (!existsSync(logPath)) return [];
  try {
    return readFileSync(logPath, "utf-8")
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((l) => JSON.parse(l) as TestQualityScore);
  } catch {
    return [];
  }
}

export function getTestQualityReport(scores: TestQualityScore[]): {
  totalFiles: number;
  avgScore: number;
  gradeDistribution: Record<"A" | "B" | "C" | "D", number>;
  lowQualityFiles: string[];
} {
  const gradeDistribution: Record<"A" | "B" | "C" | "D", number> = {
    A: 0,
    B: 0,
    C: 0,
    D: 0,
  };

  for (const s of scores) {
    gradeDistribution[s.grade]++;
  }

  const avgScore =
    scores.length > 0
      ? scores.reduce((sum, s) => sum + s.score, 0) / scores.length
      : 0;

  const lowQualityFiles = scores
    .filter((s) => s.grade === "D")
    .map((s) => s.filePath);

  return {
    totalFiles: scores.length,
    avgScore: Math.round(avgScore * 10000) / 10000,
    gradeDistribution,
    lowQualityFiles,
  };
}
