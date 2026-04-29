// ============================================================================
// @dantecode/git-engine — Diff Parsing and Review
// ============================================================================

import { execSync } from "node:child_process";
import { writeFileSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomBytes } from "node:crypto";
import type { DiffHunk, DiffLine, ColoredDiffHunk } from "@dantecode/config-types";
import { MAX_DIFF_LINES } from "@dantecode/config-types";

// Re-export the DiffHunk type so consumers can import from this module
export type { DiffHunk, DiffLine, ColoredDiffHunk } from "@dantecode/config-types";

// ----------------------------------------------------------------------------
// Helpers
// ----------------------------------------------------------------------------

/**
 * Execute a git command synchronously in the given working directory.
 * Returns the raw stdout as a string.
 */
function git(args: string, cwd: string): string {
  try {
    return execSync(`git ${args}`, {
      cwd,
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
      maxBuffer: 50 * 1024 * 1024, // 50 MB for large diffs
    });
  } catch (error: unknown) {
    const err = error as {
      status?: number;
      stdout?: string;
      stderr?: string;
      message?: string;
    };
    // git diff exits with 1 when there are differences — that's not an error
    if (err.status === 1 && typeof err.stdout === "string") {
      return err.stdout;
    }
    const stderr = typeof err.stderr === "string" ? err.stderr.trim() : "";
    const msg = stderr || err.message || "Unknown git error";
    throw new Error(`git ${args.split(" ")[0]}: ${msg}`);
  }
}

// ----------------------------------------------------------------------------
// Hunk header regex
// ----------------------------------------------------------------------------

/**
 * Matches unified diff hunk headers like:
 *   @@ -10,7 +10,8 @@ optional context
 */
const HUNK_HEADER_RE = /^@@\s+-(\d+)(?:,(\d+))?\s+\+(\d+)(?:,(\d+))?\s+@@/;

/**
 * Matches diff file headers like:
 *   diff --git a/path/to/file b/path/to/file
 */
const DIFF_FILE_HEADER_RE = /^diff --git a\/(.+?) b\/(.+)$/;

// ----------------------------------------------------------------------------
// Public API
// ----------------------------------------------------------------------------

/**
 * Get the raw unified diff for the working tree (unstaged changes).
 * If `ref` is provided, produces the diff between that ref and HEAD.
 *
 * @param projectRoot - Absolute path to the repository root.
 * @param ref - Optional git ref to diff against (e.g. "HEAD~3", "main", a SHA).
 * @returns The raw unified diff output as a string.
 */
export function getDiff(projectRoot: string, ref?: string): string {
  if (ref) {
    return git(`diff "${ref}"`, projectRoot);
  }
  return git("diff", projectRoot);
}

/**
 * Get the raw unified diff of staged (index) changes.
 *
 * @param projectRoot - Absolute path to the repository root.
 * @returns The raw unified diff output as a string.
 */
export function getStagedDiff(projectRoot: string): string {
  return git("diff --cached", projectRoot);
}

/**
 * Parse a raw unified diff string into structured DiffHunk objects.
 *
 * Each hunk includes the file it belongs to, the line range information,
 * and the hunk content (including the `@@` header line).
 *
 * @param diffOutput - Raw unified diff text (from `git diff`).
 * @returns Array of parsed DiffHunk objects.
 */
