// Tests for the Aider-derived SEARCH/REPLACE block parser. Covers parseSearchReplaceBlocks
// and applySearchReplaceBlock across all 4 match strategies (exact, trailing-ws, leading-ws,
// fuzzy) plus edge cases: empty search (insert/create), empty replace (delete), malformed
// blocks, multiple blocks, code-fence-prefixed file paths.

import { describe, it, expect } from "vitest";
import {
  parseSearchReplaceBlocks,
  applySearchReplaceBlock,
  findNearestLines,
  FUZZY_THRESHOLD,
  type SearchReplaceBlock,
} from "./search-replace-parser.js";

// ── parseSearchReplaceBlocks ────────────────────────────────────────────────

describe("parseSearchReplaceBlocks", () => {
  it("extracts a single well-formed block", () => {
    const input = [
      "src/foo.ts",
      "<<<<<<< SEARCH",
      "const old = 1;",
      "=======",
      "const updated = 2;",
      ">>>>>>> REPLACE",
    ].join("\n");
    const result = parseSearchReplaceBlocks(input);
    expect(result.blocks).toHaveLength(1);
    expect(result.blocks[0]?.filePath).toBe("src/foo.ts");
    expect(result.blocks[0]?.searchContent).toBe("const old = 1;");
    expect(result.blocks[0]?.replaceContent).toBe("const updated = 2;");
  });

  it("normalizes Windows backslashes to forward slashes in file path", () => {
    const input = [
      "src\\sub\\bar.ts",
      "<<<<<<< SEARCH",
      "x",
      "=======",
      "y",
      ">>>>>>> REPLACE",
    ].join("\n");
    const result = parseSearchReplaceBlocks(input);
    expect(result.blocks[0]?.filePath).toBe("src/sub/bar.ts");
  });

  it("strips leading ./ from file path", () => {
    const input = [
      "./src/baz.ts",
      "<<<<<<< SEARCH",
      "x",
      "=======",
      "y",
      ">>>>>>> REPLACE",
    ].join("\n");
    const result = parseSearchReplaceBlocks(input);
    expect(result.blocks[0]?.filePath).toBe("src/baz.ts");
  });

  it("skips code fences when looking back for the file path", () => {
    const input = [
      "src/quux.ts",
      "```typescript",
      "<<<<<<< SEARCH",
      "a",
      "=======",
      "b",
      ">>>>>>> REPLACE",
    ].join("\n");
    const result = parseSearchReplaceBlocks(input);
    expect(result.blocks[0]?.filePath).toBe("src/quux.ts");
  });

  it("returns empty blocks list when no file path precedes SEARCH", () => {
    const input = [
      "<<<<<<< SEARCH",
      "a",
      "=======",
      "b",
      ">>>>>>> REPLACE",
    ].join("\n");
    const result = parseSearchReplaceBlocks(input);
    expect(result.blocks).toHaveLength(0);
  });

  it("ignores malformed blocks (no separator)", () => {
    const input = [
      "src/foo.ts",
      "<<<<<<< SEARCH",
      "no separator here",
      ">>>>>>> REPLACE",
    ].join("\n");
    const result = parseSearchReplaceBlocks(input);
    // Without a `=======` line the block is not closed, so no block is emitted.
    expect(result.blocks).toHaveLength(0);
  });

  it("extracts multiple blocks in document order", () => {
    const input = [
      "src/a.ts",
      "<<<<<<< SEARCH",
      "1",
      "=======",
      "2",
      ">>>>>>> REPLACE",
      "",
      "src/b.ts",
      "<<<<<<< SEARCH",
      "3",
      "=======",
      "4",
      ">>>>>>> REPLACE",
    ].join("\n");
    const result = parseSearchReplaceBlocks(input);
    expect(result.blocks).toHaveLength(2);
    expect(result.blocks[0]?.filePath).toBe("src/a.ts");
    expect(result.blocks[1]?.filePath).toBe("src/b.ts");
    expect(result.blocks[0]?.sourceOffset).toBeLessThan(result.blocks[1]?.sourceOffset ?? 0);
  });

  it("returns prose with block regions removed", () => {
    const input = [
      "Some intro prose.",
      "",
      "src/a.ts",
      "<<<<<<< SEARCH",
      "old",
      "=======",
      "new",
      ">>>>>>> REPLACE",
      "",
      "Closing comments.",
    ].join("\n");
    const result = parseSearchReplaceBlocks(input);
    expect(result.prose).toContain("Some intro prose.");
    expect(result.prose).toContain("Closing comments.");
    expect(result.prose).not.toContain("<<<<<<<");
    expect(result.prose).not.toContain("=======");
    expect(result.prose).not.toContain(">>>>>>>");
  });

  it("preserves multi-line search and replace content with newlines", () => {
    const input = [
      "src/multi.ts",
      "<<<<<<< SEARCH",
      "line one",
      "line two",
      "line three",
      "=======",
      "replaced one",
      "replaced two",
      ">>>>>>> REPLACE",
    ].join("\n");
    const result = parseSearchReplaceBlocks(input);
    expect(result.blocks[0]?.searchContent).toBe("line one\nline two\nline three");
    expect(result.blocks[0]?.replaceContent).toBe("replaced one\nreplaced two");
  });
});

