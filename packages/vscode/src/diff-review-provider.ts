import * as vscode from "vscode";
import { execFile as execFileCallback } from "node:child_process";
import { mkdtemp, writeFile as writeFileFs } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, extname, join, relative } from "node:path";
import { promisify } from "node:util";
import { applyDiff, parseDiffHunks, type DiffHunk } from "@dantecode/git-engine";

const execFileAsync = promisify(execFileCallback);

// ─── Character-Level Diff ────────────────────────────────────────────────────

export interface CharDiffChunk {
  type: "equal" | "insert" | "delete";
  text: string;
}

export interface CharDiffResult {
  chunks: CharDiffChunk[];
  insertedChars: number;
  deletedChars: number;
  hasChanges: boolean;
}

/**
 * Compute a character-level diff between two strings using a simple LCS
 * (longest common subsequence) algorithm operating on individual characters.
 *
 * Suitable for highlighting intra-line differences in the VS Code char-diff
 * webview.  For performance, strings longer than 2000 characters fall back to
 * a single delete+insert pair.
 */
export function computeCharLevelDiff(oldText: string, newText: string): CharDiffResult {
  if (oldText === newText) {
    return {
      chunks: [{ type: "equal", text: oldText }],
      insertedChars: 0,
      deletedChars: 0,
      hasChanges: false,
    };
  }

  // Fast-path for very long strings: avoid O(m*n) LCS
  if (oldText.length + newText.length > 4000) {
    return {
      chunks: [
        { type: "delete", text: oldText },
        { type: "insert", text: newText },
      ],
      insertedChars: newText.length,
      deletedChars: oldText.length,
      hasChanges: true,
    };
  }

  const m = oldText.length;
  const n = newText.length;

  // Build LCS table
  const dp: number[][] = Array.from({ length: m + 1 }, () => new Array<number>(n + 1).fill(0));
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (oldText[i - 1] === newText[j - 1]) {
        dp[i]![j] = dp[i - 1]![j - 1]! + 1;
      } else {
        dp[i]![j] = Math.max(dp[i - 1]![j]!, dp[i]![j - 1]!);
      }
    }
  }

  // Back-track to build diff chunks
  const rawChunks: CharDiffChunk[] = [];
  let i = m;
  let j = n;
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && oldText[i - 1] === newText[j - 1]) {
      rawChunks.push({ type: "equal", text: oldText[i - 1]! });
      i--;
      j--;
    } else if (j > 0 && (i === 0 || dp[i]![j - 1]! >= dp[i - 1]![j]!)) {
      rawChunks.push({ type: "insert", text: newText[j - 1]! });
      j--;
    } else {
      rawChunks.push({ type: "delete", text: oldText[i - 1]! });
      i--;
    }
  }

  // Reverse (back-tracking produced chunks in reverse order) and merge adjacent same-type chunks
  rawChunks.reverse();
  const chunks: CharDiffChunk[] = [];
  for (const chunk of rawChunks) {
    const last = chunks[chunks.length - 1];
    if (last && last.type === chunk.type) {
      last.text += chunk.text;
    } else {
      chunks.push({ type: chunk.type, text: chunk.text });
    }
  }

  const insertedChars = chunks
    .filter((c) => c.type === "insert")
    .reduce((s, c) => s + c.text.length, 0);
  const deletedChars = chunks
    .filter((c) => c.type === "delete")
    .reduce((s, c) => s + c.text.length, 0);

  return { chunks, insertedChars, deletedChars, hasChanges: true };
}

// ─── Char-Diff Webview Provider ───────────────────────────────────────────────

/**
 * Show a character-level diff of the active file against its git HEAD version
 * in an inline VS Code Webview panel.
 */
export async function showCharDiffForActiveFile(
  context: vscode.ExtensionContext,
): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    vscode.window.showErrorMessage("DanteCode: No active file to diff.");
    return;
  }

  const filePath = editor.document.uri.fsPath;

  // Get HEAD content from git
  let headContent: string;
  try {
    const result = await execFileAsync("git", ["show", `HEAD:${filePath.replace(/\\/g, "/")}`], {
      encoding: "utf-8",
    }).catch(async () => {
      // Try with a relative path
      const relPath = filePath.replace(/\\/g, "/");
      return execFileAsync("git", ["show", `HEAD:./${relPath}`], { encoding: "utf-8" });
    });
    headContent = result.stdout;
  } catch {
    // File may be new (untracked) — diff against empty string
    headContent = "";
  }

  const currentContent = editor.document.getText();
  const panel = vscode.window.createWebviewPanel(
    "dantecodeCharDiff",
    `Char Diff: ${basename(filePath)}`,
    vscode.ViewColumn.Beside,
    { enableScripts: false, retainContextWhenHidden: false },
  );

  panel.webview.html = buildCharDiffHtml(headContent, currentContent, filePath);
  context.subscriptions.push(panel);
}

