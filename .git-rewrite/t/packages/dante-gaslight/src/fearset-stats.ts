/**
 * fearset-stats.ts
 *
 * Aggregate stats over a collection of FearSetResult records.
 */

import type { FearSetResult } from "@dantecode/runtime-spine";

export interface FearSetStats {
  totalRuns: number;
  passedRuns: number;
  failedRuns: number;
  reviewRequiredRuns: number;
  distilledRuns: number;
  averageRobustnessScore: number;
  averageRiskReduction: number;
  simulationCoverage: number; // fraction of runs with at least one simulation
  triggerChannelBreakdown: Record<string, number>;
}

export function computeFearSetStats(results: FearSetResult[]): FearSetStats {
  if (results.length === 0) {
    return {
      totalRuns: 0,
      passedRuns: 0,
      failedRuns: 0,
      reviewRequiredRuns: 0,
      distilledRuns: 0,
      averageRobustnessScore: 0,
      averageRiskReduction: 0,
      simulationCoverage: 0,
      triggerChannelBreakdown: {},
    };
  }

  let passed = 0;
  let failed = 0;
  let reviewRequired = 0;
  let distilled = 0;
  let robustnessSum = 0;
  let riskReductionSum = 0;
  let simulatedRuns = 0;
  const channelBreakdown: Record<string, number> = {};

  for (const r of results) {
    if (r.passed) passed++;
    const gd = r.robustnessScore?.gateDecision;
    if (gd === "fail") failed++;
    else if (gd === "review-required") reviewRequired++;
    if (r.distilledAt) distilled++;

    robustnessSum += r.robustnessScore?.overall ?? 0;
    riskReductionSum += r.robustnessScore?.estimatedRiskReduction ?? 0;
    if (r.robustnessScore?.hasSimulationEvidence) simulatedRuns++;

    const ch = r.trigger.channel;
    channelBreakdown[ch] = (channelBreakdown[ch] ?? 0) + 1;
  }

  return {
    totalRuns: results.length,
    passedRuns: passed,
    failedRuns: failed,
    reviewRequiredRuns: reviewRequired,
    distilledRuns: distilled,
    averageRobustnessScore: robustnessSum / results.length,
    averageRiskReduction: riskReductionSum / results.length,
    simulationCoverage: simulatedRuns / results.length,
    triggerChannelBreakdown: channelBreakdown,
  };
}

export function formatFearSetStats(stats: FearSetStats): string {
  const pct = (n: number, total: number) =>
    total === 0 ? "0%" : `${Math.round((n / total) * 100)}%`;
  return [
    `DanteFearSet Stats:`,
    `  Total runs: ${stats.totalRuns}`,
    `  Passed: ${stats.passedRuns} (${pct(stats.passedRuns, stats.totalRuns)})`,
    `  Failed: ${stats.failedRuns}`,
    `  Review required: ${stats.reviewRequiredRuns}`,
    `  Distilled to Skillbook: ${stats.distilledRuns}`,
    `  Avg robustness score: ${stats.averageRobustnessScore.toFixed(2)}`,
    `  Avg risk reduction: ${(stats.averageRiskReduction * 100).toFixed(0)}%`,
    `  Simulation coverage: ${(stats.simulationCoverage * 100).toFixed(0)}%`,
    `  Triggers: ${Object.entries(stats.triggerChannelBreakdown)
      .map(([k, v]) => `${k}=${v}`)
      .join(", ")}`,
  ].join("\n");
}