export function parseDiffHunks(diffOutput: string): DiffHunk[] {
  if (!diffOutput || diffOutput.trim().length === 0) {
    return [];
  }

  const hunks: DiffHunk[] = [];
  const lines = diffOutput.split("\n");
  let currentFile = "";
  let currentHunkLines: string[] = [];
  let currentOldStart = 0;
  let currentOldLines = 0;
  let currentNewStart = 0;
  let currentNewLines = 0;
  let inHunk = false;

  function flushHunk(): void {
    if (inHunk && currentHunkLines.length > 0 && currentFile) {
      hunks.push({
        file: currentFile,
        oldStart: currentOldStart,
        oldLines: currentOldLines,
        newStart: currentNewStart,
        newLines: currentNewLines,
        content: currentHunkLines.join("\n"),
      });
    }
    currentHunkLines = [];
    inHunk = false;
  }

  for (const line of lines) {
    // Check for a new file header
    const fileMatch = DIFF_FILE_HEADER_RE.exec(line);
    if (fileMatch) {
      flushHunk();
      // Use the "b" side path (the destination) as the canonical file name
      currentFile = fileMatch[2]!;
      continue;
    }

    // Check for a hunk header
    const hunkMatch = HUNK_HEADER_RE.exec(line);
    if (hunkMatch) {
      flushHunk();
      currentOldStart = parseInt(hunkMatch[1]!, 10);
      currentOldLines = hunkMatch[2] !== undefined ? parseInt(hunkMatch[2], 10) : 1;
      currentNewStart = parseInt(hunkMatch[3]!, 10);
      currentNewLines = hunkMatch[4] !== undefined ? parseInt(hunkMatch[4], 10) : 1;
      inHunk = true;
      currentHunkLines.push(line);
      continue;
    }

    // Inside a hunk: collect context, addition, and deletion lines
    if (inHunk) {
      if (
        line.startsWith(" ") ||
        line.startsWith("+") ||
        line.startsWith("-") ||
        line === "\\ No newline at end of file"
      ) {
        currentHunkLines.push(line);
      } else if (line.startsWith("diff ")) {
        // A new diff block started (without --git prefix, e.g. combined diff)
        flushHunk();
      }
      // Other lines inside a hunk (e.g. empty lines at end of diff) are ignored
    }
  }

  // Flush any remaining hunk
  flushHunk();

  return hunks;
}

/**
 * Apply a single diff hunk to the repository using `git apply`.
 *
 * Constructs a minimal patch file containing just the given hunk and applies
 * it via `git apply --allow-empty`.
 *
 * @param hunk - The diff hunk to apply.
 * @param projectRoot - Absolute path to the repository root.
 */
// ----------------------------------------------------------------------------
// Blade v1.2 — Colored Diff Generation
// ----------------------------------------------------------------------------

/**
 * Generates a structured colored diff hunk between old and new file content.
 * Uses a simple LCS-based diff algorithm (no external deps required).
 * Returns a ColoredDiffHunk ready for webview rendering.
 *
 * @param oldContent - Previous file content (empty string for new files)
 * @param newContent - New file content
 * @param filePath - Relative path for display (e.g. "packages/core/src/model-router.ts")
 * @returns ColoredDiffHunk with typed DiffLine[] for webview rendering
 */
export function generateColoredHunk(
  oldContent: string,
  newContent: string,
  filePath: string,
): ColoredDiffHunk {
  // Binary file detection: if either content contains a null byte
  if (oldContent.includes("\x00") || newContent.includes("\x00")) {
    const size = Math.max(oldContent.length, newContent.length);
    return {
      filePath,
      linesAdded: 0,
      linesRemoved: 0,
      lines: [
        {
          type: "hunk_header",
          content: `[Binary file — ${size} bytes]`,
          oldLineNo: null,
          newLineNo: null,
        },
      ],
      truncated: false,
      fullLineCount: 1,
    };
  }

  const oldLines = oldContent.length === 0 ? [] : oldContent.replace(/\r\n/g, "\n").split("\n");
  const newLines = newContent.length === 0 ? [] : newContent.replace(/\r\n/g, "\n").split("\n");

  // New file: all lines are adds
  if (oldLines.length === 0) {
    const lines: DiffLine[] = newLines.map((line, i) => ({
      type: "add" as const,
      content: line,
      oldLineNo: null,
      newLineNo: i + 1,
    }));
    return buildColoredResult(filePath, lines);
  }

  // Deleted file: all lines are removes
  if (newLines.length === 0) {
    const lines: DiffLine[] = oldLines.map((line, i) => ({
      type: "remove" as const,
      content: line,
      oldLineNo: i + 1,
      newLineNo: null,
    }));
    return buildColoredResult(filePath, lines);
  }

  // Modified file: compute unified diff with 3-line context
  const diffLines = computeUnifiedDiff(oldLines, newLines, 3);
  return buildColoredResult(filePath, diffLines);
}

