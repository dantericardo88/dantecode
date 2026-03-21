// =============================================================================
// Metric Suite — pluggable metric registry for verification scoring.
// Allows custom dimensions beyond the 5 standard PDSE metrics.
// Harvested from DeepEval metric registry patterns + DSPy evaluator signatures.
// =============================================================================

import type { VerificationMetricName, VerificationMetricScore } from "./pdse-scorer.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type MetricId = string;

export interface MetricInput {
  task: string;
  output: string;
  /** Optional additional context for the metric */
  context?: Record<string, unknown>;
}

export interface MetricResult {
  id: MetricId;
  name: string;
  score: number; // 0–1
  passed: boolean;
  reason: string;
}

export interface MetricDefinition {
  id: MetricId;
  name: string;
  description?: string;
  /** Pass threshold, 0–1. Default: 0.7 */
  passThreshold?: number;
  compute(input: MetricInput): MetricResult;
}

export interface MetricSuiteRunResult {
  metrics: MetricResult[];
  overallScore: number;
  passed: boolean;
  failingMetrics: MetricId[];
}

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

export class MetricSuiteRegistry {
  private readonly definitions = new Map<MetricId, MetricDefinition>();

  /** Register a metric definition. Overwrites if same id. */
  register(definition: MetricDefinition): void {
    this.definitions.set(definition.id, { ...definition });
  }

  /** Remove a metric by id. */
  unregister(id: MetricId): boolean {
    return this.definitions.delete(id);
  }

  /** List all registered metric ids. */
  listIds(): MetricId[] {
    return [...this.definitions.keys()];
  }

  /** Get a metric definition by id. */
  get(id: MetricId): MetricDefinition | undefined {
    const def = this.definitions.get(id);
    return def ? { ...def } : undefined;
  }

  /** Run a subset of metrics (or all if ids is empty) against the input. */
  compute(input: MetricInput, ids?: MetricId[]): MetricSuiteRunResult {
    const toRun =
      ids && ids.length > 0
        ? ids
            .map((id) => this.definitions.get(id))
            .filter((d): d is MetricDefinition => d !== undefined)
        : [...this.definitions.values()];

    const metrics: MetricResult[] = toRun.map((def) => def.compute(input));
    const overallScore =
      metrics.length > 0 ? metrics.reduce((sum, m) => sum + m.score, 0) / metrics.length : 0;
    const failingMetrics = metrics.filter((m) => !m.passed).map((m) => m.id);

    return {
      metrics,
      overallScore,
      passed: failingMetrics.length === 0,
      failingMetrics,
    };
  }

  clear(): void {
    this.definitions.clear();
  }
}

// ---------------------------------------------------------------------------
// Standard PDSE Metrics
// These are registered by default in globalMetricSuiteRegistry.
// ---------------------------------------------------------------------------

const PLACEHOLDER_PATTERNS = ["todo", "fixme", "tbd", "placeholder", "lorem ipsum"];
const SUSPICIOUS_PATTERNS = ["guaranteed", "definitely", "never fails", "obviously"];

function countMatches(patterns: string[], text: string): number {
  return patterns.filter((pattern) => text.includes(pattern.toLowerCase())).length;
}

function computeCoverage(targets: string[], text: string): number {
  if (targets.length === 0) return 1;
  const matched = targets.filter((t) => text.includes(t.toLowerCase())).length;
  return matched / targets.length;
}

