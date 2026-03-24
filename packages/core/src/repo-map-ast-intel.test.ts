import { describe, it, expect } from "vitest";
import {
  extractSymbolDefinitions,
  extractImports,
  computeFileScores,
} from "./repo-map-ast.js";

describe("extractSymbolDefinitions — Symbol Extraction", () => {
  it("extracts function declarations", () => {
    const code = "export function hello(name: string): void {}";
    const symbols = extractSymbolDefinitions(code, "src/hello.ts");
    expect(symbols.some((s) => s.name === "hello" && s.kind === "function")).toBe(true);
  });

  it("extracts async function declarations", () => {
    const code = "export async function fetchData(): Promise<void> {}";
    const symbols = extractSymbolDefinitions(code, "src/fetch.ts");
    expect(symbols.some((s) => s.name === "fetchData" && s.kind === "function")).toBe(true);
  });

  it("extracts class declarations", () => {
    const code = "export class AppEngine {}";
    const symbols = extractSymbolDefinitions(code, "src/engine.ts");
    expect(symbols.some((s) => s.name === "AppEngine" && s.kind === "class")).toBe(true);
  });

  it("extracts abstract classes", () => {
    const code = "export abstract class BaseService {}";
    const symbols = extractSymbolDefinitions(code, "src/base.ts");
    expect(symbols.some((s) => s.name === "BaseService" && s.kind === "class")).toBe(true);
  });

  it("extracts interface declarations", () => {
    const code = "export interface UserConfig {\n  name: string;\n}";
    const symbols = extractSymbolDefinitions(code, "src/types.ts");
    expect(symbols.some((s) => s.name === "UserConfig" && s.kind === "interface")).toBe(true);
  });

  it("extracts type aliases", () => {
    const code = "export type AppMode = 'dev' | 'prod';";
    const symbols = extractSymbolDefinitions(code, "src/types.ts");
    expect(symbols.some((s) => s.name === "AppMode" && s.kind === "type")).toBe(true);
  });

  it("extracts const declarations", () => {
    const code = "export const DEFAULT_PORT = 3000;";
    const symbols = extractSymbolDefinitions(code, "src/config.ts");
    expect(symbols.some((s) => s.name === "DEFAULT_PORT" && s.kind === "const")).toBe(true);
  });

  it("extracts enum declarations", () => {
    const code = "export enum Color { Red, Green, Blue }";
    const symbols = extractSymbolDefinitions(code, "src/enums.ts");
    expect(symbols.some((s) => s.name === "Color" && s.kind === "enum")).toBe(true);
  });

  it("records line numbers for symbols", () => {
    const code = "const x = 1;\n\nexport function second() {}\n";
    const symbols = extractSymbolDefinitions(code, "src/lines.ts");
    const fn = symbols.find((s) => s.name === "second");
    expect(fn).toBeDefined();
    expect(fn!.line).toBe(3);
  });

  it("returns empty array for empty content", () => {
    const symbols = extractSymbolDefinitions("", "empty.ts");
    expect(symbols).toEqual([]);
  });
});

describe("extractImports — Import Edge Extraction", () => {
  it("extracts relative named imports and normalizes extension", () => {
    const code = 'import { foo } from "./foo.js";';
    const edges = extractImports(code, "src/bar.ts");
    // extractImports normalizes: strips .js extension
    expect(edges.some((e) => e.from === "src/bar.ts" && e.to === "./foo")).toBe(true);
  });

  it("skips non-relative imports (npm packages)", () => {
    const code = 'import React from "react";';
    const edges = extractImports(code, "src/app.tsx");
    // Only relative imports (starting with '.') are tracked
    expect(edges).toEqual([]);
  });

  it("skips non-relative require calls", () => {
    const code = 'const fs = require("node:fs");';
    const edges = extractImports(code, "src/util.js");
    expect(edges).toEqual([]);
  });

  it("returns empty array for no imports", () => {
    const code = "const x = 1;";
    const edges = extractImports(code, "src/simple.ts");
    expect(edges).toEqual([]);
  });

  it("extracts relative require calls", () => {
    const code = 'const helper = require("./helper.js");';
    const edges = extractImports(code, "src/main.js");
    expect(edges.some((e) => e.from === "src/main.js" && e.to === "./helper")).toBe(true);
  });
});

describe("computeFileScores — PageRank-Style Scoring", () => {
  it("assigns higher scores to more-imported files", () => {
    const filePaths = ["core.ts", "util.ts", "leaf.ts"];
    const edges = [
      { from: "util.ts", to: "core.ts" },
      { from: "leaf.ts", to: "core.ts" },
      { from: "leaf.ts", to: "util.ts" },
    ];

    const scores = computeFileScores(edges, filePaths);
    expect(scores.get("core.ts")!).toBeGreaterThan(scores.get("leaf.ts")!);
  });

  it("handles empty file list", () => {
    const scores = computeFileScores([], []);
    expect(scores.size).toBe(0);
  });

  it("produces non-negative scores", () => {
    const filePaths = ["a.ts", "b.ts"];
    const edges = [{ from: "b.ts", to: "a.ts" }];

    const scores = computeFileScores(edges, filePaths);
    for (const [, score] of scores) {
      expect(score).toBeGreaterThanOrEqual(0);
    }
  });
});