function buildCharDiffHtml(oldText: string, newText: string, filePath: string): string {
  const oldLines = oldText.split("\n");
  const newLines = newText.split("\n");

  const maxLines = Math.max(oldLines.length, newLines.length);
  const rows: string[] = [];

  for (let lineIdx = 0; lineIdx < maxLines; lineIdx++) {
    const oldLine = oldLines[lineIdx];
    const newLine = newLines[lineIdx];

    if (oldLine === undefined) {
      // Pure insertion
      rows.push(
        `<tr class="insert-row"><td class="ln">+${lineIdx + 1}</td>` +
          `<td><span class="insert">${escapeHtml(newLine ?? "")}</span></td></tr>`,
      );
    } else if (newLine === undefined) {
      // Pure deletion
      rows.push(
        `<tr class="delete-row"><td class="ln">-${lineIdx + 1}</td>` +
          `<td><span class="delete">${escapeHtml(oldLine)}</span></td></tr>`,
      );
    } else if (oldLine === newLine) {
      // Context line
      rows.push(
        `<tr class="ctx-row"><td class="ln">${lineIdx + 1}</td>` +
          `<td>${escapeHtml(oldLine)}</td></tr>`,
      );
    } else {
      // Changed line — show char-level diff
      const result = computeCharLevelDiff(oldLine, newLine);
      const renderedOld = result.chunks
        .filter((c) => c.type !== "insert")
        .map((c) =>
          c.type === "delete"
            ? `<span class="delete">${escapeHtml(c.text)}</span>`
            : escapeHtml(c.text),
        )
        .join("");
      const renderedNew = result.chunks
        .filter((c) => c.type !== "delete")
        .map((c) =>
          c.type === "insert"
            ? `<span class="insert">${escapeHtml(c.text)}</span>`
            : escapeHtml(c.text),
        )
        .join("");
      rows.push(
        `<tr class="delete-row"><td class="ln">-${lineIdx + 1}</td><td>${renderedOld}</td></tr>`,
        `<tr class="insert-row"><td class="ln">+${lineIdx + 1}</td><td>${renderedNew}</td></tr>`,
      );
    }
  }

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline';">
  <title>Char Diff</title>
  <style>
    body { font-family: monospace; font-size: 12px; background: var(--vscode-editor-background, #1e1e1e); color: var(--vscode-editor-foreground, #d4d4d4); margin: 0; padding: 8px; }
    h2 { font-size: 13px; font-weight: 600; margin: 0 0 8px; color: var(--vscode-foreground, #ccc); }
    table { border-collapse: collapse; width: 100%; }
    td { padding: 1px 6px; vertical-align: top; white-space: pre-wrap; word-break: break-all; }
    .ln { color: #858585; user-select: none; min-width: 40px; text-align: right; padding-right: 12px; }
    .insert-row { background: rgba(70,150,90,0.15); }
    .delete-row { background: rgba(200,60,60,0.15); }
    .ctx-row { color: #858585; }
    span.insert { background: rgba(70,180,90,0.45); color: inherit; border-radius: 2px; }
    span.delete { background: rgba(220,60,60,0.45); color: inherit; text-decoration: line-through; border-radius: 2px; }
  </style>
</head>
<body>
  <h2>Character diff &mdash; ${escapeHtml(basename(filePath))}</h2>
  <table>${rows.join("")}</table>
</body>
</html>`;
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export interface PendingDiffReview {
  filePath: string;
  relativePath: string;
  oldContent: string;
  newContent: string;
  hunks: DiffHunk[];
  beforeUri: vscode.Uri;
  afterUri: vscode.Uri;
}

export interface DiffReviewPickItem extends vscode.QuickPickItem {
  index: number;
}

interface DiffReviewProviderOptions {
  generateDiff?: (beforePath: string, afterPath: string) => Promise<string>;
  parseHunks?: (diffOutput: string) => DiffHunk[];
  applyHunk?: (hunk: DiffHunk, projectRoot: string) => void;
  writeFile?: (filePath: string, content: string, encoding: BufferEncoding) => Promise<void>;
}

export class DiffReviewProvider {
  private readonly projectRoot: string;
  private readonly generateDiff: (beforePath: string, afterPath: string) => Promise<string>;
  private readonly parseHunks: (diffOutput: string) => DiffHunk[];
  private readonly applyHunk: (hunk: DiffHunk, projectRoot: string) => void;
  private readonly writeFile: (
    filePath: string,
    content: string,
    encoding: BufferEncoding,
  ) => Promise<void>;

  constructor(projectRoot: string, options: DiffReviewProviderOptions = {}) {
    this.projectRoot = projectRoot;
    this.generateDiff = options.generateDiff ?? defaultGenerateDiff;
    this.parseHunks = options.parseHunks ?? parseDiffHunks;
    this.applyHunk = options.applyHunk ?? applyDiff;
    this.writeFile = options.writeFile ?? writeFileFs;
  }

  async createReview(
    filePath: string,
    oldContent: string,
    newContent: string,
  ): Promise<PendingDiffReview> {
    const extension = extname(filePath) || ".txt";
    const tempDir = await mkdtemp(join(tmpdir(), "dantecode-diff-review-"));
    const beforePath = join(tempDir, `before${extension}`);
    const afterPath = join(tempDir, `after${extension}`);

    await this.writeFile(beforePath, oldContent, "utf-8");
    await this.writeFile(afterPath, newContent, "utf-8");

    const diffOutput = await this.generateDiff(beforePath, afterPath);
    const relativePath = normalizeRelativePath(this.projectRoot, filePath);
    const hunks = this.parseHunks(diffOutput).map((hunk) => ({
      ...hunk,
      file: relativePath,
    }));

    return {
      filePath,
      relativePath,
      oldContent,
      newContent,
      hunks,
      beforeUri: vscode.Uri.file(beforePath),
      afterUri: vscode.Uri.file(filePath),
    };
  }

  async openReview(review: PendingDiffReview): Promise<void> {
    await vscode.commands.executeCommand(
      "vscode.diff",
      review.beforeUri,
      review.afterUri,
      `DanteCode Review: ${basename(review.filePath)}`,
      { preview: true, preserveFocus: true },
    );
  }

  buildQuickPickItems(review: PendingDiffReview): DiffReviewPickItem[] {
    return review.hunks.map((hunk, index) => ({
      index,
      label: `Hunk ${index + 1}`,
      description: `${review.relativePath}:${hunk.newStart}`,
      detail: summarizeHunk(hunk),
    }));
  }

  async applySelectedHunks(review: PendingDiffReview, selectedIndexes: number[]): Promise<void> {
    const normalizedIndexes = normalizeIndexes(selectedIndexes, review.hunks.length);

    if (normalizedIndexes.length === review.hunks.length) {
      await this.writeFile(review.filePath, review.newContent, "utf-8");
      return;
    }

    await this.writeFile(review.filePath, review.oldContent, "utf-8");
    for (const index of normalizedIndexes) {
      this.applyHunk(review.hunks[index]!, this.projectRoot);
    }
  }

  async rejectSelectedHunks(review: PendingDiffReview, rejectedIndexes: number[]): Promise<void> {
    const rejected = new Set(normalizeIndexes(rejectedIndexes, review.hunks.length));
    const accepted = review.hunks.map((_, index) => index).filter((index) => !rejected.has(index));
    await this.applySelectedHunks(review, accepted);
  }
}

async function defaultGenerateDiff(beforePath: string, afterPath: string): Promise<string> {
  try {
    const result = await execFileAsync(
      "git",
      ["diff", "--no-index", "--unified=3", "--", beforePath, afterPath],
      {
        encoding: "utf-8",
      },
    );
    return result.stdout;
  } catch (error: unknown) {
    const err = error as { code?: number; stdout?: string; stderr?: string; message?: string };
    if (err.code === 1 && typeof err.stdout === "string") {
      return err.stdout;
    }

    const stderr = typeof err.stderr === "string" ? err.stderr.trim() : "";
    throw new Error(stderr || err.message || "Failed to generate diff review");
  }
}

function normalizeRelativePath(projectRoot: string, filePath: string): string {
  const relativePath = relative(projectRoot, filePath).replace(/\\/g, "/");
  if (
    relativePath.length === 0 ||
    relativePath.startsWith("..") ||
    /^[A-Za-z]:/.test(relativePath)
  ) {
    return basename(filePath);
  }
  return relativePath;
}

function normalizeIndexes(indexes: number[], hunkCount: number): number[] {
  return [...new Set(indexes)]
    .filter((index) => index >= 0 && index < hunkCount)
    .sort((a, b) => a - b);
}

function summarizeHunk(hunk: DiffHunk): string {
  const changedLines = hunk.content
    .split("\n")
    .filter((line) => line.startsWith("+") || line.startsWith("-"))
    .slice(0, 2)
    .map((line) => line.slice(1).trim())
    .filter(Boolean);

  if (changedLines.length === 0) {
    return hunk.content.split("\n")[0] ?? "No changed lines";
  }

  return changedLines.join(" | ");
}
