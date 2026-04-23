// ============================================================================
// packages/vscode/src/multi-file-diff-panel.ts
//
// Multi-file diff review panel — shows all pending SEARCH/REPLACE changes
// across files in one consolidated WebviewPanel with Apply All / Apply
// Selected / Reject All controls.
// ============================================================================

import * as vscode from "vscode";
import { readFile } from "node:fs/promises";
import { relative, resolve } from "node:path";
import { randomBytes } from "node:crypto";
import type { SearchReplaceBlock } from "@dantecode/core";
import {
  applySearchReplaceBlock,
  generateDiffHunks,
  parseMultiFileDiff,
  buildMultiFileDiff,
  formatDiffForPrompt,
  addAnnotation,
  getAnnotationsForFile,
  getBlockingAnnotations,
  type DiffReviewAnnotation,
} from "@dantecode/core";
import { batchApplySearchReplace } from "./streaming-diff-provider.js";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface PendingDiffEntry {
  /** Absolute path to file */
  filePath: string;
  /** Relative to projectRoot (for display) */
  relativePath: string;
  originalContent: string;
  proposedContent: string;
  blocks: SearchReplaceBlock[];
  /** Computed from diff */
  linesAdded: number;
  linesRemoved: number;
}

// ── buildPendingEntries ───────────────────────────────────────────────────────

/**
 * Group blocks by filePath, simulate applying them to produce proposedContent,
 * compute linesAdded/linesRemoved, and return sorted PendingDiffEntry[].
 */
export async function buildPendingEntries(
  blocks: SearchReplaceBlock[],
  projectRoot: string,
): Promise<PendingDiffEntry[]> {
  if (blocks.length === 0) return [];

  // Group blocks by file path, preserving order
  const byFile = new Map<string, SearchReplaceBlock[]>();
  for (const block of blocks) {
    const arr = byFile.get(block.filePath) ?? [];
    arr.push(block);
    byFile.set(block.filePath, arr);
  }

  const entries: PendingDiffEntry[] = [];

  for (const [filePath, fileBlocks] of byFile.entries()) {
    // Resolve to absolute path
    const absPath = resolve(projectRoot, filePath);

    // Read original content from disk
    const originalContent = await readFile(absPath, "utf-8").catch(() => "");

    // Simulate applying all blocks in order (dry-run)
    let proposedContent = originalContent;
    for (const block of fileBlocks) {
      const result = applySearchReplaceBlock(proposedContent, block);
      if (result.matched && result.updatedContent !== undefined) {
        proposedContent = result.updatedContent;
      }
      // On failure, skip the block and keep current content
    }

    // Compute linesAdded / linesRemoved using LCS-based hunk diff (inline-edit-manager)
    const diffHunks = generateDiffHunks(originalContent, proposedContent);
    const linesAdded = diffHunks.reduce((s, h) => s + h.lines.filter((l) => l.type === "add").length, 0);
    const linesRemoved = diffHunks.reduce((s, h) => s + h.lines.filter((l) => l.type === "remove").length, 0);

    // Compute relative path for display
    const relativePath = relative(projectRoot, absPath).replace(/\\/g, "/");

    entries.push({
      filePath: absPath,
      relativePath,
      originalContent,
      proposedContent,
      blocks: fileBlocks,
      linesAdded,
      linesRemoved,
    });
  }

  // Sort by relativePath
  entries.sort((a, b) => a.relativePath.localeCompare(b.relativePath));

  return entries;
}

// ── getDiffReviewContext ──────────────────────────────────────────────────────

/**
 * Format a PendingDiffEntry as an AI-ready review context block.
 * Uses parseMultiFileDiff + buildMultiFileDiff + formatDiffForPrompt from core
 * so the model sees a structured, annotation-aware diff summary.
 *
 * @param entry      The pending change to format
 * @param maxChars   Token budget in chars (default: 4000)
 */
