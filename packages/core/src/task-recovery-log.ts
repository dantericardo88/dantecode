// Sprint AM — Dim 15: Task recovery log
// Records what went wrong and what fix was applied per repair attempt.
// getTopRecoveryPatterns() surfaces the most successful strategies for
// injection at session start as an anti-pattern brief.
import { appendFileSync, readFileSync, existsSync, mkdirSync } from "node:fs";
import { join, resolve } from "node:path";

export interface TaskRecoveryEntry {
  timestamp: string;
  taskId: string;
  attempt: number;
  failureMode: string;
  fixApplied: string;
  succeeded: boolean;
  durationMs?: number;
}

export interface RecoveryPattern {
  failureMode: string;
  bestFix: string;
  successRate: number;
  totalAttempts: number;
}

const RECOVERY_FILE = ".danteforge/task-recovery-log.json";

/** Append a repair attempt record to .danteforge/task-recovery-log.json. */
export function recordTaskRecovery(
  entry: Omit<TaskRecoveryEntry, "timestamp">,
  projectRoot = process.cwd(),
): void {
  try {
    const root = resolve(projectRoot);
    mkdirSync(join(root, ".danteforge"), { recursive: true });
    const record: TaskRecoveryEntry = { timestamp: new Date().toISOString(), ...entry };
    appendFileSync(join(root, RECOVERY_FILE), JSON.stringify(record) + "\n", "utf-8");
  } catch { /* non-fatal */ }
}

/** Load all recovery records from disk. */
export function loadTaskRecoveryLog(projectRoot = process.cwd()): TaskRecoveryEntry[] {
  const root = resolve(projectRoot);
  const path = join(root, RECOVERY_FILE);
  if (!existsSync(path)) return [];
  try {
    return readFileSync(path, "utf-8")
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((l) => JSON.parse(l) as TaskRecoveryEntry);
  } catch { return []; }
}

/**
 * Compute the most successful fix strategies, sorted by success rate.
 * Returns top N patterns for injection into the agent session prompt.
 */
export function getTopRecoveryPatterns(projectRoot = process.cwd(), limit = 5): RecoveryPattern[] {
  const entries = loadTaskRecoveryLog(projectRoot);
  if (entries.length === 0) return [];

  // Group by (failureMode, fixApplied)
  const map = new Map<string, { success: number; total: number; fix: string; mode: string }>();
  for (const e of entries) {
    const key = `${e.failureMode}::${e.fixApplied}`;
    const existing = map.get(key) ?? { success: 0, total: 0, fix: e.fixApplied, mode: e.failureMode };
    existing.total++;
    if (e.succeeded) existing.success++;
    map.set(key, existing);
  }

  return Array.from(map.values())
    .map((v) => ({
      failureMode: v.mode,
      bestFix: v.fix,
      successRate: v.total > 0 ? v.success / v.total : 0,
      totalAttempts: v.total,
    }))
    .sort((a, b) => b.successRate - a.successRate || b.totalAttempts - a.totalAttempts)
    .slice(0, limit);
}

// Sprint BQ — Dim 15: Recovery stats + failure-mode grouping

export interface RecoveryStats {
  totalAttempts: number;
  successRate: number;               // fraction where outcome === "success" / succeeded === true
  avgAttemptsBeforeSuccess: number;  // avg attempt number for successful entries
  mostCommonFailureMode: string;     // most frequent failureMode string (empty if none)
  recentTrend: "improving" | "stable" | "declining";
}

/**
 * Group recovery entries by failureMode and return counts.
 */
export function groupByFailureMode(entries: TaskRecoveryEntry[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const entry of entries) {
    const mode = entry.failureMode ?? "unknown";
    counts[mode] = (counts[mode] ?? 0) + 1;
  }
  return counts;
}

/**
 * Compute aggregate recovery statistics from a list of TaskRecoveryEntry records.
 * Trend compares success rate of last 5 vs prior 5 entries:
 *   last5 >= prior5 + 0.1  → "improving"
 *   last5 <  prior5 - 0.1  → "declining"
 *   otherwise              → "stable"
 */
