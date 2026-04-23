// packages/codebase-index/src/__tests__/notebook-support.test.ts
// 4 tests for extractNotebookChunks and isNotebookFile — pure JSON fixture, no file I/O

import { describe, it, expect } from "vitest";
import { extractNotebookChunks, isNotebookFile } from "../notebook-extractor.js";

const SAMPLE_NOTEBOOK = JSON.stringify({
  nbformat: 4,
  cells: [
    {
      cell_type: "code",
      source: ["def process_data(df):\n", "    return df.dropna()"],
      execution_count: 1,
      outputs: [{ output_type: "stream", text: ["Done\n"] }],
    },
    {
      cell_type: "markdown",
      source: ["# Data Analysis\n", "This notebook analyzes sales data."],
    },
  ],
});

describe("extractNotebookChunks", () => {
  it("returns chunks with correct filePath", () => {
    const chunks = extractNotebookChunks(SAMPLE_NOTEBOOK, "notebooks/analysis.ipynb");
    expect(chunks.length).toBeGreaterThan(0);
    for (const chunk of chunks) {
      expect(chunk.filePath).toBe("notebooks/analysis.ipynb");
    }
  });

  it("extracts 'process_data' as a symbol from the code cell", () => {
    const chunks = extractNotebookChunks(SAMPLE_NOTEBOOK, "notebooks/analysis.ipynb");
    const codeChunk = chunks.find((c) => c.content.includes("def process_data"));
    expect(codeChunk).toBeDefined();
    expect(codeChunk!.symbols).toContain("process_data");
  });

  it("appends output text to code cell content", () => {
    const chunks = extractNotebookChunks(SAMPLE_NOTEBOOK, "notebooks/analysis.ipynb");
    const codeChunk = chunks.find((c) => c.content.includes("def process_data"));
    expect(codeChunk).toBeDefined();
    expect(codeChunk!.content).toContain("Done");
  });
});

describe("isNotebookFile", () => {
  it("returns true for .ipynb, false for .ts and .py", () => {
    expect(isNotebookFile("notebooks/analysis.ipynb")).toBe(true);
    expect(isNotebookFile("src/app.ts")).toBe(false);
    expect(isNotebookFile("scripts/process.py")).toBe(false);
  });
});
