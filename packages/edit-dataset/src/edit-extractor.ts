// ============================================================================
// packages/edit-dataset/src/edit-extractor.ts
//
// Parses unified diffs into structured hunks, creates sliding-window
// training examples from commit file pairs.
// ============================================================================

import * as path from "node:path";
import type { FilePair, DiffHunk, EditSequenceExample, EditHistoryItem } from "./types.js";

// ── Diff parsing ──────────────────────────────────────────────────────────────

/**
 * Parse a unified diff patch into structured hunks.
 * Each hunk tracks line numbers in the AFTER file.
 */
export function parseDiffHunks(patch: string): DiffHunk[] {
  const hunks: DiffHunk[] = [];
  const lines = patch.split("\n");

  let afterStart = 0;
  let oldLines: string[] = [];
  let newLines: string[] = [];
  let inHunk = false;

  const flushHunk = () => {
    if (!inHunk || (oldLines.length === 0 && newLines.length === 0)) return;
    const oldText = oldLines.join("\n");
    const newText = newLines.join("\n");
    const endLine = Math.max(afterStart, afterStart + newLines.length - 1);
    hunks.push({
      startLine: afterStart,
      endLine: endLine,
      oldText,
      newText,
      context: "",   // filled in by extractContext
    });
    oldLines = [];
    newLines = [];
    inHunk = false;
  };

  for (const line of lines) {
    // Hunk header: @@ -a,b +c,d @@
    const hunkMatch = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(line);
    if (hunkMatch) {
      flushHunk();
      afterStart = parseInt(hunkMatch[1] ?? "1", 10);
      inHunk = true;
      continue;
    }
    if (!inHunk) continue;
    if (line.startsWith("-")) {
      oldLines.push(line.slice(1));
    } else if (line.startsWith("+")) {
      newLines.push(line.slice(1));
    }
    // Context lines (space-prefixed) are skipped for oldText/newText
  }
  flushHunk();

  return hunks;
}

/**
 * Extract 5 lines of context around a hunk from the file content.
 * Returns the lines as a single string.
 */
export function extractContext(
  fileContent: string,
  startLine: number,    // 1-indexed
  endLine: number,      // 1-indexed inclusive
  contextLines = 5,
): string {
  const lines = fileContent.split("\n");
  const from = Math.max(0, startLine - 1 - contextLines);
  const to = Math.min(lines.length - 1, endLine - 1 + contextLines);
  return lines.slice(from, to + 1).join("\n");
}

/** Approximate token count (4 chars ≈ 1 token) */
function approxTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

// ── Sliding window extraction ─────────────────────────────────────────────────

/**
 * Convert file pairs from a commit into sliding-window training examples.
 *
 * Strategy:
 * 1. Parse each file's patch into diff hunks
 * 2. Treat each hunk as one "edit event"
 * 3. Apply sliding window of `windowSize`: use hunks [i..i+windowSize-1]
 *    as input history, hunk [i+windowSize] as the prediction target
 * 4. Cap at 2048 tokens per example
 */
export function extractEditSequences(
  filePairs: FilePair[],
  windowSize = 5,
  maxTokens = 2048,
): EditSequenceExample[] {
  // Build a flat list of (hunk, filePair) ordered by file then hunk position
  const allHunks: Array<{ hunk: DiffHunk; pair: FilePair }> = [];

  for (const pair of filePairs) {
    const hunks = parseDiffHunks(pair.patch);
    for (const hunk of hunks) {
      const context = extractContext(pair.afterContent, hunk.startLine, hunk.endLine);
      allHunks.push({ hunk: { ...hunk, context }, pair });
    }
  }

  if (allHunks.length <= windowSize) {
    // Not enough edits for even one training example
    return [];
  }

  const examples: EditSequenceExample[] = [];

  for (let i = 0; i + windowSize < allHunks.length; i++) {
    const historySlice = allHunks.slice(i, i + windowSize);
    const target = allHunks[i + windowSize]!;

    const editHistory: EditHistoryItem[] = historySlice.map(({ hunk, pair }) => ({
      filePath: path.basename(pair.filename),
      startLine: hunk.startLine,
      endLine: hunk.endLine,
      oldText: hunk.oldText,
      newText: hunk.newText,
      language: pair.language,
    }));

    const fileContext = target.hunk.context;

    // Token budget check
    const historyJson = JSON.stringify(editHistory);
    const totalTokens = approxTokens(historyJson) + approxTokens(fileContext);
    if (totalTokens > maxTokens) continue;

    examples.push({
      editHistory,
      fileContext,
      nextEdit: {
        filePath: path.basename(target.pair.filename),
        startLine: target.hunk.startLine,
        endLine: target.hunk.endLine,
        diff: `@@ -${target.hunk.startLine} +${target.hunk.startLine} @@\n` +
              target.hunk.oldText.split("\n").map((l) => `-${l}`).join("\n") + "\n" +
              target.hunk.newText.split("\n").map((l) => `+${l}`).join("\n"),
      },
    });
  }

  return examples;
}
