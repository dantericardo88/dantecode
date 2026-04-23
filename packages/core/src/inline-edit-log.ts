// ============================================================================
// @dantecode/core — Inline Edit Log (Sprint AG — dim 6)
// Emits edit confidence scores to .danteforge/inline-edit-log.json after
// each Write/Edit operation, providing measurable edit quality evidence.
// ============================================================================

import { appendFileSync, mkdirSync, readFileSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";

export type EditType = "insert" | "modify" | "delete" | "replace";

export interface InlineEditLogEntry {
  timestamp: string;
  filePath: string;
  editType: EditType;
  linesAdded: number;
  linesRemoved: number;
  confidenceScore: number;
  qualityScore: number;
  errorHint?: string;
}

export interface InlineEditSummary {
  totalEdits: number;
  avgConfidenceScore: number;
  avgQualityScore: number;
  highConfidenceEdits: number;
  lowConfidenceEdits: number;
}

const LOG_FILE = ".danteforge/inline-edit-log.json";

// Sprint AK — Dim 6: output channel hook so VSCode extension can surface
// edit confidence scores in the DanteCode Output panel.
let _outputHook: ((line: string) => void) | null = null;

/** Set a hook that receives each edit confidence line for display in the output panel. */
export function setEditQualityOutputHook(fn: ((line: string) => void) | null): void {
  _outputHook = fn;
}

export function emitInlineEditLog(
  entry: Omit<InlineEditLogEntry, "timestamp">,
  projectRoot?: string,
): void {
  const root = projectRoot ?? resolve(process.cwd());
  try {
    mkdirSync(join(root, ".danteforge"), { recursive: true });
    const record: InlineEditLogEntry = { timestamp: new Date().toISOString(), ...entry };
    appendFileSync(join(root, LOG_FILE), JSON.stringify(record) + "\n", "utf-8");
    // Sprint AK — Dim 6: emit to output channel hook if registered
    if (_outputHook) {
      const conf = Math.round(record.confidenceScore * 100);
      const qual = Math.round(record.qualityScore * 100);
      _outputHook(`[edit-confidence] ${record.filePath} +${record.linesAdded}/-${record.linesRemoved} confidence=${conf}% quality=${qual}%`);
    }
  } catch {
    // non-fatal
  }
}

export function loadInlineEditLog(projectRoot?: string): InlineEditLogEntry[] {
  const root = projectRoot ?? resolve(process.cwd());
  const logPath = join(root, LOG_FILE);
  if (!existsSync(logPath)) return [];
  try {
    return readFileSync(logPath, "utf-8")
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((l) => JSON.parse(l) as InlineEditLogEntry);
  } catch {
    return [];
  }
}

// ─── Inline edit acceptance store (Sprint AX — Dim 6) ────────────────────────

export interface EditAcceptanceEntry {
  filePath: string;
  editId: string;
  accepted: boolean;
  timestamp: string;
}

const ACCEPTANCE_FILE = ".danteforge/inline-edit-acceptance.json";

/** Tracks whether edits are accepted, providing evidence of real user value. */
export class InlineEditAcceptanceStore {
  private readonly _root: string;
  private readonly _path: string;

  constructor(projectRoot: string) {
    this._root = resolve(projectRoot);
    this._path = join(this._root, ACCEPTANCE_FILE);
  }

  recordAcceptance(filePath: string, editId: string, accepted: boolean): void {
    try {
      mkdirSync(join(this._root, ".danteforge"), { recursive: true });
      const entry: EditAcceptanceEntry = { filePath, editId, accepted, timestamp: new Date().toISOString() };
      appendFileSync(this._path, JSON.stringify(entry) + "\n", "utf-8");
    } catch { /* non-fatal */ }
  }

  load(): EditAcceptanceEntry[] {
    if (!existsSync(this._path)) return [];
    try {
      return readFileSync(this._path, "utf-8")
        .trim()
        .split("\n")
        .filter(Boolean)
        .map((l) => JSON.parse(l) as EditAcceptanceEntry);
    } catch { return []; }
  }

  getAcceptanceRate(): number {
    const entries = this.load();
    if (entries.length === 0) return 0;
    return entries.filter((e) => e.accepted).length / entries.length;
  }
}

export function summarizeInlineEdits(entries: InlineEditLogEntry[]): InlineEditSummary {
  if (entries.length === 0) {
    return { totalEdits: 0, avgConfidenceScore: 0, avgQualityScore: 0, highConfidenceEdits: 0, lowConfidenceEdits: 0 };
  }
  const avgConfidenceScore = entries.reduce((s, e) => s + e.confidenceScore, 0) / entries.length;
  const avgQualityScore = entries.reduce((s, e) => s + e.qualityScore, 0) / entries.length;
  const highConfidenceEdits = entries.filter((e) => e.confidenceScore >= 0.75).length;
  const lowConfidenceEdits = entries.filter((e) => e.confidenceScore < 0.5).length;
  return {
    totalEdits: entries.length,
    avgConfidenceScore: Math.round(avgConfidenceScore * 100) / 100,
    avgQualityScore: Math.round(avgQualityScore * 100) / 100,
    highConfidenceEdits,
    lowConfidenceEdits,
  };
}
