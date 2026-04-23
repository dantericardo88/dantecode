// ============================================================================
// @dantecode/core — Task Triage (Sprint CH2, Dim 15)
// Classifies task difficulty with assumption declaration for hard tasks.
// Decision-changing: hard tasks get assumption injection + tighter budgets.
// ============================================================================

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";

export interface TaskClassification {
  difficulty: "easy" | "hard";
  reason: string;
  assumptionText: string;
}

export type TaskCompletionVerdict = "COMPLETED" | "ATTEMPTED" | "FAILED";

export interface TaskCompletionEntry {
  sessionId: string;
  prompt: string;
  verdict: TaskCompletionVerdict;
  reason: string;
  toolCallCount: number;
  timestamp: string;
}

const VAGUE_VERBS = ["improve", "make", "fix", "update", "clean", "refactor", "optimize", "enhance"];
const MULTI_FILE_PATTERNS = /\b(all|every|across|multiple)\s+(file|module|package|component)/i;
const FILE_PATH_RE = /\.[a-z]{1,4}(:[0-9]+)?|src\/|packages\/|lib\/|tests?\//i;
const ACCEPTANCE_CRITERIA_RE = /\b(should|must|assert|expect|test|verify|ensure|validate)\b/i;
const SPECIFIC_IDENTIFIER_RE = /[A-Z][a-z]+[A-Z]|`[^`]+`|"[^"]+"|'[^']+'/;

export function classifyTask(prompt: string): TaskClassification {
  const trimmed = prompt.trim();
  const lower = trimmed.toLowerCase();
  const signals: string[] = [];

  // Hard signals — each fires independently
  if (trimmed.length > 200) signals.push("long-prompt");
  if (MULTI_FILE_PATTERNS.test(trimmed)) signals.push("multi-file-scope");

  const startsWithVague = VAGUE_VERBS.some((v) => lower.startsWith(v));
  if (startsWithVague) signals.push("vague-verb");

  if (!ACCEPTANCE_CRITERIA_RE.test(trimmed) && trimmed.length > 80) signals.push("no-acceptance-criteria");

  // No concrete target: no file path AND no specific identifier AND not trivially short
  if (!FILE_PATH_RE.test(trimmed) && !SPECIFIC_IDENTIFIER_RE.test(trimmed) && trimmed.length > 40) {
    signals.push("no-concrete-target");
  }

  const isHard = signals.length >= 2;

  if (!isHard) {
    return {
      difficulty: "easy",
      reason: signals.length === 0 ? "specific target with clear scope" : `minor ambiguity: ${signals[0]}`,
      assumptionText: "",
    };
  }

  const assumptions: string[] = [];
  if (signals.includes("vague-verb")) {
    assumptions.push("I will target the most relevant file based on context");
  }
  if (signals.includes("no-acceptance-criteria")) {
    assumptions.push("success = no type errors and no test regressions");
  }
  if (signals.includes("multi-file-scope")) {
    assumptions.push("I will process files in dependency order");
  }
  if (signals.includes("no-concrete-target")) {
    assumptions.push("I will infer the target from project structure");
  }
  if (signals.includes("long-prompt")) {
    assumptions.push("I will address the primary objective first");
  }
  if (assumptions.length === 0) {
    assumptions.push("I will proceed with the most conservative interpretation");
  }

  return {
    difficulty: "hard",
    reason: signals.join(", "),
    assumptionText: assumptions.join("; "),
  };
}

const COMPLETION_LOG_REL = join(".danteforge", "task-completion-log.jsonl");

export function computeTaskCompletionVerdict(
  lastToolResults: string[],
  toolCallCount: number,
  consecutiveFailures: number,
): { verdict: TaskCompletionVerdict; reason: string } {
  if (toolCallCount === 0) {
    return { verdict: "FAILED", reason: "no tool calls made" };
  }

  if (consecutiveFailures >= 3) {
    return { verdict: "FAILED", reason: `${consecutiveFailures} consecutive tool failures` };
  }

  const lastResult = lastToolResults[lastToolResults.length - 1] ?? "";
  const hasError = /FAILED|Error:|error TS\d+|✗|✘|FAIL\b/i.test(lastResult);

  if (hasError) {
    return { verdict: "ATTEMPTED", reason: "last tool result contained errors" };
  }

  return { verdict: "COMPLETED", reason: "last tool result clean, no errors detected" };
}

export function recordTaskCompletion(
  entry: Omit<TaskCompletionEntry, "timestamp">,
  projectRoot: string,
): void {
  try {
    const dir = join(projectRoot, ".danteforge");
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    const logPath = join(projectRoot, COMPLETION_LOG_REL);
    const full: TaskCompletionEntry = { ...entry, timestamp: new Date().toISOString() };
    writeFileSync(logPath, JSON.stringify(full) + "\n", { flag: "a" });
  } catch {
    // non-fatal
  }
}

export function loadTaskCompletionLog(projectRoot: string): TaskCompletionEntry[] {
  try {
    const logPath = join(projectRoot, COMPLETION_LOG_REL);
    if (!existsSync(logPath)) return [];
    return readFileSync(logPath, "utf-8")
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line) as TaskCompletionEntry);
  } catch {
    return [];
  }
}
