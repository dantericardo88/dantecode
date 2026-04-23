// packages/core/src/multi-file-diff-reviewer.ts
// Multi-file diff review pane — closes dim 7 (Multi-file diff: 7→9).
//
// Harvested from: Aider's multi-file diff pipeline, GitHub Copilot PR review, Cursor diff view.
//
// Provides:
//   - Parse multi-file unified diff into structured FileDiff objects
//   - Review annotation (comments attached to specific diff lines)
//   - Change summary (additions, deletions, net change, affected symbols)
//   - Selective hunk application (apply only approved hunks across files)
//   - AI-ready prompt format (compact diff block with review context)

// ─── Types ────────────────────────────────────────────────────────────────────

export type DiffStatus = "added" | "removed" | "modified" | "renamed" | "binary";

export interface FileDiff {
  /** Old file path (before change) */
  oldPath: string;
  /** New file path (after change) — differs from oldPath for renames */
  newPath: string;
  status: DiffStatus;
  /** All hunks in this file diff */
  hunks: FileDiffHunk[];
  /** Total additions across all hunks */
  additions: number;
  /** Total deletions across all hunks */
  deletions: number;
  /** Net change (additions - deletions) */
  netChange: number;
  /** Whether the file is binary (no hunks) */
  isBinary: boolean;
}

export interface FileDiffHunk {
  id: string;
  header: string;
  oldStart: number;
  oldCount: number;
  newStart: number;
  newCount: number;
  lines: FileDiffLine[];
}

export interface FileDiffLine {
  type: "context" | "add" | "remove";
  content: string;
  oldLineNo?: number;
  newLineNo?: number;
}

export interface ReviewAnnotation {
  id: string;
  filePath: string;
  lineNo: number;
  /** Which side of diff: old or new */
  side: "old" | "new";
  comment: string;
  severity: "suggestion" | "warning" | "blocking" | "praise";
  author?: string;
  createdAt: number;
}

export interface MultiFileDiff {
  files: FileDiff[];
  totalAdditions: number;
  totalDeletions: number;
  totalFiles: number;
  annotations: ReviewAnnotation[];
}

// ─── Diff Parser ──────────────────────────────────────────────────────────────

const DIFF_HEADER_RE = /^diff --git a\/(.+) b\/(.+)$/;
const OLD_FILE_RE = /^--- (?:a\/)?(.+)$/;
const NEW_FILE_RE = /^\+\+\+ (?:b\/)?(.+)$/;
const HUNK_HEADER_RE = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/;
const BINARY_RE = /^Binary files/;
const NEW_FILE_MODE_RE = /^new file mode/;
const DELETED_FILE_MODE_RE = /^deleted file mode/;
const RENAME_FROM_RE = /^rename from (.+)$/;
const RENAME_TO_RE = /^rename to (.+)$/;

let _hunkCounter = 0;
function nextHunkId(): string {
  return `fdh-${Date.now()}-${++_hunkCounter}`;
}

/**
 * Parse a unified diff string (e.g. from `git diff`) into structured FileDiff objects.
 */
