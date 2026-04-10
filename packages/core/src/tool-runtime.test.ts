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
    const truncated = truncateToolOutput("a".repeat(5_000), { maxChars: 200, headChars: 80, tailChars: 40 });

    expect(truncated.length).toBeLessThan(260);
    expect(truncated).toContain("truncated");
  });
});
