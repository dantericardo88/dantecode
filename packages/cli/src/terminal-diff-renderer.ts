// packages/cli/src/terminal-diff-renderer.ts
// ANSI terminal diff renderer for CLI users — fills the dim 7 gap for non-VSCode contexts.
// Provides both unified (classic) and side-by-side modes with syntax-highlighted output.
//
// Pattern: Aider's rich-diff display — color-coded additions/removals with hunk headers,
// file banners, and optional side-by-side layout when terminal is wide enough.

// ─── ANSI Colors ──────────────────────────────────────────────────────────────

const RESET = "\x1b[0m";
const RED = "\x1b[31m";
const GREEN = "\x1b[32m";
const CYAN = "\x1b[36m";
const YELLOW = "\x1b[33m";
const DIM = "\x1b[2m";
const BOLD = "\x1b[1m";
const BG_RED = "\x1b[41m";
const BG_GREEN = "\x1b[42m";

// ─── Line-Level Myers Diff ────────────────────────────────────────────────────

type LineOp = { op: "equal" | "insert" | "delete"; line: string };

/**
 * Simple O(n*m) LCS-based line diff — good enough for code diffs up to ~1000 lines.
 * Returns edit script (array of LineOp).
 */
export function diffLines(before: string, after: string): LineOp[] {
  const a = before === "" ? [] : before.split("\n");
  const b = after === "" ? [] : after.split("\n");

  const m = a.length;
  const n = b.length;

  // Build LCS table
  const dp: number[][] = Array.from({ length: m + 1 }, () => new Array<number>(n + 1).fill(0));
  for (let i = m - 1; i >= 0; i--) {
    for (let j = n - 1; j >= 0; j--) {
      if (a[i] === b[j]) {
        dp[i]![j] = 1 + dp[i + 1]![j + 1]!;
      } else {
        dp[i]![j] = Math.max(dp[i + 1]![j]!, dp[i]![j + 1]!);
      }
    }
  }

  // Trace back to get edit script
  const ops: LineOp[] = [];
  let i = 0;
  let j = 0;
  while (i < m || j < n) {
    if (i < m && j < n && a[i] === b[j]) {
      ops.push({ op: "equal", line: a[i]! });
      i++;
      j++;
    } else if (j < n && (i >= m || dp[i]![j + 1]! >= dp[i + 1]![j]!)) {
      ops.push({ op: "insert", line: b[j]! });
      j++;
    } else {
      ops.push({ op: "delete", line: a[i]! });
      i++;
    }
  }
  return ops;
}

// ─── Hunk Grouping ─────────────────────────────────────────────────────────────

export interface DiffHunkGroup {
  contextBefore: string[];
  changes: LineOp[];
  contextAfter: string[];
  beforeStart: number;
  afterStart: number;
}

function groupIntoHunks(ops: LineOp[], contextLines: number): DiffHunkGroup[] {
  const hunks: DiffHunkGroup[] = [];
  let i = 0;

  while (i < ops.length) {
    // Find next change
    if (ops[i]!.op === "equal") {
      i++;
      continue;
    }

    // Gather context before
    const ctxStartIdx = Math.max(0, i - contextLines);
    const contextBefore: string[] = [];
    for (let k = ctxStartIdx; k < i; k++) {
      if (ops[k]!.op === "equal") contextBefore.push(ops[k]!.line);
    }

    // Compute line numbers
    let beforeStart = 1;
    let afterStart = 1;
    for (let k = 0; k < ctxStartIdx; k++) {
      if (ops[k]!.op !== "insert") beforeStart++;
      if (ops[k]!.op !== "delete") afterStart++;
    }
    for (let k = ctxStartIdx; k < i; k++) {
      if (ops[k]!.op !== "insert") beforeStart++;
      if (ops[k]!.op !== "delete") afterStart++;
    }
    beforeStart -= contextBefore.length;
    afterStart -= contextBefore.length;

    // Collect changes + trailing context
    const changes: LineOp[] = [];
    let j = i;
    while (j < ops.length) {
      const op = ops[j]!;
      if (op.op !== "equal") {
        changes.push(op);
        j++;
      } else {
        // Look ahead to see if there are more changes within contextLines
        let hasNearbyChange = false;
        for (let k = j + 1; k < j + contextLines + 1 && k < ops.length; k++) {
          if (ops[k]!.op !== "equal") { hasNearbyChange = true; break; }
        }
        if (hasNearbyChange) {
          changes.push(op);
          j++;
        } else {
          break;
        }
      }
    }

    // Trailing context
    const contextAfter: string[] = [];
    for (let k = j; k < j + contextLines && k < ops.length; k++) {
      if (ops[k]!.op === "equal") contextAfter.push(ops[k]!.line);
    }

    hunks.push({ contextBefore, changes, contextAfter, beforeStart, afterStart });
    i = j + contextLines;
  }

  return hunks;
}

