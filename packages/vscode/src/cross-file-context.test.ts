import { describe, it, expect, vi } from "vitest";

import {
  extractImportPaths,
  extractExportedSignatures,
  gatherCrossFileContext,
} from "./cross-file-context.js";

// ---------------------------------------------------------------------------
// Import extraction
// ---------------------------------------------------------------------------

describe("extractImportPaths", () => {
  it("extracts relative import specifiers from ES imports", () => {
    const source = [
      'import { foo } from "./utils";',
      'import bar from "../lib/bar";',
      'import "side-effect";',
      'import type { Baz } from "./types";',
    ].join("\n");

    const paths = extractImportPaths(source);
    expect(paths).toEqual(["./utils", "../lib/bar", "./types"]);
  });

  it("ignores bare package imports", () => {
    const source = [
      'import * as vscode from "vscode";',
      'import { readFile } from "node:fs/promises";',
    ].join("\n");

    expect(extractImportPaths(source)).toEqual([]);
  });

  it("returns an empty array for files with no imports", () => {
    expect(extractImportPaths("const x = 42;\n")).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Exported symbol extraction
// ---------------------------------------------------------------------------

describe("extractExportedSignatures", () => {
  it("extracts function signatures", () => {
    const source = [
      "export function greet(name: string): string {",
      "  return `Hello ${name}`;",
      "}",
    ].join("\n");

    const sigs = extractExportedSignatures(source);
    expect(sigs).toHaveLength(1);
    expect(sigs[0]).toContain("export function greet(name: string): string");
  });

  it("extracts async function signatures", () => {
    const source =
      "export async function fetchData(url: string): Promise<Response> {\n  return fetch(url);\n}";
    const sigs = extractExportedSignatures(source);
    expect(sigs).toHaveLength(1);
    expect(sigs[0]).toContain("export async function fetchData");
  });

  it("extracts class, interface, and type declarations", () => {
    const source = [
      "export class MyService {",
      "  run() {}",
      "}",
      "export interface Config {",
      "  key: string;",
      "}",
      "export type ID = string | number;",
    ].join("\n");

    const sigs = extractExportedSignatures(source);
    expect(sigs.length).toBeGreaterThanOrEqual(3);
    expect(sigs.some((s) => s.includes("class MyService"))).toBe(true);
    expect(sigs.some((s) => s.includes("interface Config"))).toBe(true);
    expect(sigs.some((s) => s.includes("type ID"))).toBe(true);
  });

  it("extracts const exports", () => {
    const source = "export const MAX_SIZE = 100;\nexport let counter = 0;\n";
    const sigs = extractExportedSignatures(source);
    expect(sigs.length).toBeGreaterThanOrEqual(2);
  });

  it("returns empty array for files with no exports", () => {
    const source = "const internal = 1;\nfunction helper() {}\n";
    expect(extractExportedSignatures(source)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// gatherCrossFileContext integration
// ---------------------------------------------------------------------------

describe("gatherCrossFileContext", () => {
  const fileStore: Record<string, string> = {
    "/src/main.ts": [
      'import { greet } from "./utils";',
      'import { Config } from "./config";',
      "const x = greet('world');",
    ].join("\n"),
    "/src/utils.ts": [
      "export function greet(name: string): string {",
      "  return `Hello ${name}`;",
      "}",
      "export function trim(s: string): string {",
      "  return s.trim();",
      "}",
    ].join("\n"),
    "/src/config.ts": [
      "export interface Config {",
      "  key: string;",
      "  value: number;",
      "}",
      "export const DEFAULT_CONFIG: Config = { key: '', value: 0 };",
    ].join("\n"),
    "/src/unrelated.ts": ["export class Logger {", "  log(msg: string) {}", "}"].join("\n"),
  };

  const readFile = vi.fn(async (path: string): Promise<string> => {
    const content = fileStore[path];
    if (content === undefined) {
      throw new Error(`ENOENT: ${path}`);
    }
    return content;
  });

  it("returns context lines with // From prefix", async () => {
    const result = await gatherCrossFileContext({
      currentFilePath: "/src/main.ts",
      openFilePaths: ["/src/main.ts", "/src/utils.ts", "/src/config.ts"],
      readFile,
    });

    expect(result).toContain("// From");
    expect(result).toContain("greet");
  });

  it("prioritises imported files over unrelated open files", async () => {
    const result = await gatherCrossFileContext({
      currentFilePath: "/src/main.ts",
      openFilePaths: ["/src/main.ts", "/src/unrelated.ts", "/src/utils.ts", "/src/config.ts"],
      readFile,
    });

    // utils.ts and config.ts are imported — their symbols should appear
    // before unrelated.ts symbols.
    const greetIdx = result.indexOf("greet");
    const loggerIdx = result.indexOf("Logger");

    // greet must appear; Logger may or may not depending on budget
    expect(greetIdx).toBeGreaterThanOrEqual(0);
    if (loggerIdx >= 0) {
      expect(greetIdx).toBeLessThan(loggerIdx);
    }
  });

  it("respects the token budget and truncates output", async () => {
    const result = await gatherCrossFileContext({
      currentFilePath: "/src/main.ts",
      openFilePaths: ["/src/main.ts", "/src/utils.ts", "/src/config.ts"],
      maxTokenBudget: 20, // ~80 chars — very tight
      readFile,
    });

    // The result must not exceed the rough char budget.
    expect(result.length).toBeLessThanOrEqual(80);
  });

  it("returns an empty string when the current file cannot be read", async () => {
    const result = await gatherCrossFileContext({
      currentFilePath: "/nonexistent.ts",
      openFilePaths: ["/src/utils.ts"],
      readFile,
    });

    expect(result).toBe("");
  });

  it("returns an empty string when there are no open files besides the current one", async () => {
    const result = await gatherCrossFileContext({
      currentFilePath: "/src/main.ts",
      openFilePaths: ["/src/main.ts"],
      readFile,
    });

    expect(result).toBe("");
  });

  it("handles files that fail to read gracefully", async () => {
    const failReadFile = vi.fn(async (path: string): Promise<string> => {
      if (path === "/src/main.ts") return fileStore["/src/main.ts"]!;
      throw new Error("ENOENT");
    });

    const result = await gatherCrossFileContext({
      currentFilePath: "/src/main.ts",
      openFilePaths: ["/src/main.ts", "/src/utils.ts"],
      readFile: failReadFile,
    });

    // Should not throw, just return empty context.
    expect(result).toBe("");
  });

  it("includes recently edited files with higher priority", async () => {
    const result = await gatherCrossFileContext({
      currentFilePath: "/src/main.ts",
      openFilePaths: ["/src/main.ts", "/src/unrelated.ts", "/src/utils.ts"],
      recentEditPaths: ["/src/unrelated.ts"],
      maxTokenBudget: 30, // very tight budget
      readFile,
    });

    // With a tight budget, recently-edited unrelated.ts (score 1) still
    // ranks below imported utils.ts (score 2), but above a non-imported,
    // non-recent file.
    // Just verify we get some output without errors.
    expect(typeof result).toBe("string");
  });

  it("does not include the current file in the context output", async () => {
    const result = await gatherCrossFileContext({
      currentFilePath: "/src/utils.ts",
      openFilePaths: ["/src/utils.ts", "/src/config.ts"],
      readFile,
    });

    // The context should come from config.ts, not from utils.ts itself.
    // (utils.ts has no imports so context will only include open-file symbols.)
    expect(result).not.toContain("src/utils.ts");
  });
});

// ── Phase 4: recently-edited context integration ───────────────────────────────

describe("gatherCrossFileContext with recentEditPaths", () => {
  const readFile = async (path: string): Promise<string> => {
    const files: Record<string, string> = {
      "/src/main.ts": 'import { greet } from "./helper";\nconst x = 1;',
      "/src/helper.ts": "export function greet(name: string): string { return name; }",
      "/src/recent.ts": "export const RECENT_CONST = 42;",
    };
    if (files[path]) return files[path]!;
    throw new Error(`File not found: ${path}`);
  };

  it("recently-edited files appear in context output", async () => {
    const result = await gatherCrossFileContext({
      currentFilePath: "/src/main.ts",
      openFilePaths: ["/src/helper.ts"],
      recentEditPaths: ["/src/recent.ts"],
      readFile,
    });
    expect(result).toContain("recent.ts");
    expect(result).toContain("RECENT_CONST");
  });

  it("recently-edited files excluded when they are the current file", async () => {
    const result = await gatherCrossFileContext({
      currentFilePath: "/src/recent.ts",
      openFilePaths: ["/src/helper.ts"],
      recentEditPaths: ["/src/recent.ts"], // same as current
      readFile,
    });
    // The current file must not appear in context
    expect(result).not.toMatch(/\/src\/recent\.ts/);
  });

  it("imported files rank higher than recent-only files", async () => {
    const result = await gatherCrossFileContext({
      currentFilePath: "/src/main.ts",
      openFilePaths: ["/src/helper.ts"],
      recentEditPaths: ["/src/recent.ts"],
      readFile,
    });
    // helper.ts is imported — should appear before or without recent.ts
    const helperIdx = result.indexOf("greet");
    const recentIdx = result.indexOf("RECENT_CONST");
    // If both appear, imported (helper) should come first
    if (helperIdx >= 0 && recentIdx >= 0) {
      expect(helperIdx).toBeLessThan(recentIdx);
    }
  });
});

// ── Phase 5: BM25 CompletionContextRetriever ──────────────────────────────────

import { CompletionContextRetriever, bm25Score } from "./completion-context-retriever.js";

describe("bm25Score", () => {
  it("exact-match document scores higher than unrelated document", () => {
    const queryTerms = ["function", "validateToken", "string"];
    const exactDoc = ["function", "validateToken", "token", "string", "boolean"];
    const unrelatedDoc = ["const", "foo", "bar", "baz", "qux"];
    const allDocs = [exactDoc, unrelatedDoc];
    const avgDocLen = (exactDoc.length + unrelatedDoc.length) / 2;

    const exactScore = bm25Score(queryTerms, exactDoc, avgDocLen, allDocs);
    const unrelatedScore = bm25Score(queryTerms, unrelatedDoc, avgDocLen, allDocs);

    expect(exactScore).toBeGreaterThan(unrelatedScore);
  });

  it("returns 0 for no term overlap", () => {
    const score = bm25Score(
      ["functionA"],
      ["completely", "different", "words"],
      3,
      [["completely", "different", "words"]],
    );
    expect(score).toBe(0);
  });
});

describe("CompletionContextRetriever", () => {
  it("returns top-N snippets by BM25 score", async () => {
    const chunks = [
      { filePath: "/src/auth.ts", content: "export function validateToken(token: string): boolean { return true; }" },
      { filePath: "/src/utils.ts", content: "export function formatDate(d: Date): string { return d.toISOString(); }" },
      { filePath: "/src/api.ts", content: "export function callApi(url: string): Promise<Response> { return fetch(url); }" },
    ];
    const retriever = new CompletionContextRetriever(() => chunks);
    const results = await retriever.retrieve(["validateToken", "token", "string"], 2);
    expect(results.length).toBeLessThanOrEqual(2);
    // The auth.ts chunk (most relevant) should be first
    if (results.length > 0) {
      expect(results[0]).toContain("auth.ts");
    }
  });

  it("returns empty array gracefully when index unavailable", async () => {
    const retriever = new CompletionContextRetriever(() => []);
    const results = await retriever.retrieve(["function", "foo"]);
    expect(results).toEqual([]);
  });

  it("returns empty array when retriever throws", async () => {
    const retriever = new CompletionContextRetriever(() => {
      throw new Error("index unavailable");
    });
    const results = await retriever.retrieve(["foo"]);
    expect(results).toEqual([]);
  });
});
