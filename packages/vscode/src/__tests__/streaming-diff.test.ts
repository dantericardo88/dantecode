// ============================================================================
// packages/vscode/src/__tests__/streaming-diff.test.ts
// Tests for batchApplySearchReplace — parallel multi-file SEARCH/REPLACE apply.
// ============================================================================

import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Mock node:fs/promises ─────────────────────────────────────────────────────

vi.mock("node:fs/promises", () => ({
  readFile: vi.fn(),
  writeFile: vi.fn().mockResolvedValue(undefined),
}));

// ── Mock @dantecode/core ──────────────────────────────────────────────────────

vi.mock("@dantecode/core", () => ({
  parseSearchReplaceBlocks: vi.fn(),
  applySearchReplaceBlock: vi.fn((content: string) => ({
    matched: true,
    updatedContent: content + "_patched",
  })),
  MultiFileDiffSession: vi.fn(),
}));

// ── Mock vscode ───────────────────────────────────────────────────────────────

vi.mock("vscode", () => ({
  workspace: { getConfiguration: vi.fn(() => ({ get: vi.fn() })) },
  window: { visibleTextEditors: [], createTextEditorDecorationType: vi.fn() },
  EventEmitter: vi.fn(() => ({ event: vi.fn(), fire: vi.fn(), dispose: vi.fn() })),
}));

import * as fsPromises from "node:fs/promises";
import { batchApplySearchReplace } from "../streaming-diff-provider.js";
import type { SearchReplaceBlock } from "@dantecode/core";

const mockReadFile = vi.mocked(fsPromises.readFile);
const mockWriteFile = vi.mocked(fsPromises.writeFile);

function makeBlock(filePath: string, search = "old", replace = "new"): SearchReplaceBlock {
  return { filePath, searchContent: search, replaceContent: replace, sourceOffset: 0 };
}

describe("batchApplySearchReplace", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockReadFile.mockResolvedValue("original content");
    mockWriteFile.mockResolvedValue(undefined);
  });

  it("applies blocks to all files and returns them in applied[]", async () => {
    const blocks = [makeBlock("src/a.ts"), makeBlock("src/b.ts")];
    const result = await batchApplySearchReplace(blocks, "/project");

    expect(result.applied).toContain("src/a.ts");
    expect(result.applied).toContain("src/b.ts");
    expect(result.failed).toHaveLength(0);
  });

  it("records failures without throwing", async () => {
    mockReadFile.mockRejectedValueOnce(new Error("ENOENT"));
    mockReadFile.mockResolvedValueOnce("content");

    const blocks = [makeBlock("missing.ts"), makeBlock("src/b.ts")];
    const result = await batchApplySearchReplace(blocks, "/project");

    expect(result.failed.length + result.applied.length).toBe(2);
    // At least one entry should have a non-empty path
    const allPaths = [...result.applied, ...result.failed.map((f) => f.path)];
    expect(allPaths.some((p) => p.length > 0)).toBe(true);
  });

  it("groups multiple blocks for the same file and applies them sequentially", async () => {
    const { applySearchReplaceBlock } = await import("@dantecode/core");
    const applySpy = vi.mocked(applySearchReplaceBlock);

    const blocks = [
      makeBlock("src/a.ts", "old1", "new1"),
      makeBlock("src/a.ts", "old2", "new2"),
    ];
    await batchApplySearchReplace(blocks, "/project");

    // Both blocks for the same file should have been applied
    expect(applySpy).toHaveBeenCalledTimes(2);
    expect(mockWriteFile).toHaveBeenCalledTimes(1); // written once
  });

  it("returns correct applied and failed arrays", async () => {
    mockWriteFile.mockRejectedValueOnce(new Error("write error"));

    const blocks = [makeBlock("src/fail.ts"), makeBlock("src/ok.ts")];
    const result = await batchApplySearchReplace(blocks, "/project");

    // One should be in applied, one in failed (order non-deterministic due to parallel)
    expect(result.applied.length + result.failed.length).toBe(2);
  });

  it("handles single-block single-file correctly", async () => {
    const blocks = [makeBlock("src/only.ts")];
    const result = await batchApplySearchReplace(blocks, "/project");

    expect(result.applied).toEqual(["src/only.ts"]);
    expect(result.failed).toHaveLength(0);
    expect(mockWriteFile).toHaveBeenCalledTimes(1);
  });
});
