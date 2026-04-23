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
export function parseUdiffResponse(text: string): SearchReplaceBlock[] {
  const lines = text.split("\n");
  const blocks: SearchReplaceBlock[] = [];

  let i = 0;

  while (i < lines.length) {
    const line = lines[i] ?? "";

    // Look for `--- ` header
    if (!line.startsWith("--- ")) {
      i++;
      continue;
    }

    // Next non-empty line must be `+++ `
    const nextLine = lines[i + 1] ?? "";
    if (!nextLine.startsWith("+++ ")) {
      i++;
      continue;
    }

    // Extract file path from `+++ ` line
    let filePath = nextLine.slice(4).trim(); // strip "+++ " prefix
    if (filePath.startsWith("b/")) filePath = filePath.slice(2);
    filePath = filePath.trim();

    i += 2; // advance past both header lines

    // Collect all hunks for this file until the next `--- ` / `+++ ` pair or EOF
    while (i < lines.length) {
      const hunkLine = lines[i] ?? "";

      // Stop if we hit a new file header
      if (hunkLine.startsWith("--- ") && (lines[i + 1] ?? "").startsWith("+++ ")) {
        break;
      }

      // Each hunk starts with `@@ ... @@`
      if (!hunkLine.startsWith("@@")) {
        i++;
        continue;
      }

      // Skip the `@@ -L,N +L,N @@` line itself
      i++;

      const searchLines: string[] = [];
      const replaceLines: string[] = [];

      // Consume hunk body lines
      while (i < lines.length) {
        const bodyLine = lines[i] ?? "";

        // Stop hunk on new `@@` header, new file `--- `, or another `+++ `
        if (
          bodyLine.startsWith("@@") ||
          (bodyLine.startsWith("--- ") && (lines[i + 1] ?? "").startsWith("+++ "))
        ) {
          break;
        }

        // Skip "No newline at end of file" markers
        if (bodyLine.startsWith("\\ ")) {
          i++;
          continue;
        }

        const prefix = bodyLine[0];
        const content = bodyLine.slice(1); // strip the leading prefix char

        if (prefix === " ") {
          // Context line — goes into both
          searchLines.push(content);
          replaceLines.push(content);
        } else if (prefix === "-") {
          // Removal — search only
          searchLines.push(content);
        } else if (prefix === "+") {
          // Addition — replace only
          replaceLines.push(content);
        } else {
          // Unknown prefix or empty line — treat as context for robustness
          searchLines.push(bodyLine);
          replaceLines.push(bodyLine);
        }

        i++;
      }

      const searchContent = searchLines.join("\n");
      const replaceContent = replaceLines.join("\n");

      // Emit block unless both sides are empty
      if (searchContent !== "" || replaceContent !== "") {
        blocks.push({
          filePath,
          searchContent,
          replaceContent,
          sourceOffset: 0, // udiff has no direct character offset concept
        });
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
