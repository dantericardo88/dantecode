// packages/vscode/src/udiff-parser.ts
// Parses LLM unified-diff output into SearchReplaceBlock[] compatible with
// applySearchReplaceBlock(). Acts as a fallback when SEARCH/REPLACE matching fails.

import type { SearchReplaceBlock } from "@dantecode/core";

// ── parseUdiffResponse ────────────────────────────────────────────────────────

/**
 * Parse LLM unified-diff output into an array of SearchReplaceBlock objects.
 *
 * Scans `text` for `--- ` / `+++ ` header pairs (consecutive lines), then
 * processes each `@@ ... @@` hunk that follows. Each hunk yields one block:
 *   - Space-prefixed lines  → context → appears in BOTH search and replace
 *   - `-`-prefixed lines    → removal → appears in search ONLY
 *   - `+`-prefixed lines    → addition → appears in replace ONLY
 *   - `\\ No newline…` lines → skipped
 *
 * The leading prefix character is stripped before content is stored.
 * Hunks where both searchContent and replaceContent are empty are dropped.
 */
/** Detect a `--- ` / `+++ ` file-header pair starting at `i` and return the
 *  cleaned file path + the index of the first line after the headers. */
function readFileHeader(lines: string[], i: number): { filePath: string; next: number } | null {
  const line = lines[i] ?? "";
  if (!line.startsWith("--- ")) return null;
  const nextLine = lines[i + 1] ?? "";
  if (!nextLine.startsWith("+++ ")) return null;

  let filePath = nextLine.slice(4).trim();
  if (filePath.startsWith("b/")) filePath = filePath.slice(2);
  return { filePath: filePath.trim(), next: i + 2 };
}

/** Parse a single `@@`-led hunk body starting just after the `@@` header.
 *  Returns the search/replace content and the index past the hunk body. */
function readHunkBody(lines: string[], i: number): { searchContent: string; replaceContent: string; next: number } {
  const searchLines: string[] = [];
  const replaceLines: string[] = [];

  while (i < lines.length) {
    const bodyLine = lines[i] ?? "";
    if (
      bodyLine.startsWith("@@") ||
      (bodyLine.startsWith("--- ") && (lines[i + 1] ?? "").startsWith("+++ "))
    ) {
      break;
    }
    if (bodyLine.startsWith("\\ ")) { i++; continue; }

    const prefix = bodyLine[0];
    const content = bodyLine.slice(1);
    if (prefix === " ") {
      searchLines.push(content); replaceLines.push(content);
    } else if (prefix === "-") {
      searchLines.push(content);
    } else if (prefix === "+") {
      replaceLines.push(content);
    } else {
      searchLines.push(bodyLine); replaceLines.push(bodyLine);
    }
    i++;
  }

  return { searchContent: searchLines.join("\n"), replaceContent: replaceLines.join("\n"), next: i };
}

export function parseUdiffResponse(text: string): SearchReplaceBlock[] {
  const lines = text.split("\n");
  const blocks: SearchReplaceBlock[] = [];

  let i = 0;
  while (i < lines.length) {
    const header = readFileHeader(lines, i);
    if (!header) { i++; continue; }
    const filePath = header.filePath;
    i = header.next;

    while (i < lines.length) {
      const hunkLine = lines[i] ?? "";
      if (hunkLine.startsWith("--- ") && (lines[i + 1] ?? "").startsWith("+++ ")) break;
      if (!hunkLine.startsWith("@@")) { i++; continue; }

      i++; // skip the `@@ -L,N +L,N @@` header itself
      const { searchContent, replaceContent, next } = readHunkBody(lines, i);
      i = next;

      if (searchContent !== "" || replaceContent !== "") {
        blocks.push({ filePath, searchContent, replaceContent, sourceOffset: 0 });
      }
    }
  }

  return blocks;
}

// ── renderDiffHtml ────────────────────────────────────────────────────────────

/**
 * Convert an array of diff line strings (as produced by `generateColoredHunk()`)
 * into an HTML string suitable for use in a MultiFileDiffPanel webview.
 *
 * Line classification by first character:
 *   `+` → `<div class="diff-add">`
 *   `-` → `<div class="diff-remove">`
 *   ` ` → `<div class="diff-ctx">`
 *   `@` → `<div class="diff-hunk">`
 *
 * All line content is HTML-escaped before wrapping.
 */
export function renderDiffHtml(coloredHunkLines: string[]): string {
  return coloredHunkLines
    .map((line) => {
      const prefix = line[0] ?? "";
      const escaped = htmlEscape(line);

      if (prefix === "+") {
        return `<div class="diff-add">${escaped}</div>`;
      } else if (prefix === "-") {
        return `<div class="diff-remove">${escaped}</div>`;
      } else if (prefix === "@") {
        return `<div class="diff-hunk">${escaped}</div>`;
      } else {
        // Space (context) or anything else
        return `<div class="diff-ctx">${escaped}</div>`;
      }
    })
    .join("");
}

// ── Internal helpers ─────────────────────────────────────────────────────────

function htmlEscape(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
