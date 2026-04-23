// ============================================================================
// packages/cli/src/__tests__/search-replace-parser.test.ts
//
// Unit tests for the SEARCH/REPLACE parser and applier.
// Design: zero mocks — all tests call real functions with real strings.
// ============================================================================

import { describe, it, expect } from "vitest";
import {
  parseSearchReplaceBlocks,
  applySearchReplaceBlock,
  findNearestLines,
} from "../search-replace-parser.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeBlock(filePath: string, searchContent: string, replaceContent: string) {
  return { filePath, searchContent, replaceContent, sourceOffset: 0 };
}

// ---------------------------------------------------------------------------
// 1. parseSearchReplaceBlocks — extraction
// ---------------------------------------------------------------------------

describe("parseSearchReplaceBlocks — extraction", () => {
  it("parses a single block with a simple replacement", () => {
    const response = `
Here is the change:

src/index.ts
<<<<<<< SEARCH
const x = 1;
=======
const x = 2;
>>>>>>> REPLACE
`;
    const { blocks } = parseSearchReplaceBlocks(response);
    expect(blocks).toHaveLength(1);
    expect(blocks[0]!.filePath).toBe("src/index.ts");
    expect(blocks[0]!.searchContent).toBe("const x = 1;");
    expect(blocks[0]!.replaceContent).toBe("const x = 2;");
  });

  it("parses multiple blocks targeting different files", () => {
    const response = `
packages/cli/src/foo.ts
<<<<<<< SEARCH
const a = 1;
=======
const a = 2;
>>>>>>> REPLACE

packages/cli/src/bar.ts
<<<<<<< SEARCH
const b = 3;
=======
const b = 4;
>>>>>>> REPLACE
`;
    const { blocks } = parseSearchReplaceBlocks(response);
    expect(blocks).toHaveLength(2);
    expect(blocks[0]!.filePath).toBe("packages/cli/src/foo.ts");
    expect(blocks[1]!.filePath).toBe("packages/cli/src/bar.ts");
  });

  it("parses multiple blocks targeting the same file", () => {
    const response = `
src/app.ts
<<<<<<< SEARCH
const x = 1;
=======
const x = 10;
>>>>>>> REPLACE

src/app.ts
<<<<<<< SEARCH
const y = 2;
=======
const y = 20;
>>>>>>> REPLACE
`;
    const { blocks } = parseSearchReplaceBlocks(response);
    expect(blocks).toHaveLength(2);
    expect(blocks[0]!.filePath).toBe("src/app.ts");
    expect(blocks[1]!.filePath).toBe("src/app.ts");
    expect(blocks[0]!.searchContent).toBe("const x = 1;");
    expect(blocks[1]!.searchContent).toBe("const y = 2;");
  });

  it("returns empty blocks array for plain text with no markers", () => {
    const { blocks, prose } = parseSearchReplaceBlocks("This is just a normal response.");
    expect(blocks).toHaveLength(0);
    expect(prose).toContain("This is just a normal response.");
  });

  it("normalizes Windows-style backslash paths to forward slashes", () => {
    const response = `
packages\\cli\\src\\tools.ts
<<<<<<< SEARCH
old line
=======
new line
>>>>>>> REPLACE
`;
    const { blocks } = parseSearchReplaceBlocks(response);
    expect(blocks).toHaveLength(1);
    expect(blocks[0]!.filePath).toBe("packages/cli/src/tools.ts");
    expect(blocks[0]!.filePath).not.toContain("\\");
  });

  it("extracts file path from the immediately preceding non-empty line", () => {
    const response = `
Some explanation text.

packages/cli/src/agent-loop.ts
<<<<<<< SEARCH
old code
=======
new code
>>>>>>> REPLACE
`;
    const { blocks } = parseSearchReplaceBlocks(response);
    expect(blocks).toHaveLength(1);
    expect(blocks[0]!.filePath).toBe("packages/cli/src/agent-loop.ts");
  });

  it("handles block with empty REPLACE section (deletion)", () => {
    const response = `
src/utils.ts
<<<<<<< SEARCH
// TODO: remove this
=======
>>>>>>> REPLACE
`;
    const { blocks } = parseSearchReplaceBlocks(response);
    expect(blocks).toHaveLength(1);
    expect(blocks[0]!.replaceContent).toBe("");
  });

  it("handles block with empty SEARCH section (insert / create)", () => {
    const response = `
src/new-file.ts
<<<<<<< SEARCH
=======
export const hello = "world";
>>>>>>> REPLACE
`;
    const { blocks } = parseSearchReplaceBlocks(response);
    expect(blocks).toHaveLength(1);
    expect(blocks[0]!.searchContent.trim()).toBe("");
    expect(blocks[0]!.replaceContent).toBe('export const hello = "world";');
  });

  it("does not include marker lines in searchContent or replaceContent", () => {
    const response = `
src/index.ts
<<<<<<< SEARCH
const x = 1;
=======
const x = 2;
>>>>>>> REPLACE
`;
    const { blocks } = parseSearchReplaceBlocks(response);
    const block = blocks[0]!;
    expect(block.searchContent).not.toContain("<<<<<<<");
    expect(block.searchContent).not.toContain("=======");
    expect(block.replaceContent).not.toContain("=======");
    expect(block.replaceContent).not.toContain(">>>>>>>");
  });

  it("preserves prose outside block regions in result.prose", () => {
    const response = `Here is my plan.

src/index.ts
<<<<<<< SEARCH
old
=======
new
>>>>>>> REPLACE

Done!`;
    const { prose } = parseSearchReplaceBlocks(response);
    expect(prose).toContain("Here is my plan.");
    expect(prose).toContain("Done!");
    expect(prose).not.toContain("<<<<<<<");
  });

  it("does not strip indentation from content inside blocks", () => {
    const response = `
src/server.ts
<<<<<<< SEARCH
  if (condition) {
    doSomething();
  }
=======
  if (condition) {
    doSomethingElse();
  }
>>>>>>> REPLACE
`;
    const { blocks } = parseSearchReplaceBlocks(response);
    expect(blocks[0]!.searchContent).toContain("  if (condition)");
    expect(blocks[0]!.replaceContent).toContain("  if (condition)");
  });

  it("handles response with no newline at end gracefully", () => {
    const response =
      "src/x.ts\n<<<<<<< SEARCH\nold\n=======\nnew\n>>>>>>> REPLACE";
    const { blocks } = parseSearchReplaceBlocks(response);
    expect(blocks).toHaveLength(1);
    expect(blocks[0]!.filePath).toBe("src/x.ts");
  });

  it("sets sourceOffset to a non-negative number", () => {
    const response = `
src/index.ts
<<<<<<< SEARCH
x
=======
y
>>>>>>> REPLACE
`;
    const { blocks } = parseSearchReplaceBlocks(response);
    expect(blocks[0]!.sourceOffset).toBeGreaterThanOrEqual(0);
  });

  it("strips leading ./ from file path", () => {
    const response = `
./src/index.ts
<<<<<<< SEARCH
a
=======
b
>>>>>>> REPLACE
`;
    const { blocks } = parseSearchReplaceBlocks(response);
    expect(blocks[0]!.filePath).toBe("src/index.ts");
  });
});

