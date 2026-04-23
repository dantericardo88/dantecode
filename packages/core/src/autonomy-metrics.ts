// Sprint AM — Dim 7: Autonomy convergence metrics
// Tracks whether tasks finish cleanly (without user intervention or loop detection)
// and computes a convergence rate that measures autonomous task completion quality.
import { appendFileSync, readFileSync, existsSync, mkdirSync } from "node:fs";
import { join, resolve } from "node:path";

export interface AutonomyConvergenceEntry {
  timestamp: string;
  taskId: string;
  roundsUsed: number;
  maxRounds: number;
  finishedCleanly: boolean;
  loopDetected: boolean;
  userInterventions: number;
  status: "complete" | "partial" | "failed" | "loop";
}

export interface AutonomyConvergenceSummary {
  totalTasks: number;
  cleanFinishes: number;
  convergenceRate: number; // cleanFinishes / totalTasks
  avgRoundsUsed: number;
  loopDetections: number;
  efficiencyScore: number; // 1 - (avgRoundsUsed / maxRounds)
}

const CONVERGENCE_FILE = ".danteforge/autonomy-convergence-log.json";

export class AutonomyMetricsTracker {
  private readonly _projectRoot: string;

  constructor(projectRoot = process.cwd()) {
    this._projectRoot = resolve(projectRoot);
  }

  /** Record one task's convergence result. */
  trackConvergence(
    taskId: string,
    roundsUsed: number,
    maxRounds: number,
    finishedCleanly: boolean,
    opts: { loopDetected?: boolean; userInterventions?: number; status?: AutonomyConvergenceEntry["status"] } = {},
  ): void {
    try {
      mkdirSync(join(this._projectRoot, ".danteforge"), { recursive: true });
      const entry: AutonomyConvergenceEntry = {
        timestamp: new Date().toISOString(),
        taskId,
        roundsUsed,
        maxRounds,
        finishedCleanly,
        loopDetected: opts.loopDetected ?? false,
        userInterventions: opts.userInterventions ?? 0,
        status: opts.status ?? (finishedCleanly ? "complete" : "failed"),
      };
      appendFileSync(
        join(this._projectRoot, CONVERGENCE_FILE),
        JSON.stringify(entry) + "\n",
        "utf-8",
      );
    } catch { /* non-fatal */ }
  }

  /** Load all convergence records. */
  loadEntries(): AutonomyConvergenceEntry[] {
    const path = join(this._projectRoot, CONVERGENCE_FILE);
    if (!existsSync(path)) return [];
    try {
      return readFileSync(path, "utf-8")
        .trim()
        .split("\n")
        .filter(Boolean)
        .map((l) => JSON.parse(l) as AutonomyConvergenceEntry);
    } catch { return []; }
  }

  /** Compute summary statistics. */
  getSummary(): AutonomyConvergenceSummary {
    return summarizeAutonomyMetrics(this.loadEntries());
  }

  /** Fraction of tasks that finished cleanly (0-1). */
  getConvergenceRate(): number {
    const entries = this.loadEntries();
    if (entries.length === 0) return 0;
    return entries.filter((e) => e.finishedCleanly).length / entries.length;
  }
}

export function summarizeAutonomyMetrics(entries: AutonomyConvergenceEntry[]): AutonomyConvergenceSummary {
  if (entries.length === 0) {
    return { totalTasks: 0, cleanFinishes: 0, convergenceRate: 0, avgRoundsUsed: 0, loopDetections: 0, efficiencyScore: 0 };
  }
  const cleanFinishes = entries.filter((e) => e.finishedCleanly).length;
  const avgRoundsUsed = entries.reduce((s, e) => s + e.roundsUsed, 0) / entries.length;
  const avgMaxRounds = entries.reduce((s, e) => s + e.maxRounds, 0) / entries.length;
  const loopDetections = entries.filter((e) => e.loopDetected).length;
  return {
    totalTasks: entries.length,
    cleanFinishes,
    convergenceRate: cleanFinishes / entries.length,
    avgRoundsUsed,
    loopDetections,
    efficiencyScore: avgMaxRounds > 0 ? Math.max(0, 1 - avgRoundsUsed / avgMaxRounds) : 0,
  };
}
