// ============================================================================
// @dantecode/core — Task Outcome Tracker (Sprint Z)
// Tracks the result of each agent-loop task run, appending to
// .danteforge/task-outcomes.json (JSONL). Builds a persistent record
// proving the agent loop actually completes tasks — not just attempts them.
// ============================================================================

import { appendFileSync, mkdirSync } from "node:fs";
import { join, resolve } from "node:path";

export type TaskOutcomeStatus = "success" | "partial" | "failure" | "timeout";

export interface TaskOutcome {
  timestamp: string;
  taskId: string;
  /** Short description of what the task was */
  description: string;
  status: TaskOutcomeStatus;
  /** Duration in milliseconds */
  durationMs: number;
  /** Number of tool calls made during this task */
  toolCallCount: number;
  /** Number of iterations taken */
  iterationCount: number;
  /** Optional failure mode if status=failure */
  failureMode?: string;
  /** Optional brief summary of what was accomplished */
  summary?: string;
}

/**
 * Records a task outcome to `.danteforge/task-outcomes.json` (JSONL).
 * Called at the end of each agent-loop task run so the system builds a
 * persistent record of task completion vs. failure rates over time.
 *
 * @param outcome - Task outcome data (without timestamp — added here)
 * @param projectRoot - Root of the project (defaults to cwd)
 */
export function trackTaskOutcome(
  outcome: Omit<TaskOutcome, "timestamp">,
  projectRoot?: string,
): TaskOutcome {
  const entry: TaskOutcome = {
    timestamp: new Date().toISOString(),
    ...outcome,
  };

  const root = projectRoot ?? resolve(process.cwd());
  const logPath = join(root, ".danteforge", "task-outcomes.json");
  try {
    mkdirSync(join(root, ".danteforge"), { recursive: true });
    appendFileSync(logPath, JSON.stringify(entry) + "\n", "utf-8");
  } catch { /* non-fatal */ }

  return entry;
}

/**
 * Returns a summary of task outcomes: success rate, avg duration, failure modes.
 * Reads from the task-outcomes.json file.
 */
export function summarizeTaskOutcomes(outcomes: TaskOutcome[]): {
  total: number;
  successCount: number;
  successRate: number;
  avgDurationMs: number;
  topFailureModes: string[];
} {
  const total = outcomes.length;
  if (total === 0) {
    return { total: 0, successCount: 0, successRate: 1, avgDurationMs: 0, topFailureModes: [] };
  }

  const successCount = outcomes.filter((o) => o.status === "success").length;
  const successRate = successCount / total;
  const avgDurationMs = outcomes.reduce((sum, o) => sum + o.durationMs, 0) / total;

  const failureCounts = new Map<string, number>();
  for (const o of outcomes) {
    if (o.failureMode) {
      failureCounts.set(o.failureMode, (failureCounts.get(o.failureMode) ?? 0) + 1);
    }
  }
  const topFailureModes = [...failureCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([mode]) => mode);

  return { total, successCount, successRate, avgDurationMs, topFailureModes };
}
