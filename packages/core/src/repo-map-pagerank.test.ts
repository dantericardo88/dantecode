// ============================================================================
// @dantecode/core - PageRank Repo Map Tests
// ============================================================================

import { describe, it, expect, beforeEach } from "vitest";
import { mkdir, writeFile, rm as _rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  extractTags,
  computeSymbolRanks,
  formatRepoMapContext,
  buildPageRankRepoMap,
  getRelevantContext,
  type RepoMapContext,
  type SymbolTag,
} from "./repo-map-pagerank.js";
import { RepoMapTreeSitter } from "./repo-map-tree-sitter.js";

describe("extractTags", () => {
  let testDir: string;
  let treeSitter: RepoMapTreeSitter;

  beforeEach(async () => {
    testDir = join(tmpdir(), `dante-repo-map-${Date.now()}`);
    await mkdir(testDir, { recursive: true });
    treeSitter = new RepoMapTreeSitter();
  });

  it("should extract both definitions and references", async () => {
    const code = `
export function calculateTotal(items: Item[]): number {
  return items.reduce((sum, item) => sum + item.price, 0);
}

export class ShoppingCart {
  addItem(item: Item) {
    const total = calculateTotal([item]);
    return total;
  }
}
`;

    const filePath = "test.ts";
    await writeFile(join(testDir, filePath), code);

    const tags = await extractTags(filePath, testDir, treeSitter);

    // Check definitions
    const defs = tags.filter((t) => t.kind === "def");
    expect(defs.length).toBeGreaterThanOrEqual(2);
    expect(defs.some((t) => t.symbolName === "calculateTotal")).toBe(true);
    expect(defs.some((t) => t.symbolName === "ShoppingCart")).toBe(true);

    // Check references
    const refs = tags.filter((t) => t.kind === "ref");
    expect(refs.length).toBeGreaterThan(0);
    expect(refs.some((t) => t.symbolName === "calculateTotal")).toBe(true);
    expect(refs.some((t) => t.symbolName === "Item")).toBe(true);
  });

  it("should include line numbers for definitions", async () => {
    const code = `
export function foo() {
  return 42;
}
`;

    const filePath = "foo.ts";
    await writeFile(join(testDir, filePath), code);

    const tags = await extractTags(filePath, testDir, treeSitter);
    const fooDef = tags.find((t) => t.kind === "def" && t.symbolName === "foo");

    expect(fooDef).toBeDefined();
    expect(fooDef!.line).toBeGreaterThan(0);
  });

  it("should extract JSX component references", async () => {
    const code = `
export const MyComponent = () => {
  return <div><Button>Click</Button></div>;
};
`;

    const filePath = "component.tsx";
    await writeFile(join(testDir, filePath), code);

    const tags = await extractTags(filePath, testDir, treeSitter);
    const refs = tags.filter((t) => t.kind === "ref");

    expect(refs.some((t) => t.symbolName === "Button")).toBe(true);
  });

  it("should not extract keywords as references", async () => {
    const code = `
if (true) {
  const result = await fetchData();
  return result;
}
`;

    const filePath = "keywords.ts";
    await writeFile(join(testDir, filePath), code);

    const tags = await extractTags(filePath, testDir, treeSitter);
    const refs = tags.filter((t) => t.kind === "ref");

    // Should not include keywords like 'if', 'true', 'const', 'await', 'return'
    expect(refs.some((t) => t.symbolName === "if")).toBe(false);
    expect(refs.some((t) => t.symbolName === "true")).toBe(false);
    expect(refs.some((t) => t.symbolName === "const")).toBe(false);
    expect(refs.some((t) => t.symbolName === "return")).toBe(false);

    // Should include function calls
    expect(refs.some((t) => t.symbolName === "fetchData")).toBe(true);
  });
});

