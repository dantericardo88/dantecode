import type { RunResult } from "./instance-runner.js";

export interface ScoreResult {
  total: number;
  resolved: number;
  failed: number;
  errors: number;
  resolvedRate: number;
  instanceResults: Map<string, RunResult["status"]>;
}

/**
 * Score a collection of SWE-bench run results.
 * Counts how many instances were resolved, failed, or errored,
 * and computes the overall resolved rate.
 */
export function scoreResults(results: RunResult[]): ScoreResult {
  const instanceResults = new Map<string, RunResult["status"]>();
  let resolved = 0;
  let failed = 0;
  let errors = 0;

  for (const result of results) {
    instanceResults.set(result.instanceId, result.status);

    switch (result.status) {
      case "resolved":
        resolved++;
        break;
      case "failed":
        failed++;
        break;
      case "error":
      case "timeout":
        errors++;
        break;
    }
  }

  const total = results.length;
  const resolvedRate = total === 0 ? 0 : resolved / total;

  return {
    total,
    resolved,
    failed,
    errors,
    resolvedRate,
    instanceResults,
  };
}

export interface ComparisonResult {
  delta: number;
  improvement: string;
}

/**
 * Compare two SWE-bench runs (A/B test).
 * Typically used to measure DanteForge improvement:
 *   withForge vs withoutForge
 *
 * Returns the absolute delta in resolved rate and a human-readable summary.
 */
export function compareRuns(
  withForge: ScoreResult,
  withoutForge: ScoreResult,
): ComparisonResult {
  const delta = withForge.resolvedRate - withoutForge.resolvedRate;
  const deltaPercent = (delta * 100).toFixed(1);
  const absDeltaPercent = (Math.abs(delta) * 100).toFixed(1);

  let improvement: string;

  if (delta > 0) {
    improvement = `DanteForge improved resolved rate by +${deltaPercent}% (${withForge.resolved}/${withForge.total} vs ${withoutForge.resolved}/${withoutForge.total})`;
  } else if (delta < 0) {
    improvement = `DanteForge regressed resolved rate by -${absDeltaPercent}% (${withForge.resolved}/${withForge.total} vs ${withoutForge.resolved}/${withoutForge.total})`;
  } else {
    improvement = `No difference in resolved rate (${withForge.resolved}/${withForge.total} vs ${withoutForge.resolved}/${withoutForge.total})`;
  }

  return { delta, improvement };
}
