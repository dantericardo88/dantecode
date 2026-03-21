import { scorePdseMetrics, type PdseWeights, type VerificationMetricScore } from "./pdse-scorer.js";
import {
  globalVerificationRailRegistry,
  type VerificationRail,
  type VerificationRailFinding,
} from "./rails-enforcer.js";

export interface VerificationCriteria {
  requiredKeywords?: string[];
  forbiddenPatterns?: string[];
  expectedSections?: string[];
  minLength?: number;
  pdseGate?: number;
  weights?: Partial<PdseWeights>;
}

export interface VerificationTraceStage {
  stage: "syntactic" | "semantic" | "factual" | "safety";
  passed: boolean;
  summary: string;
}

export interface VerifyOutputInput {
  task: string;
  output: string;
  criteria?: VerificationCriteria;
  rails?: VerificationRail[];
}

export interface OutputVerificationReport {
  overallPassed: boolean;
  passedGate: boolean;
  pdseScore: number;
  metrics: VerificationMetricScore[];
  critiqueTrace: VerificationTraceStage[];
  railFindings: VerificationRailFinding[];
  warnings: string[];
}

export interface QaSuiteOutputInput extends VerifyOutputInput {
  id: string;
}

export interface QaSuiteReport {
  planId: string;
  outputReports: Array<{ id: string; report: OutputVerificationReport }>;
  overallPassed: boolean;
  averagePdseScore: number;
  failingOutputIds: string[];
}

export interface GeneratedQaTestCase {
  id: string;
  label: string;
  task: string;
  criteria: VerificationCriteria;
  rationale: string;
}

const PLACEHOLDER_PATTERNS = ["todo", "fixme", "tbd", "placeholder", "lorem ipsum"];
const SUSPICIOUS_PATTERNS = ["guaranteed", "definitely", "never fails", "obviously"];

export function verifyOutput(input: VerifyOutputInput): OutputVerificationReport {
  const criteria = input.criteria ?? {};
  const output = input.output.trim();
  const normalizedOutput = output.toLowerCase();
  const rails =
    input.rails && input.rails.length > 0
      ? input.rails
      : globalVerificationRailRegistry.listRails();
  const railFindings = globalVerificationRailRegistry.evaluate(input.task, output, rails);
  const hardRailFailures = railFindings.filter(
    (finding) => !finding.passed && finding.mode === "hard",
  );
  const warnings = railFindings
    .filter((finding) => !finding.passed && finding.mode === "soft")
    .flatMap((finding) =>
      finding.violations.map((violation) => `${finding.railName}: ${violation}`),
    );

  const keywordTargets = criteria.requiredKeywords ?? deriveKeywords(input.task);
  const keywordCoverage = computeCoverage(keywordTargets, normalizedOutput);
  const sectionCoverage = computeCoverage(criteria.expectedSections ?? [], normalizedOutput);
  const minLengthScore =
    typeof criteria.minLength === "number"
      ? Math.min(output.length / Math.max(criteria.minLength, 1), 1)
      : 1;
  const forbiddenHits = countMatches(criteria.forbiddenPatterns ?? [], normalizedOutput);
  const placeholderHits = countMatches(PLACEHOLDER_PATTERNS, normalizedOutput);
  const suspiciousHits = countMatches(SUSPICIOUS_PATTERNS, normalizedOutput);

  const completeness = average([keywordCoverage, sectionCoverage, minLengthScore]);
  const correctness = average([keywordCoverage, sectionCoverage, forbiddenHits === 0 ? 1 : 0.25]);
  const faithfulness = clamp(1 - placeholderHits * 0.4 - (output.length < 20 ? 0.25 : 0));
  const hallucination = clamp(1 - suspiciousHits * 0.3 - placeholderHits * 0.15);
  const safety =
    hardRailFailures.length > 0 || forbiddenHits > 0 ? 0 : warnings.length > 0 ? 0.75 : 1;

  const metrics: VerificationMetricScore[] = [
    {
      name: "faithfulness",
      score: faithfulness,
      passed: faithfulness >= 0.7,
      reason: placeholderHits > 0 ? "Placeholder language detected." : "Output appears grounded.",
    },
    {
      name: "correctness",
      score: correctness,
      passed: correctness >= 0.7,
      reason:
        correctness >= 0.7
          ? "Task expectations are represented."
          : "Key task requirements are missing.",
    },
    {
      name: "hallucination",
      score: hallucination,
      passed: hallucination >= 0.7,
      reason:
        suspiciousHits > 0
          ? "Suspicious certainty language detected."
          : "No obvious hallucination markers detected.",
    },
    {
      name: "completeness",
      score: completeness,
      passed: completeness >= 0.7,
      reason: completeness >= 0.7 ? "Required details are present." : "Coverage is incomplete.",
    },
    {
      name: "safety",
      score: safety,
      passed: safety >= 0.7,
      reason:
        safety >= 0.7
          ? "No blocking rail or safety failures."
          : "Blocking rails or forbidden patterns fired.",
    },
  ];

  const pdse = scorePdseMetrics(metrics, {
    gate: criteria.pdseGate,
    weights: criteria.weights,
  });

  const critiqueTrace: VerificationTraceStage[] = [
    {
      stage: "syntactic",
      passed: output.length > 0 && minLengthScore >= 0.7,
      summary: output.length > 0 ? "Output is present." : "Output is empty.",
    },
    {
      stage: "semantic",
      passed: completeness >= 0.7 && correctness >= 0.7,
      summary:
        completeness >= 0.7 && correctness >= 0.7
          ? "Output covers the requested task."
          : "Output misses required task content.",
    },
    {
      stage: "factual",
      passed: faithfulness >= 0.7 && hallucination >= 0.7,
      summary:
        faithfulness >= 0.7 && hallucination >= 0.7
          ? "No major factual-risk heuristics triggered."
          : "Factual-risk heuristics triggered.",
    },
    {
      stage: "safety",
      passed: safety >= 0.7,
      summary:
        safety >= 0.7
          ? "No blocking safety rails were violated."
          : "Safety or guardrail failures require changes.",
    },
  ];

  return {
    overallPassed:
      pdse.passedGate &&
      hardRailFailures.length === 0 &&
      critiqueTrace.every((stage) => stage.passed),
    passedGate: pdse.passedGate,
    pdseScore: pdse.overallScore,
    metrics,
    critiqueTrace,
    railFindings,
    warnings,
  };
}