// ---------------------------------------------------------------------------
// 2. applySearchReplaceBlock — exact match
// ---------------------------------------------------------------------------

describe("applySearchReplaceBlock — exact match", () => {
  it("returns matched=true and correct updatedContent for exact match", () => {
    const fileContent = "const x = 1;\nconst y = 2;\n";
    const block = makeBlock("src/f.ts", "const x = 1;", "const x = 99;");
    const result = applySearchReplaceBlock(fileContent, block);
    expect(result.matched).toBe(true);
    expect(result.usedFallback).toBe(false);
    expect(result.updatedContent).toBe("const x = 99;\nconst y = 2;\n");
  });

  it("returns usedFallback=false for exact match", () => {
    const block = makeBlock("f.ts", "hello", "world");
    const result = applySearchReplaceBlock("hello world", block);
    expect(result.usedFallback).toBe(false);
  });

  it("handles empty searchContent by prepending replaceContent to file", () => {
    const block = makeBlock("f.ts", "", "// header\n");
    const result = applySearchReplaceBlock("existing content", block);
    expect(result.matched).toBe(true);
    expect(result.updatedContent).toContain("// header");
    expect(result.updatedContent).toContain("existing content");
  });

  it("handles empty replaceContent by deleting matched section", () => {
    const block = makeBlock("f.ts", "delete me\n", "");
    const result = applySearchReplaceBlock("before\ndelete me\nafter\n", block);
    expect(result.matched).toBe(true);
    expect(result.updatedContent).not.toContain("delete me");
    expect(result.updatedContent).toContain("before");
    expect(result.updatedContent).toContain("after");
  });

  it("returns matched=false when search string not found in file", () => {
    const block = makeBlock("f.ts", "does not exist in file", "replacement");
    const result = applySearchReplaceBlock("completely different content here", block);
    expect(result.matched).toBe(false);
    expect(result.updatedContent).toBeUndefined();
  });

  it("replaces only the first occurrence when search appears multiple times", () => {
    const fileContent = "foo\nfoo\nfoo\n";
    const block = makeBlock("f.ts", "foo", "bar");
    const result = applySearchReplaceBlock(fileContent, block);
    expect(result.matched).toBe(true);
    // First occurrence replaced, others remain
    expect(result.updatedContent).toBe("bar\nfoo\nfoo\n");
  });
});