export function getRecoveryStats(entries: TaskRecoveryEntry[]): RecoveryStats {
  if (entries.length === 0) {
    return {
      totalAttempts: 0,
      successRate: 0,
      avgAttemptsBeforeSuccess: 0,
      mostCommonFailureMode: "",
      recentTrend: "stable",
    };
  }

  const totalAttempts = entries.length;
  const successfulEntries = entries.filter((e) => e.succeeded);
  const successRate = successfulEntries.length / totalAttempts;

  const avgAttemptsBeforeSuccess =
    successfulEntries.length > 0
      ? successfulEntries.reduce((sum, e) => sum + e.attempt, 0) / successfulEntries.length
      : 0;

  // Most common failureMode
  const modeCounts = groupByFailureMode(entries);
  let mostCommonFailureMode = "";
  let maxCount = 0;
  for (const [mode, count] of Object.entries(modeCounts)) {
    if (count > maxCount) {
      maxCount = count;
      mostCommonFailureMode = mode;
    }
  }

  // Trend: compare last 5 vs prior 5
  const sorted = [...entries].sort(
    (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime(),
  );
  const last5 = sorted.slice(-5);
  const prior5 = sorted.slice(-10, -5);
  let recentTrend: RecoveryStats["recentTrend"] = "stable";
  if (prior5.length > 0) {
    const last5Rate = last5.filter((e) => e.succeeded).length / last5.length;
    const prior5Rate = prior5.filter((e) => e.succeeded).length / prior5.length;
    if (last5Rate >= prior5Rate + 0.1) recentTrend = "improving";
    else if (last5Rate < prior5Rate - 0.1) recentTrend = "declining";
  }

  return { totalAttempts, successRate, avgAttemptsBeforeSuccess, mostCommonFailureMode, recentTrend };
}

// Sprint BR — Dim 15: TaskRecoveryReporter

export interface TaskRecoveryStats {
  totalRecoveries: number;
  successfulRecoveries: number;
  recoverySuccessRate: number;
  avgRetriesBeforeSuccess: number;
  mostCommonErrors: string[];
  avgRecoveryDurationMs: number;
}

const RECOVERY_STATS_FILE = ".danteforge/task-recovery-stats.json";

/**
 * Compute TaskRecoveryStats from an array of TaskRecoveryEntry records.
 * Uses `succeeded` for success flag, `attempt` for retry count, `durationMs` for duration.
 */
export function getTaskRecoveryStats(entries: TaskRecoveryEntry[]): TaskRecoveryStats {
  if (entries.length === 0) {
    return {
      totalRecoveries: 0,
      successfulRecoveries: 0,
      recoverySuccessRate: 0,
      avgRetriesBeforeSuccess: 0,
      mostCommonErrors: [],
      avgRecoveryDurationMs: 0,
    };
  }

  const totalRecoveries = entries.length;
  const successful = entries.filter((e) => e.succeeded);
  const successfulRecoveries = successful.length;
  const recoverySuccessRate = successfulRecoveries / totalRecoveries;

  const avgRetriesBeforeSuccess =
    successful.length > 0
      ? successful.reduce((sum, e) => sum + e.attempt, 0) / successful.length
      : 0;

  // Count failureMode frequencies
  const errorCounts = new Map<string, number>();
  for (const e of entries) {
    const mode = e.failureMode ?? "unknown";
    errorCounts.set(mode, (errorCounts.get(mode) ?? 0) + 1);
  }
  const mostCommonErrors = Array.from(errorCounts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([mode]) => mode);

  const entriesWithDuration = entries.filter((e) => typeof e.durationMs === "number");
  const avgRecoveryDurationMs =
    entriesWithDuration.length > 0
      ? entriesWithDuration.reduce((sum, e) => sum + (e.durationMs ?? 0), 0) / entriesWithDuration.length
      : 0;

  return {
    totalRecoveries,
    successfulRecoveries,
    recoverySuccessRate,
    avgRetriesBeforeSuccess,
    mostCommonErrors,
    avgRecoveryDurationMs,
  };
}

/** Append a TaskRecoveryStats snapshot to .danteforge/task-recovery-stats.json (JSONL). */
export function recordTaskRecoveryStats(
  stats: TaskRecoveryStats,
  projectRoot = process.cwd(),
): void {
  try {
    const root = resolve(projectRoot);
    mkdirSync(join(root, ".danteforge"), { recursive: true });
    const record = { ...stats, timestamp: new Date().toISOString() };
    appendFileSync(
      join(root, RECOVERY_STATS_FILE),
      JSON.stringify(record) + "\n",
      "utf-8",
    );
  } catch { /* non-fatal */ }
}

/** Load all TaskRecoveryStats snapshots from disk. */
export function loadTaskRecoveryStats(
  projectRoot = process.cwd(),
): Array<TaskRecoveryStats & { timestamp: string }> {
  const root = resolve(projectRoot);
  const path = join(root, RECOVERY_STATS_FILE);
  if (!existsSync(path)) return [];
  try {
    return readFileSync(path, "utf-8")
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((l) => JSON.parse(l) as TaskRecoveryStats & { timestamp: string });
  } catch {
    return [];
  }
}

/** Format top patterns as a [Recovery brief] prompt segment. */
export function buildRecoveryBrief(patterns: RecoveryPattern[]): string {
  if (patterns.length === 0) return "";
  const lines = patterns
    .filter((p) => p.successRate > 0)
    .slice(0, 3)
    .map((p) => `  • When "${p.failureMode}": apply "${p.bestFix}" (${Math.round(p.successRate * 100)}% success)`);
  if (lines.length === 0) return "";
  return `[Recovery brief] Proven fixes from past sessions:\n${lines.join("\n")}`;
}
