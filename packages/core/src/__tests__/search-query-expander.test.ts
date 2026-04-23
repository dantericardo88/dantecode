// packages/core/src/__tests__/search-query-expander.test.ts
import { describe, it, expect } from "vitest";
import {
  splitIdentifier,
  tokenizeQuery,
  expandQuery,
  rerankCodeResults,
  extractPrimarySymbol,
  formatSearchResultsForPrompt,
  type CodeSearchResult,
} from "../search-query-expander.js";

// ─── splitIdentifier ──────────────────────────────────────────────────────────

describe("splitIdentifier", () => {
  it("splits camelCase", () => {
    expect(splitIdentifier("getUserById")).toEqual(["get", "user", "by", "id"]);
  });

  it("splits PascalCase", () => {
    expect(splitIdentifier("ParseGitLog")).toEqual(["parse", "git", "log"]);
  });

  it("splits snake_case", () => {
    expect(splitIdentifier("parse_git_log")).toEqual(["parse", "git", "log"]);
  });

  it("splits SCREAMING_CASE", () => {
    expect(splitIdentifier("HTTP_TIMEOUT")).toEqual(["http", "timeout"]);
  });

  it("splits kebab-case", () => {
    expect(splitIdentifier("fetch-data")).toEqual(["fetch", "data"]);
  });

  it("handles ABCPrefix (consecutive uppercase)", () => {
    const tokens = splitIdentifier("XMLParser");
    expect(tokens).toContain("xml");
    expect(tokens).toContain("parser");
  });

  it("filters single-char tokens", () => {
    expect(splitIdentifier("x")).toEqual([]);
    expect(splitIdentifier("aB")).toEqual([]);
  });

  it("handles plain lowercase word", () => {
    expect(splitIdentifier("helper")).toEqual(["helper"]);
  });
});

// ─── tokenizeQuery ────────────────────────────────────────────────────────────

describe("tokenizeQuery", () => {
  it("lowercases and splits", () => {
    const tokens = tokenizeQuery("Parse Git log output");
    expect(tokens).toContain("parse");
    expect(tokens).toContain("git");
    expect(tokens).toContain("log");
    expect(tokens).toContain("output");
  });

  it("removes stop words", () => {
    const tokens = tokenizeQuery("how to get the user by id");
    expect(tokens).not.toContain("the");
    expect(tokens).not.toContain("to");
    expect(tokens).not.toContain("how");
    expect(tokens).toContain("user");
  });

  it("deduplicates tokens", () => {
    const tokens = tokenizeQuery("user user user");
    expect(tokens.filter((t) => t === "user")).toHaveLength(1);
  });

  it("splits on non-alphanumeric characters", () => {
    const tokens = tokenizeQuery("parse-json/data");
    expect(tokens).toContain("parse");
    expect(tokens).toContain("json");
    expect(tokens).toContain("data");
  });

  it("filters 1-char tokens", () => {
    const tokens = tokenizeQuery("a b c dog");
    expect(tokens).not.toContain("a");
    expect(tokens).not.toContain("b");
    expect(tokens).not.toContain("c");
    expect(tokens).toContain("dog");
  });
});

// ─── expandQuery ──────────────────────────────────────────────────────────────

describe("expandQuery", () => {
  it("returns original query", () => {
    const result = expandQuery("parse git log");
    expect(result.original).toBe("parse git log");
  });

  it("includes camelCase variant", () => {
    const result = expandQuery("parse git log");
    const camelVar = result.symbolVariants.find((v) => v.includes("Git"));
    expect(camelVar).toBeDefined();
  });

  it("includes snake_case variant", () => {
    const result = expandQuery("parse git log");
    expect(result.symbolVariants).toContain("parse_git_log");
  });

  it("includes PascalCase variant", () => {
    const result = expandQuery("parse git log");
    expect(result.symbolVariants).toContain("ParseGitLog");
  });

  it("allTerms contains both tokens and variants", () => {
    const result = expandQuery("parse git log");
    expect(result.allTerms).toContain("parse");
    expect(result.allTerms.some((t) => t.includes("Git") || t.includes("git"))).toBe(true);
  });

  it("deduplicates allTerms", () => {
    const result = expandQuery("foo foo bar");
    const countFoo = result.allTerms.filter((t) => t === "foo").length;
    expect(countFoo).toBeLessThanOrEqual(1);
  });

  it("handles single-word query", () => {
    const result = expandQuery("authenticate");
    expect(result.tokens).toContain("authenticate");
    // With only one token, no multi-token variants should be generated
    expect(result.symbolVariants.length).toBe(0);
  });
});