describe("computeSymbolRanks", () => {
  it("should rank symbols by reference frequency", () => {
    const tags: SymbolTag[] = [
      // Define two functions in different files
      {
        filePath: "a.ts",
        symbolName: "helper",
        kind: "def",
        line: 1,
        signature: "function helper()",
      },
      { filePath: "b.ts", symbolName: "util", kind: "def", line: 1, signature: "function util()" },

      // File c references helper multiple times
      { filePath: "c.ts", symbolName: "helper", kind: "ref", line: -1 },
      { filePath: "c.ts", symbolName: "helper", kind: "ref", line: -1 },
      { filePath: "c.ts", symbolName: "helper", kind: "ref", line: -1 },

      // File d references util once
      { filePath: "d.ts", symbolName: "util", kind: "ref", line: -1 },
    ];

    const ranked = computeSymbolRanks(tags);

    expect(ranked.length).toBe(2);
    // helper should rank higher due to more references
    expect(ranked[0].symbolName).toBe("helper");
    expect(ranked[1].symbolName).toBe("util");
  });

  it("should boost symbols mentioned in options", () => {
    const tags: SymbolTag[] = [
      {
        filePath: "a.ts",
        symbolName: "common",
        kind: "def",
        line: 1,
        signature: "function common()",
      },
      { filePath: "b.ts", symbolName: "rare", kind: "def", line: 1, signature: "function rare()" },
      { filePath: "c.ts", symbolName: "common", kind: "ref", line: -1 },
      { filePath: "c.ts", symbolName: "rare", kind: "ref", line: -1 },
    ];

    const ranked = computeSymbolRanks(tags, {
      mentionedIdents: ["rare"],
    });

    // "rare" should rank higher despite equal reference count
    expect(ranked[0].symbolName).toBe("rare");
  });

  it("should boost symbols from chat files", () => {
    const tags: SymbolTag[] = [
      {
        filePath: "chat.ts",
        symbolName: "chatFunc",
        kind: "def",
        line: 1,
        signature: "function chatFunc()",
      },
      {
        filePath: "other.ts",
        symbolName: "otherFunc",
        kind: "def",
        line: 1,
        signature: "function otherFunc()",
      },
      { filePath: "user.ts", symbolName: "chatFunc", kind: "ref", line: -1 },
      { filePath: "user.ts", symbolName: "otherFunc", kind: "ref", line: -1 },
    ];

    const ranked = computeSymbolRanks(tags, {
      chatFiles: ["chat.ts"],
    });

    // chatFunc should rank higher due to chat file boost
    expect(ranked[0].symbolName).toBe("chatFunc");
  });

  it("should penalize private symbols", () => {
    const tags: SymbolTag[] = [
      {
        filePath: "a.ts",
        symbolName: "_private",
        kind: "def",
        line: 1,
        signature: "function _private()",
      },
      {
        filePath: "b.ts",
        symbolName: "public",
        kind: "def",
        line: 1,
        signature: "function public()",
      },
      { filePath: "c.ts", symbolName: "_private", kind: "ref", line: -1 },
      { filePath: "c.ts", symbolName: "public", kind: "ref", line: -1 },
    ];

    const ranked = computeSymbolRanks(tags);

    // public should rank higher than _private
    expect(ranked[0].symbolName).toBe("public");
    expect(ranked[1].symbolName).toBe("_private");
  });

  it("should boost symbols with conventional naming", () => {
    const tags: SymbolTag[] = [
      {
        filePath: "a.ts",
        symbolName: "long_snake_case_name",
        kind: "def",
        line: 1,
        signature: "const long_snake_case_name",
      },
      {
        filePath: "b.ts",
        symbolName: "LongCamelCaseName",
        kind: "def",
        line: 1,
        signature: "class LongCamelCaseName",
      },
      { filePath: "c.ts", symbolName: "x", kind: "def", line: 1, signature: "const x" },
      { filePath: "d.ts", symbolName: "long_snake_case_name", kind: "ref", line: -1 },
      { filePath: "d.ts", symbolName: "LongCamelCaseName", kind: "ref", line: -1 },
      { filePath: "d.ts", symbolName: "x", kind: "ref", line: -1 },
    ];

    const ranked = computeSymbolRanks(tags);

    // Long conventional names should rank higher than short names
    const topTwo = ranked.slice(0, 2).map((r) => r.symbolName);
    expect(topTwo).toContain("long_snake_case_name");
    expect(topTwo).toContain("LongCamelCaseName");
    expect(ranked[2].symbolName).toBe("x");
  });

  it("should penalize widely-defined symbols", () => {
    const tags: SymbolTag[] = [
      // "common" defined in 6 files
      { filePath: "a.ts", symbolName: "common", kind: "def", line: 1, signature: "const common" },
      { filePath: "b.ts", symbolName: "common", kind: "def", line: 1, signature: "const common" },
      { filePath: "c.ts", symbolName: "common", kind: "def", line: 1, signature: "const common" },
      { filePath: "d.ts", symbolName: "common", kind: "def", line: 1, signature: "const common" },
      { filePath: "e.ts", symbolName: "common", kind: "def", line: 1, signature: "const common" },
      { filePath: "f.ts", symbolName: "common", kind: "def", line: 1, signature: "const common" },

      // "unique" defined in 1 file
      { filePath: "g.ts", symbolName: "unique", kind: "def", line: 1, signature: "const unique" },

      // Both referenced once
      { filePath: "user.ts", symbolName: "common", kind: "ref", line: -1 },
      { filePath: "user.ts", symbolName: "unique", kind: "ref", line: -1 },
    ];

    const ranked = computeSymbolRanks(tags);

    // unique should rank higher than common
    expect(ranked[0].symbolName).toBe("unique");
  });

  it("should handle files with no references gracefully", () => {
    const tags: SymbolTag[] = [
      {
        filePath: "isolated.ts",
        symbolName: "unused",
        kind: "def",
        line: 1,
        signature: "function unused()",
      },
    ];

    const ranked = computeSymbolRanks(tags);

    // When there are no ref tags at all, the system uses defines as references
    // This creates self-referencing edges, so symbols should appear
    expect(ranked.length).toBeGreaterThanOrEqual(1);
    if (ranked.length > 0) {
      expect(ranked[0].symbolName).toBe("unused");
      expect(ranked[0].rank).toBeGreaterThan(0);
    }
  });
});

