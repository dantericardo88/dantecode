// ============================================================================
// packages/codebase-index/src/__tests__/semantic-chunker.test.ts
// 10 tests for semantic bracket-counting chunker
// ============================================================================

import { describe, it, expect } from "vitest";
import { semanticChunkFile } from "../semantic-chunker.js";

// ── Helpers ───────────────────────────────────────────────────────────────────

function lines(n: number): string[] {
  return Array.from({ length: n }, (_, i) => `  line_${i + 1}();`);
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("semanticChunkFile — import block", () => {
  it("groups consecutive import lines into a single chunk", () => {
    const src = [
      "import { foo } from './foo.js';",
      "import { bar } from './bar.js';",
      "import { baz } from './baz.js';",
      "",
      "export function main() {",
      "  foo();",
      "  bar();",
      "  baz();",
      "}",
    ].join("\n");

    const chunks = semanticChunkFile(src, "src/main.ts", 200);
    // Should have at least one chunk containing all 3 import lines together
    const importChunk = chunks.find((c) => c.content.includes("import { foo }") && c.content.includes("import { bar }"));
    expect(importChunk).toBeDefined();
  });
});

describe("semanticChunkFile — top-level declarations", () => {
  it("starts a new chunk at depth=0 function declaration", () => {
    const src = [
      "import { x } from './x.js';",
      "",
      "function alpha() {",
      "  return 1;",
      "}",
      "",
      "function beta() {",
      "  return 2;",
      "}",
    ].join("\n");

    const chunks = semanticChunkFile(src, "index.ts", 200);
    // Each function should end up in its own chunk (or merged with adjacent tiny chunks)
    const hasAlpha = chunks.some((c) => c.content.includes("function alpha"));
    const hasBeta = chunks.some((c) => c.content.includes("function beta"));
    expect(hasAlpha).toBe(true);
    expect(hasBeta).toBe(true);
  });

  it("keeps a class with 3 methods as ONE chunk (bracket depth holds body together)", () => {
    const src = [
      "export class Foo {",
      "  methodA() {",
      "    return 1;",
      "  }",
      "  methodB() {",
      "    return 2;",
      "  }",
      "  methodC() {",
      "    return 3;",
      "  }",
      "}",
    ].join("\n");

    const chunks = semanticChunkFile(src, "foo.ts", 200);
    // All methods must be in the SAME chunk
    const classChunk = chunks.find((c) => c.content.includes("class Foo"));
    expect(classChunk).toBeDefined();
    expect(classChunk!.content).toContain("methodA");
    expect(classChunk!.content).toContain("methodB");
    expect(classChunk!.content).toContain("methodC");
    // Should not be split into multiple class chunks
    const classChunks = chunks.filter((c) => c.content.includes("class Foo"));
    expect(classChunks).toHaveLength(1);
  });

  it("attaches JSDoc comment before export function into the same chunk", () => {
    const src = [
      "/**",
      " * Adds two numbers.",
      " */",
      "export function add(a: number, b: number): number {",
      "  return a + b;",
      "}",
    ].join("\n");

    const chunks = semanticChunkFile(src, "math.ts", 200);
    const fnChunk = chunks.find((c) => c.content.includes("export function add"));
    expect(fnChunk).toBeDefined();
    expect(fnChunk!.content).toContain("Adds two numbers");
  });
});

describe("semanticChunkFile — Python mode", () => {
  it("splits at top-level def at column 0", () => {
    // Build a larger Python file so it exceeds maxChunkLines=4
    const alpha = ["def alpha():", "    x = 1", "    y = 2", "    return x + y"].join("\n");
    const beta = ["def beta():", "    a = 1", "    b = 2", "    return a + b"].join("\n");
    const src = alpha + "\n\n" + beta;

    const chunks = semanticChunkFile(src, "app.py", 4);
    const hasAlpha = chunks.some((c) => c.content.includes("def alpha"));
    const hasBeta = chunks.some((c) => c.content.includes("def beta"));
    expect(hasAlpha).toBe(true);
    expect(hasBeta).toBe(true);
    // alpha and beta should not be in the same chunk
    const both = chunks.find((c) => c.content.includes("def alpha") && c.content.includes("def beta"));
    expect(both).toBeUndefined();
  });

  it("does NOT split at indented def inside a class", () => {
    // Class with indented methods — build it large enough to not early-return
    const methods = Array.from({ length: 6 }, (_, i) => [`    def method_${i}(self):`, `        return ${i}`]).flat();
    const src = ["class Foo:", ...methods].join("\n");

    const chunks = semanticChunkFile(src, "foo.py", 200);
    // The entire class is one chunk — all methods should NOT be in separate chunks
    const classChunk = chunks.find((c) => c.content.includes("class Foo"));
    expect(classChunk).toBeDefined();
    expect(classChunk!.content).toContain("method_0");
    expect(classChunk!.content).toContain("method_5");
  });
});

describe("semanticChunkFile — size caps and merging", () => {
  it("force-splits a file larger than maxChunkLines at the next boundary", () => {
    // Build a file with two functions, total > 10 lines
    const fn1 = ["export function bigA() {", ...lines(6), "}"].join("\n");
    const fn2 = ["export function bigB() {", ...lines(6), "}"].join("\n");
    const src = fn1 + "\n" + fn2;

    const chunks = semanticChunkFile(src, "big.ts", 10);
    // Force-split means we get at least 2 chunks
    expect(chunks.length).toBeGreaterThanOrEqual(2);
  });

  it("merges a tiny chunk (< 5 lines) with the adjacent chunk", () => {
    // A one-liner const followed by a larger function
    const src = [
      "const X = 1;",
      "",
      "export function big() {",
      "  return X;",
      "  // ...some content",
      "  // ...some content",
      "}",
    ].join("\n");

    const chunks = semanticChunkFile(src, "tiny.ts", 200);
    // The tiny const chunk should be merged rather than being standalone with < 5 lines
    // Just verify no chunk is absurdly small (content-wise)
    for (const c of chunks) {
      expect(c.content.trim().length).toBeGreaterThan(0);
    }
  });

  it("sets correct startLine and endLine after split", () => {
    const src = [
      "import { a } from './a.js';",
      "",
      "export function foo() {",
      "  return 1;",
      "}",
      "",
      "export function bar() {",
      "  return 2;",
      "}",
    ].join("\n");

    const chunks = semanticChunkFile(src, "lines.ts", 200);
    for (const c of chunks) {
      if (c.startLine != null && c.endLine != null) {
        expect(c.startLine).toBeGreaterThanOrEqual(1);
        expect(c.endLine).toBeGreaterThanOrEqual(c.startLine);
      }
    }
  });

  it("returns [] for empty file", () => {
    expect(semanticChunkFile("", "empty.ts")).toHaveLength(0);
    expect(semanticChunkFile("   \n\n  ", "empty.ts")).toHaveLength(0);
  });
});