// ─── rerankCodeResults ────────────────────────────────────────────────────────

describe("rerankCodeResults", () => {
  function makeResult(overrides: Partial<CodeSearchResult>): CodeSearchResult {
    return {
      filePath: "src/index.ts",
      content: "some content here",
      retrievalScore: 1.0,
      ...overrides,
    };
  }

  it("returns results sorted by score descending", () => {
    const results = [
      makeResult({ retrievalScore: 0.3, filePath: "low.ts" }),
      makeResult({ retrievalScore: 0.9, symbolName: "parseGitLog", filePath: "parser.ts" }),
    ];
    const reranked = rerankCodeResults(results, { query: "parse git log" });
    expect(reranked[0]!.filePath).toBe("parser.ts");
  });

  it("boosts results with matching symbol name", () => {
    const exact = makeResult({ symbolName: "parseGitLog", retrievalScore: 0.5 });
    const noSymbol = makeResult({ symbolName: "unrelated", retrievalScore: 0.8 });
    const results = rerankCodeResults([exact, noSymbol], { query: "parse git log" });
    // Exact symbol match should pull it up
    const exactIdx = results.findIndex((r) => r.symbolName === "parseGitLog");
    const noSymIdx = results.findIndex((r) => r.symbolName === "unrelated");
    expect(exactIdx).toBeLessThan(noSymIdx);
  });

  it("boosts results with matching filename", () => {
    const matching = makeResult({ filePath: "src/git-parser.ts", retrievalScore: 0.5 });
    const nonMatching = makeResult({ filePath: "src/unrelated.ts", retrievalScore: 0.8 });
    const results = rerankCodeResults([matching, nonMatching], { query: "git parser" });
    const matchIdx = results.findIndex((r) => r.filePath.includes("git-parser"));
    const noMatchIdx = results.findIndex((r) => r.filePath.includes("unrelated"));
    expect(matchIdx).toBeLessThan(noMatchIdx);
  });

  it("penalizes very short content", () => {
    const short = makeResult({ content: "fn x()", retrievalScore: 1.0 });
    const longer = makeResult({ content: "function parseGitLog(raw: string) { /* lots of code */ return results; }", retrievalScore: 1.0 });
    const results = rerankCodeResults([short, longer], { query: "parse" });
    const longerIdx = results.findIndex((r) => r.content.length > 50);
    const shortIdx = results.findIndex((r) => r.content === "fn x()");
    expect(longerIdx).toBeLessThanOrEqual(shortIdx);
  });

  it("boosts recent files", () => {
    const recent = makeResult({ lastModifiedMs: Date.now() - 60_000, retrievalScore: 0.5 });
    const old = makeResult({ lastModifiedMs: Date.now() - 30 * 24 * 60 * 60 * 1000, retrievalScore: 0.9 });
    const results = rerankCodeResults([recent, old], { query: "function" });
    const recentIdx = results.findIndex((r) => r.lastModifiedMs === recent.lastModifiedMs);
    const oldIdx = results.findIndex((r) => r.lastModifiedMs === old.lastModifiedMs);
    // Recency boost should compensate
    expect(recentIdx).toBeLessThanOrEqual(oldIdx);
  });

  it("returns empty array for empty input", () => {
    expect(rerankCodeResults([], { query: "test" })).toEqual([]);
  });

  it("preserves all result entries", () => {
    const results = [makeResult({ filePath: "a.ts" }), makeResult({ filePath: "b.ts" })];
    const reranked = rerankCodeResults(results, { query: "x" });
    expect(reranked).toHaveLength(2);
  });

  it("applies term frequency boost from content", () => {
    const many = makeResult({ content: "parse parse parse git git log log foo", retrievalScore: 0.5 });
    const few = makeResult({ content: "something else entirely different", retrievalScore: 0.5 });
    const results = rerankCodeResults([many, few], { query: "parse git log" });
    expect(results[0]!.content).toBe(many.content);
  });
});

// ─── extractPrimarySymbol ─────────────────────────────────────────────────────

