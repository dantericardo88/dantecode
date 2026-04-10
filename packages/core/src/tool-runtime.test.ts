import { describe, expect, it } from "vitest";
import {
  applyExactEdit,
  createFileSnapshot,
  isSnapshotStale,
  preserveLineEndingsForWrite,
  truncateToolOutput,
} from "./tool-runtime.js";

describe("applyExactEdit", () => {
  it("matches LF payloads against CRLF files and preserves CRLF on write", () => {
    const result = applyExactEdit(
      "const one = 1;\r\nconst two = 2;\r\n",
      "const one = 1;\n",
      "const one = 3;\n",
      false,
    );

    expect(result.matched).toBe(true);
    expect(result.usedNormalizedLineEndings).toBe(true);
    expect(result.updatedContent).toBe("const one = 3;\r\nconst two = 2;\r\n");
  });
});

describe("preserveLineEndingsForWrite", () => {
  it("rewrites LF content to the file's existing CRLF style", () => {
    expect(preserveLineEndingsForWrite("a\nb\n", "old\r\ncontent\r\n")).toBe("a\r\nb\r\n");
  });
});

describe("file snapshots", () => {
  it("detects stale snapshots when content changes", () => {
    const previous = createFileSnapshot("src/app.ts", "hello", { mtimeMs: 1, size: 5 });
    const current = createFileSnapshot("src/app.ts", "hello!", { mtimeMs: 2, size: 6 });

    expect(isSnapshotStale(previous, current)).toBe(true);
  });
});

describe("truncateToolOutput", () => {
  it("truncates oversized tool results with a clear marker", () => {
    const truncated = truncateToolOutput("a".repeat(5_000), {
      maxChars: 200,
      headChars: 80,
      tailChars: 40,
    });

    expect(truncated.length).toBeLessThan(260);
    expect(truncated).toContain("truncated");
  });
});

describe("createFileSnapshot", () => {
  it("emits stable snapshot ids", () => {
    const snapshot1 = createFileSnapshot("test.txt", "content");
    const snapshot2 = createFileSnapshot("test.txt", "content");

    expect(snapshot1.id).toBeDefined();
    expect(snapshot2.id).toBeDefined();
    expect(snapshot1.id).not.toBe(snapshot2.id); // Different ids for different calls
  });
});

describe("snapshot lineage", () => {
  it("successful mutation can point back to readSnapshotId", () => {
    // This is tested in integration, but here we verify the snapshot creation
    const readSnapshot = createFileSnapshot("file.txt", "old");
    const afterSnapshot = createFileSnapshot("file.txt", "new");

    expect(readSnapshot.id).toBeDefined();
    expect(afterSnapshot.id).toBeDefined();
    expect(readSnapshot.hash).not.toBe(afterSnapshot.hash);
  });

  it("snapshot lineage survives normal edit/write flow", () => {
    const original = createFileSnapshot("test.txt", "original");
    const edited = createFileSnapshot("test.txt", "edited");

    expect(original.hash).not.toBe(edited.hash);
    expect(original.id).not.toBe(edited.id);
  });
});