// ---------------------------------------------------------------------------
// 3. applySearchReplaceBlock — fallback match
// ---------------------------------------------------------------------------

describe("applySearchReplaceBlock — fallback match", () => {
  it("returns matched=true and usedFallback=true when trailing whitespace differs", () => {
    // Multi-line search: file has trailing spaces before \n, search has none.
    // Exact match fails because "const x = 1;\nconst y" is not a substring
    // of "const x = 1;   \nconst y".  Stripped match succeeds.
    const fileContent = "const x = 1;   \nconst y = 2;\n";
    const block = makeBlock("f.ts", "const x = 1;\nconst y = 2;", "const x = 99;\nconst y = 2;");
    const result = applySearchReplaceBlock(fileContent, block);
    expect(result.matched).toBe(true);
    expect(result.usedFallback).toBe(true);
  });

  it("produces valid output when fallback match is used", () => {
    const fileContent = "function foo() {  \n  return 1;  \n}\n";
    const block = makeBlock("f.ts", "function foo() {\n  return 1;\n}", "function foo() {\n  return 2;\n}");
    const result = applySearchReplaceBlock(fileContent, block);
    expect(result.matched).toBe(true);
    expect(result.updatedContent).toContain("return 2;");
  });
});

// ---------------------------------------------------------------------------
// 4. applySearchReplaceBlock — diagnostics
// ---------------------------------------------------------------------------

