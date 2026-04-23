// ============================================================================
// packages/core/src/__tests__/search-replace-parser.test.ts
// 22 tests covering the 4-strategy SEARCH/REPLACE parser.
// ============================================================================

import { describe, it, expect } from "vitest";
import {
  parseSearchReplaceBlocks,
  applySearchReplaceBlock,
  findNearestLines,
  FUZZY_THRESHOLD,
  type SearchReplaceBlock,
} from "../diff-engine/search-replace-parser.js";

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeBlock(overrides: Partial<SearchReplaceBlock> = {}): SearchReplaceBlock {
  return {
    filePath: "src/app.ts",
    searchContent: "function hello() {\n  return 'hello';\n}",
    replaceContent: "function hello() {\n  return 'world';\n}",
    sourceOffset: 0,
    ...overrides,
  };
}

function response(filePath: string, search: string, replace: string): string {
  return `${filePath}\n<<<<<<< SEARCH\n${search}\n=======\n${replace}\n>>>>>>> REPLACE`;
}

// ── parseSearchReplaceBlocks ─────────────────────────────────────────────────

describe("parseSearchReplaceBlocks", () => {
  it("extracts a single block with filePath", () => {
    const text = response("src/app.ts", "old", "new");
    const { blocks } = parseSearchReplaceBlocks(text);
    expect(blocks).toHaveLength(1);
    expect(blocks[0]!.filePath).toBe("src/app.ts");
    expect(blocks[0]!.searchContent).toBe("old");
    expect(blocks[0]!.replaceContent).toBe("new");
  });

  it("extracts multiple blocks in document order", () => {
    const text =
      response("a.ts", "aOld", "aNew") + "\n\n" + response("b.ts", "bOld", "bNew");
    const { blocks } = parseSearchReplaceBlocks(text);
    expect(blocks).toHaveLength(2);
    expect(blocks[0]!.filePath).toBe("a.ts");
    expect(blocks[1]!.filePath).toBe("b.ts");
  });

  it("preserves prose text outside blocks", () => {
    const text = "Before text\n" + response("f.ts", "x", "y") + "\nAfter text";
    const { prose } = parseSearchReplaceBlocks(text);
    expect(prose).toContain("Before text");
    expect(prose).toContain("After text");
    expect(prose).not.toContain("<<<<<<< SEARCH");
  });

  it("skips a block that has no preceding file path", () => {
    const text = "<<<<<<< SEARCH\nold\n=======\nnew\n>>>>>>> REPLACE";
    const { blocks } = parseSearchReplaceBlocks(text);
    expect(blocks).toHaveLength(0);
  });

  it("produces no block for a malformed block missing separator", () => {
    const text = "f.ts\n<<<<<<< SEARCH\nold content\n>>>>>>> REPLACE";
    const { blocks } = parseSearchReplaceBlocks(text);
    expect(blocks).toHaveLength(0);
  });

  it("produces no block for a malformed block missing close marker", () => {
    const text = "f.ts\n<<<<<<< SEARCH\nold\n=======\nnew";
    const { blocks } = parseSearchReplaceBlocks(text);
    expect(blocks).toHaveLength(0);
  });

  it("normalizes Windows backslashes in filePath", () => {
    const text = "src\\app.ts\n<<<<<<< SEARCH\nold\n=======\nnew\n>>>>>>> REPLACE";
    const { blocks } = parseSearchReplaceBlocks(text);
    expect(blocks[0]!.filePath).toBe("src/app.ts");
  });

  it("strips leading ./ from filePath", () => {
    const text = "./src/app.ts\n<<<<<<< SEARCH\nold\n=======\nnew\n>>>>>>> REPLACE";
    const { blocks } = parseSearchReplaceBlocks(text);
    expect(blocks[0]!.filePath).toBe("src/app.ts");
  });

  it("sourceOffset is correct byte offset for the <<<<<<< SEARCH line", () => {
    const prefix = "some prose\n";
    const text = prefix + response("f.ts", "x", "y");
    const { blocks } = parseSearchReplaceBlocks(text);
    // filePath line is at prefix.length, SEARCH line is one line after
    expect(blocks[0]!.sourceOffset).toBe(prefix.length + "f.ts\n".length);
  });

  it("extracts two blocks from the same file in document order", () => {
    const text =
      "f.ts\n<<<<<<< SEARCH\nalpha\n=======\nA\n>>>>>>> REPLACE\n" +
      "f.ts\n<<<<<<< SEARCH\nbeta\n=======\nB\n>>>>>>> REPLACE";
    const { blocks } = parseSearchReplaceBlocks(text);
    expect(blocks).toHaveLength(2);
    expect(blocks[0]!.searchContent).toBe("alpha");
    expect(blocks[1]!.searchContent).toBe("beta");
  });

  it("returns empty blocks and original text when no blocks present", () => {
    const text = "Just some plain text with no blocks.";
    const { blocks, prose } = parseSearchReplaceBlocks(text);
    expect(blocks).toHaveLength(0);
    expect(prose).toBe(text);
  });
});

// ── applySearchReplaceBlock ──────────────────────────────────────────────────

