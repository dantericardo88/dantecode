// ============================================================================
// packages/vscode/src/edit-history-tracker.ts
// Next-Edit Prediction Phase 1: edit history ring buffer + pattern detection.
// Harvest: Tabby context tracker + Continue.dev cursor cache patterns.
// ============================================================================

import * as vscode from "vscode";

export interface EditRecord {
  filePath: string;
  range: {
    startLine: number;
    startChar: number;
    endLine: number;
    endChar: number;
  };
  oldText: string;
  newText: string;
  timestamp: number;
  changeType: "insert" | "delete" | "replace";
}

function classifyChange(oldText: string, newText: string): EditRecord["changeType"] {
  if (oldText === "") return "insert";
  if (newText === "") return "delete";
  return "replace";
}

/**
 * Tracks VS Code document changes in a ring buffer for next-edit prediction.
 * Only tracks real file documents (scheme === "file").
 *
 * Patterns exported:
 * - getAdjacentLinePattern(): 3+ consecutive-line edits → predict N+1
 * - getColumnPattern(): 3+ same-column edits in last 5 → predict vertical fill
 * - getFilePairPattern(): A/B/A alternation → predict file oscillation
 */
export class EditHistoryTracker implements vscode.Disposable {
  private readonly _ring: EditRecord[] = [];
  private readonly _maxSize: number;
  private readonly _disposable: vscode.Disposable;

  constructor(maxSize = 50) {
    this._maxSize = maxSize;
    this._disposable = vscode.workspace.onDidChangeTextDocument((event) => {
      if (event.document.uri.scheme !== "file") return;
      const filePath = event.document.uri.fsPath;
      for (const change of event.contentChanges) {
        const record: EditRecord = {
          filePath,
          range: {
            startLine: change.range.start.line,
            startChar: change.range.start.character,
            endLine: change.range.end.line,
            endChar: change.range.end.character,
          },
          oldText: change.rangeLength > 0 ? change.rangeOffset.toString() : "", // VS Code doesn't give oldText; infer from rangeLength
          newText: change.text,
          timestamp: Date.now(),
          changeType: classifyChange(change.rangeLength > 0 ? "x" : "", change.text),
        };
        this._push(record);
      }
    });
  }

  /**
   * Push an edit record (also callable directly in tests without VS Code events).
   */
  push(record: EditRecord): void {
    this._push(record);
  }

  private _push(record: EditRecord): void {
    if (this._ring.length >= this._maxSize) {
      this._ring.shift();
    }
    this._ring.push(record);
  }

  /**
   * Returns last N edits, newest first.
   * If N is omitted, returns all.
   */
  getRecent(n?: number): readonly EditRecord[] {
    const result = [...this._ring].reverse();
    return n !== undefined ? result.slice(0, n) : result;
  }

  /**
   * Returns last N edits for a specific file, newest first.
   */
  getForFile(filePath: string, n?: number): readonly EditRecord[] {
    const result = [...this._ring].filter((r) => r.filePath === filePath).reverse();
    return n !== undefined ? result.slice(0, n) : result;
  }

  /**
   * Pattern: 3+ most recent edits on consecutive lines (block fill).
   * Returns the matching records (oldest-first) or null if no match.
   */
  getAdjacentLinePattern(): EditRecord[] | null {
    const recent = this.getRecent(6) as EditRecord[];
    if (recent.length < 3) return null;

    // Look for a run of 3+ consecutive line numbers in the most recent edits
    // recent[0] is newest, so we need to scan for a consecutive sequence
    for (let start = 0; start <= recent.length - 3; start++) {
      const run: EditRecord[] = [recent[start]!];
      for (let i = start + 1; i < recent.length; i++) {
        const prev = run[run.length - 1]!;
        const curr = recent[i]!;
        if (
          curr.filePath === prev.filePath &&
          Math.abs(curr.range.startLine - prev.range.startLine) === 1
        ) {
          run.push(curr);
          if (run.length >= 3) {
            return run.reverse(); // oldest first
          }
        } else {
          break;
        }
      }
    }
    return null;
  }

  /**
   * Pattern: ≥3 of the last 5 edits share the same startChar (vertical alignment).
   * Returns { column, count } or null.
   */
  getColumnPattern(): { column: number; count: number } | null {
    const recent = this.getRecent(5) as EditRecord[];
    if (recent.length < 3) return null;

    const colCounts = new Map<number, number>();
    for (const r of recent) {
      const col = r.range.startChar;
      colCounts.set(col, (colCounts.get(col) ?? 0) + 1);
    }
    for (const [col, count] of colCounts) {
      if (count >= 3) return { column: col, count };
    }
    return null;
  }

  /**
   * Pattern: A/B/A alternation in last 3+ edits (file pair oscillation).
   * Returns { fileA, fileB } or null.
   */
  getFilePairPattern(): { fileA: string; fileB: string } | null {
    const recent = this.getRecent(4) as EditRecord[];
    if (recent.length < 3) return null;

    // Check most recent 3: [0]=newest, [1]=second, [2]=third
    const f0 = recent[0]?.filePath;
    const f1 = recent[1]?.filePath;
    const f2 = recent[2]?.filePath;
    if (!f0 || !f1 || !f2) return null;

    if (f0 !== f1 && f1 !== f2 && f0 === f2) {
      // Pattern: A, B, A (current=A, last was B, before that was A)
      return { fileA: f0, fileB: f1 };
    }
    // Also check 4-edit alternation: A/B/A/B
    if (recent.length >= 4) {
      const f3 = recent[3]?.filePath;
      if (f3 && f0 !== f1 && f1 !== f2 && f2 !== f3 && f0 === f2 && f1 === f3) {
        return { fileA: f0, fileB: f1 };
      }
    }
    return null;
  }

  get size(): number {
    return this._ring.length;
  }

  dispose(): void {
    this._disposable.dispose();
    this._ring.length = 0;
  }
}
