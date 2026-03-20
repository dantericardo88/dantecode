// =============================================================================
// Verification Suite Runner — structured DeepEval-style test suite runner.
// Defines named test cases with expected criteria, runs them against
// the verification engine, and produces structured suite reports.
// =============================================================================

import { randomUUID } from "node:crypto";
import { verifyOutput, type OutputVerificationReport, type VerificationCriteria } from "./qa-harness.js";
import type { VerificationRail } from "./rails-enforcer.js";
import { synthesizeConfidence, type ConfidenceThresholds, type ConfidenceSynthesisResult } from "./confidence-synthesizer.js";

// ---------------------------------------------------------------------------
// Test case types
// ---------------------------------------------------------------------------

export type TestCaseKind = "coverage" | "structure" | "safety" | "style" | "custom";

export interface VerificationTestCase {
  id: string;
  label: string;
  kind: TestCaseKind;
  task: string;
  output: string;
  criteria?: VerificationCriteria;
  rails?: VerificationRail[];
  /** Optional expected decision for assertion. */
  expectedDecision?: "pass" | "soft-pass" | "review-required" | "block";
}

export interface TestCaseResult {
  id: string;
  label: string;
  kind: TestCaseKind;
  report: OutputVerificationReport;
  synthesis: ConfidenceSynthesisResult;
  passed: boolean;
  assertionMet: boolean;   // true if no expectedDecision, or decision matched
  durationMs: number;
}

export interface SuiteRunReport {
  suiteId: string;
  label: string;
  totalCases: number;
  passedCases: number;
  failedCases: number;
  assertionsMet: number;
  assertionsFailed: number;
  averagePdseScore: number;
  results: TestCaseResult[];
  ranAt: string;
  durationMs: number;
}

export interface SuiteDefinition {
  id?: string;
  label: string;
  thresholds?: Partial<ConfidenceThresholds>;
  cases: VerificationTestCase[];
}

// ---------------------------------------------------------------------------
// Suite Runner
// ---------------------------------------------------------------------------

export class VerificationSuiteRunner {
  private readonly suites = new Map<string, SuiteDefinition>();

  /** Register a suite definition. */
  registerSuite(suite: SuiteDefinition): string {
    const id = suite.id ?? randomUUID();
    this.suites.set(id, { ...suite, id });
    return id;
  }

  /** Get a suite by id. */
  getSuite(id: string): SuiteDefinition | undefined {
    return this.suites.get(id);
  }

  /** List registered suite ids. */
  listSuiteIds(): string[] {
    return [...this.suites.keys()];
  }

  /**
   * Run a registered suite by id. Returns its report.
   */
  async runById(suiteId: string): Promise<SuiteRunReport | null> {
    const suite = this.suites.get(suiteId);
    if (!suite) return null;
    return this.run(suite);
  }

  /**
   * Run a suite definition directly (without registering).
   */
  async run(suite: SuiteDefinition): Promise<SuiteRunReport> {
    const suiteId = suite.id ?? randomUUID();
    const start = Date.now();
    const results: TestCaseResult[] = [];

    for (const testCase of suite.cases) {
      const caseStart = Date.now();
      const report = verifyOutput({
        task: testCase.task,
        output: testCase.output,
        ...(testCase.criteria ? { criteria: testCase.criteria } : {}),
        ...(testCase.rails ? { rails: testCase.rails } : {}),
      });

      const synthesis = synthesizeConfidence({
        pdseScore: report.pdseScore,
        metrics: report.metrics,
        railFindings: report.railFindings,
        critiqueTrace: report.critiqueTrace,
        ...(suite.thresholds ? { thresholds: suite.thresholds } : {}),
      });

      const assertionMet =
        testCase.expectedDecision === undefined || synthesis.decision === testCase.expectedDecision;

      results.push({
        id: testCase.id,
        label: testCase.label,
        kind: testCase.kind,
        report,
        synthesis,
        passed: report.overallPassed,
        assertionMet,
        durationMs: Date.now() - caseStart,
      });
    }

    const totalDuration = Date.now() - start;
    const passedCases = results.filter((r) => r.passed).length;
    const assertionsMet = results.filter((r) => r.assertionMet).length;
    const avgScore =
      results.length > 0
        ? results.reduce((sum, r) => sum + r.report.pdseScore, 0) / results.length
        : 0;

    return {
      suiteId,
      label: suite.label,
      totalCases: results.length,
      passedCases,
      failedCases: results.length - passedCases,
      assertionsMet,
      assertionsFailed: results.length - assertionsMet,
      averagePdseScore: avgScore,
      results,
      ranAt: new Date().toISOString(),
      durationMs: totalDuration,
    };
  }

  clear(): void {
    this.suites.clear();
  }
}

// ---------------------------------------------------------------------------
// Test case builder helpers (DeepEval-style)
// ---------------------------------------------------------------------------

/** Build a coverage test case from a task and output. */
export function buildCoverageTestCase(
  task: string,
  output: string,
  keywords: string[],
): VerificationTestCase {
  return {
    id: `coverage-${randomUUID().slice(0, 8)}`,
    label: `Coverage: ${keywords.slice(0, 3).join(", ")}`,
    kind: "coverage",
    task,
    output,
    criteria: { requiredKeywords: keywords, minLength: 40 },
  };
}

/** Build a safety test case (checks no forbidden patterns). */
export function buildSafetyTestCase(
  task: string,
  output: string,
  forbiddenPatterns: string[],
): VerificationTestCase {
  return {
    id: `safety-${randomUUID().slice(0, 8)}`,
    label: "Safety check",
    kind: "safety",
    task,
    output,
    criteria: { forbiddenPatterns },
  };
}

/** Build a structural test case from expected sections. */
export function buildStructureTestCase(
  task: string,
  output: string,
  expectedSections: string[],
): VerificationTestCase {
  return {
    id: `structure-${randomUUID().slice(0, 8)}`,
    label: `Structure: ${expectedSections.join(", ")}`,
    kind: "structure",
    task,
    output,
    criteria: { expectedSections },
  };
}

/** Global singleton suite runner. */
export const globalSuiteRunner = new VerificationSuiteRunner();
