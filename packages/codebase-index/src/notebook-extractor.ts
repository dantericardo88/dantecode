// ============================================================================
// packages/codebase-index/src/notebook-extractor.ts
//
// Extract searchable text from Jupyter notebook (.ipynb) files.
// Each cell becomes a separate IndexChunk.
// No external dependencies — pure JSON parsing.
// ============================================================================

import type { IndexChunk } from "./types.js";

interface NotebookCell {
  cell_type: "code" | "markdown" | "raw";
  source: string | string[];
  execution_count?: number | null;
  outputs?: Array<{
    output_type: string;
    text?: string | string[];
    traceback?: string[];
  }>;
}

interface NotebookData {
  nbformat?: number;
  cells?: NotebookCell[];
}

function cellSource(cell: NotebookCell): string {
  const src = cell.source;
  return Array.isArray(src) ? src.join("") : (src ?? "");
}

function outputText(outputs: NotebookCell["outputs"]): string {
  if (!outputs?.length) return "";
  const parts: string[] = [];
  for (const out of outputs) {
    if (out.text) {
      const t = Array.isArray(out.text) ? out.text.join("") : out.text;
      parts.push(t.slice(0, 500));
    }
    if (out.traceback) {
      // Strip ANSI escape codes from tracebacks
      const tb = out.traceback.join("\n").replace(/\x1b\[[0-9;]*m/g, "");
      parts.push(tb.slice(0, 200));
    }
  }
  return parts.join("\n");
}

/**
 * Extract IndexChunks from a .ipynb JSON string.
 * Each non-empty cell becomes one chunk.
 * Code cells include truncated output text.
 * Returns [] if JSON is invalid or not a recognized notebook format.
 */
export function extractNotebookChunks(
  jsonContent: string,
  filePath: string,
): IndexChunk[] {
  let nb: NotebookData;
  try {
    nb = JSON.parse(jsonContent) as NotebookData;
  } catch {
    return [];
  }

  if (!Array.isArray(nb.cells)) return [];

  const chunks: IndexChunk[] = [];
  let lineOffset = 1;

  for (const cell of nb.cells) {
    const source = cellSource(cell);
    if (!source.trim()) continue;

    const sourceLines = source.split("\n");
    const endLine = lineOffset + sourceLines.length - 1;

    let content = source;
    if (cell.cell_type === "code") {
      const outText = outputText(cell.outputs);
      if (outText.trim()) {
        content = source + "\n# output:\n" + outText;
      }
    }

    // Extract Python function/class names as symbols
    const symbols: string[] = [];
    if (cell.cell_type === "code") {
      for (const match of content.matchAll(/^(?:def|class)\s+(\w+)/gm)) {
        if (match[1]) symbols.push(match[1]);
      }
    }

    chunks.push({
      filePath,
      content: content.slice(0, 3000),
      startLine: lineOffset,
      endLine,
      symbols,
    });

    lineOffset = endLine + 1;
  }

  return chunks;
}

/** Check if a file path refers to a Jupyter notebook. */
export function isNotebookFile(filePath: string): boolean {
  return filePath.toLowerCase().endsWith(".ipynb");
}