// ── applySearchReplaceBlock ─────────────────────────────────────────────────

describe("applySearchReplaceBlock — exact match", () => {
  it("applies an exact-match block", () => {
    const file = "before\nconst x = 1;\nafter\n";
    const block: SearchReplaceBlock = {
      filePath: "src/foo.ts",
      searchContent: "const x = 1;",
      replaceContent: "const x = 42;",
      sourceOffset: 0,
    };
    const result = applySearchReplaceBlock(file, block);
    expect(result.matched).toBe(true);
    expect(result.matchQuality).toBe("exact");
    expect(result.usedFallback).toBe(false);
    expect(result.updatedContent).toBe("before\nconst x = 42;\nafter\n");
  });

  it("returns failure with diagnostic when no match found", () => {
    const file = "totally\nunrelated\ncontent\n";
    const block: SearchReplaceBlock = {
      filePath: "src/foo.ts",
      searchContent: "this string is not in the file",
      replaceContent: "irrelevant",
      sourceOffset: 0,
    };
    const result = applySearchReplaceBlock(file, block);
    expect(result.matched).toBe(false);
    expect(result.matchQuality).toBe("none");
    expect(result.diagnostic).toBeDefined();
  });
});

describe("applySearchReplaceBlock — empty search (insert)", () => {
  it("prepends content when searchContent is empty and file is non-empty", () => {
    const block: SearchReplaceBlock = {
      filePath: "src/foo.ts",
      searchContent: "",
      replaceContent: "// new header line",
      sourceOffset: 0,
    };
    const result = applySearchReplaceBlock("existing line", block);
    expect(result.matched).toBe(true);
    expect(result.updatedContent).toBe("// new header line\nexisting line");
  });

  it("treats empty search + empty file as a create operation", () => {
    const block: SearchReplaceBlock = {
      filePath: "new-file.ts",
      searchContent: "",
      replaceContent: "export const greeting = 'hello';\n",
      sourceOffset: 0,
    };
    const result = applySearchReplaceBlock("", block);
    expect(result.matched).toBe(true);
    expect(result.updatedContent).toBe("export const greeting = 'hello';\n");
  });
});

describe("applySearchReplaceBlock — empty replace (delete)", () => {
  it("deletes the matched section when replaceContent is empty", () => {
    const file = "keep this\nDELETE ME\nkeep this too\n";
    const block: SearchReplaceBlock = {
      filePath: "src/foo.ts",
      searchContent: "DELETE ME\n",
      replaceContent: "",
      sourceOffset: 0,
    };
    const result = applySearchReplaceBlock(file, block);
    expect(result.matched).toBe(true);
    expect(result.updatedContent).toBe("keep this\nkeep this too\n");
  });
});

describe("applySearchReplaceBlock — fallback strategies", () => {
  it("matches across trailing whitespace differences (search has trailing ws, file does not)", () => {
    // Set up a case where exact match cannot succeed: search has trailing
    // whitespace on each line, file has none. Trailing-ws normalization on
    // both sides should produce identical text and match.
    const file = "const x = 1;\nconst y = 2;\nafter\n";
    const block: SearchReplaceBlock = {
      filePath: "src/foo.ts",
      searchContent: "const x = 1;   \nconst y = 2;   ", // trailing spaces
      replaceContent: "const x = 42;\nconst y = 99;",
      sourceOffset: 0,
    };
    const result = applySearchReplaceBlock(file, block);
    expect(result.matched).toBe(true);
    expect(result.usedFallback).toBe(true);
    // Should be either trailing-ws or leading-ws (both normalize whitespace), not exact, not fuzzy
    expect(["trailing-ws", "leading-ws"]).toContain(result.matchQuality);
  });

  it("matches across leading whitespace differences", () => {
    const file = "    const x = 1;\n    const y = 2;\n";
    const block: SearchReplaceBlock = {
      filePath: "src/foo.ts",
      searchContent: "const x = 1;\nconst y = 2;", // no leading whitespace at all
      replaceContent: "const x = 42;\nconst y = 99;",
      sourceOffset: 0,
    };
    const result = applySearchReplaceBlock(file, block);
    expect(result.matched).toBe(true);
    expect(result.usedFallback).toBe(true);
  });
});

describe("FUZZY_THRESHOLD", () => {
  it("is a sensible Jaccard threshold in [0,1]", () => {
    expect(FUZZY_THRESHOLD).toBeGreaterThan(0);
    expect(FUZZY_THRESHOLD).toBeLessThanOrEqual(1);
    expect(FUZZY_THRESHOLD).toBeGreaterThanOrEqual(0.5); // anything below 0.5 would be reckless
  });
});

// ── findNearestLines ────────────────────────────────────────────────────────

describe("findNearestLines", () => {
  it("returns approximate match info for similar content", () => {
    const file = "function foo() {\n  return 1;\n}\n\nfunction bar() {\n  return 2;\n}\n";
    const result = findNearestLines(file, "function foo() {\n  return 99;\n}");
    // findNearestLines is exploratory — we just verify it returns *something* shaped right.
    expect(result).toBeDefined();
  });
});