describe("extractPrimarySymbol", () => {
  it("extracts function declaration", () => {
    const content = `export function parseGitLog(raw: string): Change[] {\n  return [];\n}`;
    const sym = extractPrimarySymbol(content, "src/git.ts");
    expect(sym?.name).toBe("parseGitLog");
    expect(sym?.kind).toBe("function");
  });

  it("extracts class declaration", () => {
    const content = `export class GitContextProvider {\n  constructor() {}\n}`;
    const sym = extractPrimarySymbol(content, "src/git.ts");
    expect(sym?.name).toBe("GitContextProvider");
    expect(sym?.kind).toBe("class");
  });

  it("extracts interface declaration", () => {
    const content = `export interface BlameEntry {\n  commit: string;\n}`;
    const sym = extractPrimarySymbol(content, "src/types.ts");
    expect(sym?.name).toBe("BlameEntry");
    expect(sym?.kind).toBe("interface");
  });

  it("extracts type alias", () => {
    const content = `export type TestRunner = "vitest" | "jest";`;
    const sym = extractPrimarySymbol(content, "src/types.ts");
    expect(sym?.name).toBe("TestRunner");
    expect(sym?.kind).toBe("type");
  });

  it("extracts const arrow function (as variable or function)", () => {
    const content = `export const buildQuery = (q: string) => {\n  return q;\n};`;
    const sym = extractPrimarySymbol(content, "src/query.ts");
    expect(sym?.name).toBe("buildQuery");
    // Arrow functions in const are classified as variable or function
    expect(["function", "variable"]).toContain(sym?.kind);
  });

  it("extracts JSDoc as docstring", () => {
    const content = `/**\n * Parse git blame output.\n */\nexport function parsePorcelain(raw: string) {}`;
    const sym = extractPrimarySymbol(content, "src/git.ts");
    expect(sym?.docstring).toContain("Parse git blame output");
  });

  it("returns null for empty content", () => {
    expect(extractPrimarySymbol("", "empty.ts")).toBeNull();
  });

  it("returns null for non-exportable content", () => {
    const content = `const x = 1;\nconst y = 2;`;
    const sym = extractPrimarySymbol(content, "src/x.ts");
    // May return variable or null depending on the 'const' match
    if (sym) {
      expect(sym.kind).toBe("variable");
    } else {
      expect(sym).toBeNull();
    }
  });

  it("includes filePath in result", () => {
    const content = `export function foo() {}`;
    const sym = extractPrimarySymbol(content, "src/foo.ts");
    expect(sym?.filePath).toBe("src/foo.ts");
  });
});

// ─── formatSearchResultsForPrompt ────────────────────────────────────────────

describe("formatSearchResultsForPrompt", () => {
  function makeResult(overrides: Partial<CodeSearchResult>): CodeSearchResult {
    return {
      filePath: "src/utils.ts",
      content: "export function helper() {}",
      retrievalScore: 0.9,
      ...overrides,
    };
  }

  it("includes search header", () => {
    const output = formatSearchResultsForPrompt([makeResult({})], "parse git log");
    expect(output).toContain('Search: "parse git log"');
  });

  it("shows no results message when empty", () => {
    const output = formatSearchResultsForPrompt([], "test query");
    expect(output).toContain("No results found");
  });

  it("shows file path in results", () => {
    const output = formatSearchResultsForPrompt([makeResult({ filePath: "src/git.ts" })], "git");
    expect(output).toContain("src/git.ts");
  });

  it("shows symbol name when present", () => {
    const output = formatSearchResultsForPrompt([makeResult({ symbolName: "parseLog" })], "parse");
    expect(output).toContain("parseLog");
  });

  it("limits to maxResults", () => {
    const results = Array.from({ length: 10 }, (_, i) => makeResult({ filePath: `src/${i}.ts` }));
    const output = formatSearchResultsForPrompt(results, "test", 3);
    const count = (output.match(/^\*\*\d+\./gm) ?? []).length;
    expect(count).toBe(3);
  });

  it("truncates long content", () => {
    const longContent = "x".repeat(2000);
    const output = formatSearchResultsForPrompt([makeResult({ content: longContent })], "test", 1, 100);
    expect(output).toContain("truncated");
  });

  it("shows retrieval score", () => {
    const output = formatSearchResultsForPrompt([makeResult({ retrievalScore: 1.5 })], "test");
    expect(output).toContain("1.50");
  });

  it("shows line number when present", () => {
    const output = formatSearchResultsForPrompt([makeResult({ startLine: 42 })], "test");
    expect(output).toContain(":42");
  });
});
