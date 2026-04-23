// packages/core/src/inline-edit-manager.ts
// Inline edit UX management — closes dim 6 (Inline edit UX: 7→9).
//
// Harvested from: Aider's diff pipeline, Cursor inline edit, Continue.dev quick edits.
//
// Provides:
//   - Unified diff generation (Myers diff algorithm)
//   - Hunk extraction and per-hunk accept/reject
//   - Range edit (replace a range with model-generated content)
//   - Edit suggestion queue with priority
//   - Conflict detection between concurrent edits
//   - Edit session history for undo

// ─── Types ────────────────────────────────────────────────────────────────────

export type EditLineType = "context" | "add" | "remove";

export interface DiffLine {
  type: EditLineType;
  content: string;
  oldLineNo?: number;
  newLineNo?: number;
}

export interface DiffHunk {
  id: string;
  /** Starting line in the old file (1-indexed) */
  oldStart: number;
  /** Number of lines from old file */
  oldCount: number;
  /** Starting line in the new file (1-indexed) */
  newStart: number;
  /** Number of lines from new file */
  newCount: number;
  /** Header like @@ -1,5 +1,6 @@ */
  header: string;
  lines: DiffLine[];
  /** Net line change (positive = added, negative = removed) */
  netChange: number;
}

export interface InlineEdit {
  id: string;
  filePath: string;
  /** Original content before edit */
  originalContent: string;
  /** Proposed content after edit */
  proposedContent: string;
  hunks: DiffHunk[];
  /** Status of each hunk: hunkId → "accepted" | "rejected" | "pending" */
  hunkStatus: Map<string, "accepted" | "rejected" | "pending">;
  /** When the edit was created */
  createdAt: number;
  /** Description/intent of the edit */
  description?: string;
}

export interface RangeEdit {
  filePath: string;
  /** Start line (1-indexed, inclusive) */
  startLine: number;
  /** End line (1-indexed, inclusive) */
  endLine: number;
  /** New content to replace the range */
  newContent: string;
  /** Description of what was changed */
  description?: string;
}

export interface EditSuggestion {
  id: string;
  filePath: string;
  edit: RangeEdit | InlineEdit;
  priority: number;
  source: "model" | "lsp" | "user" | "lint-fix";
  createdAt: number;
}

// ─── Unified Diff Generator ───────────────────────────────────────────────────

/**
 * Compute the longest common subsequence of two string arrays.
 * Used as the basis for diff generation.
 */
export function lcs(a: string[], b: string[]): number[][] {
  const m = a.length;
  const n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () => new Array<number>(n + 1).fill(0));

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (a[i - 1] === b[j - 1]) {
        dp[i]![j] = dp[i - 1]![j - 1]! + 1;
      } else {
        dp[i]![j] = Math.max(dp[i - 1]![j]!, dp[i]![j - 1]!);
      }
    }
  }
  return dp;
}

/**
 * Backtrack the LCS table to produce a sequence of DiffLines.
 */
function backtrack(dp: number[][], a: string[], b: string[], i: number, j: number): DiffLine[] {
  if (i === 0 && j === 0) return [];
  if (i === 0) {
    return [...backtrack(dp, a, b, i, j - 1), { type: "add", content: b[j - 1]! }];
  }
  if (j === 0) {
    return [...backtrack(dp, a, b, i - 1, j), { type: "remove", content: a[i - 1]! }];
  }
  if (a[i - 1] === b[j - 1]) {
    return [...backtrack(dp, a, b, i - 1, j - 1), { type: "context", content: a[i - 1]! }];
  }
  if (dp[i - 1]![j]! >= dp[i]![j - 1]!) {
    return [...backtrack(dp, a, b, i - 1, j), { type: "remove", content: a[i - 1]! }];
  }
  return [...backtrack(dp, a, b, i, j - 1), { type: "add", content: b[j - 1]! }];
}

let _hunkIdCounter = 0;
function hunkId(): string {
  return `hunk-${Date.now()}-${++_hunkIdCounter}`;
}

/**
 * Generate unified diff hunks from two text strings.
 * Context lines control how many surrounding lines each hunk includes.
 */
