/**
 * diff-renderer.test.ts — @dantecode/ux-polish
 */

import { describe, it, expect } from "vitest";
import { renderDiff, renderBeforeAfter, highlightLine } from "./diff-renderer.js";
import { ThemeEngine } from "../theme-engine.js";

const THEME = new ThemeEngine({ theme: "default", colors: false });

const SAMPLE_DIFF = `--- a/src/auth.ts
+++ b/src/auth.ts
@@ -1,4 +1,6 @@
 import { sign } from 'jsonwebtoken';
+import { hash } from 'bcryptjs';
+
 export function login(user: string): string {
-  return sign({ user }, 'secret');
+  return sign({ user }, process.env.JWT_SECRET!);
 }
`;

describe("renderDiff", () => {
  it("renders unified diff with additions green and deletions red", () => {
    const theme = new ThemeEngine({ theme: "default", colors: true });
    const result = renderDiff(SAMPLE_DIFF, { theme });
    expect(result.rendered).toContain("\x1b[32m"); // green for additions
    expect(result.rendered).toContain("\x1b[31m"); // red for deletions
    expect(result.additions).toBe(3);
    expect(result.deletions).toBe(1);
  });

  it("renders line numbers in gutter when lineNumbers: true", () => {
    const result = renderDiff(SAMPLE_DIFF, { theme: THEME, lineNumbers: true });
    // Should contain line number digits
    expect(result.rendered).toMatch(/\d+/);
  });

  it("file header shows path in output", () => {
    const result = renderDiff(SAMPLE_DIFF, { theme: THEME });
    expect(result.rendered).toContain("src/auth.ts");
    expect(result.fileCount).toBe(1);
  });

  it("truncates at maxLines and sets truncated flag", () => {
    const longDiff = SAMPLE_DIFF + SAMPLE_DIFF + SAMPLE_DIFF;
    const result = renderDiff(longDiff, { theme: THEME, maxLines: 5 });
    expect(result.truncated).toBe(true);
    expect(result.rendered).toContain("truncated");
  });

  it("returns 'No changes' for empty diff", () => {
    const result = renderDiff("", { theme: THEME });
    expect(result.rendered).toContain("No changes");
    expect(result.additions).toBe(0);
    expect(result.deletions).toBe(0);
    expect(result.truncated).toBe(false);
  });

  it("compact mode omits context lines", () => {
    const result = renderDiff(SAMPLE_DIFF, { theme: THEME, compact: true });
    // Context lines start with space, should be fewer lines
    const normalResult = renderDiff(SAMPLE_DIFF, { theme: THEME, compact: false });
    expect(result.rendered.split("\n").length).toBeLessThan(normalResult.rendered.split("\n").length);
  });
});

describe("renderBeforeAfter", () => {
  it("generates correct diff from two strings", () => {
    const before = "line1\nline2\nline3\n";
    const after = "line1\nLINE2\nline3\n";
    const result = renderBeforeAfter("test.ts", before, after, { theme: THEME });
    expect(result.additions).toBeGreaterThan(0);
    expect(result.deletions).toBeGreaterThan(0);
    expect(result.rendered).toContain("test.ts");
  });

  it("returns no-change result for identical files", () => {
    const content = "same content\n";
    const result = renderBeforeAfter("same.ts", content, content, { theme: THEME });
    expect(result.additions).toBe(0);
    expect(result.deletions).toBe(0);
  });
});

describe("highlightLine", () => {
  it("colors TypeScript keywords", () => {
    const theme = new ThemeEngine({ theme: "default", colors: true });
    const result = highlightLine("const x = function() {}", "ts", theme);
    // Keywords should be wrapped in ANSI codes
    expect(result).not.toBe("const x = function() {}");
    expect(result).toContain("const");
    expect(result).toContain("function");
  });

  it("colors Python keywords", () => {
    const theme = new ThemeEngine({ theme: "default", colors: true });
    const result = highlightLine("def my_func(x):", "py", theme);
    expect(result).toContain("def");
  });

  it("does not crash on unknown language extension", () => {
    const theme = new ThemeEngine({ theme: "default", colors: true });
    const result = highlightLine("some unknown lang content", "xyz", theme);
    expect(result).toBe("some unknown lang content");
  });
});