/**
 * Computes a unified diff between two line arrays with context lines.
 */
interface EditOp {
  type: "equal" | "remove" | "add";
  oldIdx: number;
  newIdx: number;
  line: string;
}

interface HunkRegion {
  start: number;
  end: number;
}

/** Standard O(NM) LCS table over oldLines/newLines. */
function buildLcsTable(oldLines: string[], newLines: string[]): number[][] {
  const n = oldLines.length;
  const m = newLines.length;
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      if (oldLines[i - 1] === newLines[j - 1]) {
        dp[i]![j] = dp[i - 1]![j - 1]! + 1;
      } else {
        dp[i]![j] = Math.max(dp[i - 1]![j]!, dp[i]![j - 1]!);
      }
    }
  }
  return dp;
}

/** Reverse-walk the LCS table into a forward-ordered edit script. */
function backtrackToEdits(
  dp: number[][],
  oldLines: string[],
  newLines: string[],
): EditOp[] {
  const edits: EditOp[] = [];
  let i = oldLines.length;
  let j = newLines.length;
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && oldLines[i - 1] === newLines[j - 1]) {
      edits.push({ type: "equal", oldIdx: i, newIdx: j, line: oldLines[i - 1]! });
      i--; j--;
    } else if (j > 0 && (i === 0 || dp[i]![j - 1]! >= dp[i - 1]![j]!)) {
      edits.push({ type: "add", oldIdx: -1, newIdx: j, line: newLines[j - 1]! });
      j--;
    } else {
      edits.push({ type: "remove", oldIdx: i, newIdx: -1, line: oldLines[i - 1]! });
      i--;
    }
  }
  edits.reverse();
  return edits;
}

/** Coalesce change indices into [start,end] regions, padded by contextSize. */
function groupEditsToRegions(edits: EditOp[], contextSize: number): HunkRegion[] {
  const changes: number[] = [];
  for (let idx = 0; idx < edits.length; idx++) {
    if (edits[idx]!.type !== "equal") changes.push(idx);
  }
  if (changes.length === 0) return [];

  const regions: HunkRegion[] = [];
  let regionStart = Math.max(0, changes[0]! - contextSize);
  let regionEnd = Math.min(edits.length - 1, changes[0]! + contextSize);

  for (let ci = 1; ci < changes.length; ci++) {
    const changeStart = Math.max(0, changes[ci]! - contextSize);
    const changeEnd = Math.min(edits.length - 1, changes[ci]! + contextSize);
    if (changeStart <= regionEnd + 1) {
      regionEnd = changeEnd;
    } else {
      regions.push({ start: regionStart, end: regionEnd });
      regionStart = changeStart;
      regionEnd = changeEnd;
    }
  }
  regions.push({ start: regionStart, end: regionEnd });
  return regions;
}

function emitDiffLines(edits: EditOp[], regions: HunkRegion[]): DiffLine[] {
  const result: DiffLine[] = [];
  for (const region of regions) {
    const firstEdit = edits[region.start]!;
    const oldStart =
      firstEdit.type === "add"
        ? (firstEdit.oldIdx === -1 ? 1 : firstEdit.oldIdx)
        : firstEdit.oldIdx;
    const newStart =
      firstEdit.type === "remove"
        ? (firstEdit.newIdx === -1 ? 1 : firstEdit.newIdx)
        : firstEdit.newIdx;
    result.push({
      type: "hunk_header",
      content: `@@ -${oldStart} +${newStart} @@`,
      oldLineNo: null,
      newLineNo: null,
    });
    for (let idx = region.start; idx <= region.end; idx++) {
      const edit = edits[idx]!;
      if (edit.type === "equal") {
        result.push({ type: "context", content: edit.line, oldLineNo: edit.oldIdx, newLineNo: edit.newIdx });
      } else if (edit.type === "add") {
        result.push({ type: "add", content: edit.line, oldLineNo: null, newLineNo: edit.newIdx });
      } else {
        result.push({ type: "remove", content: edit.line, oldLineNo: edit.oldIdx, newLineNo: null });
      }
    }
  }
  return result;
}

