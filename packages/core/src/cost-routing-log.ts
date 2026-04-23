// packages/core/src/cost-routing-log.ts
// Sprint AX — Dim 27: Cost-per-success metric.
// Splits session cost by task success/failure, proving DanteCode is
// cost-efficient on tasks it succeeds at (ratio < 1.0 is the evidence).
import { appendFileSync, readFileSync, existsSync, mkdirSync } from "node:fs";
import { join, resolve } from "node:path";

export interface CostPerTaskEntry {
  sessionId: string;
  totalCostUsd: number;
  taskSucceeded: boolean;
  timestamp: string;
}

export interface CostPerSuccessRatio {
  avgCostSucceeded: number;
  avgCostFailed: number;
  /** avgCostSucceeded / avgCostFailed — ratio < 1.0 = cost-efficient on successes. 0 if no failed tasks. */
  ratio: number;
}

const COST_FILE = ".danteforge/cost-per-success-log.json";

/** Append a cost-per-task entry to .danteforge/cost-per-success-log.json (JSONL). */
export function recordCostPerTaskOutcome(
  sessionId: string,
  totalCostUsd: number,
  taskSucceeded: boolean,
  projectRoot?: string,
): void {
  try {
    const root = resolve(projectRoot ?? process.cwd());
    mkdirSync(join(root, ".danteforge"), { recursive: true });
    const record: CostPerTaskEntry = { sessionId, totalCostUsd, taskSucceeded, timestamp: new Date().toISOString() };
    appendFileSync(join(root, COST_FILE), JSON.stringify(record) + "\n", "utf-8");
  } catch { /* non-fatal */ }
}

/** Load all cost-per-task entries from .danteforge/cost-per-success-log.json. */
export function loadCostPerTaskOutcomes(projectRoot?: string): CostPerTaskEntry[] {
  const root = resolve(projectRoot ?? process.cwd());
  const path = join(root, COST_FILE);
  if (!existsSync(path)) return [];
  try {
    return readFileSync(path, "utf-8")
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((l) => JSON.parse(l) as CostPerTaskEntry);
  } catch { return []; }
}

/** Compute cost-efficiency ratio: avgCostSucceeded / avgCostFailed. */
export function getCostPerSuccessRatio(entries: CostPerTaskEntry[]): CostPerSuccessRatio {
  const succeeded = entries.filter((e) => e.taskSucceeded);
  const failed = entries.filter((e) => !e.taskSucceeded);

  const avg = (arr: CostPerTaskEntry[]) =>
    arr.length === 0 ? 0 : arr.reduce((s, e) => s + e.totalCostUsd, 0) / arr.length;

  const avgCostSucceeded = avg(succeeded);
  const avgCostFailed = avg(failed);
  const ratio = avgCostFailed === 0 ? 0 : avgCostSucceeded / avgCostFailed;

  return { avgCostSucceeded, avgCostFailed, ratio };
}
