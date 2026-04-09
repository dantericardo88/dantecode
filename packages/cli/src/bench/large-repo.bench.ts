import { describe, bench, beforeAll } from "vitest";
import { BackgroundSemanticIndex } from "@dantecode/core";
import { writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Generates N stub TypeScript files under `dir`.
 * Each file exports a unique class and a handful of functions so the extractor
 * has something real to parse.
 */
async function generateStubFiles(dir: string, count: number): Promise<string[]> {
  await mkdir(dir, { recursive: true });
  const paths: string[] = [];
  for (let i = 0; i < count; i++) {
    const name = `stub_${i}.ts`;
    const abs = join(dir, name);
    const content = [
      `// Auto-generated stub file ${i}`,
      `import { readFile } from "node:fs/promises";`,
      `import { join } from "node:path";`,
      ``,
      `export class StubClass${i} {`,
      `  private value: number = ${i};`,
      `  getValue(): number { return this.value; }`,
      `  async load(p: string): Promise<string> { return readFile(join(p, "x"), "utf-8"); }`,
      `}`,
      ``,
      `export function stubHelper${i}(x: number): number { return x * ${i + 1}; }`,
      `export const STUB_CONST_${i} = ${i * 100};`,
      `export type StubType${i} = { id: number; label: string; value: StubClass${i} };`,
    ].join("\n");
    await writeFile(abs, content, "utf-8");
    paths.push(abs);
  }
  return paths;
}

// ---------------------------------------------------------------------------
// Suite 1: BackgroundSemanticIndex — large corpus
// ---------------------------------------------------------------------------

describe("BackgroundSemanticIndex: large corpus", () => {
  let indexDir: string;
  // Built-once index for the search bench
  let sharedIndex: BackgroundSemanticIndex;

  beforeAll(async () => {
    indexDir = join(tmpdir(), `dante-bench-${Date.now()}`);
    await generateStubFiles(indexDir, 200); // 200 files — keep bench fast

    // Pre-build an index that the search bench can reuse
    sharedIndex = new BackgroundSemanticIndex({
      projectRoot: indexDir,
      sessionId: "bench-shared",
      // Store index under a sub-directory so it is excluded from the file scan
      indexDir: join(indexDir, ".dantecode", "index"),
    });
    // Index first 50 files to warm up the shared index
    const relPaths: string[] = [];
    for (let i = 0; i < 50; i++) {
      relPaths.push(`stub_${i}.ts`);
    }
    // Use the public indexFile path by starting the index and waiting
    await sharedIndex.start();
    await sharedIndex.wait();
  }, 30_000 /* generous timeout for file creation + indexing */);

  bench(
    "index 200 TypeScript files (start + wait)",
    async () => {
      // Each bench iteration creates a fresh index instance so we measure pure
      // indexing cost, not cached state.
      const idx = new BackgroundSemanticIndex({
        projectRoot: indexDir,
        sessionId: `bench-iter-${Date.now()}`,
        indexDir: join(indexDir, ".dantecode", "index-iter"),
      });
      await idx.start();
      await idx.wait();
    },
    { time: 2000 },
  );

  bench(
    "search after indexing — keyword 'StubClass'",
    async () => {
      await sharedIndex.search("StubClass", 10);
    },
    { time: 2000 },
  );

  bench(
    "search after indexing — keyword 'helper'",
    async () => {
      await sharedIndex.search("helper", 20);
    },
    { time: 2000 },
  );

  bench(
    "search after indexing — long multi-token query",
    async () => {
      await sharedIndex.search("export function stub helper value number", 10);
    },
    { time: 2000 },
  );
});

// ---------------------------------------------------------------------------
// Suite 2: String processing baseline (no I/O)
// ---------------------------------------------------------------------------

describe("String processing baseline", () => {
  bench("JSON roundtrip 1KB", () => {
    const obj = { key: "a".repeat(500), count: 42, nested: { arr: [1, 2, 3] } };
    JSON.parse(JSON.stringify(obj));
  });

  bench("regex match on 10KB string", () => {
    const str = "export function ".repeat(200);
    /export\s+function\s+\w+/g.test(str);
  });

  bench("string split + filter 10KB", () => {
    const str = "export const foo = 1;\n".repeat(200);
    str.split("\n").filter((l) => l.includes("export"));
  });

  bench("Array.from(new Set()) dedup 1000 items", () => {
    const arr = Array.from({ length: 1000 }, (_, i) => `token_${i % 100}`);
    Array.from(new Set(arr));
  });
});
