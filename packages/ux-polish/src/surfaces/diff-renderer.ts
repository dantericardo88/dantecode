/**
 * diff-renderer.ts — @dantecode/ux-polish
 *
 * Terminal diff renderer with syntax highlighting.
 * Renders unified diffs with:
 *   - Green lines for additions (+ prefix)
 *   - Red lines for deletions (- prefix)
 *   - Dim for context lines
 *   - Line numbers in the gutter
 *   - File header with path and change summary
 *
 * No external dependencies. Uses ANSI escape codes only.
 * All functions are pure (string in, string out).
 */

import { ThemeEngine } from "../theme-engine.js";
import type { SemanticColors } from "../types.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Reject diffs larger than this to prevent DoS. */
const MAX_DIFF_INPUT_SIZE = 5_000_000; // 5MB
/** Cap per-side line count so DP LCS stays tractable and always correct. */
const MAX_LINES_PER_SIDE = 800;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface DiffRenderOptions {
  /** Max lines to display before truncating. Default: 50. */
  maxLines?: number;
  /** Show line numbers in gutter. Default: true. */
  lineNumbers?: boolean;
  /** Colorize code syntax within diff lines. Default: true. */
  syntaxHighlight?: boolean;
  /** Theme for colors. */
  theme?: ThemeEngine;
  /** Compact mode: show only changed lines, no context. */
  compact?: boolean;
}

export interface DiffRenderResult {
  /** Full ANSI-formatted diff string. */
  rendered: string;
  /** Count of added lines. */
  additions: number;
  /** Count of removed lines. */
  deletions: number;
  /** Number of files referenced in the diff. */
  fileCount: number;
  /** Whether output was truncated at maxLines. */
  truncated: boolean;
}

// ---------------------------------------------------------------------------
// Syntax highlighting patterns
// ---------------------------------------------------------------------------

const KEYWORD_PATTERNS: Record<string, RegExp> = {
  ts: /\b(import|export|const|let|var|function|class|interface|type|return|if|else|for|while|async|await|new|throw|try|catch|finally|extends|implements|readonly|public|private|protected|static|abstract|enum|namespace|module|declare|as|from|of|in|instanceof|typeof|keyof|never|unknown|void|undefined|null|true|false)\b/g,
  js: /\b(import|export|const|let|var|function|class|return|if|else|for|while|async|await|new|throw|try|catch|finally|extends|prototype|this|typeof|instanceof|in|of|null|true|false|undefined)\b/g,
  py: /\b(import|from|def|class|return|if|elif|else|for|while|with|as|try|except|finally|raise|yield|async|await|pass|break|continue|and|or|not|in|is|lambda|global|nonlocal|True|False|None)\b/g,
  rs: /\b(fn|let|mut|const|struct|enum|impl|trait|use|pub|mod|match|if|else|for|while|loop|return|async|await|move|ref|self|Self|super|crate|where|type|dyn|unsafe|extern|static|break|continue|true|false)\b/g,
  go: /\b(func|var|const|type|struct|interface|return|if|else|for|range|switch|case|default|defer|go|chan|select|map|make|new|nil|true|false|package|import|break|continue|fallthrough|goto)\b/g,
};

