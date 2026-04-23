// ============================================================================
// packages/core/src/__tests__/multi-file-session.test.ts
// 15 tests for MultiFileDiffSession.
// ============================================================================

import { describe, it, expect, vi } from "vitest";
import { MultiFileDiffSession } from "../diff-engine/multi-file-session.js";
import type { SearchReplaceBlock } from "../diff-engine/search-replace-parser.js";

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeBlock(
  filePath: string,
  searchContent: string,
  replaceContent: string,
): SearchReplaceBlock {
  return { filePath, searchContent, replaceContent, sourceOffset: 0 };
}

function makeGetContent(files: Record<string, string>) {
  return vi.fn(async (path: string) => files[path] ?? "");
}

function makeWriteContent(files: Record<string, string>) {
  return vi.fn(async (path: string, content: string) => {
    files[path] = content;
  });
}

// ── Constructor ───────────────────────────────────────────────────────────────

describe("MultiFileDiffSession", () => {
  it("creates all blocks in pending state", () => {
    const session = new MultiFileDiffSession([
      makeBlock("a.ts", "old", "new"),
      makeBlock("b.ts", "foo", "bar"),
    ]);
    expect(session.blocks).toHaveLength(2);
    expect(session.blocks.every((b) => b.state === "pending")).toBe(true);
  });

  it("pendingBlocks returns only pending blocks", () => {
    const session = new MultiFileDiffSession([
      makeBlock("a.ts", "old", "new"),
      makeBlock("b.ts", "foo", "bar"),
    ]);
    // Reject one via rejectBlock
    session.rejectBlock("block-0");
    expect(session.pendingBlocks).toHaveLength(1);
    expect(session.pendingBlocks[0]!.id).toBe("block-1");
  });

  it("allSettled is false while any block is pending", () => {
    const session = new MultiFileDiffSession([makeBlock("a.ts", "x", "y")]);
    expect(session.allSettled).toBe(false);
  });

  it("allSettled is true when all blocks are applied or rejected", () => {
    const session = new MultiFileDiffSession([
      makeBlock("a.ts", "x", "y"),
      makeBlock("b.ts", "p", "q"),
    ]);
    session.rejectBlock("block-0");
    session.rejectBlock("block-1");
    expect(session.allSettled).toBe(true);
  });

  it("affectedFiles returns deduplicated file paths", () => {
    const session = new MultiFileDiffSession([
      makeBlock("a.ts", "x", "y"),
      makeBlock("a.ts", "p", "q"),
      makeBlock("b.ts", "m", "n"),
    ]);
    const files = session.affectedFiles;
    expect(files).toHaveLength(2);
    expect(files).toContain("a.ts");
    expect(files).toContain("b.ts");
  });

  it("getBlocksForFile filters by filePath", () => {
    const session = new MultiFileDiffSession([
      makeBlock("a.ts", "x", "y"),
      makeBlock("b.ts", "p", "q"),
      makeBlock("a.ts", "m", "n"),
    ]);
    const aBlocks = session.getBlocksForFile("a.ts");
    expect(aBlocks).toHaveLength(2);
    expect(aBlocks.every((b) => b.filePath === "a.ts")).toBe(true);
  });

  // ── applyBlock ─────────────────────────────────────────────────────────────

  it("applyBlock success: sets state to applied and matchQuality", async () => {
    const files = { "a.ts": "const x = 1;\n" };
    const session = new MultiFileDiffSession([makeBlock("a.ts", "const x = 1;", "const x = 2;")]);
    const result = await session.applyBlock(
      "block-0",
      makeGetContent(files),
      makeWriteContent(files),
    );
    expect(result.matched).toBe(true);
    expect(session.blocks[0]!.state).toBe("applied");
    expect(session.blocks[0]!.matchQuality).toBe("exact");
  });

  it("applyBlock failure: sets state to failed and failureReason", async () => {
    const files = { "a.ts": "something completely different" };
    const session = new MultiFileDiffSession([
      makeBlock("a.ts", "function verySpecificNameXYZQQQ() {}", "renamed()"),
    ]);
    const result = await session.applyBlock(
      "block-0",
      makeGetContent(files),
      makeWriteContent(files),
    );
    expect(result.matched).toBe(false);
    expect(session.blocks[0]!.state).toBe("failed");
    expect(session.blocks[0]!.failureReason).toBeTruthy();
  });

  it("applyBlock throws when block id is not found", async () => {
    const session = new MultiFileDiffSession([makeBlock("a.ts", "x", "y")]);
    await expect(
      session.applyBlock("block-999", makeGetContent({}), makeWriteContent({})),
    ).rejects.toThrow("block-999");
  });

  it("applyBlock throws when block is not pending", async () => {
    const session = new MultiFileDiffSession([makeBlock("a.ts", "x", "y")]);
    session.rejectBlock("block-0");
    await expect(
      session.applyBlock("block-0", makeGetContent({}), makeWriteContent({})),
    ).rejects.toThrow("rejected");
  });

  // ── rejectBlock ────────────────────────────────────────────────────────────

  it("rejectBlock sets state to rejected", () => {
    const session = new MultiFileDiffSession([makeBlock("a.ts", "x", "y")]);
    session.rejectBlock("block-0");
    expect(session.blocks[0]!.state).toBe("rejected");
  });

  // ── applyAll ──────────────────────────────────────────────────────────────

  it("applyAll applies all pending blocks and returns a map with one entry per block", async () => {
    const files = { "a.ts": "const a = 1;\n", "b.ts": "const b = 2;\n" };
    const session = new MultiFileDiffSession([
      makeBlock("a.ts", "const a = 1;", "const a = 10;"),
      makeBlock("b.ts", "const b = 2;", "const b = 20;"),
    ]);
    const results = await session.applyAll(makeGetContent(files), makeWriteContent(files));
    expect(results.size).toBe(2);
    expect(results.get("block-0")!.matched).toBe(true);
    expect(results.get("block-1")!.matched).toBe(true);
  });

  it("applyAll continues after one failure and does not throw", async () => {
    const files = { "a.ts": "const a = 1;\n", "b.ts": "totally different content" };
    const session = new MultiFileDiffSession([
      makeBlock("a.ts", "const a = 1;", "const a = 10;"),
      makeBlock("b.ts", "function specificNameXYZ() {}", "renamed()"),
    ]);
    const results = await session.applyAll(makeGetContent(files), makeWriteContent(files));
    expect(results.size).toBe(2);
    expect(results.get("block-0")!.matched).toBe(true);
    expect(results.get("block-1")!.matched).toBe(false);
    expect(session.blocks[1]!.state).toBe("failed");
  });

  // ── rejectAll ─────────────────────────────────────────────────────────────

  it("rejectAll sets all pending blocks to rejected", () => {
    const session = new MultiFileDiffSession([
      makeBlock("a.ts", "x", "y"),
      makeBlock("b.ts", "p", "q"),
    ]);
    session.rejectAll();
    expect(session.blocks.every((b) => b.state === "rejected")).toBe(true);
    expect(session.allSettled).toBe(true);
  });
});