export function runQaSuite(planId: string, outputs: QaSuiteOutputInput[]): QaSuiteReport {
  const outputReports = outputs.map((output) => ({
    id: output.id,
    report: verifyOutput(output),
  }));
  const failingOutputIds = outputReports
    .filter((entry) => !entry.report.overallPassed)
    .map((entry) => entry.id);
  const averagePdseScore =
    outputReports.length > 0
      ? outputReports.reduce((sum, entry) => sum + entry.report.pdseScore, 0) / outputReports.length
      : 0;

  return {
    planId,
    outputReports,
    overallPassed: failingOutputIds.length === 0,
    averagePdseScore,
    failingOutputIds,
  };
}

export function generateQaTestCases(task: string): GeneratedQaTestCase[] {
  const inferredKeywords = inferVerificationKeywords(task);
  const inferredSections = inferExpectedSections(task);
  const cases: GeneratedQaTestCase[] = [
    {
      id: "coverage",
      label: "Coverage",
      task,
      criteria: {
        requiredKeywords: inferredKeywords,
        minLength: Math.max(40, inferredKeywords.length * 12),
      },
      rationale: "Ensures the output covers the task's primary concepts.",
    },
  ];

  if (inferredSections.length > 0) {
    cases.push({
      id: "structure",
      label: "Structure",
      task,
      criteria: {
        expectedSections: inferredSections,
        minLength: 40,
      },
      rationale: "Checks for task-specific sections that improve answer structure.",
    });
  }

  cases.push({
    id: "safety",
    label: "Safety",
    task,
    criteria: {
      forbiddenPatterns: ["TODO", "FIXME", "TBD", "placeholder"],
      minLength: 20,
    },
    rationale: "Flags placeholder language and shallow outputs before they ship.", // antistub-ok
  });

  return cases;
}

function deriveKeywords(task: string): string[] {
  return [
    ...new Set(
      task
        .toLowerCase()
        .split(/[^a-z0-9]+/i)
        .filter((token) => token.length >= 5),
    ),
  ].slice(0, 6);
}

function inferVerificationKeywords(task: string): string[] {
  const normalized = task.toLowerCase();
  const inferred = new Set<string>();

  if (/\bdeploy(?:ment)?\b/.test(normalized)) {
    inferred.add("deploy");
  }
  if (/\brollback\b/.test(normalized)) {
    inferred.add("rollback");
  }
  if (/\bincident\b/.test(normalized)) {
    inferred.add("incident");
  }
  if (/\bresponse\b/.test(normalized)) {
    inferred.add("response");
  }

  for (const keyword of deriveKeywords(task)) {
    inferred.add(keyword);
  }

  return Array.from(inferred).slice(0, 6);
}

function inferExpectedSections(task: string): string[] {
  const normalized = task.toLowerCase();
  const sections: string[] = [];

  if (/\bstep(?:s)?\b|\bworkflow\b|\bprocess\b/.test(normalized)) {
    sections.push("Steps");
  }
  if (/\brollback\b/.test(normalized)) {
    sections.push("Rollback");
  }
  if (/\bsummary\b|\bsummarize\b/.test(normalized)) {
    sections.push("Summary");
  }
  if (/\brisk\b|\bmitigation\b/.test(normalized)) {
    sections.push("Risks");
  }

  return sections;
}

function computeCoverage(targets: string[], normalizedOutput: string): number {
  if (targets.length === 0) {
    return 1;
  }

  const hits = targets.filter((target) => normalizedOutput.includes(target.toLowerCase())).length;
  return hits / targets.length;
}

function countMatches(patterns: string[], normalizedOutput: string): number {
  return patterns.filter((pattern) => normalizedOutput.includes(pattern.toLowerCase())).length;
}

function average(values: number[]): number {
  if (values.length === 0) {
    return 1;
  }

  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function clamp(value: number): number {
  return Math.max(0, Math.min(1, value));
}
