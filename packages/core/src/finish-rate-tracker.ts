// ============================================================================
// @dantecode/core — Finish-Rate Tracker (Sprint AU, Dim 15)
// Classifies task difficulty and tracks hard-task completion rates.
// ============================================================================

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";

export type TaskDifficulty = "hard" | "medium" | "easy";

export interface FinishRateEntry {
  taskId: string;
  taskDifficulty: TaskDifficulty;
  finishedCleanly: boolean;
  roundsUsed: number;
  touchedFiles: number;
  verifyPassed: boolean;
  timestamp: string;
}

export interface FinishRateStats {
  totalTasks: number;
  hardTaskFinishRate: number;
  mediumTaskFinishRate: number;
  easyTaskFinishRate: number;
  overallFinishRate: number;
}

export function classifyTaskDifficulty(
  prompt: string,
  touchedFiles: string[],
): TaskDifficulty {
  if (prompt.length > 200 || touchedFiles.length > 3) return "hard";
  if (prompt.length > 100 || touchedFiles.length > 1) return "medium";
  return "easy";
}

const LOG_REL = join(".danteforge", "finish-rate-log.json");

export function recordFinishRate(
  entry: Omit<FinishRateEntry, "timestamp">,
  projectRoot: string,
): void {
  try {
    const dir = join(projectRoot, ".danteforge");
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    const logPath = join(projectRoot, LOG_REL);
    const full: FinishRateEntry = { ...entry, timestamp: new Date().toISOString() };
    const line = JSON.stringify(full) + "\n";
    writeFileSync(logPath, line, { flag: "a" });
  } catch {
    // non-fatal
  }
}

export function loadFinishRates(projectRoot: string): FinishRateEntry[] {
  try {
    const logPath = join(projectRoot, LOG_REL);
    if (!existsSync(logPath)) return [];
    const raw = readFileSync(logPath, "utf-8");
    return raw
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line) as FinishRateEntry);
  } catch {
    return [];
  }
}

export function getFinishRateStats(entries: FinishRateEntry[]): FinishRateStats {
  const total = entries.length;
  if (total === 0) {
    return { totalTasks: 0, hardTaskFinishRate: 0, mediumTaskFinishRate: 0, easyTaskFinishRate: 0, overallFinishRate: 0 };
  }
  const rate = (subset: FinishRateEntry[]): number => {
    if (subset.length === 0) return 0;
    return subset.filter((e) => e.finishedCleanly).length / subset.length;
  };
  const hard = entries.filter((e) => e.taskDifficulty === "hard");
  const medium = entries.filter((e) => e.taskDifficulty === "medium");
  const easy = entries.filter((e) => e.taskDifficulty === "easy");
  return {
    totalTasks: total,
    hardTaskFinishRate: rate(hard),
    mediumTaskFinishRate: rate(medium),
    easyTaskFinishRate: rate(easy),
    overallFinishRate: entries.filter((e) => e.finishedCleanly).length / total,
  };
}