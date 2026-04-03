import { describe, it, expect } from "vitest";
import { chunkFile } from "./code-index.js";

describe("chunkFile — Code Chunking", () => {
  it("returns empty array for empty content", () => {
    const chunks = chunkFile("", "file.ts", 50);
    expect(chunks).toEqual([]);
  });

  it("returns single chunk when file is small", () => {
    const content = "const x = 1;\nconst y = 2;\n";
    const chunks = chunkFile(content, "small.ts", 50);
    expect(chunks).toHaveLength(1);
    expect(chunks[0]!.filePath).toBe("small.ts");
    expect(chunks[0]!.startLine).toBe(1);
  });

  it("extracts symbols from chunks", () => {
    const content = "export function hello() {}\nconst world = 42;\n";
    const chunks = chunkFile(content, "symbols.ts", 100);
    expect(chunks[0]!.symbols).toContain("hello");
    expect(chunks[0]!.symbols).toContain("world");
  });

  it("splits large files at function boundaries", () => {
    const lines: string[] = [];
    for (let i = 0; i < 15; i++) {
      lines.push(`  const line${i} = ${i};`);
    }
    lines.push("export function secondFn() {");
    for (let i = 0; i < 15; i++) {
      lines.push(`  const more${i} = ${i};`);
    }
    lines.push("}");
    const content = lines.join("\n");
    const chunks = chunkFile(content, "large.ts", 10);
    expect(chunks.length).toBeGreaterThan(1);
  });

  it("detects class, interface, and type boundaries", () => {
    const content = [
      "// header",
      "const x = 1;",
      "const y = 2;",
      "const z = 3;",
      "const a = 4;",
      "const b = 5;",
      "const c = 6;",
      "const d = 7;",
      "const e = 8;",
      "const f = 9;",
      "const g = 10;",
      "class MyClass {",
      "  doStuff() {}",
      "}",
      "interface MyInterface {",
      "  field: string;",
      "}",
      "type MyType = string;",
    ].join("\n");

    const chunks = chunkFile(content, "boundaries.ts", 5);
    const allSymbols = chunks.flatMap((c) => c.symbols);
    expect(allSymbols).toContain("MyClass");
  });

  it("preserves correct line numbers across chunks", () => {
    const lines: string[] = [];
    for (let i = 0; i < 30; i++) {
      lines.push(`const line${i} = ${i};`);
    }
    // Add a boundary at a known position
    lines.splice(15, 0, "export function boundary() {}");
    const content = lines.join("\n");
    const chunks = chunkFile(content, "lines.ts", 10);

    // First chunk should start at line 1
    expect(chunks[0]!.startLine).toBe(1);
    // Later chunks should have higher start lines
    if (chunks.length > 1) {
      expect(chunks[1]!.startLine).toBeGreaterThan(1);
    }
  });

  it("handles whitespace-only content", () => {
    const chunks = chunkFile("   \n  \n  ", "whitespace.ts", 50);
    expect(chunks).toEqual([]);
  });
});