const STRING_PATTERN = /(["'`])(?:(?!\1|\\).|\\.)*\1/g;

const COMMENT_PATTERNS: Record<string, RegExp> = {
  ts: /\/\/.*$|\/\*[\s\S]*?\*\//gm,
  js: /\/\/.*$|\/\*[\s\S]*?\*\//gm,
  py: /#.*$/gm,
  rs: /\/\/.*$|\/\*[\s\S]*?\*\//gm,
  go: /\/\/.*$|\/\*[\s\S]*?\*\//gm,
};

/**
 * Apply lightweight syntax highlighting to a single line.
 * Order: comments first (greedy), then strings, then keywords.
 */
export function highlightLine(line: string, fileExtension: string, theme: ThemeEngine): string {
  const c = theme.resolve().colors;
  const lang = fileExtension.replace(/^\./, "").toLowerCase();

  // Only highlight languages we know
  if (!KEYWORD_PATTERNS[lang]) return line;

  let result = line;
  const commentPlaceholders: string[] = [];

  // Step 1: Extract comment regions into placeholders so strings/keywords
  // inside comments are not double-colored.
  const commentPattern = COMMENT_PATTERNS[lang];
  if (commentPattern) {
    result = result.replace(
      new RegExp(commentPattern.source, commentPattern.flags),
      (m) => {
        const idx = commentPlaceholders.length;
        commentPlaceholders.push(`${c.muted}${m}${c.reset}`);
        return `\x00C${idx}\x00`;
      },
    );
  }

  // Step 2: Strings (only outside comment regions)
  result = result.replace(
    new RegExp(STRING_PATTERN.source, STRING_PATTERN.flags),
    (m) => `${c.success}${m}${c.reset}`,
  );

  // Step 3: Keywords (only outside comment regions)
  const kwPattern = KEYWORD_PATTERNS[lang];
  if (kwPattern) {
    result = result.replace(
      new RegExp(kwPattern.source, kwPattern.flags),
      (m) => `${c.progress}${m}${c.reset}`,
    );
  }

  // Step 4: Restore comment placeholders
  for (let i = 0; i < commentPlaceholders.length; i++) {
    result = result.replace(`\x00C${i}\x00`, commentPlaceholders[i]!);
  }

  return result;
}

// ---------------------------------------------------------------------------
// renderDiff — parse and render a unified diff string
// ---------------------------------------------------------------------------

/**
 * Render a unified diff string to themed ANSI output.
 */
export function renderDiff(
  unifiedDiff: string,
  options: DiffRenderOptions = {},
): DiffRenderResult {
  const maxLines = options.maxLines ?? 50;
  const showLineNumbers = options.lineNumbers ?? true;
  const doHighlight = options.syntaxHighlight ?? true;
  const compact = options.compact ?? false;
  const theme = options.theme ?? new ThemeEngine();
  const c = theme.resolve().colors;

  if (unifiedDiff.length > MAX_DIFF_INPUT_SIZE) {
    return {
      rendered: `${c.warning}Diff skipped — input too large${c.reset}\n`,
      additions: 0,
      deletions: 0,
      fileCount: 0,
      truncated: true,
    };
  }

  if (!unifiedDiff.trim()) {
    return {
      rendered: `${c.muted}No changes${c.reset}\n`,
      additions: 0,
      deletions: 0,
      fileCount: 0,
      truncated: false,
    };
  }

  const lines = unifiedDiff.split("\n");
  const outputLines: string[] = [];
  let additions = 0;
  let deletions = 0;
  let fileCount = 0;
  let truncated = false;
  let leftLine = 1;
  let rightLine = 1;
  let currentFile = "";
  let linesWritten = 0;

  for (let i = 0; i < lines.length; i++) {
    if (linesWritten >= maxLines) {
      truncated = true;
      break;
    }

    const line = lines[i] ?? "";

    if (line.startsWith("--- ")) {
      currentFile = line.slice(4).replace(/^a\//, "");
      continue;
    }

    if (line.startsWith("+++ ")) {
      const newFile = line.slice(4).replace(/^b\//, "");
      fileCount++;
      outputLines.push(formatFileHeader(newFile || currentFile, c));
      linesWritten++;
      continue;
    }

    if (line.startsWith("@@ ")) {
      // Parse hunk header: @@ -L,S +L,S @@
      const match = /@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(line);
      if (match) {
        leftLine = parseInt(match[1] ?? "1", 10);
        rightLine = parseInt(match[2] ?? "1", 10);
      }
      if (!compact) {
        outputLines.push(`${c.muted}${line}${c.reset}`);
        linesWritten++;
      }
      continue;
    }

    if (line.startsWith("+") && !line.startsWith("+++")) {
      additions++;
      const content = line.slice(1);
      const ext = getExtension(currentFile);
      const highlighted = doHighlight ? highlightLine(content, ext, theme) : content;
      const gutter = showLineNumbers ? `${c.success}${padLine(rightLine)}${c.reset}` : "";
      outputLines.push(`${c.success}+${c.reset}${gutter}${c.success} ${highlighted}${c.reset}`);
      rightLine++;
      linesWritten++;
      continue;
    }

    if (line.startsWith("-") && !line.startsWith("---")) {
      deletions++;
      const content = line.slice(1);
      const ext = getExtension(currentFile);
      const highlighted = doHighlight ? highlightLine(content, ext, theme) : content;
      const gutter = showLineNumbers ? `${c.error}${padLine(leftLine)}${c.reset}` : "";
      outputLines.push(`${c.error}-${c.reset}${gutter}${c.error} ${highlighted}${c.reset}`);
      leftLine++;
      linesWritten++;
      continue;
    }

    if (line.startsWith(" ") || line === "") {
      if (!compact) {
        const content = line.startsWith(" ") ? line.slice(1) : "";
        const gutter = showLineNumbers
          ? `${c.muted}${padLine(rightLine)}${c.reset}`
          : "";
        outputLines.push(`${c.muted} ${gutter} ${content}${c.reset}`);
        linesWritten++;
      }
      leftLine++;
      rightLine++;
      continue;
    }
  }

  if (truncated) {
    const remaining = lines.length - linesWritten;
    outputLines.push(`${c.muted}... (${remaining} more lines truncated)${c.reset}`);
  }

  return {
    rendered: outputLines.join("\n") + "\n",
    additions,
    deletions,
    fileCount,
    truncated,
  };
}

// ---------------------------------------------------------------------------
// renderBeforeAfter — generate diff from two strings and render it
// ---------------------------------------------------------------------------

/**
 * Render a before/after comparison for a single file.
 * Generates a unified diff internally — no external deps.
 */
export function renderBeforeAfter(
  filePath: string,
  before: string,
  after: string,
  options: DiffRenderOptions = {},
): DiffRenderResult {
  const theme = options.theme ?? new ThemeEngine();
  const c = theme.resolve().colors;

  // DoS guard: reject excessively large inputs
  if (before.length + after.length > MAX_DIFF_INPUT_SIZE) {
    return {
      rendered: `${c.warning}Diff skipped — input too large (${Math.round((before.length + after.length) / 1_000_000)}MB)${c.reset}\n`,
      additions: 0,
      deletions: 0,
      fileCount: 0,
      truncated: true,
    };
  }

  // Line cap: truncate inputs so DP LCS is always correct and tractable.
  // fastLCS was removed — DP only, capped at MAX_LINES_PER_SIDE per side.
  const beforeLines = before.split("\n");
  const afterLines = after.split("\n");
  const inputTruncated =
    beforeLines.length > MAX_LINES_PER_SIDE || afterLines.length > MAX_LINES_PER_SIDE;
  const effectiveBefore = inputTruncated
    ? beforeLines.slice(0, MAX_LINES_PER_SIDE).join("\n")
    : before;
  const effectiveAfter = inputTruncated
    ? afterLines.slice(0, MAX_LINES_PER_SIDE).join("\n")
    : after;

  const unifiedDiff = generateUnifiedDiff(filePath, effectiveBefore, effectiveAfter);
  const result = renderDiff(unifiedDiff, { ...options, theme });

  if (inputTruncated) {
    const note = `${c.warning}⚠ Diff truncated — showing first ${MAX_LINES_PER_SIDE} lines per side${c.reset}\n`;
    return { ...result, rendered: note + result.rendered, truncated: true };
  }

  return result;
}

// ---------------------------------------------------------------------------
// Internal diff generation (Myers diff, simplified)
// ---------------------------------------------------------------------------

function generateUnifiedDiff(filePath: string, before: string, after: string): string {
  const beforeLines = before.split("\n");
  const afterLines = after.split("\n");
  const hunks = computeHunks(beforeLines, afterLines);

  if (hunks.length === 0) return "";

  const lines: string[] = [
    `--- a/${filePath}`,
    `+++ b/${filePath}`,
  ];

  for (const hunk of hunks) {
    lines.push(hunk.header);
    lines.push(...hunk.lines);
  }

  return lines.join("\n");
}

interface DiffHunk {
  header: string;
  lines: string[];
}

function computeHunks(before: string[], after: string[]): DiffHunk[] {
  // LCS-based diff
  const edits = computeEdits(before, after);
  if (edits.length === 0) return [];

  const CONTEXT = 3;
  const hunks: DiffHunk[] = [];
  let i = 0;

  while (i < edits.length) {
    const edit = edits[i];
    if (!edit || edit.kind === "equal") {
      i++;
      continue;
    }

    // Collect a window of edits with context
    const start = Math.max(0, i - CONTEXT);
    let end = i;

    // Expand to include surrounding changed lines
    while (end < edits.length && ((edits[end]?.kind ?? "equal") !== "equal" || end - i < CONTEXT)) {
      end++;
    }
    end = Math.min(edits.length, end + CONTEXT);

    const hunkEdits = edits.slice(start, end);
    const hunkLines: string[] = [];
    let leftStart = 1;
    let rightStart = 1;
    let leftCount = 0;
    let rightCount = 0;

    // Compute start positions
    for (let j = 0; j < start; j++) {
      const e = edits[j];
      if (!e) continue;
      if (e.kind === "equal" || e.kind === "delete") leftStart++;
      if (e.kind === "equal" || e.kind === "insert") rightStart++;
    }

    for (const e of hunkEdits) {
      if (e.kind === "equal") {
        hunkLines.push(` ${e.text}`);
        leftCount++;
        rightCount++;
      } else if (e.kind === "delete") {
        hunkLines.push(`-${e.text}`);
        leftCount++;
      } else {
        hunkLines.push(`+${e.text}`);
        rightCount++;
      }
    }

    hunks.push({
      header: `@@ -${leftStart},${leftCount} +${rightStart},${rightCount} @@`,
      lines: hunkLines,
    });

    i = end;
  }

  return hunks;
}

interface Edit {
  kind: "equal" | "insert" | "delete";
  text: string;
}

function computeEdits(before: string[], after: string[]): Edit[] {
  // Simple patience diff via LCS
  const lcs = longestCommonSubsequence(before, after);
  const edits: Edit[] = [];
  let bi = 0;
  let ai = 0;
  let li = 0;

  while (li < lcs.length) {
    const pair = lcs[li];
    if (!pair) { li++; continue; }
    const [bIdx, aIdx] = pair;
    while (bi < bIdx) {
      edits.push({ kind: "delete", text: before[bi++] ?? "" });
    }
    while (ai < aIdx) {
      edits.push({ kind: "insert", text: after[ai++] ?? "" });
    }
    edits.push({ kind: "equal", text: before[bi] ?? "" });
    bi++;
    ai++;
    li++;
  }

  while (bi < before.length) {
    edits.push({ kind: "delete", text: before[bi++] ?? "" });
  }
  while (ai < after.length) {
    edits.push({ kind: "insert", text: after[ai++] ?? "" });
  }

  return edits;
}

function longestCommonSubsequence(a: string[], b: string[]): [number, number][] {
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

  // Backtrack
  const result: [number, number][] = [];
  let i = m;
  let j = n;
  while (i > 0 && j > 0) {
    if (a[i - 1] === b[j - 1]) {
      result.unshift([i - 1, j - 1]);
      i--;
      j--;
    } else if (dp[i - 1]![j]! > dp[i]![j - 1]!) {
      i--;
    } else {
      j--;
    }
  }

  return result;
}

// ---------------------------------------------------------------------------
// Formatting helpers
// ---------------------------------------------------------------------------

function formatFileHeader(filePath: string, c: SemanticColors): string {
  return `${c.info}┌─ ${filePath} ─${"─".repeat(Math.max(0, 40 - filePath.length))}┐${c.reset}`;
}

function padLine(n: number): string {
  return String(n).padStart(4);
}

function getExtension(filePath: string): string {
  const dot = filePath.lastIndexOf(".");
  return dot >= 0 ? filePath.slice(dot + 1) : "";
}