// ─── Unified Diff Renderer ────────────────────────────────────────────────────

export interface UnifiedDiffOptions {
  fileName?: string;
  contextLines?: number;
  showLineNumbers?: boolean;
  noColor?: boolean;
}

/**
 * Render a unified diff between before/after strings with ANSI colors.
 * Returns empty string when there are no differences.
 */
export function renderUnifiedDiff(before: string, after: string, opts: UnifiedDiffOptions = {}): string {
  const { fileName, contextLines = 3, showLineNumbers = true, noColor = false } = opts;
  const c = noColor ? { red: "", green: "", cyan: "", dim: "", bold: "", reset: "", bgRed: "", bgGreen: "", yellow: "" }
    : { red: RED, green: GREEN, cyan: CYAN, dim: DIM, bold: BOLD, reset: RESET, bgRed: BG_RED, bgGreen: BG_GREEN, yellow: YELLOW };

  const ops = diffLines(before, after);
  const hasChanges = ops.some((o) => o.op !== "equal");
  if (!hasChanges) return "";

  const hunks = groupIntoHunks(ops, contextLines);
  const lines: string[] = [];

  if (fileName) {
    lines.push(`${c.bold}${c.cyan}--- ${fileName} (before)${c.reset}`);
    lines.push(`${c.bold}${c.cyan}+++ ${fileName} (after)${c.reset}`);
  }

  for (const hunk of hunks) {
    // Compute hunk line ranges
    const beforeLen = hunk.contextBefore.length + hunk.changes.filter((o) => o.op !== "insert").length + hunk.contextAfter.length;
    const afterLen = hunk.contextBefore.length + hunk.changes.filter((o) => o.op !== "delete").length + hunk.contextAfter.length;

    // Hunk header
    lines.push(`${c.cyan}@@ -${hunk.beforeStart},${beforeLen} +${hunk.afterStart},${afterLen} @@${c.reset}`);

    let beforeLine = hunk.beforeStart;
    let afterLine = hunk.afterStart;

    for (const ctxLine of hunk.contextBefore) {
      const ln = showLineNumbers ? `${c.dim}${String(beforeLine).padStart(4)} ${String(afterLine).padStart(4)}${c.reset} ` : "";
      lines.push(`${ln} ${ctxLine}`);
      beforeLine++;
      afterLine++;
    }

    for (const op of hunk.changes) {
      if (op.op === "delete") {
        const ln = showLineNumbers ? `${c.dim}${String(beforeLine).padStart(4)}     ${c.reset}` : "";
        lines.push(`${c.red}${ln}-${op.line}${c.reset}`);
        beforeLine++;
      } else if (op.op === "insert") {
        const ln = showLineNumbers ? `${c.dim}     ${String(afterLine).padStart(4)}${c.reset}` : "";
        lines.push(`${c.green}${ln}+${op.line}${c.reset}`);
        afterLine++;
      } else {
        const ln = showLineNumbers ? `${c.dim}${String(beforeLine).padStart(4)} ${String(afterLine).padStart(4)}${c.reset} ` : "";
        lines.push(`${ln} ${op.line}`);
        beforeLine++;
        afterLine++;
      }
    }

    for (const ctxLine of hunk.contextAfter) {
      const ln = showLineNumbers ? `${c.dim}${String(beforeLine).padStart(4)} ${String(afterLine).padStart(4)}${c.reset} ` : "";
      lines.push(`${ln} ${ctxLine}`);
      beforeLine++;
      afterLine++;
    }
  }

  return lines.join("\n");
}