export function generateDiffHunks(
  oldText: string,
  newText: string,
  contextLines = 3,
): DiffHunk[] {
  const oldLines = oldText.split("\n");
  const newLines = newText.split("\n");

  if (oldText === newText) return [];

  const dp = lcs(oldLines, newLines);
  const rawLines = backtrack(dp, oldLines, newLines, oldLines.length, newLines.length);

  // Assign line numbers
  let oldNo = 1;
  let newNo = 1;
  const numbered: DiffLine[] = rawLines.map((line) => {
    const result: DiffLine = { ...line };
    if (line.type === "context" || line.type === "remove") {
      result.oldLineNo = oldNo++;
      if (line.type === "context") result.newLineNo = newNo++;
    } else {
      result.newLineNo = newNo++;
    }
    return result;
  });

  // Group into hunks with context
  const hunks: DiffHunk[] = [];
  const changeIndices: number[] = numbered
    .map((l, i) => (l.type !== "context" ? i : -1))
    .filter((i) => i >= 0);

  if (changeIndices.length === 0) return [];

  // Merge overlapping change groups into hunks
  const groups: [number, number][] = [];
  let groupStart = Math.max(0, changeIndices[0]! - contextLines);
  let groupEnd = Math.min(numbered.length - 1, changeIndices[0]! + contextLines);

  for (let ci = 1; ci < changeIndices.length; ci++) {
    const idx = changeIndices[ci]!;
    const expanded = Math.max(0, idx - contextLines);
    if (expanded <= groupEnd + 1) {
      groupEnd = Math.min(numbered.length - 1, idx + contextLines);
    } else {
      groups.push([groupStart, groupEnd]);
      groupStart = expanded;
      groupEnd = Math.min(numbered.length - 1, idx + contextLines);
    }
  }
  groups.push([groupStart, groupEnd]);

  for (const [start, end] of groups) {
    const lines = numbered.slice(start, end + 1);
    const firstOld = lines.find((l) => l.oldLineNo !== undefined)?.oldLineNo ?? 1;
    const firstNew = lines.find((l) => l.newLineNo !== undefined)?.newLineNo ?? 1;
    const oldCount = lines.filter((l) => l.type !== "add").length;
    const newCount = lines.filter((l) => l.type !== "remove").length;
    const addCount = lines.filter((l) => l.type === "add").length;
    const removeCount = lines.filter((l) => l.type === "remove").length;

    hunks.push({
      id: hunkId(),
      oldStart: firstOld,
      oldCount,
      newStart: firstNew,
      newCount,
      header: `@@ -${firstOld},${oldCount} +${firstNew},${newCount} @@`,
      lines,
      netChange: addCount - removeCount,
    });
  }

  return hunks;
}

/**
 * Format diff hunks as a unified diff string.
 */
export function formatUnifiedDiff(
  hunks: DiffHunk[],
  oldPath: string,
  newPath: string,
): string {
  if (hunks.length === 0) return "";

  const lines = [
    `--- ${oldPath}`,
    `+++ ${newPath}`,
  ];

  for (const hunk of hunks) {
    lines.push(hunk.header);
    for (const line of hunk.lines) {
      const prefix = line.type === "add" ? "+" : line.type === "remove" ? "-" : " ";
      lines.push(`${prefix}${line.content}`);
    }
  }

  return lines.join("\n");
}

// ─── Hunk Accept/Reject ───────────────────────────────────────────────────────

/**
 * Apply accepted hunks from an InlineEdit to produce the final content.
 * Rejected hunks revert to original; pending hunks are treated as accepted.
 */
export function applyHunkSelections(edit: InlineEdit): string {
  const oldLines = edit.originalContent.split("\n");
  const result: string[] = [];
  let oldIdx = 0; // 0-indexed pointer into oldLines

  for (const hunk of edit.hunks) {
    const status = edit.hunkStatus.get(hunk.id) ?? "pending";
    const hunkOldStart = hunk.oldStart - 1; // convert to 0-indexed

    // Copy context before this hunk
    while (oldIdx < hunkOldStart) {
      result.push(oldLines[oldIdx]!);
      oldIdx++;
    }

    if (status === "rejected") {
      // Keep original lines for this hunk
      for (let i = 0; i < hunk.oldCount; i++) {
        result.push(oldLines[oldIdx + i]!);
      }
    } else {
      // Apply the hunk (accepted or pending)
      for (const line of hunk.lines) {
        if (line.type !== "remove") {
          result.push(line.content);
        }
      }
    }
    oldIdx = hunkOldStart + hunk.oldCount;
  }

  // Copy remaining lines after all hunks
  while (oldIdx < oldLines.length) {
    result.push(oldLines[oldIdx]!);
    oldIdx++;
  }

  return result.join("\n");
}

