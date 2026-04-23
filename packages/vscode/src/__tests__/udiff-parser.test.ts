import { describe, it, expect } from "vitest";
import { parseUdiffResponse, renderDiffHtml } from "../udiff-parser.js";

describe("parseUdiffResponse", () => {
  it("parses single-file udiff with one hunk into one SearchReplaceBlock", () => {
    const udiff = [
      "--- a/src/foo.ts",
      "+++ b/src/foo.ts",
      "@@ -1,4 +1,5 @@",
      " import { x } from './x';",
      "-const old = 1;",
      "+const old = 2;",
      "+const extra = 3;",
    ].join("\n");

    const blocks = parseUdiffResponse(udiff);

    expect(blocks).toHaveLength(1);
    expect(blocks[0]!.filePath).toBe("src/foo.ts");
    expect(blocks[0]!.searchContent).toBe("import { x } from './x';\nconst old = 1;");
    expect(blocks[0]!.replaceContent).toBe(
      "import { x } from './x';\nconst old = 2;\nconst extra = 3;",
    );
  });

  it("parses multi-file udiff into one block per file", () => {
    const udiff = [
      "--- a/src/alpha.ts",
      "+++ b/src/alpha.ts",
      "@@ -1,2 +1,2 @@",
      " const a = 1;",
      "-const b = 2;",
      "+const b = 99;",
      "--- a/src/beta.ts",
      "+++ b/src/beta.ts",
      "@@ -1,2 +1,2 @@",
      " const x = 'hello';",
      "-const y = 'world';",
      "+const y = 'earth';",
    ].join("\n");

    const blocks = parseUdiffResponse(udiff);

    expect(blocks).toHaveLength(2);
    expect(blocks[0]!.filePath).toBe("src/alpha.ts");
    expect(blocks[1]!.filePath).toBe("src/beta.ts");
  });

  it("includes context lines (space prefix) in BOTH searchContent and replaceContent", () => {
    const udiff = [
      "--- a/lib/util.ts",
      "+++ b/lib/util.ts",
      "@@ -10,4 +10,4 @@",
      " function greet() {",
      "-  return 'hi';",
      "+  return 'hello';",
      " }",
    ].join("\n");

    const blocks = parseUdiffResponse(udiff);

    expect(blocks).toHaveLength(1);
    const block = blocks[0]!;
    // Context lines appear in both
    expect(block.searchContent).toContain("function greet() {");
    expect(block.replaceContent).toContain("function greet() {");
    expect(block.searchContent).toContain("}");
    expect(block.replaceContent).toContain("}");
  });

  it("puts removal lines (-) into searchContent only, not replaceContent", () => {
    const udiff = [
      "--- a/src/old.ts",
      "+++ b/src/old.ts",
      "@@ -5,3 +5,2 @@",
      " const keep = true;",
      "-const remove = 'gone';",
      " const also = false;",
    ].join("\n");

    const blocks = parseUdiffResponse(udiff);

    expect(blocks).toHaveLength(1);
    expect(blocks[0]!.searchContent).toContain("const remove = 'gone';");
    expect(blocks[0]!.replaceContent).not.toContain("const remove = 'gone';");
  });

  it("puts addition lines (+) into replaceContent only, not searchContent", () => {
    const udiff = [
      "--- a/src/new.ts",
      "+++ b/src/new.ts",
      "@@ -3,2 +3,3 @@",
      " const existing = 1;",
      "+const added = 2;",
      " const end = 3;",
    ].join("\n");

    const blocks = parseUdiffResponse(udiff);

    expect(blocks).toHaveLength(1);
    expect(blocks[0]!.replaceContent).toContain("const added = 2;");
    expect(blocks[0]!.searchContent).not.toContain("const added = 2;");
  });

  it("returns [] for text with no --- / +++ headers", () => {
    const text = "This is just prose without any diff headers.\nNo blocks here.";
    const blocks = parseUdiffResponse(text);
    expect(blocks).toEqual([]);
  });

  it("still emits a block for a hunk with zero context lines (pure addition)", () => {
    const udiff = [
      "--- /dev/null",
      "+++ b/src/brand-new.ts",
      "@@ -0,0 +1,3 @@",
      "+export function newFn() {",
      "+  return 42;",
      "+}",
    ].join("\n");

    const blocks = parseUdiffResponse(udiff);

    expect(blocks).toHaveLength(1);
    expect(blocks[0]!.searchContent).toBe("");
    expect(blocks[0]!.replaceContent).toBe("export function newFn() {\n  return 42;\n}");
  });

  it("renders diff lines as HTML with correct classes and HTML-escapes < and >", () => {
    const lines = [
      "+const a = <T>val;",
      "-const a = old & gone;",
      " const b = 1 > 0;",
      "@@ -1,4 +1,5 @@",
    ];

    const html = renderDiffHtml(lines);

    expect(html).toContain('<div class="diff-add">+const a = &lt;T&gt;val;</div>');
    expect(html).toContain('<div class="diff-remove">-const a = old &amp; gone;</div>');
    expect(html).toContain('<div class="diff-ctx"> const b = 1 &gt; 0;</div>');
    expect(html).toContain('<div class="diff-hunk">@@ -1,4 +1,5 @@</div>');
  });
});
