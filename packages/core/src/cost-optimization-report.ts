// ============================================================================
// @dantecode/core — Cost Optimization Report (dim 27)
// Identifies cost-saving opportunities and emits reports to disk.
// ============================================================================

import { appendFileSync, mkdirSync, readFileSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";

export interface CostOptimizationOpportunity {
  category: "cache_hit" | "model_downgrade" | "context_trim" | "batch_request";
  description: string;
  estimatedSavingsUsd: number;
  confidence: number;
}

export interface CostOptimizationReport {
  sessionId: string;
  totalSpentUsd: number;
  totalSavedUsd: number;
  savingsRate: number;
  opportunities: CostOptimizationOpportunity[];
  topRecommendation: string;
  generatedAt: string;
}

const OPT_REPORT_FILE = ".danteforge/cost-optimization-report.json";

export function buildCostOptimizationReport(
  sessionId: string,
  totalSpentUsd: number,
  totalSavedUsd: number,
  cacheHitRate: number,
  avgModelTier: "fast" | "balanced" | "best",
  contextUtilizationRate: number,
): CostOptimizationReport {
  const opportunities: CostOptimizationOpportunity[] = [];

  if (cacheHitRate < 0.5) {
    opportunities.push({
      category: "cache_hit",
      description:
        "Increase prompt cache hit rate by reusing system prompts across requests. " +
        `Current cache hit rate is ${Math.round(cacheHitRate * 100)}%.`,
      estimatedSavingsUsd:
        Math.round(totalSpentUsd * 0.3 * 10000) / 10000,
      confidence: 0.8,
    });
  }

  if (avgModelTier === "best") {
    opportunities.push({
      category: "model_downgrade",
      description:
        "Route routine tasks to a faster, cheaper model tier. " +
        "Many completion tasks do not require the best-tier model.",
      estimatedSavingsUsd:
        Math.round(totalSpentUsd * 0.4 * 10000) / 10000,
      confidence: 0.7,
    });
  }

  if (contextUtilizationRate < 0.6) {
    opportunities.push({
      category: "context_trim",
      description:
        "Trim context window to remove unused tokens. " +
        `Current context utilization is ${Math.round(contextUtilizationRate * 100)}%.`,
      estimatedSavingsUsd:
        Math.round(totalSpentUsd * 0.2 * 10000) / 10000,
      confidence: 0.75,
    });
  }

  // Sort by estimated savings descending to find top recommendation
  const sorted = [...opportunities].sort(
    (a, b) => b.estimatedSavingsUsd - a.estimatedSavingsUsd,
  );

  const topRecommendation =
    sorted[0]?.description ??
    "No optimization opportunities detected at current usage levels.";

  const denominator = totalSpentUsd + totalSavedUsd;
  const savingsRate =
    denominator > 0
      ? Math.round((totalSavedUsd / denominator) * 10000) / 10000
      : 0;

  return {
    sessionId,
    totalSpentUsd: Math.round(totalSpentUsd * 10000) / 10000,
    totalSavedUsd: Math.round(totalSavedUsd * 10000) / 10000,
    savingsRate,
    opportunities,
    topRecommendation,
    generatedAt: new Date().toISOString(),
  };
}

export function recordCostOptimizationReport(
  report: CostOptimizationReport,
  projectRoot?: string,
): void {
  const root = projectRoot ?? resolve(process.cwd());
  try {
    mkdirSync(join(root, ".danteforge"), { recursive: true });
    appendFileSync(
      join(root, OPT_REPORT_FILE),
      JSON.stringify(report) + "\n",
      "utf-8",
    );
  } catch {
    // non-fatal
  }
}

export function loadCostOptimizationReports(
  projectRoot?: string,
): CostOptimizationReport[] {
  const root = projectRoot ?? resolve(process.cwd());
  const logPath = join(root, OPT_REPORT_FILE);
  if (!existsSync(logPath)) return [];
  try {
    return readFileSync(logPath, "utf-8")
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((l) => JSON.parse(l) as CostOptimizationReport);
  } catch {
    return [];
  }
}

export function getCostOptimizationStats(reports: CostOptimizationReport[]): {
  totalSpentUsd: number;
  totalSavedUsd: number;
  avgSavingsRate: number;
  mostCommonOpportunity: string;
} {
  if (reports.length === 0) {
    return {
      totalSpentUsd: 0,
      totalSavedUsd: 0,
      avgSavingsRate: 0,
      mostCommonOpportunity: "none",
    };
  }

  const totalSpentUsd = reports.reduce((s, r) => s + r.totalSpentUsd, 0);
  const totalSavedUsd = reports.reduce((s, r) => s + r.totalSavedUsd, 0);
  const avgSavingsRate =
    reports.reduce((s, r) => s + r.savingsRate, 0) / reports.length;

  // Count category occurrences across all opportunities
  const catCounts: Record<string, number> = {};
  for (const r of reports) {
    for (const opp of r.opportunities) {
      catCounts[opp.category] = (catCounts[opp.category] ?? 0) + 1;
    }
  }

  const mostCommonOpportunity =
    Object.keys(catCounts).length > 0
      ? Object.keys(catCounts).reduce((a, b) =>
          (catCounts[a] ?? 0) >= (catCounts[b] ?? 0) ? a : b,
        )
      : "none";

  return {
    totalSpentUsd: Math.round(totalSpentUsd * 10000) / 10000,
    totalSavedUsd: Math.round(totalSavedUsd * 10000) / 10000,
    avgSavingsRate: Math.round(avgSavingsRate * 10000) / 10000,
    mostCommonOpportunity,
  };
}