describe("formatRepoMapContext", () => {
  it("should format ranked symbols grouped by file", () => {
    const ranked = [
      { filePath: "a.ts", symbolName: "foo", rank: 1.0, line: 5, signature: "function foo()" },
      { filePath: "a.ts", symbolName: "bar", rank: 0.8, line: 10, signature: "function bar()" },
      { filePath: "b.ts", symbolName: "baz", rank: 0.6, line: 3, signature: "class baz" },
    ];

    const output = formatRepoMapContext(ranked, [], 1000);

    expect(output).toContain("# Repository Map");
    expect(output).toContain("## a.ts");
    expect(output).toContain("function foo():5");
    expect(output).toContain("function bar():10");
    expect(output).toContain("## b.ts");
    expect(output).toContain("class baz:3");
  });

  it("should exclude chat files from output", () => {
    const ranked = [
      {
        filePath: "chat.ts",
        symbolName: "chatFunc",
        rank: 1.0,
        line: 1,
        signature: "function chatFunc()",
      },
      {
        filePath: "other.ts",
        symbolName: "otherFunc",
        rank: 0.9,
        line: 1,
        signature: "function otherFunc()",
      },
    ];

    const output = formatRepoMapContext(ranked, ["chat.ts"], 1000);

    expect(output).not.toContain("chat.ts");
    expect(output).toContain("other.ts");
  });

  it("should respect token budget", () => {
    const ranked = Array.from({ length: 100 }, (_, i) => ({
      filePath: `file${i}.ts`,
      symbolName: `symbol${i}`,
      rank: 1.0 - i * 0.01,
      line: i + 1,
      signature: `function symbol${i}()`,
    }));

    const smallBudget = formatRepoMapContext(ranked, [], 200);
    const largeBudget = formatRepoMapContext(ranked, [], 2000);

    expect(smallBudget.length).toBeLessThan(largeBudget.length);
    expect(smallBudget.length).toBeLessThanOrEqual(200 * 4); // ~4 chars per token
  });

  it("should handle symbols with no line numbers", () => {
    const ranked = [
      { filePath: "a.ts", symbolName: "noLine", rank: 1.0, line: -1, signature: "const noLine" },
    ];

    const output = formatRepoMapContext(ranked, [], 1000);

    expect(output).toContain("const noLine");
    expect(output).not.toContain(":-1");
  });
});

