import { describe, expect, it } from "vitest";
import {
  extractSymbolDefinitions,
  extractImports,
  computeFileScores,
  formatRepoMap,
  type RankedFile,
  type ImportEdge,
} from "./repo-map-ast.js";

describe("repo-map-ast", () => {
  describe("extractSymbolDefinitions", () => {
    it("extracts function definitions", () => {
      const code = `export function authenticate(user: string): boolean {\n  return true;\n}`;
      const symbols = extractSymbolDefinitions(code, "auth.ts");
      expect(symbols.some((s) => s.name === "authenticate" && s.kind === "function")).toBe(true);
    });

    it("extracts async functions", () => {
      const code = `export async function fetchData(url: string): Promise<Response> {\n  return fetch(url);\n}`;
      const symbols = extractSymbolDefinitions(code, "api.ts");
      expect(symbols.some((s) => s.name === "fetchData" && s.kind === "function")).toBe(true);
    });

    it("extracts class definitions", () => {
      const code = `export class UserService {\n  getUser() {}\n}`;
      const symbols = extractSymbolDefinitions(code, "service.ts");
      expect(symbols.some((s) => s.name === "UserService" && s.kind === "class")).toBe(true);
    });

    it("extracts abstract classes", () => {
      const code = `export abstract class BaseProvider {\n  abstract connect(): void;\n}`;
      const symbols = extractSymbolDefinitions(code, "base.ts");
      expect(symbols.some((s) => s.name === "BaseProvider" && s.kind === "class")).toBe(true);
    });

    it("extracts interface definitions", () => {
      const code = `export interface Config {\n  apiKey: string;\n}`;
      const symbols = extractSymbolDefinitions(code, "types.ts");
      expect(symbols.some((s) => s.name === "Config" && s.kind === "interface")).toBe(true);
    });

    it("extracts type aliases", () => {
      const code = `export type ModelProvider = "grok" | "anthropic" | "openai";`;
      const symbols = extractSymbolDefinitions(code, "types.ts");
      expect(symbols.some((s) => s.name === "ModelProvider" && s.kind === "type")).toBe(true);
    });

    it("extracts const declarations", () => {
      const code = `export const DEFAULT_MODEL = "grok-3";`;
      const symbols = extractSymbolDefinitions(code, "constants.ts");
      expect(symbols.some((s) => s.name === "DEFAULT_MODEL" && s.kind === "const")).toBe(true);
    });

    it("extracts enum definitions", () => {
      const code = `export enum Status {\n  Active,\n  Inactive,\n}`;
      const symbols = extractSymbolDefinitions(code, "enums.ts");
      expect(symbols.some((s) => s.name === "Status" && s.kind === "enum")).toBe(true);
    });

    it("extracts multiple symbols from a file", () => {
      const code = [
        `export function add(a: number, b: number): number { return a + b; }`,
        `export interface MathOps { add: Function; }`,
        `export class Calculator {}`,
      ].join("\n");
      const symbols = extractSymbolDefinitions(code, "math.ts");
      expect(symbols.length).toBeGreaterThanOrEqual(3);
    });

    it("returns empty for files with no definitions", () => {
      const code = `// Just a comment\n// Another comment`;
      const symbols = extractSymbolDefinitions(code, "empty.ts");
      expect(symbols).toEqual([]);
    });

    it("includes correct file path in symbols", () => {
      const code = `export function test() {}`;
      const symbols = extractSymbolDefinitions(code, "src/test.ts");
      expect(symbols[0]!.filePath).toBe("src/test.ts");
    });
  });

  describe("extractImports", () => {
    it("extracts relative ES module imports", () => {
      const code = `import { foo } from "./utils.js";`;
      const imports = extractImports(code, "src/main.ts");
      expect(imports).toHaveLength(1);
      expect(imports[0]!.to).toBe("./utils");
    });

    it("extracts relative imports without extensions", () => {
      const code = `import { Bar } from "../types";`;
      const imports = extractImports(code, "src/deep/file.ts");
      expect(imports).toHaveLength(1);
      expect(imports[0]!.to).toBe("../types");
    });

    it("ignores package imports", () => {
      const code = `import express from "express";\nimport { join } from "node:path";`;
      const imports = extractImports(code, "src/app.ts");
      expect(imports).toHaveLength(0);
    });

    it("extracts multiple imports from the same file", () => {
      const code = [
        `import { a } from "./moduleA.js";`,
        `import { b } from "./moduleB.ts";`,
        `import { c } from "./moduleC";`,
      ].join("\n");
      const imports = extractImports(code, "src/main.ts");
      expect(imports).toHaveLength(3);
    });

    it("strips /index from import paths", () => {
      const code = `import { something } from "./utils/index.js";`;
      const imports = extractImports(code, "src/main.ts");
      expect(imports[0]!.to).toBe("./utils");
    });

    it("sets 'from' to the source file path", () => {
      const code = `import { x } from "./other.js";`;
      const imports = extractImports(code, "src/caller.ts");
      expect(imports[0]!.from).toBe("src/caller.ts");
    });
  });

  describe("computeFileScores", () => {
    it("returns empty map for empty input", () => {
      const scores = computeFileScores([], []);
      expect(scores.size).toBe(0);
    });

    it("assigns equal scores when there are no import edges", () => {
      const files = ["a.ts", "b.ts", "c.ts"];
      const scores = computeFileScores([], files);
      const values = [...scores.values()];
      // All scores should be equal (uniform distribution)
      expect(values[0]).toBeCloseTo(values[1]!, 5);
      expect(values[1]).toBeCloseTo(values[2]!, 5);
    });

    it("ranks highly-imported files higher", () => {
      const files = ["core.ts", "a.ts", "b.ts", "c.ts"];
      const edges: ImportEdge[] = [
        { from: "a.ts", to: "./core" },
        { from: "b.ts", to: "./core" },
        { from: "c.ts", to: "./core" },
      ];
      const scores = computeFileScores(edges, files);

      const coreScore = scores.get("core.ts") ?? 0;
      const aScore = scores.get("a.ts") ?? 0;
      expect(coreScore).toBeGreaterThan(aScore);
    });

    it("handles circular imports", () => {
      const files = ["a.ts", "b.ts"];
      const edges: ImportEdge[] = [
        { from: "a.ts", to: "./b" },
        { from: "b.ts", to: "./a" },
      ];
      const scores = computeFileScores(edges, files);
      // Should not crash, scores should be roughly equal
      expect(scores.get("a.ts")).toBeGreaterThan(0);
      expect(scores.get("b.ts")).toBeGreaterThan(0);
    });

    it("all scores are positive", () => {
      const files = ["a.ts", "b.ts", "c.ts"];
      const edges: ImportEdge[] = [
        { from: "a.ts", to: "./b" },
        { from: "c.ts", to: "./b" },
      ];
      const scores = computeFileScores(edges, files);
      for (const score of scores.values()) {
        expect(score).toBeGreaterThan(0);
      }
      // b.ts should score highest (imported by a and c)
      expect(scores.get("b.ts")!).toBeGreaterThan(scores.get("a.ts")!);
    });
  });

  describe("formatRepoMap", () => {
    it("formats ranked files as markdown", () => {
      const files: RankedFile[] = [
        {
          filePath: "src/core.ts",
          score: 0.5,
          symbols: [
            {
              name: "process",
              kind: "function",
              signature: "export function process(data: string): Result",
              filePath: "src/core.ts",
              line: 1,
            },
          ],
        },
      ];
      const output = formatRepoMap(files);
      expect(output).toContain("src/core.ts");
      expect(output).toContain("function");
      expect(output).toContain("process");
    });

    it("respects token budget", () => {
      const files: RankedFile[] = Array.from({ length: 100 }, (_, i) => ({
        filePath: `src/file${i}.ts`,
        score: 1 - i * 0.01,
        symbols: [
          {
            name: `func${i}`,
            kind: "function" as const,
            signature: `export function func${i}(data: string): Promise<void>`,
            filePath: `src/file${i}.ts`,
            line: 1,
          },
        ],
      }));

      const output = formatRepoMap(files, 200);
      // Output should be much shorter than all 100 files
      const roughTokens = Math.ceil(output.length / 4);
      expect(roughTokens).toBeLessThanOrEqual(220); // small buffer
    });

    it("returns header for empty file list", () => {
      const output = formatRepoMap([]);
      expect(output).toContain("Repository Map");
    });

    it("includes symbols under their file heading", () => {
      const files: RankedFile[] = [
        {
          filePath: "utils.ts",
          score: 0.3,
          symbols: [
            {
              name: "helper",
              kind: "function",
              signature: "function helper()",
              filePath: "utils.ts",
              line: 1,
            },
            {
              name: "Config",
              kind: "interface",
              signature: "interface Config",
              filePath: "utils.ts",
              line: 5,
            },
          ],
        },
      ];
      const output = formatRepoMap(files);
      expect(output).toContain("utils.ts");
      expect(output).toContain("function helper");
      expect(output).toContain("interface Config");
    });
  });
});