// ─── Side-By-Side Diff Renderer ───────────────────────────────────────────────

export interface SideBySideOptions {
  fileName?: string;
  contextLines?: number;
  width?: number;
  noColor?: boolean;
}

function padOrTrunc(s: string, len: number): string {
  if (s.length > len) return s.slice(0, len - 1) + "…";
  return s.padEnd(len, " ");
}

/**
 * Render a side-by-side diff with before on the left, after on the right.
 * Falls back to unified if terminal is too narrow (< 80 cols).
 */
export function renderSideBySideDiff(before: string, after: string, opts: SideBySideOptions = {}): string {
  const { fileName, contextLines = 3, width = 160, noColor = false } = opts;
  const c = noColor ? { red: "", green: "", cyan: "", dim: "", bold: "", reset: "", yellow: "" }
    : { red: RED, green: GREEN, cyan: CYAN, dim: DIM, bold: BOLD, reset: RESET, yellow: YELLOW };

  if (width < 80) {
    return renderUnifiedDiff(before, after, { fileName, contextLines, noColor });
  }

  const ops = diffLines(before, after);
  const hasChanges = ops.some((o) => o.op !== "equal");
  if (!hasChanges) return "";

  const colWidth = Math.floor((width - 3) / 2);
  const lines: string[] = [];

  if (fileName) {
    lines.push(`${c.bold}${c.cyan}${padOrTrunc(`─── ${fileName} `, width)}${c.reset}`);
  }

  const divider = "─".repeat(colWidth) + "┼" + "─".repeat(colWidth);
  lines.push(`${c.dim}${padOrTrunc("BEFORE", colWidth)}│${padOrTrunc("AFTER", colWidth)}${c.reset}`);
  lines.push(`${c.dim}${divider}${c.reset}`);

  // Convert ops into paired left/right lines
  const beforeLines: Array<{ text: string; op: "equal" | "delete" | "context" }> = [];
  const afterLines: Array<{ text: string; op: "equal" | "insert" | "context" }> = [];

  const hunks = groupIntoHunks(ops, contextLines);

  for (const hunk of hunks) {
    // Context before
    for (const l of hunk.contextBefore) {
      beforeLines.push({ text: l, op: "equal" });
      afterLines.push({ text: l, op: "equal" });
    }

    // Pair up deletes and inserts in the same hunk
    const dels = hunk.changes.filter((o) => o.op === "delete");
    const ins = hunk.changes.filter((o) => o.op === "insert");
    const eqs = hunk.changes.filter((o) => o.op === "equal");
    const maxPairs = Math.max(dels.length, ins.length);
    for (let k = 0; k < maxPairs; k++) {
      beforeLines.push({ text: dels[k]?.line ?? "", op: dels[k] ? "delete" : "context" });
      afterLines.push({ text: ins[k]?.line ?? "", op: ins[k] ? "insert" : "context" });
    }
    for (const eq of eqs) {
      beforeLines.push({ text: eq.line, op: "equal" });
      afterLines.push({ text: eq.line, op: "equal" });
    }

    // Context after
    for (const l of hunk.contextAfter) {
      beforeLines.push({ text: l, op: "equal" });
      afterLines.push({ text: l, op: "equal" });
    }

    // Separator between hunks
    beforeLines.push({ text: "⋯", op: "context" });
    afterLines.push({ text: "⋯", op: "context" });
  }

  for (let k = 0; k < beforeLines.length; k++) {
    const left = beforeLines[k]!;
    const right = afterLines[k]!;

    const leftColor = left.op === "delete" ? c.red : left.op === "context" ? c.dim : "";
    const rightColor = right.op === "insert" ? c.green : right.op === "context" ? c.dim : "";
    const leftSign = left.op === "delete" ? "-" : " ";
    const rightSign = right.op === "insert" ? "+" : " ";

    const leftText = padOrTrunc(leftSign + left.text, colWidth);
    const rightText = padOrTrunc(rightSign + right.text, colWidth);

    lines.push(`${leftColor}${leftText}${c.reset}│${rightColor}${rightText}${c.reset}`);
  }

  return lines.join("\n");
}