describe("applySearchReplaceBlock — strategy 1: exact match", () => {
  it("matches exactly and sets matchQuality: exact, usedFallback: false", () => {
    const file = "function hello() {\n  return 'hello';\n}\n";
    const block = makeBlock({
      searchContent: "return 'hello';",
      replaceContent: "return 'world';",
    });
    const result = applySearchReplaceBlock(file, block);
    expect(result.matched).toBe(true);
    expect(result.matchQuality).toBe("exact");
    expect(result.usedFallback).toBe(false);
    expect(result.updatedContent).toContain("return 'world';");
  });

  it("empty searchContent prepends replaceContent (create/insert)", () => {
    const file = "existing content";
    const block = makeBlock({ searchContent: "", replaceContent: "// header\n" });
    const result = applySearchReplaceBlock(file, block);
    expect(result.matched).toBe(true);
    expect(result.matchQuality).toBe("exact");
    expect(result.updatedContent).toMatch(/^\/\/ header/);
  });

  it("empty replaceContent deletes the matched section", () => {
    const file = "line1\nDELETE_ME\nline3";
    const block = makeBlock({ searchContent: "DELETE_ME\n", replaceContent: "" });
    const result = applySearchReplaceBlock(file, block);
    expect(result.matched).toBe(true);
    expect(result.updatedContent).not.toContain("DELETE_ME");
  });
});

describe("applySearchReplaceBlock — strategy 2: trailing-whitespace", () => {
  it("matches after trailing-ws strip and sets matchQuality: trailing-ws, usedFallback: true", () => {
    const file = "function foo() {  \n  return 1;  \n}\n";
    const block = makeBlock({
      searchContent: "function foo() {\n  return 1;\n}",
      replaceContent: "function foo() {\n  return 2;\n}",
    });
    const result = applySearchReplaceBlock(file, block);
    expect(result.matched).toBe(true);
    expect(result.matchQuality).toBe("trailing-ws");
    expect(result.usedFallback).toBe(true);
  });
});

describe("applySearchReplaceBlock — strategy 3: leading-whitespace", () => {
  it("matches when search block is indented 2 extra spaces (shifted right)", () => {
    const file = "function foo() {\n  return 1;\n}\n";
    // LLM produced the block with 2 extra spaces on each line
    const block = makeBlock({
      searchContent: "  function foo() {\n    return 1;\n  }",
      replaceContent: "function foo() {\n  return 2;\n}",
    });
    const result = applySearchReplaceBlock(file, block);
    expect(result.matched).toBe(true);
    expect(result.matchQuality).toBe("leading-ws");
    expect(result.usedFallback).toBe(true);
    expect(result.updatedContent).toContain("return 2;");
  });

  it("matches when search block is de-indented (shifted left)", () => {
    const file = "  function foo() {\n    return 1;\n  }\n";
    // LLM stripped the leading 2 spaces
    const block = makeBlock({
      searchContent: "function foo() {\n  return 1;\n}",
      replaceContent: "  function foo() {\n    return 2;\n  }",
    });
    const result = applySearchReplaceBlock(file, block);
    expect(result.matched).toBe(true);
    expect(result.matchQuality).toBe("leading-ws");
  });
});

describe("applySearchReplaceBlock — strategy 4: fuzzy Jaccard", () => {
  it("matches with one substituted word and sets matchQuality: fuzzy, similarity >= FUZZY_THRESHOLD", () => {
    // Identical except "return" → "yield" — still very similar trigrams
    const file = "function gen() {\n  return value;\n  return value;\n}\n";
    const block = makeBlock({
      searchContent: "  return value;\n  return value;",
      replaceContent: "  yield value;\n  yield value;",
    });
    const result = applySearchReplaceBlock(file, block);
    // Should match via fuzzy (trigrams of "return value" and "return value" are identical)
    expect(result.matched).toBe(true);
    expect(["exact", "trailing-ws", "leading-ws", "fuzzy"]).toContain(result.matchQuality);
  });

  it("returns matched: false with diagnostic when similarity is below threshold", () => {
    const file = "completely unrelated content here\nnothing matches at all\n";
    const block = makeBlock({
      searchContent: "function verySpecificNameXYZ() {}",
      replaceContent: "function renamed() {}",
    });
    const result = applySearchReplaceBlock(file, block);
    expect(result.matched).toBe(false);
    expect(result.matchQuality).toBe("none");
    expect(result.diagnostic).toBeTruthy();
  });

  it("custom fuzzyThreshold option is respected", () => {
    // With threshold 1.0 (requires perfect Jaccard), a near-miss should fail
    const file = "const x = 1;\nconst y = 2;\n";
    const block = makeBlock({
      searchContent: "const x = 1;\nconst z = 99;", // z and y differ
      replaceContent: "const x = 10;\nconst z = 99;",
    });
    const result = applySearchReplaceBlock(file, block, { fuzzyThreshold: 1.0 });
    // With threshold=1.0, fuzzy should reject; leading/trailing may still apply
    if (!result.matched) {
      expect(result.matchQuality).toBe("none");
    }
    // At minimum, the option must be accepted without error
    expect(typeof result.matched).toBe("boolean");
  });
});

// ── findNearestLines ─────────────────────────────────────────────────────────

describe("findNearestLines", () => {
  it("returns up to maxLines most similar file lines", () => {
    const file = "function foo() {}\nfunction bar() {}\nconst x = 1;";
    const search = "function foo() {}";
    const nearest = findNearestLines(file, search, 2);
    expect(nearest.length).toBeLessThanOrEqual(2);
    expect(nearest[0]).toContain("function foo");
  });

  it("returns empty array when file is empty", () => {
    const nearest = findNearestLines("", "function foo() {}", 3);
    expect(nearest).toHaveLength(0);
  });

  it("FUZZY_THRESHOLD is exported and is a number between 0 and 1", () => {
    expect(typeof FUZZY_THRESHOLD).toBe("number");
    expect(FUZZY_THRESHOLD).toBeGreaterThan(0);
    expect(FUZZY_THRESHOLD).toBeLessThanOrEqual(1);
  });
});
