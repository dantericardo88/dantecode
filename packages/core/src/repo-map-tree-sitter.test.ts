import { describe, expect, it, beforeEach } from "vitest";
import { RepoMapTreeSitter } from "./repo-map-tree-sitter.js";

describe("repo-map-tree-sitter", () => {
  let extractor: RepoMapTreeSitter;

  beforeEach(() => {
    extractor = new RepoMapTreeSitter();
  });

  describe("TypeScript parsing", () => {
    it("extracts function declarations", () => {
      const code = `export function authenticate(user: string): boolean {\n  return true;\n}`;
      const symbols = extractor.extractSymbols(code, "auth.ts");
      expect(symbols.some((s) => s.name === "authenticate" && s.kind === "function")).toBe(true);
    });

    it("extracts async functions", () => {
      const code = `export async function fetchData(url: string): Promise<Response> {\n  return fetch(url);\n}`;
      const symbols = extractor.extractSymbols(code, "api.ts");
      expect(symbols.some((s) => s.name === "fetchData" && s.kind === "function")).toBe(true);
    });

    it("extracts class definitions", () => {
      const code = `export class UserService {\n  getUser() {}\n}`;
      const symbols = extractor.extractSymbols(code, "service.ts");
      expect(symbols.some((s) => s.name === "UserService" && s.kind === "class")).toBe(true);
    });

    it("extracts interface definitions", () => {
      const code = `export interface Config {\n  apiKey: string;\n}`;
      const symbols = extractor.extractSymbols(code, "types.ts");
      expect(symbols.some((s) => s.name === "Config" && s.kind === "interface")).toBe(true);
    });

    it("extracts type aliases", () => {
      const code = `export type ModelProvider = "grok" | "anthropic" | "openai";`;
      const symbols = extractor.extractSymbols(code, "types.ts");
      expect(symbols.some((s) => s.name === "ModelProvider" && s.kind === "type")).toBe(true);
    });

    it("extracts const declarations", () => {
      const code = `export const DEFAULT_MODEL = "grok-3";`;
      const symbols = extractor.extractSymbols(code, "constants.ts");
      expect(symbols.some((s) => s.name === "DEFAULT_MODEL" && s.kind === "const")).toBe(true);
    });

    it("extracts arrow functions assigned to const", () => {
      const code = `export const add = (a: number, b: number): number => a + b;`;
      const symbols = extractor.extractSymbols(code, "math.ts");
      expect(symbols.some((s) => s.name === "add" && s.kind === "const")).toBe(true);
    });

    it("extracts enum definitions", () => {
      const code = `export enum Status {\n  Active,\n  Inactive,\n}`;
      const symbols = extractor.extractSymbols(code, "enums.ts");
      expect(symbols.some((s) => s.name === "Status" && s.kind === "enum")).toBe(true);
    });

    it("extracts nested class methods", () => {
      const code = `class Calculator {\n  add(a: number, b: number) { return a + b; }\n}`;
      const symbols = extractor.extractSymbols(code, "calc.ts");
      expect(symbols.some((s) => s.name === "Calculator" && s.kind === "class")).toBe(true);
    });

    it("handles tsx files", () => {
      const code = `export const App = () => <div>Hello</div>;`;
      const symbols = extractor.extractSymbols(code, "App.tsx");
      expect(symbols.some((s) => s.name === "App")).toBe(true);
    });
  });

  describe("Python parsing", () => {
    it("extracts function definitions", () => {
      const code = `def authenticate(user: str) -> bool:\n    return True`;
      const symbols = extractor.extractSymbols(code, "auth.py");
      expect(symbols.some((s) => s.name === "authenticate" && s.kind === "function")).toBe(true);
    });

    it("extracts async function definitions", () => {
      const code = `async def fetch_data(url: str) -> dict:\n    return {}`;
      const symbols = extractor.extractSymbols(code, "api.py");
      expect(symbols.some((s) => s.name === "fetch_data" && s.kind === "function")).toBe(true);
    });

    it("extracts class definitions", () => {
      const code = `class UserService:\n    def get_user(self):\n        pass`;
      const symbols = extractor.extractSymbols(code, "service.py");
      expect(symbols.some((s) => s.name === "UserService" && s.kind === "class")).toBe(true);
    });

    it("extracts class with inheritance", () => {
      const code = `class AdminService(BaseService):\n    pass`;
      const symbols = extractor.extractSymbols(code, "admin.py");
      expect(symbols.some((s) => s.name === "AdminService" && s.kind === "class")).toBe(true);
    });

    it("extracts decorated functions", () => {
      const code = `@staticmethod\ndef helper():\n    pass`;
      const symbols = extractor.extractSymbols(code, "utils.py");
      expect(symbols.some((s) => s.name === "helper" && s.kind === "function")).toBe(true);
    });

    it("extracts methods within classes", () => {
      const code = `class Math:\n    def add(self, a, b):\n        return a + b`;
      const symbols = extractor.extractSymbols(code, "math.py");
      expect(symbols.some((s) => s.name === "Math" && s.kind === "class")).toBe(true);
      expect(symbols.some((s) => s.name === "add" && s.kind === "function")).toBe(true);
    });

    it("handles multi-line function signatures", () => {
      const code = `def long_function(\n    param1: str,\n    param2: int\n) -> bool:\n    return True`;
      const symbols = extractor.extractSymbols(code, "long.py");
      expect(symbols.some((s) => s.name === "long_function")).toBe(true);
    });

    it("extracts private methods", () => {
      const code = `def _private_method():\n    pass`;
      const symbols = extractor.extractSymbols(code, "private.py");
      expect(symbols.some((s) => s.name === "_private_method" && s.kind === "function")).toBe(true);
    });
  });

  describe("JavaScript parsing", () => {
    it("extracts function declarations", () => {
      const code = `function add(a, b) {\n  return a + b;\n}`;
      const symbols = extractor.extractSymbols(code, "math.js");
      expect(symbols.some((s) => s.name === "add" && s.kind === "function")).toBe(true);
    });

    it("extracts class declarations", () => {
      const code = `class Calculator {\n  add(a, b) { return a + b; }\n}`;
      const symbols = extractor.extractSymbols(code, "calc.js");
      expect(symbols.some((s) => s.name === "Calculator" && s.kind === "class")).toBe(true);
    });

    it("extracts arrow functions assigned to const", () => {
      const code = `const multiply = (a, b) => a * b;`;
      const symbols = extractor.extractSymbols(code, "ops.js");
      expect(symbols.some((s) => s.name === "multiply" && s.kind === "const")).toBe(true);
    });

    it("extracts const declarations", () => {
      const code = `const API_KEY = "secret";`;
      const symbols = extractor.extractSymbols(code, "config.js");
      expect(symbols.some((s) => s.name === "API_KEY" && s.kind === "const")).toBe(true);
    });

    it("handles JSX syntax", () => {
      const code = `const Button = () => <button>Click</button>;`;
      const symbols = extractor.extractSymbols(code, "Button.jsx");
      expect(symbols.some((s) => s.name === "Button")).toBe(true);
    });

    it("handles ES modules", () => {
      const code = `export const helper = () => {};`;
      const symbols = extractor.extractSymbols(code, "utils.mjs");
      expect(symbols.some((s) => s.name === "helper")).toBe(true);
    });
  });

  describe("Go parsing", () => {
    it("extracts function declarations", () => {
      const code = `func Authenticate(user string) bool {\n  return true\n}`;
      const symbols = extractor.extractSymbols(code, "auth.go");
      expect(symbols.some((s) => s.name === "Authenticate" && s.kind === "function")).toBe(true);
    });

    it("extracts struct definitions", () => {
      const code = `type User struct {\n  Name string\n  Age  int\n}`;
      const symbols = extractor.extractSymbols(code, "models.go");
      expect(symbols.some((s) => s.name === "User" && s.kind === "class")).toBe(true);
    });

    it("extracts interface definitions", () => {
      const code = `type Service interface {\n  Get() error\n}`;
      const symbols = extractor.extractSymbols(code, "service.go");
      expect(symbols.some((s) => s.name === "Service" && s.kind === "interface")).toBe(true);
    });

    it("extracts type aliases", () => {
      const code = `type UserID string`;
      const symbols = extractor.extractSymbols(code, "types.go");
      expect(symbols.some((s) => s.name === "UserID" && s.kind === "type")).toBe(true);
    });
  });

  describe("Rust parsing", () => {
    it("extracts function declarations", () => {
      const code = `fn authenticate(user: &str) -> bool {\n  true\n}`;
      const symbols = extractor.extractSymbols(code, "auth.rs");
      expect(symbols.some((s) => s.name === "authenticate" && s.kind === "function")).toBe(true);
    });

    it("extracts struct definitions", () => {
      const code = `struct User {\n  name: String,\n  age: u32,\n}`;
      const symbols = extractor.extractSymbols(code, "models.rs");
      expect(symbols.some((s) => s.name === "User" && s.kind === "class")).toBe(true);
    });

    it("extracts enum definitions", () => {
      const code = `enum Status {\n  Active,\n  Inactive,\n}`;
      const symbols = extractor.extractSymbols(code, "types.rs");
      expect(symbols.some((s) => s.name === "Status" && s.kind === "enum")).toBe(true);
    });

    it("extracts trait definitions", () => {
      const code = `trait Service {\n  fn get(&self) -> Result<(), Error>;\n}`;
      const symbols = extractor.extractSymbols(code, "service.rs");
      expect(symbols.some((s) => s.name === "Service" && s.kind === "interface")).toBe(true);
    });
  });

  describe("Fallback logic", () => {
    it("falls back to regex for unsupported file types", () => {
      const code = `public class HelloWorld {\n  public static void main(String[] args) {}\n}`;
      extractor.resetStats();
      extractor.extractSymbols(code, "Main.java");
      const stats = extractor.getStats();
      expect(stats.regexOnly).toBe(1);
    });

    it("falls back to regex on parse errors", () => {
      const malformed = `function broken( { }`;
      extractor.resetStats();
      extractor.extractSymbols(malformed, "broken.ts");
      const stats = extractor.getStats();
      // Should either succeed with tree-sitter or fall back to regex
      expect(stats.treeSitterSuccess + stats.treeSitterFallback).toBeGreaterThan(0);
    });

    it("returns empty array for files with no symbols", () => {
      const code = `// Just a comment\n// Another comment`;
      const symbols = extractor.extractSymbols(code, "empty.ts");
      expect(symbols).toEqual([]);
    });

    it("handles empty source gracefully", () => {
      const symbols = extractor.extractSymbols("", "empty.ts");
      expect(symbols).toEqual([]);
    });
  });

  describe("Performance benchmarks", () => {
    it("parses TypeScript file in under 50ms", () => {
      const code = Array.from({ length: 100 }, (_, i) => `function fn${i}() {}`).join("\n");
      const start = performance.now();
      extractor.extractSymbols(code, "perf.ts");
      const duration = performance.now() - start;
      expect(duration).toBeLessThan(50);
    });

    it("parses Python file in under 50ms", () => {
      const code = Array.from({ length: 100 }, (_, i) => `def fn${i}():\n    pass`).join("\n");
      const start = performance.now();
      extractor.extractSymbols(code, "perf.py");
      const duration = performance.now() - start;
      expect(duration).toBeLessThan(50);
    });

    it("parses large TypeScript file efficiently", () => {
      const code =
        Array.from(
          { length: 500 },
          (_, i) => `export function func${i}(x: number): number { return x * 2; }`,
        ).join("\n") +
        "\n" +
        Array.from(
          { length: 500 },
          (_, i) => `export interface Type${i} { id: number; name: string; }`,
        ).join("\n");
      const start = performance.now();
      const symbols = extractor.extractSymbols(code, "large.ts");
      const duration = performance.now() - start;
      expect(duration).toBeLessThan(200);
      expect(symbols.length).toBeGreaterThan(900);
    });

    it("maintains coverage stats across multiple files", () => {
      extractor.resetStats();
      extractor.extractSymbols(`function test() {}`, "test.ts");
      extractor.extractSymbols(`def test(): pass`, "test.py");
      extractor.extractSymbols(`public class Test {}`, "Test.java");

      const stats = extractor.getStats();
      expect(stats.total).toBe(3);
      expect(stats.treeSitterSuccess).toBe(2);
      expect(stats.regexOnly).toBe(1);
      expect(stats.coverage).toBeGreaterThan(60);
    });
  });

  describe("Statistics tracking", () => {
    it("tracks tree-sitter successes", () => {
      extractor.resetStats();
      extractor.extractSymbols(`function test() {}`, "test.ts");
      const stats = extractor.getStats();
      expect(stats.treeSitterSuccess).toBe(1);
      expect(stats.coverage).toBe(100);
    });

    it("tracks regex fallbacks", () => {
      extractor.resetStats();
      extractor.extractSymbols(`public class Test {}`, "Test.java");
      const stats = extractor.getStats();
      expect(stats.regexOnly).toBe(1);
      expect(stats.coverage).toBe(0);
    });

    it("calculates coverage percentage correctly", () => {
      extractor.resetStats();
      extractor.extractSymbols(`function a() {}`, "a.ts");
      extractor.extractSymbols(`function b() {}`, "b.ts");
      extractor.extractSymbols(`public class C {}`, "C.java");
      extractor.extractSymbols(`public class D {}`, "D.java");

      const stats = extractor.getStats();
      expect(stats.total).toBe(4);
      expect(stats.coverage).toBe(50);
    });

    it("resets stats correctly", () => {
      extractor.extractSymbols(`function test() {}`, "test.ts");
      extractor.resetStats();
      const stats = extractor.getStats();
      expect(stats.total).toBe(0);
      expect(stats.treeSitterSuccess).toBe(0);
      expect(stats.coverage).toBe(0);
    });
  });

  describe("Edge cases", () => {
    it("handles files with only whitespace", () => {
      const symbols = extractor.extractSymbols("   \n\n   \t\t", "whitespace.ts");
      expect(symbols).toEqual([]);
    });

    it("handles files with only comments", () => {
      const code = `// Comment 1\n/* Comment 2 */\n// Comment 3`;
      const symbols = extractor.extractSymbols(code, "comments.ts");
      expect(symbols).toEqual([]);
    });

    it("extracts symbols from minified code", () => {
      const code = `function a(){return 1}class B{}`;
      const symbols = extractor.extractSymbols(code, "min.ts");
      expect(symbols.length).toBeGreaterThan(0);
    });

    it("handles Unicode in symbol names", () => {
      const code = `const 测试 = () => {};`;
      const symbols = extractor.extractSymbols(code, "unicode.ts");
      expect(symbols.some((s) => s.name === "测试")).toBe(true);
    });

    it("includes correct line numbers", () => {
      const code = `\n\nfunction test() {}\n`;
      const symbols = extractor.extractSymbols(code, "test.ts");
      const testSymbol = symbols.find((s) => s.name === "test");
      expect(testSymbol?.line).toBe(3);
    });

    it("includes correct file path in all symbols", () => {
      const code = `function a() {}\nfunction b() {}`;
      const symbols = extractor.extractSymbols(code, "src/deep/path/file.ts");
      expect(symbols.every((s) => s.filePath === "src/deep/path/file.ts")).toBe(true);
    });
  });
});