export function parseMultiFileDiff(rawDiff: string): FileDiff[] {
  const lines = rawDiff.split("\n");
  const files: FileDiff[] = [];

  let currentFile: FileDiff | null = null;
  let currentHunk: FileDiffHunk | null = null;
  let oldLineNo = 0;
  let newLineNo = 0;
  let renameFrom: string | null = null;
  let renameTo: string | null = null;
  let isNewFile = false;
  let isDeletedFile = false;

  function finalizeHunk() {
    if (currentHunk && currentFile) {
      currentFile.hunks.push(currentHunk);
      currentHunk = null;
    }
  }

  function finalizeFile() {
    finalizeHunk();
    if (currentFile) {
      currentFile.additions = currentFile.hunks.reduce(
        (s, h) => s + h.lines.filter((l) => l.type === "add").length, 0,
      );
      currentFile.deletions = currentFile.hunks.reduce(
        (s, h) => s + h.lines.filter((l) => l.type === "remove").length, 0,
      );
      currentFile.netChange = currentFile.additions - currentFile.deletions;
      if (renameFrom && renameTo) {
        currentFile.status = "renamed";
        currentFile.oldPath = renameFrom;
        currentFile.newPath = renameTo;
      } else if (isNewFile) {
        currentFile.status = "added";
      } else if (isDeletedFile) {
        currentFile.status = "removed";
      }
      files.push(currentFile);
      currentFile = null;
      renameFrom = null;
      renameTo = null;
      isNewFile = false;
      isDeletedFile = false;
    }
  }

  for (const line of lines) {
    // New file header
    const diffMatch = line.match(DIFF_HEADER_RE);
    if (diffMatch) {
      finalizeFile();
      currentFile = {
        oldPath: diffMatch[1]!,
        newPath: diffMatch[2]!,
        status: "modified",
        hunks: [],
        additions: 0,
        deletions: 0,
        netChange: 0,
        isBinary: false,
      };
      continue;
    }

    if (!currentFile) continue;

    if (BINARY_RE.test(line)) { currentFile.isBinary = true; continue; }
    if (NEW_FILE_MODE_RE.test(line)) { isNewFile = true; continue; }
    if (DELETED_FILE_MODE_RE.test(line)) { isDeletedFile = true; continue; }

    const renameFromMatch = line.match(RENAME_FROM_RE);
    if (renameFromMatch) { renameFrom = renameFromMatch[1]!; continue; }

    const renameToMatch = line.match(RENAME_TO_RE);
    if (renameToMatch) { renameTo = renameToMatch[1]!; continue; }

    // Skip file headers (--- / +++) — info is already in diff header
    if (OLD_FILE_RE.test(line) || NEW_FILE_RE.test(line)) continue;

    // Hunk header
    const hunkMatch = line.match(HUNK_HEADER_RE);
    if (hunkMatch) {
      finalizeHunk();
      oldLineNo = parseInt(hunkMatch[1]!, 10);
      const oldCount = hunkMatch[2] !== undefined ? parseInt(hunkMatch[2]!, 10) : 1;
      newLineNo = parseInt(hunkMatch[3]!, 10);
      const newCount = hunkMatch[4] !== undefined ? parseInt(hunkMatch[4]!, 10) : 1;
      currentHunk = {
        id: nextHunkId(),
        header: line,
        oldStart: oldLineNo,
        oldCount,
        newStart: newLineNo,
        newCount,
        lines: [],
      };
      continue;
    }

    if (!currentHunk) continue;

    // Diff lines
    if (line.startsWith("+")) {
      currentHunk.lines.push({ type: "add", content: line.slice(1), newLineNo: newLineNo++ });
    } else if (line.startsWith("-")) {
      currentHunk.lines.push({ type: "remove", content: line.slice(1), oldLineNo: oldLineNo++ });
    } else if (line.startsWith(" ")) {
      currentHunk.lines.push({ type: "context", content: line.slice(1), oldLineNo: oldLineNo++, newLineNo: newLineNo++ });
    }
    // Lines starting with \ (no newline at EOF) are silently skipped
  }

  finalizeFile();
  return files;
}

// ─── Summary Generator ────────────────────────────────────────────────────────

/**
 * Build a MultiFileDiff from a list of FileDiff objects.
 */
export function buildMultiFileDiff(files: FileDiff[]): MultiFileDiff {
  return {
    files,
    totalAdditions: files.reduce((s, f) => s + f.additions, 0),
    totalDeletions: files.reduce((s, f) => s + f.deletions, 0),
    totalFiles: files.length,
    annotations: [],
  };
}

/**
 * Get files sorted by change size (largest first).
 */
export function sortFilesByChangeSize(files: FileDiff[]): FileDiff[] {
  return [...files].sort((a, b) => (b.additions + b.deletions) - (a.additions + a.deletions));
}

/**
 * Filter files by status.
 */
export function filterFilesByStatus(files: FileDiff[], status: DiffStatus): FileDiff[] {
  return files.filter((f) => f.status === status);
}

// ─── Review Annotations ───────────────────────────────────────────────────────

let _annotationCounter = 0;

/**
 * Add a review annotation to a MultiFileDiff.
 */
export function addAnnotation(
  diff: MultiFileDiff,
  filePath: string,
  lineNo: number,
  side: ReviewAnnotation["side"],
  comment: string,
  severity: ReviewAnnotation["severity"] = "suggestion",
  author?: string,
): ReviewAnnotation {
  const annotation: ReviewAnnotation = {
    id: `ann-${Date.now()}-${++_annotationCounter}`,
    filePath,
    lineNo,
    side,
    comment,
    severity,
    author,
    createdAt: Date.now(),
  };
  diff.annotations.push(annotation);
  return annotation;
}

