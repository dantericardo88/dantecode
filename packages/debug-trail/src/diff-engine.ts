// ============================================================================
// @dantecode/debug-trail — Diff Engine
// Generates human-readable before/after diffs for trail entries and exports.
// Zero-dependency line-level diff using Myers-style patience algorithm.
// ============================================================================

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface DiffLine {
  type: "context" | "added" | "removed";
  lineNumber?: number;
  oldLineNumber?: number;
  newLineNumber?: number;
  content: string;
}

export interface FileDiff {
  filePath: string;
  beforeHash?: string;
  afterHash?: string;
  linesAdded: number;
  linesRemoved: number;
  hunks: DiffHunk[];
  isBinary: boolean;
  summary: string;
}

export interface DiffHunk {
  oldStart: number;
  oldCount: number;
  newStart: number;
  newCount: number;
  lines: DiffLine[];
}

// ---------------------------------------------------------------------------
// Core line-level diff (patience/LCS-based)
// ---------------------------------------------------------------------------

function lcs(a: string[], b: string[]): number[][] {
  const m = a.length;
  const n = b.length;
  // Build DP table
  const dp: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0) as number[]);

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

// Gap 3: iterative backtrack — avoids JS call-stack overflow for large files.
function backtrack(dp: number[][], a: string[], b: string[], m: number, n: number): DiffLine[] {
  const lines: DiffLine[] = [];
  let i = m;
  let j = n;
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && a[i - 1] === b[j - 1]) {
      lines.push({ type: "context", content: a[i - 1]! });
      i--;
      j--;
    } else if (j > 0 && (i === 0 || dp[i]![j - 1]! >= dp[i - 1]![j]!)) {
      lines.push({ type: "added", content: b[j - 1]! });
      j--;
    } else {
      lines.push({ type: "removed", content: a[i - 1]! });
      i--;
    }
  }
  return lines.reverse();
}

function computeDiffLines(beforeLines: string[], afterLines: string[]): DiffLine[] {
  const dp = lcs(beforeLines, afterLines);
  return backtrack(dp, beforeLines, afterLines, beforeLines.length, afterLines.length);
}

// ---------------------------------------------------------------------------
// Group diff lines into hunks with context
// ---------------------------------------------------------------------------

function groupIntoHunks(lines: DiffLine[], contextSize = 3): DiffHunk[] {
  // Assign line numbers
  let oldLine = 1;
  let newLine = 1;
  const numbered = lines.map((l) => {
    const result = { ...l, oldLineNumber: oldLine, newLineNumber: newLine };
    if (l.type !== "added") oldLine++;
    if (l.type !== "removed") newLine++;
    return result;
  });

  // Find change positions
  const changePositions = numbered
    .map((l, i) => ({ i, changed: l.type !== "context" }))
    .filter((x) => x.changed)
    .map((x) => x.i);

  if (changePositions.length === 0) return [];

  // Group into hunks
  const hunks: DiffHunk[] = [];
  let hunkStart = Math.max(0, changePositions[0]! - contextSize);
  let hunkEnd = Math.min(numbered.length - 1, changePositions[0]! + contextSize);

  for (let ci = 1; ci < changePositions.length; ci++) {
    const pos = changePositions[ci]!;
    if (pos - hunkEnd <= contextSize * 2) {
      hunkEnd = Math.min(numbered.length - 1, pos + contextSize);
    } else {
      hunks.push(buildHunk(numbered.slice(hunkStart, hunkEnd + 1)));
      hunkStart = Math.max(0, pos - contextSize);
      hunkEnd = Math.min(numbered.length - 1, pos + contextSize);
    }
  }
  hunks.push(buildHunk(numbered.slice(hunkStart, hunkEnd + 1)));
  return hunks;
}

function buildHunk(lines: DiffLine[]): DiffHunk {
  const oldStart = lines[0]?.oldLineNumber ?? 1;
  const newStart = lines[0]?.newLineNumber ?? 1;
  const oldCount = lines.filter((l) => l.type !== "added").length;
  const newCount = lines.filter((l) => l.type !== "removed").length;
  return { oldStart, oldCount, newStart, newCount, lines };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** Check if content is binary (non-UTF-8). */
export function isBinaryContent(content: string | Buffer): boolean {
  if (Buffer.isBuffer(content)) {
    // Check first 8KB for null bytes
    const sample = content.slice(0, 8192);
    return sample.includes(0);
  }
  return false;
}

/**
 * Compute a diff between before and after text content.
 */
export function diffText(
  before: string,
  after: string,
  options?: { contextLines?: number; filePath?: string; beforeHash?: string; afterHash?: string },
): FileDiff {
  const filePath = options?.filePath ?? "<unknown>";
  const contextLines = options?.contextLines ?? 3;

  const beforeLines = before.split("\n");
  const afterLines = after.split("\n");

  const diffLines = computeDiffLines(beforeLines, afterLines);
  const hunks = groupIntoHunks(diffLines, contextLines);
  const linesAdded = diffLines.filter((l) => l.type === "added").length;
  const linesRemoved = diffLines.filter((l) => l.type === "removed").length;

  return {
    filePath,
    beforeHash: options?.beforeHash,
    afterHash: options?.afterHash,
    linesAdded,
    linesRemoved,
    hunks,
    isBinary: false,
    summary: `+${linesAdded} -${linesRemoved}`,
  };
}

/**
 * Compute a diff between two Buffers.
 */
export function diffBuffers(
  before: Buffer,
  after: Buffer,
  options?: { filePath?: string; beforeHash?: string; afterHash?: string },
): FileDiff {
  const filePath = options?.filePath ?? "<unknown>";
  if (isBinaryContent(before) || isBinaryContent(after)) {
    return {
      filePath,
      beforeHash: options?.beforeHash,
      afterHash: options?.afterHash,
      linesAdded: 0,
      linesRemoved: 0,
      hunks: [],
      isBinary: true,
      summary: "[binary file changed]",
    };
  }
  return diffText(before.toString("utf8"), after.toString("utf8"), { ...options, filePath });
}

/**
 * Format a FileDiff as a unified diff string.
 */
export function formatUnifiedDiff(diff: FileDiff): string {
  if (diff.isBinary) {
    return `Binary file changed: ${diff.filePath}\n`;
  }
  const lines: string[] = [`--- a/${diff.filePath}`, `+++ b/${diff.filePath}`];
  for (const hunk of diff.hunks) {
    lines.push(`@@ -${hunk.oldStart},${hunk.oldCount} +${hunk.newStart},${hunk.newCount} @@`);
    for (const line of hunk.lines) {
      const prefix = line.type === "added" ? "+" : line.type === "removed" ? "-" : " ";
      lines.push(`${prefix}${line.content}`);
    }
  }
  return lines.join("\n");
}