function computeUnifiedDiff(
  oldLines: string[],
  newLines: string[],
  contextSize: number,
): DiffLine[] {
  const n = oldLines.length;
  const m = newLines.length;
  if (n * m > 10_000_000) return simpleDiff(oldLines, newLines);

  const dp = buildLcsTable(oldLines, newLines);
  const edits = backtrackToEdits(dp, oldLines, newLines);
  const regions = groupEditsToRegions(edits, contextSize);
  if (regions.length === 0) return [];
  return emitDiffLines(edits, regions);
}

/**
 * Simple line-by-line diff for very large files where LCS is too expensive.
 */
function simpleDiff(oldLines: string[], newLines: string[]): DiffLine[] {
  const result: DiffLine[] = [];
  const maxLen = Math.max(oldLines.length, newLines.length);
  for (let i = 0; i < maxLen; i++) {
    const oldLine = i < oldLines.length ? oldLines[i]! : undefined;
    const newLine = i < newLines.length ? newLines[i]! : undefined;
    if (oldLine === newLine) {
      result.push({ type: "context", content: oldLine!, oldLineNo: i + 1, newLineNo: i + 1 });
    } else {
      if (oldLine !== undefined) {
        result.push({ type: "remove", content: oldLine, oldLineNo: i + 1, newLineNo: null });
      }
      if (newLine !== undefined) {
        result.push({ type: "add", content: newLine, oldLineNo: null, newLineNo: i + 1 });
      }
    }
  }
  return result;
}

/**
 * Builds the final ColoredDiffHunk from a DiffLine array, applying truncation if needed.
 */
function buildColoredResult(filePath: string, lines: DiffLine[]): ColoredDiffHunk {
  const linesAdded = lines.filter((l) => l.type === "add").length;
  const linesRemoved = lines.filter((l) => l.type === "remove").length;
  const fullLineCount = lines.length;
  const truncated = lines.length > MAX_DIFF_LINES;
  const displayLines = truncated ? lines.slice(0, MAX_DIFF_LINES) : lines;

  return {
    filePath,
    linesAdded,
    linesRemoved,
    lines: displayLines,
    truncated,
    fullLineCount,
  };
}

// ----------------------------------------------------------------------------
// Git Apply
// ----------------------------------------------------------------------------

export function applyDiff(hunk: DiffHunk, projectRoot: string): void {
  // Build a minimal unified diff patch for this single hunk
  const patchLines: string[] = [`--- a/${hunk.file}`, `+++ b/${hunk.file}`, hunk.content];

  // Add trailing newline if not present
  let patch = patchLines.join("\n");
  if (!patch.endsWith("\n")) {
    patch += "\n";
  }

  // Write patch to a temporary file to avoid shell escaping issues
  const tmpName = `dantecode-patch-${randomBytes(8).toString("hex")}.patch`;
  const tmpPath = join(tmpdir(), tmpName);

  try {
    writeFileSync(tmpPath, patch, "utf-8");

    execSync(`git apply --allow-empty "${tmpPath}"`, {
      cwd: projectRoot,
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
      maxBuffer: 10 * 1024 * 1024,
    });
  } catch (error: unknown) {
    const err = error as { stderr?: string; message?: string };
    const stderr = typeof err.stderr === "string" ? err.stderr.trim() : "";
    const msg = stderr || err.message || "Unknown git error";
    throw new Error(`git apply: ${msg}`);
  } finally {
    // Clean up the temporary patch file
    try {
      unlinkSync(tmpPath);
    } catch {
      // Ignore cleanup failures
    }
  }
}