describe("applySearchReplaceBlock — diagnostics", () => {
  it("returns non-empty diagnostic when no match found and file has content", () => {
    const block = makeBlock("f.ts", "function reallySpecificNameThatExists()", "replacement");
    const result = applySearchReplaceBlock("some completely different code here", block);
    expect(result.matched).toBe(false);
    expect(typeof result.diagnostic).toBe("string");
    expect(result.diagnostic!.length).toBeGreaterThan(0);
  });

  it("returns diagnostic containing nearest similar lines when partial match possible", () => {
    const fileContent = "const planningEnabled = x >= 0.7;\n";
    const block = makeBlock("f.ts", "const planningEnabled = x >= 0.5;", "const planningEnabled = x >= 0.5;");
    const result = applySearchReplaceBlock(fileContent, block);
    expect(result.matched).toBe(false);
    // diagnostic should reference the similar line
    expect(result.diagnostic).toContain("planningEnabled");
  });

  it("returns non-empty diagnostic even when file is completely empty", () => {
    const block = makeBlock("f.ts", "something", "replacement");
    const result = applySearchReplaceBlock("", block);
    expect(result.matched).toBe(false);
    expect(typeof result.diagnostic).toBe("string");
    expect(result.diagnostic!.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// 5. findNearestLines
// ---------------------------------------------------------------------------

describe("findNearestLines", () => {
  it("returns top-N most similar lines from file", () => {
    const fileContent = [
      "const planningEnabled = x >= 0.7;",
      "const x = 1;",
      "const thinkingBudget = 1000;",
    ].join("\n");
    const searchContent = "const planningEnabled = x >= 0.5;";
    const results = findNearestLines(fileContent, searchContent, 2);
    expect(results.length).toBeGreaterThan(0);
    expect(results.length).toBeLessThanOrEqual(2);
    // The most similar line should be the planning one
    expect(results[0]).toContain("planningEnabled");
  });

  it("returns empty array for empty file", () => {
    const results = findNearestLines("", "search text", 3);
    expect(results).toEqual([]);
  });

  it("returns empty array for empty search content", () => {
    const results = findNearestLines("some file content", "", 3);
    expect(results).toEqual([]);
  });

  it("does not throw when searchContent is longer than any single line", () => {
    const fileContent = "short line";
    const searchContent = "this is a very long search string that is definitely longer than the file line";
    expect(() => findNearestLines(fileContent, searchContent, 3)).not.toThrow();
  });

  it("respects the maxLines parameter", () => {
    const fileContent = Array.from({ length: 20 }, (_, i) => `const x${i} = ${i};`).join("\n");
    const results = findNearestLines(fileContent, "const x0 = 0;", 5);
    expect(results.length).toBeLessThanOrEqual(5);
  });
});

// ---------------------------------------------------------------------------
// 6. Round-trip integration (no mocks, real logic only)
// ---------------------------------------------------------------------------

describe("Round-trip integration", () => {
  it("parse then apply produces correct final file content", () => {
    const originalFile = "const a = 1;\nconst b = 2;\nconst c = 3;\n";
    const response = `
src/config.ts
<<<<<<< SEARCH
const a = 1;
=======
const a = 100;
>>>>>>> REPLACE
`;
    const { blocks } = parseSearchReplaceBlocks(response);
    expect(blocks).toHaveLength(1);
    const result = applySearchReplaceBlock(originalFile, blocks[0]!);
    expect(result.matched).toBe(true);
    expect(result.updatedContent).toBe("const a = 100;\nconst b = 2;\nconst c = 3;\n");
  });

  it("second block applied to content after first block (sequential application)", () => {
    const originalFile = "const x = 1;\nconst y = 2;\n";
    const response = `
src/app.ts
<<<<<<< SEARCH
const x = 1;
=======
const x = 10;
>>>>>>> REPLACE

src/app.ts
<<<<<<< SEARCH
const y = 2;
=======
const y = 20;
>>>>>>> REPLACE
`;
    const { blocks } = parseSearchReplaceBlocks(response);
    expect(blocks).toHaveLength(2);

    // Apply sequentially — each block operates on the result of the previous
    let content = originalFile;
    for (const block of blocks) {
      const result = applySearchReplaceBlock(content, block);
      expect(result.matched).toBe(true);
      content = result.updatedContent!;
    }
    expect(content).toBe("const x = 10;\nconst y = 20;\n");
  });

  it("block with empty search creates new file content (prepend)", () => {
    const response = `
src/new.ts
<<<<<<< SEARCH
=======
export const VERSION = "1.0.0";
>>>>>>> REPLACE
`;
    const { blocks } = parseSearchReplaceBlocks(response);
    const result = applySearchReplaceBlock("", blocks[0]!);
    expect(result.matched).toBe(true);
    expect(result.updatedContent).toContain('VERSION = "1.0.0"');
  });

  it("response with both prose and block extracts prose correctly", () => {
    const response = `I will fix the planning threshold.

packages/cli/src/agent-loop.ts
<<<<<<< SEARCH
const planningEnabled = lexicalComplexity >= 0.7;
=======
const planningEnabled = lexicalComplexity >= 0.5;
>>>>>>> REPLACE

That should do it.`;
    const { blocks, prose } = parseSearchReplaceBlocks(response);
    expect(blocks).toHaveLength(1);
    expect(blocks[0]!.searchContent).toContain("0.7");
    expect(blocks[0]!.replaceContent).toContain("0.5");
    expect(prose).toContain("I will fix the planning threshold.");
    expect(prose).toContain("That should do it.");
    expect(prose).not.toContain("<<<<<<< SEARCH");
  });
});