export function getDiffReviewContext(entry: PendingDiffEntry, maxChars = 4_000): string {
  // Build a minimal unified diff header + hunks from the hunk data
  const hunks = generateDiffHunks(entry.originalContent, entry.proposedContent);
  if (hunks.length === 0) return `No changes in ${entry.relativePath}`;

  // Build synthetic unified diff string for parseMultiFileDiff
  const diffLines = [
    `diff --git a/${entry.relativePath} b/${entry.relativePath}`,
    `--- a/${entry.relativePath}`,
    `+++ b/${entry.relativePath}`,
  ];
  for (const hunk of hunks) {
    diffLines.push(hunk.header);
    for (const line of hunk.lines) {
      const prefix = line.type === "add" ? "+" : line.type === "remove" ? "-" : " ";
      diffLines.push(`${prefix}${line.content}`);
    }
  }
  const rawDiff = diffLines.join("\n");

  const files = parseMultiFileDiff(rawDiff);
  if (files.length === 0) return `Changes in ${entry.relativePath}: +${entry.linesAdded}/-${entry.linesRemoved}`;

  const multiDiff = buildMultiFileDiff(files);

  // Add a synthetic annotation summarising net change
  if (entry.linesAdded > 0 || entry.linesRemoved > 0) {
    addAnnotation(multiDiff, entry.relativePath, 1, "new",
      `Net change: +${entry.linesAdded}/-${entry.linesRemoved} lines`, "suggestion");
  }

  return formatDiffForPrompt(multiDiff, { maxChars, includeContext: false });
}

// ── htmlEscape ────────────────────────────────────────────────────────────────

