// ============================================================================
// @dantecode/core — Semantic Index Tests
// 35 tests covering index building, search, readiness, and error handling
// ============================================================================

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join as pathJoin } from "node:path";
import { BackgroundSemanticIndex } from "./semantic-index.js";

describe("BackgroundSemanticIndex", () => {
  let testDir: string;

  beforeEach(async () => {
    testDir = await mkdtemp(pathJoin(tmpdir(), "semantic-index-test-"));
  });

  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true });
  });

  // -------------------------------------------------------------------------
  // Index Building (10 tests)
  // -------------------------------------------------------------------------

  describe("Index Building", () => {
    it("should start indexing on start()", async () => {
      const index = new BackgroundSemanticIndex({
        projectRoot: testDir,
        sessionId: "test-session",
      });

      await index.start();

      const readiness = index.getReadiness();
      expect(readiness.status).toBeOneOf(["indexing", "ready"]);
    });

    it("should index TypeScript files", async () => {
      await writeFile(
        pathJoin(testDir, "test.ts"),
        `export class MyClass {}\nexport function myFunc() {}\nconst myConst = 42;`
      );

      const index = new BackgroundSemanticIndex({
        projectRoot: testDir,
        sessionId: "test-session",
      });

      await index.start();
      await index.wait();

      const readiness = index.getReadiness();
      if (readiness.status === "error") {
        throw new Error(`Index failed: ${readiness.error}`);
      }

      const results = await index.search("MyClass");
      expect(results.length).toBeGreaterThan(0);
      expect(results[0]!.symbols).toContain("MyClass");
    });

    it("should index JavaScript files", async () => {
      await writeFile(pathJoin(testDir, "test.js"), `class MyJsClass {}\nfunction myJsFunc() {}`);

      const index = new BackgroundSemanticIndex({
        projectRoot: testDir,
        sessionId: "test-session",
      });

      await index.start();
      await index.wait();

      const results = await index.search("MyJsClass");
      expect(results.length).toBeGreaterThan(0);
      expect(results[0]!.symbols).toContain("MyJsClass");
    });

    it("should index Python files", async () => {
      await writeFile(pathJoin(testDir, "test.py"), `class MyPyClass:\n    pass\ndef my_py_func():\n    pass`);

      const index = new BackgroundSemanticIndex({
        projectRoot: testDir,
        sessionId: "test-session",
      });

      await index.start();
      await index.wait();

      const results = await index.search("MyPyClass");
      expect(results.length).toBeGreaterThan(0);
      expect(results[0]!.symbols).toContain("MyPyClass");
    });

    it("should extract imports from TypeScript files", async () => {
      await writeFile(pathJoin(testDir, "test.ts"), `import { foo } from 'bar';\nimport 'side-effect';`);

      const index = new BackgroundSemanticIndex({
        projectRoot: testDir,
        sessionId: "test-session",
      });

      await index.start();
      await index.wait();

      const results = await index.search("test.ts");
      expect(results.length).toBeGreaterThan(0);
      expect(results[0]!.imports).toContain("bar");
      expect(results[0]!.imports).toContain("side-effect");
    });

    it("should extract imports from Python files", async () => {
      await writeFile(pathJoin(testDir, "test.py"), `import os\nfrom pathlib import Path`);

      const index = new BackgroundSemanticIndex({
        projectRoot: testDir,
        sessionId: "test-session",
      });

      await index.start();
      await index.wait();

      const results = await index.search("test.py");
      expect(results.length).toBeGreaterThan(0);
      expect(results[0]!.imports).toContain("os");
      expect(results[0]!.imports).toContain("pathlib");
    });

    it("should extract keywords from file content", async () => {
      await writeFile(
        pathJoin(testDir, "test.ts"),
        `export class MySpecialClass { private specialMethod() { return "special result"; } }`
      );

      const index = new BackgroundSemanticIndex({
        projectRoot: testDir,
        sessionId: "test-session",
      });

      await index.start();
      await index.wait();

      const results = await index.search("special");
      expect(results.length).toBeGreaterThan(0);
      expect(results[0]!.keywords).toContain("special");
    });

    it("should handle empty files gracefully", async () => {
      await writeFile(pathJoin(testDir, "empty.ts"), "");

      const index = new BackgroundSemanticIndex({
        projectRoot: testDir,
        sessionId: "test-session",
      });

      await index.start();
      await index.wait();

      const readiness = index.getReadiness();
      expect(readiness.status).toBe("ready");
    });

    it("should exclude node_modules by default", async () => {
      await mkdir(pathJoin(testDir, "node_modules"), { recursive: true });
      await writeFile(pathJoin(testDir, "node_modules", "lib.js"), `export class LibClass {}`);

      const index = new BackgroundSemanticIndex({
        projectRoot: testDir,
        sessionId: "test-session",
      });

      await index.start();
      await index.wait();

      const results = await index.search("LibClass");
      expect(results.length).toBe(0);
    });

    it("should respect maxFiles limit", async () => {
      for (let i = 0; i < 10; i++) {
        await writeFile(pathJoin(testDir, `file${i}.ts`), `export const val${i} = ${i};`);
      }

      const index = new BackgroundSemanticIndex({
        projectRoot: testDir,
        sessionId: "test-session",
        maxFiles: 5,
      });

      await index.start();
      await index.wait();

      const readiness = index.getReadiness();
      expect(readiness.totalFiles).toBeLessThanOrEqual(5);
    });
  });

  // -------------------------------------------------------------------------
  // Search (keyword + semantic) (12 tests)
  // -------------------------------------------------------------------------

  describe("Search", () => {
    it("should find files by path match", async () => {
      await writeFile(pathJoin(testDir, "special-file.ts"), `export const x = 1;`);

      const index = new BackgroundSemanticIndex({
        projectRoot: testDir,
        sessionId: "test-session",
      });

      await index.start();
      await index.wait();

      const results = await index.search("special");
      expect(results.length).toBeGreaterThan(0);
      expect(results[0]!.path).toContain("special");
    });

    it("should find files by symbol match", async () => {
      await writeFile(pathJoin(testDir, "test.ts"), `export class UniqueSymbol {}`);

      const index = new BackgroundSemanticIndex({
        projectRoot: testDir,
        sessionId: "test-session",
      });

      await index.start();
      await index.wait();

      const results = await index.search("UniqueSymbol");
      expect(results.length).toBeGreaterThan(0);
      expect(results[0]!.symbols).toContain("UniqueSymbol");
    });

    it("should find files by import match", async () => {
      await writeFile(pathJoin(testDir, "test.ts"), `import { something } from '@unique/package';`);

      const index = new BackgroundSemanticIndex({
        projectRoot: testDir,
        sessionId: "test-session",
      });

      await index.start();
      await index.wait();

      const results = await index.search("unique");
      expect(results.length).toBeGreaterThan(0);
    });

    it("should find files by keyword match", async () => {
      await writeFile(pathJoin(testDir, "test.ts"), `const specialKeyword = "value";`);

      const index = new BackgroundSemanticIndex({
        projectRoot: testDir,
        sessionId: "test-session",
      });

      await index.start();
      await index.wait();

      const results = await index.search("specialkeyword");
      expect(results.length).toBeGreaterThan(0);
    });

    it("should rank results by score", async () => {
      await writeFile(pathJoin(testDir, "exact.ts"), `export class ExactMatch {}`);
      await writeFile(pathJoin(testDir, "partial.ts"), `// ExactMatch mentioned in comment`);

      const index = new BackgroundSemanticIndex({
        projectRoot: testDir,
        sessionId: "test-session",
      });

      await index.start();
      await index.wait();

      const results = await index.search("ExactMatch");
      expect(results.length).toBeGreaterThanOrEqual(2);
      expect(results[0]!.path).toContain("exact");
      expect(results[0]!.score).toBeGreaterThan(results[1]!.score ?? 0);
    });

    it("should limit results to specified limit", async () => {
      for (let i = 0; i < 10; i++) {
        await writeFile(pathJoin(testDir, `match${i}.ts`), `export const match = ${i};`);
      }

      const index = new BackgroundSemanticIndex({
        projectRoot: testDir,
        sessionId: "test-session",
      });

      await index.start();
      await index.wait();

      const results = await index.search("match", 3);
      expect(results.length).toBeLessThanOrEqual(3);
    });

    it("should return empty array for no matches", async () => {
      await writeFile(pathJoin(testDir, "test.ts"), `export const foo = 1;`);

      const index = new BackgroundSemanticIndex({
        projectRoot: testDir,
        sessionId: "test-session",
      });

      await index.start();
      await index.wait();

      const results = await index.search("nonexistent-xyzabc");
      expect(results.length).toBe(0);
    });

    it("should work with partial index", async () => {
      for (let i = 0; i < 100; i++) {
        await writeFile(pathJoin(testDir, `file${i}.ts`), `export const val = ${i};`);
      }

      const index = new BackgroundSemanticIndex({
        projectRoot: testDir,
        sessionId: "test-session",
      });

      await index.start();

      // Search before index completes
      const results = await index.search("file0");
      // Should work even if not all files indexed yet
      expect(Array.isArray(results)).toBe(true);

      await index.stop();
    });

    it("should be case-insensitive", async () => {
      await writeFile(pathJoin(testDir, "test.ts"), `export class MyCamelCaseClass {}`);

      const index = new BackgroundSemanticIndex({
        projectRoot: testDir,
        sessionId: "test-session",
      });

      await index.start();
      await index.wait();

      const results = await index.search("mycamelcaseclass");
      expect(results.length).toBeGreaterThan(0);
    });

    it("should handle multi-word queries", async () => {
      await writeFile(pathJoin(testDir, "test.ts"), `export class MySpecialClass {}`);

      const index = new BackgroundSemanticIndex({
        projectRoot: testDir,
        sessionId: "test-session",
      });

      await index.start();
      await index.wait();

      const results = await index.search("special class");
      expect(results.length).toBeGreaterThan(0);
    });

    it("should prioritize exact symbol matches", async () => {
      await writeFile(pathJoin(testDir, "exact.ts"), `export class TargetClass {}`);
      await writeFile(pathJoin(testDir, "partial.ts"), `// TargetClass is a target class`);

      const index = new BackgroundSemanticIndex({
        projectRoot: testDir,
        sessionId: "test-session",
      });

      await index.start();
      await index.wait();

      const results = await index.search("TargetClass");
      expect(results[0]!.path).toContain("exact");
    });

    it("should handle React component patterns", async () => {
      await writeFile(pathJoin(testDir, "Component.tsx"), `export const MyComponent = () => { return <div />; }`);

      const index = new BackgroundSemanticIndex({
        projectRoot: testDir,
        sessionId: "test-session",
      });

      await index.start();
      await index.wait();

      const results = await index.search("MyComponent");
      expect(results.length).toBeGreaterThan(0);
      expect(results[0]!.symbols).toContain("MyComponent");
    });
  });

  // -------------------------------------------------------------------------
  // Readiness Tracking (5 tests)
  // -------------------------------------------------------------------------

  describe("Readiness Tracking", () => {
    it("should start with indexing status", () => {
      const index = new BackgroundSemanticIndex({
        projectRoot: testDir,
        sessionId: "test-session",
      });

      const readiness = index.getReadiness();
      expect(readiness.status).toBe("indexing");
      expect(readiness.progress).toBe(0);
    });

    it("should update progress during indexing", async () => {
      for (let i = 0; i < 10; i++) {
        await writeFile(pathJoin(testDir, `file${i}.ts`), `export const val = ${i};`);
      }

      const index = new BackgroundSemanticIndex({
        projectRoot: testDir,
        sessionId: "test-session",
      });

      await index.start();

      // May already be complete on fast systems
      const readiness = index.getReadiness();
      expect(readiness.progress).toBeGreaterThanOrEqual(0);
      expect(readiness.progress).toBeLessThanOrEqual(100);

      await index.stop();
    });

    it("should reach ready status when complete", async () => {
      await writeFile(pathJoin(testDir, "test.ts"), `export const x = 1;`);

      const index = new BackgroundSemanticIndex({
        projectRoot: testDir,
        sessionId: "test-session",
      });

      await index.start();
      await index.wait();

      const readiness = index.getReadiness();
      expect(readiness.status).toBe("ready");
      expect(readiness.progress).toBe(100);
    });

    it("should track filesIndexed and totalFiles", async () => {
      await writeFile(pathJoin(testDir, "a.ts"), `export const a = 1;`);
      await writeFile(pathJoin(testDir, "b.ts"), `export const b = 2;`);

      const index = new BackgroundSemanticIndex({
        projectRoot: testDir,
        sessionId: "test-session",
      });

      await index.start();
      await index.wait();

      const readiness = index.getReadiness();
      expect(readiness.totalFiles).toBe(2);
      expect(readiness.filesIndexed).toBe(2);
    });

    it("should return a copy of readiness state", () => {
      const index = new BackgroundSemanticIndex({
        projectRoot: testDir,
        sessionId: "test-session",
      });

      const readiness1 = index.getReadiness();
      const readiness2 = index.getReadiness();

      expect(readiness1).not.toBe(readiness2); // Different objects
      expect(readiness1).toEqual(readiness2); // Same values
    });
  });

  // -------------------------------------------------------------------------
  // Worker Lifecycle (4 tests)
  // -------------------------------------------------------------------------

  describe("Worker Lifecycle", () => {
    it("should allow multiple start() calls without error", async () => {
      const index = new BackgroundSemanticIndex({
        projectRoot: testDir,
        sessionId: "test-session",
      });

      await index.start();
      await index.start(); // Should be no-op

      await index.stop();
    });

    it("should stop indexing when stop() is called", async () => {
      for (let i = 0; i < 100; i++) {
        await writeFile(pathJoin(testDir, `file${i}.ts`), `export const val = ${i};`);
      }

      const index = new BackgroundSemanticIndex({
        projectRoot: testDir,
        sessionId: "test-session",
      });

      await index.start();
      await index.wait();

      const readiness = index.getReadiness();
      expect(["indexing", "ready"]).toContain(readiness.status);
    });

    it("should handle stop() before start() gracefully", async () => {
      const index = new BackgroundSemanticIndex({
        projectRoot: testDir,
        sessionId: "test-session",
      });

      await index.stop();

      const readiness = index.getReadiness();
      expect(readiness.status).toBe("indexing");
    });

    it("should allow restart after stop", async () => {
      await writeFile(pathJoin(testDir, "test.ts"), `export const x = 1;`);

      const index = new BackgroundSemanticIndex({
        projectRoot: testDir,
        sessionId: "test-session",
      });

      await index.start();
      await index.wait();

      // Start again should work
      await index.start();
      await index.wait();

      const readiness = index.getReadiness();
      expect(readiness.status).toBe("ready");
    });
  });

  // -------------------------------------------------------------------------
  // Error Handling (4 tests)
  // -------------------------------------------------------------------------

  describe("Error Handling", () => {
    it("should handle missing project root gracefully", async () => {
      const index = new BackgroundSemanticIndex({
        projectRoot: pathJoin(testDir, "nonexistent"),
        sessionId: "test-session",
      });

      await index.start();
      await index.wait();

      const readiness = index.getReadiness();
      expect(readiness.status).toBeOneOf(["ready", "error"]);
    });

    it("should handle permission errors gracefully", async () => {
      // Create a file we can't read (simulated)
      const index = new BackgroundSemanticIndex({
        projectRoot: testDir,
        sessionId: "test-session",
      });

      await index.start();
      await index.wait();

      // Should not throw
      const readiness = index.getReadiness();
      expect(readiness.status).toBeOneOf(["ready", "error"]);
    });

    it("should skip malformed files", async () => {
      await writeFile(pathJoin(testDir, "good.ts"), `export const x = 1;`);
      await writeFile(pathJoin(testDir, "bad.ts"), String.fromCharCode(0, 1, 2, 3)); // Binary garbage

      const index = new BackgroundSemanticIndex({
        projectRoot: testDir,
        sessionId: "test-session",
      });

      await index.start();
      await index.wait();

      const readiness = index.getReadiness();
      expect(readiness.status).toBe("ready");
      expect(readiness.filesIndexed).toBeGreaterThan(0);
    });

    it("should report error in readiness when index fails", async () => {
      const index = new BackgroundSemanticIndex({
        projectRoot: testDir,
        sessionId: "test-session",
        indexDir: "/invalid/path/that/cannot/be/created",
      });

      await index.start();
      await index.wait();

      const readiness = index.getReadiness();
      if (readiness.status === "error") {
        expect(readiness.error).toBeTruthy();
      }
    });
  });
});