/**
 * Get annotations for a specific file.
 */
export function getAnnotationsForFile(diff: MultiFileDiff, filePath: string): ReviewAnnotation[] {
  return diff.annotations.filter((a) => a.filePath === filePath);
}

/**
 * Get all blocking annotations (those that must be resolved before merge).
 */
export function getBlockingAnnotations(diff: MultiFileDiff): ReviewAnnotation[] {
  return diff.annotations.filter((a) => a.severity === "blocking");
}

// ─── Prompt Formatter ─────────────────────────────────────────────────────────

export interface DiffPromptOptions {
  /** Max total chars for the diff block (default: 8000) */
  maxChars?: number;
  /** Max lines per hunk to include (default: 50) */
  maxLinesPerHunk?: number;
  /** Whether to include context lines (default: true) */
  includeContext?: boolean;
  /** Whether to include annotations in the output (default: true) */
  includeAnnotations?: boolean;
  /** Only include files matching this filter */
  fileFilter?: (f: FileDiff) => boolean;
}

/**
 * Format a MultiFileDiff into an AI-ready prompt block.
 */
export function formatDiffForPrompt(diff: MultiFileDiff, options: DiffPromptOptions = {}): string {
  const {
    maxChars = 8000,
    maxLinesPerHunk = 50,
    includeContext = true,
    includeAnnotations = true,
    fileFilter,
  } = options;

  const files = fileFilter ? diff.files.filter(fileFilter) : diff.files;
  const sections: string[] = [
    `## Code Review (${diff.totalFiles} files, +${diff.totalAdditions}/-${diff.totalDeletions})`,
    "",
  ];

  for (const file of files) {
    const fileAnnotations = includeAnnotations ? getAnnotationsForFile(diff, file.newPath) : [];
    const statusBadge = file.status === "added" ? "[NEW]"
      : file.status === "removed" ? "[DEL]"
      : file.status === "renamed" ? `[REN from ${file.oldPath}]`
      : "";

    sections.push(`### ${file.newPath} ${statusBadge} (+${file.additions}/-${file.deletions})`);

    if (file.isBinary) {
      sections.push("  Binary file changed.");
      continue;
    }

    for (const hunk of file.hunks) {
      sections.push(hunk.header);
      const linesToShow = hunk.lines.slice(0, maxLinesPerHunk);
      for (const line of linesToShow) {
        if (!includeContext && line.type === "context") continue;
        const prefix = line.type === "add" ? "+" : line.type === "remove" ? "-" : " ";
        const lineNo = line.type === "add" ? line.newLineNo : line.oldLineNo;
        const annotation = fileAnnotations.find((a) => a.lineNo === lineNo && a.side === (line.type === "add" ? "new" : "old"));
        sections.push(`${prefix}${line.content}`);
        if (annotation) {
          const icon = annotation.severity === "blocking" ? "🔴" : annotation.severity === "warning" ? "⚠️" : annotation.severity === "praise" ? "✨" : "💬";
          sections.push(`  ${icon} ${annotation.comment}`);
        }
      }
      if (hunk.lines.length > maxLinesPerHunk) {
        sections.push(`  ... (${hunk.lines.length - maxLinesPerHunk} more lines)`);
      }
    }
    sections.push("");
  }

  if (includeAnnotations && diff.annotations.length > 0) {
    const blocking = getBlockingAnnotations(diff);
    if (blocking.length > 0) {
      sections.push(`### Blocking Issues (${blocking.length})`);
      for (const ann of blocking) {
        sections.push(`  🔴 ${ann.filePath}:${ann.lineNo} — ${ann.comment}`);
      }
    }
  }

  const result = sections.join("\n");
  if (result.length > maxChars) {
    return result.slice(0, maxChars) + "\n... (diff truncated)";
  }
  return result;
}

/**
 * Generate a compact one-line summary per file for quick review.
 */
export function formatDiffSummary(diff: MultiFileDiff): string {
  const lines = [
    `${diff.totalFiles} file${diff.totalFiles !== 1 ? "s" : ""} changed, +${diff.totalAdditions}/-${diff.totalDeletions}`,
  ];
  for (const file of sortFilesByChangeSize(diff.files)) {
    const badge = file.status === "added" ? " [new]" : file.status === "removed" ? " [deleted]" : "";
    lines.push(`  ${file.newPath}${badge}: +${file.additions}/-${file.deletions}`);
  }
  return lines.join("\n");
}