describe("buildPageRankRepoMap", () => {
  let testDir: string;
  let treeSitter: RepoMapTreeSitter;

  beforeEach(async () => {
    testDir = join(tmpdir(), `dante-repo-map-${Date.now()}`);
    await mkdir(testDir, { recursive: true });
    treeSitter = new RepoMapTreeSitter();
  });

  it("should build a complete repo map for multiple files", async () => {
    // Create a mini project
    const fileA = `
export function helperA() {
  return 42;
}
`;

    const fileB = `
import { helperA } from './a';

export function mainFunc() {
  const result = helperA();
  return result * 2;
}
`;

    await writeFile(join(testDir, "a.ts"), fileA);
    await writeFile(join(testDir, "b.ts"), fileB);

    const context: RepoMapContext = {
      projectRoot: testDir,
      files: ["a.ts", "b.ts"],
      treeSitter,
    };

    const map = await buildPageRankRepoMap(context, { maxTokens: 1000 });

    expect(map).toContain("# Repository Map");
    // helperA is referenced, so it should appear
    expect(map).toContain("helperA");
    // mainFunc might not appear if it's not referenced externally
    // In a minimal 2-file example, PageRank favors referenced symbols
    expect(map.length).toBeGreaterThan(50); // Should have some content
  });

  it("should prioritize chat files in ranking", async () => {
    const fileA = `export function chatFunc() {}`;
    const fileB = `export function otherFunc() {}`;
    const fileC = `
import { chatFunc } from './a';
import { otherFunc } from './b';

chatFunc();
otherFunc();
`;

    await writeFile(join(testDir, "a.ts"), fileA);
    await writeFile(join(testDir, "b.ts"), fileB);
    await writeFile(join(testDir, "c.ts"), fileC);

    const context: RepoMapContext = {
      projectRoot: testDir,
      files: ["a.ts", "b.ts", "c.ts"],
      treeSitter,
    };

    const map = await buildPageRankRepoMap(context, {
      chatFiles: ["a.ts"],
      maxTokens: 1000,
    });

    // Chat files are excluded from output (they're already in context)
    // So we should see otherFunc but not chatFunc
    expect(map).not.toContain("a.ts"); // Chat file excluded
    expect(map).toContain("b.ts"); // Other file included
    expect(map).toContain("otherFunc");
  });

  it("should handle missing files gracefully", async () => {
    await writeFile(join(testDir, "exists.ts"), "export const x = 1;");

    const context: RepoMapContext = {
      projectRoot: testDir,
      files: ["exists.ts", "missing.ts"],
      treeSitter,
    };

    const map = await buildPageRankRepoMap(context, { maxTokens: 1000 });

    // With a very minimal file, it should still appear if it has any symbols
    // The map might be empty if the token budget is too tight
    expect(map).toContain("# Repository Map");
    // exists.ts might or might not appear depending on PageRank convergence
    // Just verify missing.ts doesn't crash
    expect(map).not.toContain("missing.ts");
  });
});

describe("getRelevantContext", () => {
  let testDir: string;
  let treeSitter: RepoMapTreeSitter;

  beforeEach(async () => {
    testDir = join(tmpdir(), `dante-repo-map-${Date.now()}`);
    await mkdir(testDir, { recursive: true });
    treeSitter = new RepoMapTreeSitter();
  });

  it("should boost symbols matching query terms", async () => {
    const fileA = `export function userAuthentication() {}`;
    const fileB = `export function dataProcessor() {}`;
    const fileC = `
import { userAuthentication } from './a';
import { dataProcessor } from './b';

userAuthentication();
dataProcessor();
`;

    await writeFile(join(testDir, "a.ts"), fileA);
    await writeFile(join(testDir, "b.ts"), fileB);
    await writeFile(join(testDir, "c.ts"), fileC);

    const context: RepoMapContext = {
      projectRoot: testDir,
      files: ["a.ts", "b.ts", "c.ts"],
      treeSitter,
    };

    const map = await getRelevantContext(context, "authentication login user", {
      maxTokens: 500,
    });

    const authPos = map.indexOf("userAuthentication");
    const dataPos = map.indexOf("dataProcessor");

    // userAuthentication should appear before dataProcessor due to query match
    expect(authPos).toBeGreaterThan(0);
    expect(authPos).toBeLessThan(dataPos);
  });
});