// ─── Multi-File Diff Formatter ─────────────────────────────────────────────────

export interface FileDiffEntry {
  path: string;
  before: string;
  after: string;
}

export interface MultiFileDiffOptions {
  mode?: "unified" | "side-by-side";
  contextLines?: number;
  width?: number;
  noColor?: boolean;
}

/**
 * Format multiple file diffs with file banners and change summaries.
 * Used in CLI review mode and `@diff` context injection.
 */
export function formatMultiFileDiff(files: FileDiffEntry[], opts: MultiFileDiffOptions = {}): string {
  const { mode = "unified", contextLines = 3, width = 160, noColor = false } = opts;
  const c = noColor ? { bold: "", cyan: "", yellow: "", dim: "", reset: "" }
    : { bold: BOLD, cyan: CYAN, yellow: YELLOW, dim: DIM, reset: RESET };

  const sections: string[] = [];

  for (const file of files) {
    const ops = diffLines(file.before, file.after);
    const added = ops.filter((o) => o.op === "insert").length;
    const removed = ops.filter((o) => o.op === "delete").length;
    if (added === 0 && removed === 0) continue;

    const banner = `${c.bold}${c.cyan}${"═".repeat(60)}${c.reset}\n` +
      `${c.bold}${file.path}${c.reset}  ${c.yellow}+${added} -${removed}${c.reset}\n` +
      `${c.dim}${"─".repeat(60)}${c.reset}`;

    const diff = mode === "side-by-side"
      ? renderSideBySideDiff(file.before, file.after, { fileName: file.path, contextLines, width, noColor })
      : renderUnifiedDiff(file.before, file.after, { fileName: file.path, contextLines, noColor });

    sections.push(`${banner}\n${diff}`);
  }

  if (sections.length === 0) return "(no changes)";

  const totalAdded = files.reduce((sum, f) => {
    const ops = diffLines(f.before, f.after);
    return sum + ops.filter((o) => o.op === "insert").length;
  }, 0);
  const totalRemoved = files.reduce((sum, f) => {
    const ops = diffLines(f.before, f.after);
    return sum + ops.filter((o) => o.op === "delete").length;
  }, 0);

  const summary = `${c.bold}${c.cyan}${"═".repeat(60)}${c.reset}\n` +
    `${c.bold}Summary:${c.reset} ${sections.length} file(s)  ${c.yellow}+${totalAdded} lines  -${totalRemoved} lines${c.reset}`;

  return [...sections, summary].join("\n\n");
}

// ─── Compact Stats Line ────────────────────────────────────────────────────────

/**
 * One-line summary: "+12 -4 in 3 files"
 * Used in status bars and TokenGauge annotations.
 */
export function diffStatLine(files: FileDiffEntry[], noColor = false): string {
  const c = noColor ? { green: "", red: "", dim: "", reset: "" } : { green: GREEN, red: RED, dim: DIM, reset: RESET };
  let added = 0;
  let removed = 0;
  let changed = 0;
  for (const f of files) {
    const ops = diffLines(f.before, f.after);
    const a = ops.filter((o) => o.op === "insert").length;
    const r = ops.filter((o) => o.op === "delete").length;
    if (a > 0 || r > 0) { added += a; removed += r; changed++; }
  }
  if (changed === 0) return "(no changes)";
  return `${c.green}+${added}${c.reset} ${c.red}-${removed}${c.reset} ${c.dim}in ${changed} file(s)${c.reset}`;
}
