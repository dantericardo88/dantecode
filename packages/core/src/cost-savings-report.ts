// ============================================================================
// @dantecode/core — Cost Savings Report
// Computes actual savings from fast-tier routing and emits to disk.
// ============================================================================

import { appendFileSync, mkdirSync, readFileSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";

export interface CostSavingsEntry {
  timestamp: string;
  sessionId: string;
  fastTierRequests: number;
  defaultTierCostPerRequest: number;
  fastTierCostPerRequest: number;
  savedDollars: number;
  tasksCompleted: number;
  costPerSuccess: number;
}

export interface CostSavingsSummary {
  totalFastTierRequests: number;
  totalSavedDollars: number;
  avgCostPerSuccess: number;
  savingsPercent: number;
  sessionCount: number;
}

const SAVINGS_FILE = ".danteforge/cost-savings-report.json";

export function computeSessionSavings(opts: {
  sessionId: string;
  fastTierRequests: number;
  defaultTierCostPerRequest?: number;
  fastTierCostPerRequest?: number;
  tasksCompleted: number;
  totalSpent?: number;
  projectRoot?: string;
}): CostSavingsEntry {
  const defaultCost = opts.defaultTierCostPerRequest ?? 0.0035;
  const fastCost = opts.fastTierCostPerRequest ?? 0.00035;
  const savedDollars = opts.fastTierRequests * (defaultCost - fastCost);
  const totalSpent = opts.totalSpent ?? opts.fastTierRequests * fastCost;
  const costPerSuccess = opts.tasksCompleted > 0 ? totalSpent / opts.tasksCompleted : totalSpent;

  const entry: CostSavingsEntry = {
    timestamp: new Date().toISOString(),
    sessionId: opts.sessionId,
    fastTierRequests: opts.fastTierRequests,
    defaultTierCostPerRequest: defaultCost,
    fastTierCostPerRequest: fastCost,
    savedDollars: Math.round(savedDollars * 10000) / 10000,
    tasksCompleted: opts.tasksCompleted,
    costPerSuccess: Math.round(costPerSuccess * 10000) / 10000,
  };

  const root = opts.projectRoot ?? resolve(process.cwd());
  try {
    mkdirSync(join(root, ".danteforge"), { recursive: true });
    appendFileSync(join(root, SAVINGS_FILE), JSON.stringify(entry) + "\n", "utf-8");
  } catch {
    // non-fatal
  }

  return entry;
}

export function loadCostSavingsReport(projectRoot?: string): CostSavingsEntry[] {
  const root = projectRoot ?? resolve(process.cwd());
  const logPath = join(root, SAVINGS_FILE);
  if (!existsSync(logPath)) return [];
  try {
    return readFileSync(logPath, "utf-8")
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((l) => JSON.parse(l) as CostSavingsEntry);
  } catch {
    return [];
  }
}

export function summarizeCostSavings(entries: CostSavingsEntry[]): CostSavingsSummary {
  if (entries.length === 0) {
    return { totalFastTierRequests: 0, totalSavedDollars: 0, avgCostPerSuccess: 0, savingsPercent: 0, sessionCount: 0 };
  }
  const totalFastTierRequests = entries.reduce((s, e) => s + e.fastTierRequests, 0);
  const totalSavedDollars = entries.reduce((s, e) => s + e.savedDollars, 0);
  const avgCostPerSuccess = entries.reduce((s, e) => s + e.costPerSuccess, 0) / entries.length;
  const totalDefaultSpend = entries.reduce((s, e) => s + e.fastTierRequests * e.defaultTierCostPerRequest, 0);
  const savingsPercent = totalDefaultSpend > 0 ? (totalSavedDollars / totalDefaultSpend) * 100 : 0;
  return {
    totalFastTierRequests,
    totalSavedDollars: Math.round(totalSavedDollars * 10000) / 10000,
    avgCostPerSuccess: Math.round(avgCostPerSuccess * 10000) / 10000,
    savingsPercent: Math.round(savingsPercent * 10) / 10,
    sessionCount: entries.length,
  };
}
