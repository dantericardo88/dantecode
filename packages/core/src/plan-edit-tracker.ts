// Sprint AJ — Dim 16: Plan edit tracking
// Records when a user edits a plan before execution, including what changed.
// Emits evidence to .danteforge/plan-edit-log.json.
import { appendFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

export interface PlanEditEntry {
  timestamp: string;
  sessionId: string;
  originalLineCount: number;
  editedLineCount: number;
  linesChanged: number;
  confirmed: boolean;
  stepCount: number;
}

export interface PlanEditSummary {
  totalEdits: number;
  confirmedEdits: number;
  cancelledEdits: number;
  avgLinesChanged: number;
  editRate: number; // fraction of plans that were edited before confirm
}

/**
 * Record a plan edit event — called after editAndConfirm() returns.
 * Emits JSONL to .danteforge/plan-edit-log.json.
 */
export function recordPlanEdit(entry: Omit<PlanEditEntry, "timestamp">, projectRoot = process.cwd()): void {
  try {
    const dir = join(projectRoot, ".danteforge");
    mkdirSync(dir, { recursive: true });
    const full: PlanEditEntry = { timestamp: new Date().toISOString(), ...entry };
    appendFileSync(join(dir, "plan-edit-log.json"), JSON.stringify(full) + "\n", "utf-8");
  } catch { /* non-fatal */ }
}

export function summarizePlanEdits(entries: PlanEditEntry[]): PlanEditSummary {
  if (entries.length === 0) {
    return { totalEdits: 0, confirmedEdits: 0, cancelledEdits: 0, avgLinesChanged: 0, editRate: 0 };
  }
  const confirmed = entries.filter((e) => e.confirmed);
  const edited = entries.filter((e) => e.linesChanged > 0);
  const totalLines = entries.reduce((s, e) => s + e.linesChanged, 0);
  return {
    totalEdits: entries.length,
    confirmedEdits: confirmed.length,
    cancelledEdits: entries.length - confirmed.length,
    avgLinesChanged: totalLines / entries.length,
    editRate: edited.length / entries.length,
  };
}

/**
 * Compute lines changed between original and edited plan strings.
 */
export function computePlanDiff(original: string, edited: string): number {
  const origLines = original.split("\n");
  const editLines = edited.split("\n");
  let changed = 0;
  const maxLen = Math.max(origLines.length, editLines.length);
  for (let i = 0; i < maxLen; i++) {
    if (origLines[i] !== editLines[i]) changed++;
  }
  return changed;
}
