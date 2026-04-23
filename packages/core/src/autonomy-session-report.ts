// ============================================================================
// @dantecode/core — Autonomy Session Report (dim 7)
// Builds, records, and aggregates per-session autonomy metrics.
// Persists JSONL to .danteforge/autonomy-session-report.json
// ============================================================================

import { appendFileSync, mkdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

export interface AutonomySessionSummary {
  sessionId: string;
  totalTurns: number;
  tasksAttempted: number;
  tasksCompleted: number;
  toolCallsTotal: number;
  filesModified: number;
  /** 0-1: tasksCompleted/tasksAttempted * (1 - interventionRate) */
  autonomyScore: number;
  /** Fraction of turns where user intervened (stopped/redirected) */
  interventionRate: number;
  timestamp: string;
}

export interface AutonomyReportEntry extends AutonomySessionSummary {
  /** Up to 3 failure reasons */
  topBlockers: string[];
}

/**
 * Builds an AutonomyReportEntry from raw session counters.
 *
 * autonomyScore = tasksAttempted > 0
 *   ? (tasksCompleted / tasksAttempted) * (1 - interventionRate)
 *   : 0
 * interventionRate = turns > 0 ? userInterventions / turns : 0
 */
export function buildAutonomySessionSummary(
  sessionId: string,
  turns: number,
  tasksAttempted: number,
  tasksCompleted: number,
  toolCalls: number,
  filesModified: number,
  userInterventions: number,
  blockers?: string[],
): AutonomyReportEntry {
  const interventionRate = turns > 0 ? userInterventions / turns : 0;
  const autonomyScore =
    tasksAttempted > 0
      ? (tasksCompleted / tasksAttempted) * (1 - interventionRate)
      : 0;

  return {
    sessionId,
    totalTurns: turns,
    tasksAttempted,
    tasksCompleted,
    toolCallsTotal: toolCalls,
    filesModified,
    autonomyScore: Math.max(0, Math.min(1, autonomyScore)),
    interventionRate: Math.max(0, Math.min(1, interventionRate)),
    topBlockers: (blockers ?? []).slice(0, 3),
    timestamp: new Date().toISOString(),
  };
}

const REPORT_FILE = ".danteforge/autonomy-session-report.json";

/**
 * Appends an AutonomyReportEntry as a JSONL line to
 * .danteforge/autonomy-session-report.json
 */
export function recordAutonomyReport(
  entry: AutonomyReportEntry,
  projectRoot?: string,
): void {
  const root = resolve(projectRoot ?? process.cwd());
  const filePath = join(root, REPORT_FILE);
  try {
    mkdirSync(join(root, ".danteforge"), { recursive: true });
    appendFileSync(filePath, JSON.stringify(entry) + "\n", "utf-8");
  } catch {
    // non-fatal
  }
}

/**
 * Reads and parses the JSONL autonomy-session-report.json file.
 * Returns an empty array if the file is missing or malformed.
 */
export function loadAutonomyReports(projectRoot?: string): AutonomyReportEntry[] {
  const root = resolve(projectRoot ?? process.cwd());
  const filePath = join(root, REPORT_FILE);
  try {
    const raw = readFileSync(filePath, "utf-8");
    return raw
      .split("\n")
      .filter((line) => line.trim().length > 0)
      .map((line) => JSON.parse(line) as AutonomyReportEntry);
  } catch {
    return [];
  }
}

/**
 * Aggregates multiple AutonomyReportEntry records into summary stats.
 * topBlockers are unioned, deduped, and sorted by descending frequency.
 */
export function getAutonomyStats(entries: AutonomyReportEntry[]): {
  avgAutonomyScore: number;
  avgInterventionRate: number;
  totalTasksCompleted: number;
  totalTasksAttempted: number;
  topBlockers: string[];
} {
  if (entries.length === 0) {
    return {
      avgAutonomyScore: 0,
      avgInterventionRate: 0,
      totalTasksCompleted: 0,
      totalTasksAttempted: 0,
      topBlockers: [],
    };
  }

  let sumAutonomy = 0;
  let sumIntervention = 0;
  let totalCompleted = 0;
  let totalAttempted = 0;
  const blockerFreq = new Map<string, number>();

  for (const entry of entries) {
    sumAutonomy += entry.autonomyScore;
    sumIntervention += entry.interventionRate;
    totalCompleted += entry.tasksCompleted;
    totalAttempted += entry.tasksAttempted;
    for (const b of entry.topBlockers) {
      blockerFreq.set(b, (blockerFreq.get(b) ?? 0) + 1);
    }
  }

  const topBlockers = [...blockerFreq.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([blocker]) => blocker);

  return {
    avgAutonomyScore: sumAutonomy / entries.length,
    avgInterventionRate: sumIntervention / entries.length,
    totalTasksCompleted: totalCompleted,
    totalTasksAttempted: totalAttempted,
    topBlockers,
  };
}
