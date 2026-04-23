// ============================================================================
// @dantecode/core — Outcome-Aware Retry (Sprint AE — dim 15)
// Reads task-outcomes.json to surface past failure modes for similar tasks,
// enabling anti-pattern injection at session start.
// ============================================================================

import { readFileSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import type { TaskOutcome } from "./task-outcome-tracker.js";

export interface PastFailureContext {
  failureModes: string[];
  recentFailureCount: number;
  successRate: number;
  antiPatternPrompt: string;
}

const LOG_FILE = ".danteforge/task-outcomes.json";

function tokenizeDescription(desc: string): Set<string> {
  return new Set(
    desc
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .split(/\s+/)
      .filter((w) => w.length > 3),
  );
}

function descriptionSimilarity(a: string, b: string): number {
  const ta = tokenizeDescription(a);
  const tb = tokenizeDescription(b);
  if (ta.size === 0 || tb.size === 0) return 0;
  let intersection = 0;
  for (const w of ta) {
    if (tb.has(w)) intersection++;
  }
  return intersection / Math.max(ta.size, tb.size);
}

export function lookupRecentFailureModes(
  taskDescription: string,
  projectRoot?: string,
  opts?: { limit?: number; similarityThreshold?: number },
): PastFailureContext {
  const root = projectRoot ?? resolve(process.cwd());
  const logPath = join(root, LOG_FILE);

  const empty: PastFailureContext = {
    failureModes: [],
    recentFailureCount: 0,
    successRate: 1,
    antiPatternPrompt: "",
  };

  if (!existsSync(logPath)) return empty;

  let outcomes: TaskOutcome[] = [];
  try {
    outcomes = readFileSync(logPath, "utf-8")
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((l) => JSON.parse(l) as TaskOutcome);
  } catch {
    return empty;
  }

  const limit = opts?.limit ?? 10;
  const threshold = opts?.similarityThreshold ?? 0.2;
  const recent = outcomes.slice(-limit);

  const similar = recent.filter(
    (o) => descriptionSimilarity(taskDescription, o.description) >= threshold,
  );

  const failures = similar.filter((o) => o.status !== "success");
  const failureModes = [
    ...new Set(failures.map((o) => o.failureMode).filter(Boolean) as string[]),
  ];

  const successRate = similar.length > 0
    ? similar.filter((o) => o.status === "success").length / similar.length
    : 1;

  let antiPatternPrompt = "";
  if (failureModes.length > 0) {
    antiPatternPrompt =
      `[Past failure modes for similar tasks]: ${failureModes.join(", ")}. ` +
      `Avoid these patterns in your approach.`;
  }

  return {
    failureModes,
    recentFailureCount: failures.length,
    successRate,
    antiPatternPrompt,
  };
}