function htmlEscape(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// ── renderDiffHtml ────────────────────────────────────────────────────────────

/**
 * Compute a line-by-line diff between original and proposed content.
 * Returns an HTML string with:
 *   - Lines only in proposed: <div class="da">+${line}</div>
 *   - Lines only in original: <div class="dr">-${line}</div>
 *   - Lines in both (context, max 3 before/after changed sections): <div class="dc"> ${line}</div>
 */
export function renderDiffHtml(originalContent: string, proposedContent: string): string {
  const originalLines = originalContent.split("\n");
  const proposedLines = proposedContent.split("\n");

  const originalSet = new Set(originalLines);
  const proposedSet = new Set(proposedLines);

  // Build a unified line list with tags: 'added', 'removed', 'context'
  type TaggedLine = { tag: "added" | "removed" | "context"; text: string };
  const tagged: TaggedLine[] = [];

  // Walk original lines for removed / context
  for (const line of originalLines) {
    if (!proposedSet.has(line)) {
      tagged.push({ tag: "removed", text: line });
    } else {
      tagged.push({ tag: "context", text: line });
    }
  }

  // Insert added lines (lines in proposed but not in original)
  // We interleave them at the end of context runs (simple approach)
  const addedLines: TaggedLine[] = [];
  for (const line of proposedLines) {
    if (!originalSet.has(line)) {
      addedLines.push({ tag: "added", text: line });
    }
  }

  // Merge: place added lines after context block
  const merged: TaggedLine[] = [...tagged, ...addedLines];

  // Apply context windowing: show max 3 context lines before/after changed sections
  const CONTEXT_SIZE = 3;
  const changedIndexes = new Set<number>();
  for (let i = 0; i < merged.length; i++) {
    if (merged[i]!.tag !== "context") changedIndexes.add(i);
  }

  const visibleIndexes = new Set<number>();
  for (const idx of changedIndexes) {
    // Show up to CONTEXT_SIZE lines before
    for (let k = Math.max(0, idx - CONTEXT_SIZE); k <= idx; k++) {
      visibleIndexes.add(k);
    }
    // Show up to CONTEXT_SIZE lines after
    for (let k = idx; k <= Math.min(merged.length - 1, idx + CONTEXT_SIZE); k++) {
      visibleIndexes.add(k);
    }
  }

  // If no changes at all, show all lines as context
  const hasChanges = changedIndexes.size > 0;
  const parts: string[] = [];

  for (let i = 0; i < merged.length; i++) {
    const entry = merged[i]!;
    if (!hasChanges || visibleIndexes.has(i)) {
      const escaped = htmlEscape(entry.text);
      if (entry.tag === "added") {
        parts.push(`<div class="da">+${escaped}</div>`);
      } else if (entry.tag === "removed") {
        parts.push(`<div class="dr">-${escaped}</div>`);
      } else {
        parts.push(`<div class="dc"> ${escaped}</div>`);
      }
    }
  }

  return parts.join("\n");
}

// ── getReviewHtml ─────────────────────────────────────────────────────────────

export function getReviewHtml(
  nonce: string,
  entries: PendingDiffEntry[],
  _webview: vscode.Webview,
  annotations: DiffReviewAnnotation[] = [],
): string {
  const totalBlocks = entries.reduce((sum, e) => sum + e.blocks.length, 0);

  const fileCards = entries
    .map((entry) => {
      const diffHtml = renderDiffHtml(entry.originalContent, entry.proposedContent);
      const escapedRel = htmlEscape(entry.relativePath);

      // Use getBlockingAnnotations to surface only blocking annotations per file,
      // matching the severity-first approach used in formatDiffForPrompt.
      // getAnnotationsForFile is kept in imports for other callers.
      const syntheticDiff = { files: [], totalAdditions: 0, totalDeletions: 0, totalFiles: 0, annotations };
      const blockingForFile = getBlockingAnnotations(syntheticDiff).filter(
        (a) => a.filePath === entry.relativePath,
      );
      // Also include non-blocking annotations for full context
      const allFileAnnotations = getAnnotationsForFile(syntheticDiff, entry.relativePath);
      const hasBlocking = blockingForFile.length > 0;
      const fileRiskBadge = hasBlocking
        ? `<span class="file-risk file-risk-blocking">⚑ ${blockingForFile.length} blocking</span>`
        : "";

      const badgesHtml = allFileAnnotations.length > 0
        ? `<div class="ann-row">${fileRiskBadge}${allFileAnnotations.map((a) =>
            `<span class="ann ann-${a.severity}">${htmlEscape(a.comment)}</span>`
          ).join("")}</div>`
        : "";

      return `<div class="file-card" data-file="${escapedRel}">
    <div class="file-header">
      <input type="checkbox" class="file-toggle" checked data-file="${escapedRel}">
      <span class="file-path">${escapedRel}</span>
      <span class="badge-add">+${entry.linesAdded}</span>
      <span class="badge-remove">-${entry.linesRemoved}</span>
    </div>
    ${badgesHtml}<div class="diff-body">${diffHtml}</div>
  </div>`;
    })
    .join("\n");

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}';">
  <title>Review Changes</title>
  <style nonce="${nonce}">
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: var(--vscode-font-family);
      font-size: var(--vscode-font-size);
      color: var(--vscode-editor-foreground);
      background: var(--vscode-editor-background);
    }
    .da { background: rgba(0,255,0,0.12); color: #4ec9b0; font-family: monospace; white-space: pre; padding: 0 8px; }
    .dr { background: rgba(255,0,0,0.12); color: #f48771; font-family: monospace; white-space: pre; padding: 0 8px; }
    .dc { color: var(--vscode-editor-foreground); opacity: 0.5; font-family: monospace; white-space: pre; padding: 0 8px; }
    .file-card { border: 1px solid var(--vscode-widget-border,#3c3c3c); border-radius: 6px; margin: 8px 0; overflow: hidden; }
    .file-header { display: flex; align-items: center; gap: 8px; padding: 8px 12px; background: var(--vscode-sideBar-background,#252526); cursor: pointer; }
    .badge-add { color: #4ec9b0; font-size: 11px; }
    .badge-remove { color: #f48771; font-size: 11px; }
    .ann-row { display: flex; flex-wrap: wrap; gap: 4px; padding: 4px 12px; background: var(--vscode-sideBar-background,#252526); border-top: 1px solid var(--vscode-widget-border,#3c3c3c); }
    .ann { border-radius: 3px; padding: 1px 6px; font-size: 11px; font-family: var(--vscode-font-family); max-width: 480px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .ann-blocking { background: #f44747; color: #fff; }
    .ann-warning { background: #cca700; color: #fff; }
    .ann-suggestion { background: #0e639c; color: #fff; }
    .ann-praise { background: #16825d; color: #fff; }
    .file-risk { border-radius: 3px; padding: 1px 6px; font-size: 11px; font-weight: 600; }
    .file-risk-blocking { background: #f44747; color: #fff; }
    .apply-btn { background: var(--vscode-button-background,#0e639c); color: var(--vscode-button-foreground,#fff); border: none; border-radius: 4px; padding: 4px 10px; cursor: pointer; font-size: 12px; }
    .skip-btn { background: transparent; border: 1px solid var(--vscode-widget-border,#3c3c3c); color: var(--vscode-editor-foreground); border-radius: 4px; padding: 4px 10px; cursor: pointer; font-size: 12px; }
    #toolbar { display: flex; gap: 8px; padding: 12px; border-bottom: 1px solid var(--vscode-widget-border,#3c3c3c); align-items: center; }
    #title { font-size: 14px; font-weight: 600; flex: 1; }
    #file-list { padding: 8px 12px; overflow-y: auto; }
  </style>
</head>
<body>
  <div id="toolbar">
    <span id="title">Review ${entries.length} files · ${totalBlocks} changes</span>
    <button class="apply-btn" id="btn-apply-all">Apply All</button>
    <button class="skip-btn" id="btn-reject-all">Reject All</button>
  </div>
  <div id="file-list">
    ${fileCards}
  </div>
  <div style="padding: 12px; border-top: 1px solid var(--vscode-widget-border,#3c3c3c);">
    <button class="apply-btn" id="btn-apply-selected">Apply Selected</button>
  </div>
  <script nonce="${nonce}">
    const vscode = acquireVsCodeApi();
    document.getElementById('btn-apply-all').addEventListener('click', () => {
      vscode.postMessage({ type: 'apply_all' });
    });
    document.getElementById('btn-reject-all').addEventListener('click', () => {
      vscode.postMessage({ type: 'reject_all' });
    });
    document.getElementById('btn-apply-selected').addEventListener('click', () => {
      const checked = [...document.querySelectorAll('.file-toggle:checked')].map(el => el.dataset.file);
      vscode.postMessage({ type: 'apply_selected', files: checked });
    });
  </script>
</body>
</html>`;
}

// ── MultiFileDiffPanel ────────────────────────────────────────────────────────

export class MultiFileDiffPanel implements vscode.Disposable {
  private static _current: MultiFileDiffPanel | undefined;

  private readonly _panel: vscode.WebviewPanel;
  private readonly _projectRoot: string;

  private constructor(
    panel: vscode.WebviewPanel,
    entries: PendingDiffEntry[],
    projectRoot: string,
    onResult: (applied: string[], rejected: string[]) => void,
  ) {
    this._panel = panel;
    this._projectRoot = projectRoot;

    // Collect all blocks and all file relative paths
    const allBlocks = entries.flatMap((e) => e.blocks);
    const allFiles = entries.map((e) => e.relativePath);

    // Wire message handler
    panel.webview.onDidReceiveMessage(async (message: { type: string; files?: string[] }) => {
      if (message.type === "apply_all") {
        const result = await batchApplySearchReplace(allBlocks, this._projectRoot);
        onResult(result.applied, []);
        panel.dispose();
      } else if (message.type === "apply_selected") {
        const selectedFiles = new Set(message.files ?? []);
        const filteredBlocks = allBlocks.filter((b) => {
          const rel = relative(this._projectRoot, b.filePath).replace(/\\/g, "/");
          return selectedFiles.has(rel) || selectedFiles.has(b.filePath);
        });
        const rejectedFiles = allFiles.filter((f) => !selectedFiles.has(f));
        const result = await batchApplySearchReplace(filteredBlocks, this._projectRoot);
        onResult(result.applied, rejectedFiles);
        panel.dispose();
      } else if (message.type === "reject_all") {
        onResult([], allFiles);
        panel.dispose();
      }
    });

    // Cleanup on dispose
    panel.onDidDispose(() => {
      MultiFileDiffPanel._current = undefined;
    });
  }

  static show(
    entries: PendingDiffEntry[],
    projectRoot: string,
    onResult: (applied: string[], rejected: string[]) => void,
    _context?: vscode.ExtensionContext,
  ): MultiFileDiffPanel {
    // Dispose any existing panel
    if (MultiFileDiffPanel._current) {
      MultiFileDiffPanel._current.dispose();
    }

    const panel = vscode.window.createWebviewPanel(
      "dantecodeMultiDiff",
      "Review Changes",
      vscode.ViewColumn.Beside,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
      },
    );

    // Generate nonce
    const nonce = randomBytes(16).toString("hex");

    // Set HTML
    panel.webview.html = getReviewHtml(nonce, entries, panel.webview);

    const instance = new MultiFileDiffPanel(panel, entries, projectRoot, onResult);
    MultiFileDiffPanel._current = instance;

    return instance;
  }

  dispose(): void {
    this._panel.dispose();
  }
}
