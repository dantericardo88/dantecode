// packages/cli/src/__tests__/terminal-diff-renderer.test.ts
import { describe, it, expect } from "vitest";
import {
  diffLines,
  renderUnifiedDiff,
  renderSideBySideDiff,
  formatMultiFileDiff,
  diffStatLine,
} from "../terminal-diff-renderer.js";

// ─── diffLines ────────────────────────────────────────────────────────────────

describe("diffLines", () => {
  it("returns all equal ops for identical strings", () => {
    const ops = diffLines("hello\nworld", "hello\nworld");
    expect(ops.every((o) => o.op === "equal")).toBe(true);
  });

  it("returns insert op for added line", () => {
    const ops = diffLines("line1", "line1\nline2");
    expect(ops.some((o) => o.op === "insert" && o.line === "line2")).toBe(true);
  });

  it("returns delete op for removed line", () => {
    const ops = diffLines("line1\nline2", "line1");
    expect(ops.some((o) => o.op === "delete" && o.line === "line2")).toBe(true);
  });

  it("handles empty before string", () => {
    const ops = diffLines("", "new line");
    expect(ops[0]?.op).toBe("insert");
    expect(ops[0]?.line).toBe("new line");
  });

  it("handles empty after string", () => {
    const ops = diffLines("old line", "");
    expect(ops[0]?.op).toBe("delete");
    expect(ops[0]?.line).toBe("old line");
  });

  it("handles both empty strings", () => {
    const ops = diffLines("", "");
    expect(ops).toHaveLength(0);
  });

  it("correctly diffs multiline replacement", () => {
    const before = "a\nb\nc";
    const after = "a\nx\nc";
    const ops = diffLines(before, after);
    const del = ops.find((o) => o.op === "delete");
    const ins = ops.find((o) => o.op === "insert");
    expect(del?.line).toBe("b");
    expect(ins?.line).toBe("x");
  });
});

// ─── renderUnifiedDiff ────────────────────────────────────────────────────────

describe("renderUnifiedDiff", () => {
  it("returns empty string for identical content", () => {
    expect(renderUnifiedDiff("same", "same", { noColor: true })).toBe("");
  });

  it("contains + prefix for inserted lines", () => {
    const out = renderUnifiedDiff("line1", "line1\nline2", { noColor: true });
    expect(out).toContain("+line2");
  });

  it("contains - prefix for removed lines", () => {
    const out = renderUnifiedDiff("line1\nline2", "line1", { noColor: true });
    expect(out).toContain("-line2");
  });

  it("includes @@ hunk header", () => {
    const out = renderUnifiedDiff("a\nb\nc", "a\nx\nc", { noColor: true });
    expect(out).toContain("@@");
  });

  it("includes fileName in header when provided", () => {
    const out = renderUnifiedDiff("old", "new", { fileName: "test.ts", noColor: true });
    expect(out).toContain("test.ts");
    expect(out).toContain("---");
    expect(out).toContain("+++");
  });

  it("respects contextLines option", () => {
    const before = Array.from({ length: 10 }, (_, i) => `line${i}`).join("\n");
    const after = before.replace("line5", "CHANGED");
    const out1 = renderUnifiedDiff(before, after, { contextLines: 1, noColor: true });
    const out3 = renderUnifiedDiff(before, after, { contextLines: 3, noColor: true });
    // 1-context should have fewer lines than 3-context
    expect(out1.split("\n").length).toBeLessThan(out3.split("\n").length);
  });

  it("produces output with ANSI codes when noColor=false", () => {
    const out = renderUnifiedDiff("a", "b");
    expect(out).toContain("\x1b[");
  });

  it("produces clean output with noColor=true", () => {
    const out = renderUnifiedDiff("a", "b", { noColor: true });
    expect(out).not.toContain("\x1b[");
  });
});

// ─── renderSideBySideDiff ─────────────────────────────────────────────────────

describe("renderSideBySideDiff", () => {
  it("returns empty string for identical content", () => {
    expect(renderSideBySideDiff("same", "same", { noColor: true })).toBe("");
  });

  it("falls back to unified diff when width < 80", () => {
    const sideBySide = renderSideBySideDiff("a\nb", "a\nc", { width: 60, noColor: true });
    // Both should contain the changed line indicators
    expect(sideBySide).toContain("-b");
    expect(sideBySide).toContain("+c");
  });

  it("contains divider character │ for wide terminals", () => {
    const out = renderSideBySideDiff("a\nb\nc", "a\nx\nc", { width: 160, noColor: true });
    expect(out).toContain("│");
  });

  it("includes BEFORE and AFTER headers", () => {
    const out = renderSideBySideDiff("old", "new", { width: 160, noColor: true });
    expect(out).toContain("BEFORE");
    expect(out).toContain("AFTER");
  });

  it("shows deleted lines with - prefix on left side", () => {
    const out = renderSideBySideDiff("removed", "added", { width: 160, noColor: true });
    expect(out).toContain("-removed");
    expect(out).toContain("+added");
  });
});

// ─── formatMultiFileDiff ──────────────────────────────────────────────────────

describe("formatMultiFileDiff", () => {
  it("returns (no changes) when all files are identical", () => {
    const result = formatMultiFileDiff([
      { path: "a.ts", before: "same", after: "same" },
    ], { noColor: true });
    expect(result).toBe("(no changes)");
  });

  it("includes file path in output", () => {
    const result = formatMultiFileDiff([
      { path: "src/foo.ts", before: "old", after: "new" },
    ], { noColor: true });
    expect(result).toContain("src/foo.ts");
  });

  it("includes summary line with + and - counts", () => {
    const result = formatMultiFileDiff([
      { path: "a.ts", before: "line1", after: "line1\nline2" },
    ], { noColor: true });
    expect(result).toContain("+1");
    expect(result).toContain("file(s)");
  });

  it("handles multiple files", () => {
    const result = formatMultiFileDiff([
      { path: "a.ts", before: "old a", after: "new a" },
      { path: "b.ts", before: "old b", after: "new b" },
    ], { noColor: true });
    expect(result).toContain("a.ts");
    expect(result).toContain("b.ts");
    expect(result).toContain("2 file(s)");
  });

  it("skips unchanged files from count", () => {
    const result = formatMultiFileDiff([
      { path: "a.ts", before: "changed", after: "updated" },
      { path: "b.ts", before: "same", after: "same" },
    ], { noColor: true });
    expect(result).toContain("1 file(s)");
    expect(result).not.toContain("b.ts");
  });

  it("uses side-by-side mode when specified", () => {
    const result = formatMultiFileDiff([
      { path: "a.ts", before: "old", after: "new" },
    ], { mode: "side-by-side", width: 160, noColor: true });
    expect(result).toContain("│");
  });
});

// ─── diffStatLine ─────────────────────────────────────────────────────────────

describe("diffStatLine", () => {
  it("returns (no changes) for identical files", () => {
    const line = diffStatLine([{ path: "a.ts", before: "same", after: "same" }], true);
    expect(line).toBe("(no changes)");
  });

  it("includes + and - counts", () => {
    const line = diffStatLine([
      { path: "a.ts", before: "line1", after: "line1\nline2" },
    ], true);
    expect(line).toContain("+1");
    expect(line).toContain("-0");
  });

  it("aggregates multiple files", () => {
    const line = diffStatLine([
      { path: "a.ts", before: "old", after: "new" },
      { path: "b.ts", before: "x\ny", after: "x" },
    ], true);
    expect(line).toContain("2 file(s)");
  });
});
