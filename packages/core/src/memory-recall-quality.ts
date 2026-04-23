// ============================================================================
// @dantecode/core — Memory Recall Quality Tracker
// Records which recalled memories led to successful task outcomes,
// enabling outcome-linked recall improvement.
// ============================================================================

import { appendFileSync, mkdirSync, readFileSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";

export interface MemoryRecallRecord {
  timestamp: string;
  sessionId: string;
  recalledKeys: string[];
  taskDescription: string;
  taskOutcome: "success" | "partial" | "failure";
  relevanceScores?: Record<string, number>;
  improvementNote?: string;
}

export interface RecallQualitySummary {
  totalRecalls: number;
  successRate: number;
  topPerformingKeys: string[];
  lowPerformingKeys: string[];
  avgRelevanceScore: number;
}

const LOG_FILE = ".danteforge/memory-recall-quality.json";

export function recordMemoryRecall(
  record: Omit<MemoryRecallRecord, "timestamp">,
  projectRoot?: string,
): void {
  const root = projectRoot ?? resolve(process.cwd());
  const logPath = join(root, LOG_FILE);
  try {
    mkdirSync(join(root, ".danteforge"), { recursive: true });
    const entry: MemoryRecallRecord = { timestamp: new Date().toISOString(), ...record };
    appendFileSync(logPath, JSON.stringify(entry) + "\n", "utf-8");
  } catch {
    // non-fatal
  }
}

export function summarizeRecallQuality(records: MemoryRecallRecord[]): RecallQualitySummary {
  if (records.length === 0) {
    return { totalRecalls: 0, successRate: 0, topPerformingKeys: [], lowPerformingKeys: [], avgRelevanceScore: 0 };
  }

  const successCount = records.filter((r) => r.taskOutcome === "success").length;
  const successRate = successCount / records.length;

  // Track key performance
  const keySuccessCount: Record<string, number> = {};
  const keyTotalCount: Record<string, number> = {};
  let totalRelevance = 0;
  let relevanceCount = 0;

  for (const record of records) {
    for (const key of record.recalledKeys) {
      keyTotalCount[key] = (keyTotalCount[key] ?? 0) + 1;
      if (record.taskOutcome === "success") {
        keySuccessCount[key] = (keySuccessCount[key] ?? 0) + 1;
      }
    }
    if (record.relevanceScores) {
      for (const score of Object.values(record.relevanceScores)) {
        totalRelevance += score;
        relevanceCount++;
      }
    }
  }

  const keySuccessRates = Object.keys(keyTotalCount).map((key) => ({
    key,
    rate: (keySuccessCount[key] ?? 0) / keyTotalCount[key]!,
  }));

  keySuccessRates.sort((a, b) => b.rate - a.rate);
  const topPerformingKeys = keySuccessRates.slice(0, 5).map((k) => k.key);
  const lowPerformingKeys = keySuccessRates.slice(-3).map((k) => k.key).reverse();
  const avgRelevanceScore = relevanceCount > 0 ? totalRelevance / relevanceCount : 0;

  return { totalRecalls: records.length, successRate, topPerformingKeys, lowPerformingKeys, avgRelevanceScore };
}

export function loadRecallQualityLog(projectRoot?: string): MemoryRecallRecord[] {
  const root = projectRoot ?? resolve(process.cwd());
  const logPath = join(root, LOG_FILE);
  if (!existsSync(logPath)) return [];
  try {
    return readFileSync(logPath, "utf-8")
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((l) => JSON.parse(l) as MemoryRecallRecord);
  } catch {
    return [];
  }
}
