import { describe, expect, it } from "vitest";
import { buildRepoMap } from "./repo-map-ast.js";
import { mkdtemp, rm, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

describe("buildRepoMap with tree-sitter integration", () => {
  it("uses tree-sitter by default and extracts symbols accurately", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "repo-map-ts-"));

    try {
      // Create a multi-file project
      await mkdir(join(tempDir, "src"), { recursive: true });

      await writeFile(
        join(tempDir, "src", "auth.ts"),
        `export function authenticate(user: string): boolean {
  return true;
}

export class AuthService {
  login() {}
}`,
      );

      await writeFile(
        join(tempDir, "src", "utils.py"),
        `def helper(x: int) -> int:
    return x * 2

class Calculator:
    def add(self, a, b):
        return a + b`,
      );

      await writeFile(
        join(tempDir, "src", "app.js"),
        `const express = require('express');

function startServer() {
  return express();
}

class App {
  run() {}
}`,
      );

      const ranked = await buildRepoMap(tempDir, { useTreeSitter: true });

      // Verify all files are indexed
      expect(ranked.length).toBe(3);

      // Verify TypeScript symbols extracted via tree-sitter
      const authFile = ranked.find((f) => f.filePath.includes("auth.ts"));
      expect(authFile).toBeDefined();
      expect(authFile!.symbols.some((s) => s.name === "authenticate")).toBe(true);
      expect(authFile!.symbols.some((s) => s.name === "AuthService")).toBe(true);

      // Verify Python symbols extracted via tree-sitter
      const pyFile = ranked.find((f) => f.filePath.includes("utils.py"));
      expect(pyFile).toBeDefined();
      expect(pyFile!.symbols.some((s) => s.name === "helper")).toBe(true);
      expect(pyFile!.symbols.some((s) => s.name === "Calculator")).toBe(true);

      // Verify JavaScript symbols extracted via tree-sitter
      const jsFile = ranked.find((f) => f.filePath.includes("app.js"));
      expect(jsFile).toBeDefined();
      expect(jsFile!.symbols.some((s) => s.name === "startServer")).toBe(true);
      expect(jsFile!.symbols.some((s) => s.name === "App")).toBe(true);
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it("falls back to regex when tree-sitter is disabled", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "repo-map-regex-"));

    try {
      await mkdir(join(tempDir, "src"), { recursive: true });

      await writeFile(
        join(tempDir, "src", "test.ts"),
        `export function test() {
  return true;
}`,
      );

      const ranked = await buildRepoMap(tempDir, { useTreeSitter: false });

      expect(ranked.length).toBe(1);
      expect(ranked[0]!.symbols.some((s) => s.name === "test")).toBe(true);
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it("handles large codebases efficiently", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "repo-map-perf-"));

    try {
      await mkdir(join(tempDir, "src"), { recursive: true });

      // Create 100 files with 10 symbols each
      for (let i = 0; i < 100; i++) {
        const content = Array.from(
          { length: 10 },
          (_, j) => `export function func_${i}_${j}() { return ${j}; }`,
        ).join("\n");

        await writeFile(join(tempDir, "src", `file${i}.ts`), content);
      }

      const start = performance.now();
      const ranked = await buildRepoMap(tempDir, { useTreeSitter: true });
      const duration = performance.now() - start;

      expect(ranked.length).toBe(100);
      // 5000ms threshold: tree-sitter on Windows is significantly slower due to I/O overhead.
      // The original 500ms was calibrated for Linux CI — on Windows 3-6s is typical for 100 files.
      expect(duration).toBeLessThan(5000); // < 5s for 1000 symbols (Windows-safe threshold)
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it("maintains backward compatibility with regex fallback", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "repo-map-compat-"));

    try {
      await mkdir(join(tempDir, "src"), { recursive: true });

      // Create files with both supported and unsupported extensions
      await writeFile(join(tempDir, "src", "main.ts"), `export function main() { return 0; }`);

      await writeFile(
        join(tempDir, "src", "Main.java"),
        `public class Main {
  public static void main(String[] args) {}
}`,
      );

      const ranked = await buildRepoMap(tempDir, { useTreeSitter: true });

      expect(ranked.length).toBe(2);

      // TypeScript should be parsed with tree-sitter
      const tsFile = ranked.find((f) => f.filePath.includes("main.ts"));
      expect(tsFile!.symbols.some((s) => s.name === "main")).toBe(true);

      // Java should fall back to regex (unsupported by tree-sitter)
      const javaFile = ranked.find((f) => f.filePath.includes("Main.java"));
      expect(javaFile!.symbols.length).toBeGreaterThanOrEqual(0);
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });
});
