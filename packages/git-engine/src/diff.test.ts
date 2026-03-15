import { describe, it, expect } from "vitest";
import { parseDiffHunks } from "./diff.js";

describe("diff parser", () => {
  describe("parseDiffHunks", () => {
    it("returns empty array for empty input", () => {
      expect(parseDiffHunks("")).toEqual([]);
      expect(parseDiffHunks("   ")).toEqual([]);
    });

    it("parses a single hunk from a simple diff", () => {
      const diff = `diff --git a/src/index.ts b/src/index.ts
--- a/src/index.ts
+++ b/src/index.ts
@@ -1,3 +1,4 @@
 import { foo } from "./foo";
+import { bar } from "./bar";

 export function main() {`;
      const hunks = parseDiffHunks(diff);
      expect(hunks).toHaveLength(1);
      expect(hunks[0]?.file).toBe("src/index.ts");
      expect(hunks[0]?.oldStart).toBe(1);
      expect(hunks[0]?.oldLines).toBe(3);
      expect(hunks[0]?.newStart).toBe(1);
      expect(hunks[0]?.newLines).toBe(4);
      expect(hunks[0]?.content).toContain('+import { bar } from "./bar";');
    });

    it("parses multiple hunks in the same file", () => {
      const diff = `diff --git a/src/app.ts b/src/app.ts
--- a/src/app.ts
+++ b/src/app.ts
@@ -5,3 +5,4 @@
 line5
 line6
+added line
 line7
@@ -20,3 +21,3 @@
 line20
-old line21
+new line21
 line22`;
      const hunks = parseDiffHunks(diff);
      expect(hunks).toHaveLength(2);
      expect(hunks[0]?.oldStart).toBe(5);
      expect(hunks[1]?.oldStart).toBe(20);
      expect(hunks[0]?.content).toContain("+added line");
      expect(hunks[1]?.content).toContain("-old line21");
      expect(hunks[1]?.content).toContain("+new line21");
    });

    it("parses hunks across multiple files", () => {
      const diff = `diff --git a/src/a.ts b/src/a.ts
--- a/src/a.ts
+++ b/src/a.ts
@@ -1,2 +1,3 @@
 line1
+new line in a
 line2
diff --git a/src/b.ts b/src/b.ts
--- a/src/b.ts
+++ b/src/b.ts
@@ -1,2 +1,3 @@
 line1
+new line in b
 line2`;
      const hunks = parseDiffHunks(diff);
      expect(hunks).toHaveLength(2);
      expect(hunks[0]?.file).toBe("src/a.ts");
      expect(hunks[1]?.file).toBe("src/b.ts");
    });

    it("handles hunk headers without line count (single-line changes)", () => {
      const diff = `diff --git a/src/config.ts b/src/config.ts
--- a/src/config.ts
+++ b/src/config.ts
@@ -10 +10 @@
-const OLD = true;
+const NEW = false;`;
      const hunks = parseDiffHunks(diff);
      expect(hunks).toHaveLength(1);
      expect(hunks[0]?.oldStart).toBe(10);
      expect(hunks[0]?.oldLines).toBe(1);
      expect(hunks[0]?.newStart).toBe(10);
      expect(hunks[0]?.newLines).toBe(1);
    });

    it("handles 'No newline at end of file' marker", () => {
      const diff = `diff --git a/src/file.ts b/src/file.ts
--- a/src/file.ts
+++ b/src/file.ts
@@ -1,2 +1,2 @@
 line1
-line2
\\ No newline at end of file
+line2 modified
\\ No newline at end of file`;
      const hunks = parseDiffHunks(diff);
      expect(hunks).toHaveLength(1);
      expect(hunks[0]?.content).toContain("\\ No newline at end of file");
    });

    it("extracts file path from 'b' side of diff header", () => {
      const diff = `diff --git a/old/path.ts b/new/path.ts
--- a/old/path.ts
+++ b/new/path.ts
@@ -1,2 +1,2 @@
-old content
+new content`;
      const hunks = parseDiffHunks(diff);
      expect(hunks[0]?.file).toBe("new/path.ts");
    });

    it("preserves deletion and addition markers in content", () => {
      const diff = `diff --git a/src/main.ts b/src/main.ts
--- a/src/main.ts
+++ b/src/main.ts
@@ -1,3 +1,3 @@
 keep this
-remove this
+add this
 keep this too`;
      const hunks = parseDiffHunks(diff);
      expect(hunks[0]?.content).toContain("-remove this");
      expect(hunks[0]?.content).toContain("+add this");
      expect(hunks[0]?.content).toContain(" keep this");
    });

    it("handles large hunk ranges", () => {
      const diff = `diff --git a/big.ts b/big.ts
--- a/big.ts
+++ b/big.ts
@@ -100,50 +100,55 @@
 context line
+added line`;
      const hunks = parseDiffHunks(diff);
      expect(hunks[0]?.oldStart).toBe(100);
      expect(hunks[0]?.oldLines).toBe(50);
      expect(hunks[0]?.newStart).toBe(100);
      expect(hunks[0]?.newLines).toBe(55);
    });
  });
});