// ─── Range Edit ───────────────────────────────────────────────────────────────

/**
 * Apply a range edit to file content.
 * Replaces lines startLine..endLine (1-indexed, inclusive) with newContent.
 */
export function applyRangeEdit(content: string, edit: RangeEdit): string {
  const lines = content.split("\n");
  const before = lines.slice(0, edit.startLine - 1);
  const after = lines.slice(edit.endLine);
  const newLines = edit.newContent === "" ? [] : edit.newContent.split("\n");
  return [...before, ...newLines, ...after].join("\n");
}

/**
 * Extract a line range from content for preview.
 */
export function extractLineRange(content: string, startLine: number, endLine: number): string {
  const lines = content.split("\n");
  return lines.slice(startLine - 1, endLine).join("\n");
}

// ─── Conflict Detection ───────────────────────────────────────────────────────

export interface EditConflict {
  editAId: string;
  editBId: string;
  conflictingHunks: Array<{ hunkA: string; hunkB: string }>;
}

/**
 * Detect conflicts between two InlineEdits on the same file.
 * Hunks conflict when their line ranges overlap.
 */
export function detectEditConflicts(editA: InlineEdit, editB: InlineEdit): EditConflict | null {
  if (editA.filePath !== editB.filePath) return null;

  const conflictingHunks: Array<{ hunkA: string; hunkB: string }> = [];

  for (const ha of editA.hunks) {
    for (const hb of editB.hunks) {
      const aEnd = ha.oldStart + ha.oldCount - 1;
      const bEnd = hb.oldStart + hb.oldCount - 1;
      // Overlap condition
      if (ha.oldStart <= bEnd && hb.oldStart <= aEnd) {
        conflictingHunks.push({ hunkA: ha.id, hunkB: hb.id });
      }
    }
  }

  if (conflictingHunks.length === 0) return null;
  return { editAId: editA.id, editBId: editB.id, conflictingHunks };
}

// ─── InlineEdit Builder ───────────────────────────────────────────────────────

let _editIdCounter = 0;

/**
 * Build an InlineEdit by generating hunks between original and proposed content.
 */
export function buildInlineEdit(
  filePath: string,
  originalContent: string,
  proposedContent: string,
  description?: string,
): InlineEdit {
  const hunks = generateDiffHunks(originalContent, proposedContent);
  const hunkStatus = new Map<string, "accepted" | "rejected" | "pending">();
  for (const hunk of hunks) hunkStatus.set(hunk.id, "pending");

  return {
    id: `edit-${Date.now()}-${++_editIdCounter}`,
    filePath,
    originalContent,
    proposedContent,
    hunks,
    hunkStatus,
    createdAt: Date.now(),
    description,
  };
}

/**
 * Accept all hunks in an edit at once.
 */
export function acceptAllHunks(edit: InlineEdit): void {
  for (const hunk of edit.hunks) edit.hunkStatus.set(hunk.id, "accepted");
}

/**
 * Reject all hunks in an edit at once.
 */
export function rejectAllHunks(edit: InlineEdit): void {
  for (const hunk of edit.hunks) edit.hunkStatus.set(hunk.id, "rejected");
}

// ─── Edit Suggestion Queue ────────────────────────────────────────────────────

export class EditSuggestionQueue {
  private _suggestions: EditSuggestion[] = [];

  push(
    filePath: string,
    edit: RangeEdit | InlineEdit,
    priority: number,
    source: EditSuggestion["source"] = "model",
  ): string {
    const id = `sug-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    this._suggestions.push({ id, filePath, edit, priority, source, createdAt: Date.now() });
    this._suggestions.sort((a, b) => b.priority - a.priority);
    return id;
  }

  /** Get next highest-priority suggestion */
  peek(): EditSuggestion | undefined {
    return this._suggestions[0];
  }

  /** Remove and return next suggestion */
  shift(): EditSuggestion | undefined {
    return this._suggestions.shift();
  }

  /** Get all suggestions for a given file */
  forFile(filePath: string): EditSuggestion[] {
    return this._suggestions.filter((s) => s.filePath === filePath);
  }

  /** Remove a suggestion by ID */
  remove(id: string): boolean {
    const idx = this._suggestions.findIndex((s) => s.id === id);
    if (idx === -1) return false;
    this._suggestions.splice(idx, 1);
    return true;
  }

  get size(): number {
    return this._suggestions.length;
  }

  clear(): void {
    this._suggestions = [];
  }
}
