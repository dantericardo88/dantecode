// packages/vscode/src/__tests__/udiff-pipeline.test.ts
// Tests for the unified-diff completion pipeline:
//   parseUdiffResponse() → applyUdiffBlocks() → WorkspaceEdit
//
// Machine 4 wiring: when a FIM completion contains "--- a/", the response is
// routed through parseUdiffResponse() and applied as a WorkspaceEdit instead
// of being returned as an inline completion item.

import { describe, it, expect } from "vitest";
import { parseUdiffResponse } from "../udiff-parser.js";
import type { SearchReplaceBlock } from "@dantecode/core";

// ── parseUdiffResponse unit tests (testing the pipeline entry point) ──────────

describe("parseUdiffResponse — pipeline entry point", () => {
  it("returns SearchReplaceBlock[] for a valid unified diff", () => {
    const diff = [
      "--- a/src/auth.ts",
      "+++ b/src/auth.ts",
      "@@ -10,4 +10,4 @@",
      " function login() {",
      "-  return false;",
      "+  return true;",
      " }",
    ].join("\n");

    const blocks = parseUdiffResponse(diff);
    expect(blocks).toHaveLength(1);
    expect(blocks[0]!.searchContent).toContain("return false;");
    expect(blocks[0]!.replaceContent).toContain("return true;");
  });

  it("returns [] when text contains no --- a/ header", () => {
    const text = "just some completion text\nwith no diff markers";
    const blocks = parseUdiffResponse(text);
    expect(blocks).toHaveLength(0);
  });

  it("returns [] when --- header exists but no +++ follows", () => {
    const text = "--- a/file.ts\nsome content without +++ header";
    const blocks = parseUdiffResponse(text);
    expect(blocks).toHaveLength(0);
  });

  it("returns [] for empty hunks (no additions or removals)", () => {
    // A diff with only context lines produces non-empty search AND replace
    // (both context), so this tests an actual empty hunk (@@ with nothing)
    const diff = [
      "--- a/src/file.ts",
      "+++ b/src/file.ts",
      "@@ -1,0 +1,0 @@",
      // no body lines
    ].join("\n");

    const blocks = parseUdiffResponse(diff);
    // Empty hunk → both sides are empty strings → block is dropped
    expect(blocks).toHaveLength(0);
  });

  it("handles multiple hunks in a single file", () => {
    const diff = [
      "--- a/src/utils.ts",
      "+++ b/src/utils.ts",
      "@@ -5,3 +5,3 @@",
      " const A = 1;",
      "-const B = 2;",
      "+const B = 99;",
      "@@ -20,3 +20,3 @@",
      " function foo() {",
      "-  return 'old';",
      "+  return 'new';",
      " }",
    ].join("\n");

    const blocks = parseUdiffResponse(diff);
    expect(blocks).toHaveLength(2);
  });

  it("strips 'b/' prefix from file path in +++ line", () => {
    const diff = [
      "--- a/src/index.ts",
      "+++ b/src/index.ts",
      "@@ -1,2 +1,2 @@",
      "-const x = 1;",
      "+const x = 2;",
    ].join("\n");

    const blocks = parseUdiffResponse(diff);
    expect(blocks[0]!.filePath).toBe("src/index.ts");
  });
});

// ── applyUdiffBlocks logic tests (via simulated document text matching) ────────

describe("applyUdiffBlocks — document text matching logic", () => {
  /**
   * Simulate what applyUdiffBlocks does: find searchContent in document text,
   * collect the replacements. We test the selection logic in isolation without
   * a real vscode.TextDocument.
   */
  function simulateApply(
    blocks: SearchReplaceBlock[],
    documentText: string,
  ): Array<{ found: boolean; replacement: string }> {
    return blocks.map((block) => {
      if (!block.searchContent) return { found: false, replacement: "" };
      const idx = documentText.indexOf(block.searchContent);
      if (idx === -1) return { found: false, replacement: "" };
      return { found: true, replacement: block.replaceContent };
    });
  }

  it("matches searchContent found in document text", () => {
    const docText = "function foo() {\n  return false;\n}\n";
    const blocks: SearchReplaceBlock[] = [
      {
        filePath: "src/foo.ts",
        searchContent: "  return false;",
        replaceContent: "  return true;",
        sourceOffset: 0,
      },
    ];

    const results = simulateApply(blocks, docText);
    expect(results[0]!.found).toBe(true);
    expect(results[0]!.replacement).toBe("  return true;");
  });

  it("skips blocks whose searchContent is not found in document", () => {
    const docText = "function foo() {\n  return true;\n}\n";
    const blocks: SearchReplaceBlock[] = [
      {
        filePath: "src/foo.ts",
        searchContent: "  return false;", // not in document
        replaceContent: "  return true;",
        sourceOffset: 0,
      },
    ];

    const results = simulateApply(blocks, docText);
    expect(results[0]!.found).toBe(false);
  });

  it("applies multiple non-overlapping blocks independently", () => {
    const docText = "const A = 1;\nconst B = 2;\nconst C = 3;\n";
    const blocks: SearchReplaceBlock[] = [
      {
        filePath: "src/consts.ts",
        searchContent: "const A = 1;",
        replaceContent: "const A = 10;",
        sourceOffset: 0,
      },
      {
        filePath: "src/consts.ts",
        searchContent: "const B = 2;",
        replaceContent: "const B = 20;",
        sourceOffset: 0,
      },
    ];

    const results = simulateApply(blocks, docText);
    expect(results[0]!.found).toBe(true);
    expect(results[1]!.found).toBe(true);
    expect(results[0]!.replacement).toBe("const A = 10;");
    expect(results[1]!.replacement).toBe("const B = 20;");
  });

  it("handles empty searchContent by skipping the block", () => {
    const docText = "some content here";
    const blocks: SearchReplaceBlock[] = [
      {
        filePath: "src/file.ts",
        searchContent: "", // empty search
        replaceContent: "new content",
        sourceOffset: 0,
      },
    ];

    const results = simulateApply(blocks, docText);
    expect(results[0]!.found).toBe(false);
  });
});

// ── Integration: full diff detection → parse → apply gate ────────────────────

describe("unified diff pipeline gate", () => {
  it("triggers when response contains '--- a/' and useUnifiedDiff=true", () => {
    const completionText = [
      "--- a/src/auth.ts",
      "+++ b/src/auth.ts",
      "@@ -5,3 +5,3 @@",
      " function auth() {",
      "-  return null;",
      "+  return token;",
      " }",
    ].join("\n");

    const useUnifiedDiff = true;
    const hasDiffMarker = completionText.includes("--- a/");
    expect(useUnifiedDiff && hasDiffMarker).toBe(true);

    const blocks = parseUdiffResponse(completionText);
    expect(blocks.length).toBeGreaterThan(0);
    // Pipeline would call applyUdiffBlocks + return []
  });

  it("falls through to cleanCompletionText when no diff marker present", () => {
    const completionText = "const result = computeValue(x, y);";
    const useUnifiedDiff = true;
    const hasDiffMarker = completionText.includes("--- a/");

    // Gate: no diff marker → pipeline skips parseUdiffResponse
    expect(useUnifiedDiff && hasDiffMarker).toBe(false);
  });

  it("falls through when parseUdiffResponse returns [] (no valid hunks)", () => {
    const completionText = "--- a/file.ts\nsome malformed content";
    const blocks = parseUdiffResponse(completionText);
    // No valid hunks → blocks empty → fall through to cleanCompletionText
    expect(blocks).toHaveLength(0);
  });
});