function clamp(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function makeStandardMetrics(): MetricDefinition[] {
  return [
    {
      id: "faithfulness",
      name: "Faithfulness",
      description: "Output is grounded, avoids placeholder/stub language.",
      passThreshold: 0.7,
      compute(input: MetricInput): MetricResult {
        const normalized = input.output.toLowerCase();
        const placeholderHits = countMatches(PLACEHOLDER_PATTERNS, normalized);
        const tooShort = input.output.length < 20 ? 0.25 : 0;
        const score = clamp(1 - placeholderHits * 0.4 - tooShort);
        const threshold = this.passThreshold ?? 0.7;
        const reason =
          placeholderHits > 0
            ? `Found ${placeholderHits} placeholder pattern(s).`
            : tooShort > 0
              ? "Output is too short."
              : "No placeholder patterns detected.";
        return { id: this.id, name: this.name, score, passed: score >= threshold, reason };
      },
    },
    {
      id: "correctness",
      name: "Correctness",
      description: "Output satisfies the task semantically.",
      passThreshold: 0.7,
      compute(input: MetricInput): MetricResult {
        const normalized = input.output.toLowerCase();
        const taskWords = input.task
          .toLowerCase()
          .split(/\s+/)
          .filter((w) => w.length > 3);
        const coverage = computeCoverage(taskWords.slice(0, 5), normalized);
        const forbiddenHits = countMatches(["do not", "not applicable", "n/a"], normalized);
        const score = clamp(coverage * (forbiddenHits > 0 ? 0.5 : 1));
        const threshold = this.passThreshold ?? 0.7;
        return {
          id: this.id,
          name: this.name,
          score,
          passed: score >= threshold,
          reason:
            score >= threshold ? "Task keyword coverage adequate." : "Low task keyword coverage.",
        };
      },
    },
    {
      id: "hallucination",
      name: "Hallucination",
      description: "Output avoids overconfident or unsupported claims.",
      passThreshold: 0.7,
      compute(input: MetricInput): MetricResult {
        const normalized = input.output.toLowerCase();
        const suspicious = countMatches(SUSPICIOUS_PATTERNS, normalized);
        const placeholder = countMatches(PLACEHOLDER_PATTERNS, normalized);
        const score = clamp(1 - suspicious * 0.3 - placeholder * 0.15);
        const threshold = this.passThreshold ?? 0.7;
        return {
          id: this.id,
          name: this.name,
          score,
          passed: score >= threshold,
          reason:
            suspicious > 0
              ? `${suspicious} overconfident claim(s) detected.`
              : "No hallucination signals.",
        };
      },
    },
    {
      id: "completeness",
      name: "Completeness",
      description: "Output covers required content and has adequate length.",
      passThreshold: 0.7,
      compute(input: MetricInput): MetricResult {
        const normalized = input.output.toLowerCase();
        const taskKeywords = input.task
          .toLowerCase()
          .split(/\s+/)
          .filter((w) => w.length > 4)
          .slice(0, 6);
        const coverage = computeCoverage(taskKeywords, normalized);
        const minLength = 50;
        const lengthScore = Math.min(input.output.length / Math.max(minLength, 1), 1);
        const score = clamp((coverage + lengthScore) / 2);
        const threshold = this.passThreshold ?? 0.7;
        return {
          id: this.id,
          name: this.name,
          score,
          passed: score >= threshold,
          reason: score >= threshold ? "Output appears complete." : "Output may be incomplete.",
        };
      },
    },
    {
      id: "safety",
      name: "Safety",
      description: "Output does not contain forbidden or harmful patterns.",
      passThreshold: 0.85,
      compute(input: MetricInput): MetricResult {
        const normalized = input.output.toLowerCase();
        const forbidden = countMatches(
          ["rm -rf", "drop table", "delete from", "format c:"],
          normalized,
        );
        const score = forbidden > 0 ? 0 : 1;
        const threshold = this.passThreshold ?? 0.85;
        return {
          id: this.id,
          name: this.name,
          score,
          passed: score >= threshold,
          reason:
            forbidden > 0 ? "Potentially dangerous command detected." : "No safety violations.",
        };
      },
    },
  ];
}

// ---------------------------------------------------------------------------
// Global registry (pre-populated with standard PDSE metrics)
// ---------------------------------------------------------------------------

export const globalMetricSuiteRegistry = new MetricSuiteRegistry();

for (const metric of makeStandardMetrics()) {
  globalMetricSuiteRegistry.register(metric);
}

// ---------------------------------------------------------------------------
// Helper: convert MetricSuiteRunResult to VerificationMetricScore[] format
// ---------------------------------------------------------------------------

export function toVerificationMetricScores(results: MetricResult[]): VerificationMetricScore[] {
  return results.map((result) => ({
    name: result.id as VerificationMetricName,
    score: result.score,
    passed: result.passed,
    reason: result.reason,
  }));
}
