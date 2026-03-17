import { describe, it, expect, vi, beforeEach } from "vitest";
import type { DiffHunk } from "@dantecode/config-types";

// ---------------------------------------------------------------------------
// Mock child_process and fs for getDiff/getStagedDiff/applyDiff tests
// ---------------------------------------------------------------------------

vi.mock("node:child_process", () => ({
  execSync: vi.fn(),
}));

vi.mock("node:fs", () => ({
  writeFileSync: vi.fn(),
  unlinkSync: vi.fn(),
}));

import { parseDiffHunks, getDiff, getStagedDiff, applyDiff, generateColoredHunk } from "./diff.js";
import { execSync } from "node:child_process";
import { writeFileSync, unlinkSync } from "node:fs";

// ---------------------------------------------------------------------------
// parseDiffHunks (pure string parser — no mocks needed)
// ---------------------------------------------------------------------------

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

    it("flushes hunk when 'diff ' line appears mid-hunk (combined diff)", () => {
      const diff = `diff --git a/src/a.ts b/src/a.ts
--- a/src/a.ts
+++ b/src/a.ts
@@ -1,2 +1,3 @@
 line1
+added
diff src/b.ts
@@ -1,2 +1,2 @@
-old
+new`;
      const hunks = parseDiffHunks(diff);
      // First hunk should be flushed when "diff src/b.ts" is encountered
      expect(hunks.length).toBeGreaterThanOrEqual(1);
      expect(hunks[0]?.file).toBe("src/a.ts");
      expect(hunks[0]?.content).toContain("+added");
    });
  });

  // -------------------------------------------------------------------------
  // getDiff / getStagedDiff (mocked execSync)
  // -------------------------------------------------------------------------

  describe("getDiff", () => {
    beforeEach(() => {
      vi.clearAllMocks();
    });

    it("calls git diff without ref", () => {
      (execSync as ReturnType<typeof vi.fn>).mockReturnValueOnce("diff output");
      const result = getDiff("/project");
      expect(result).toBe("diff output");
      expect(execSync).toHaveBeenCalledWith(
        "git diff",
        expect.objectContaining({ cwd: "/project" }),
      );
    });

    it("calls git diff with ref when provided", () => {
      (execSync as ReturnType<typeof vi.fn>).mockReturnValueOnce("ref diff output");
      const result = getDiff("/project", "HEAD~2");
      expect(result).toBe("ref diff output");
      expect(execSync).toHaveBeenCalledWith(
        'git diff "HEAD~2"',
        expect.objectContaining({ cwd: "/project" }),
      );
    });

    it("treats exit code 1 with stdout as success (differences found)", () => {
      const exitOneError = Object.assign(new Error("exit 1"), {
        status: 1,
        stdout: "diff --git a/file.ts b/file.ts\n",
      });
      (execSync as ReturnType<typeof vi.fn>).mockImplementationOnce(() => {
        throw exitOneError;
      });
      const result = getDiff("/project");
      expect(result).toBe("diff --git a/file.ts b/file.ts\n");
    });

    it("throws on real git errors", () => {
      const realError = Object.assign(new Error("git error"), {
        status: 128,
        stderr: "fatal: not a git repository",
      });
      (execSync as ReturnType<typeof vi.fn>).mockImplementationOnce(() => {
        throw realError;
      });
      expect(() => getDiff("/project")).toThrow("git diff: fatal: not a git repository");
    });

    it("uses error message when stderr is empty", () => {
      const err = Object.assign(new Error("some error"), {
        status: 2,
        stderr: "",
        message: "some error",
      });
      (execSync as ReturnType<typeof vi.fn>).mockImplementationOnce(() => {
        throw err;
      });
      expect(() => getDiff("/project")).toThrow("git diff: some error");
    });

    it("uses 'Unknown git error' when no stderr or message", () => {
      const err = Object.assign(new Error(""), { status: 2, stderr: "" });
      err.message = "";
      (execSync as ReturnType<typeof vi.fn>).mockImplementationOnce(() => {
        throw err;
      });
      expect(() => getDiff("/project")).toThrow("Unknown git error");
    });
  });

  describe("getStagedDiff", () => {
    beforeEach(() => {
      vi.clearAllMocks();
    });

    it("calls git diff --cached", () => {
      (execSync as ReturnType<typeof vi.fn>).mockReturnValueOnce("staged diff");
      const result = getStagedDiff("/project");
      expect(result).toBe("staged diff");
      expect(execSync).toHaveBeenCalledWith(
        "git diff --cached",
        expect.objectContaining({ cwd: "/project" }),
      );
    });
  });

  // -------------------------------------------------------------------------
  // applyDiff (mocked execSync, writeFileSync, unlinkSync)
  // -------------------------------------------------------------------------

  describe("applyDiff", () => {
    beforeEach(() => {
      vi.clearAllMocks();
    });

    const testHunk: DiffHunk = {
      file: "src/test.ts",
      oldStart: 1,
      oldLines: 3,
      newStart: 1,
      newLines: 4,
      content: "@@ -1,3 +1,4 @@\n line1\n+added\n line2\n line3",
    };

    it("writes patch to temp file and runs git apply", () => {
      (execSync as ReturnType<typeof vi.fn>).mockReturnValueOnce("");

      applyDiff(testHunk, "/project");

      expect(writeFileSync).toHaveBeenCalledTimes(1);
      const [tmpPath, content] = (writeFileSync as ReturnType<typeof vi.fn>).mock.calls[0]!;
      expect(tmpPath).toContain("dantecode-patch-");
      expect(tmpPath).toContain(".patch");
      expect(content).toContain("--- a/src/test.ts");
      expect(content).toContain("+++ b/src/test.ts");
      expect(content).toContain("@@ -1,3 +1,4 @@");

      expect(execSync).toHaveBeenCalledWith(
        expect.stringContaining("git apply --allow-empty"),
        expect.objectContaining({ cwd: "/project" }),
      );
    });

    it("ensures patch ends with newline", () => {
      (execSync as ReturnType<typeof vi.fn>).mockReturnValueOnce("");
      applyDiff(testHunk, "/project");

      const [, content] = (writeFileSync as ReturnType<typeof vi.fn>).mock.calls[0]!;
      expect(content.endsWith("\n")).toBe(true);
    });

    it("cleans up temp file after success", () => {
      (execSync as ReturnType<typeof vi.fn>).mockReturnValueOnce("");
      applyDiff(testHunk, "/project");

      expect(unlinkSync).toHaveBeenCalledTimes(1);
    });

    it("throws on git apply error with stderr", () => {
      const err = Object.assign(new Error("apply failed"), {
        stderr: "error: patch does not apply",
      });
      (execSync as ReturnType<typeof vi.fn>).mockImplementationOnce(() => {
        throw err;
      });

      expect(() => applyDiff(testHunk, "/project")).toThrow(
        "git apply: error: patch does not apply",
      );
    });

    it("cleans up temp file even after error", () => {
      const err = Object.assign(new Error("apply failed"), {
        stderr: "error",
      });
      (execSync as ReturnType<typeof vi.fn>).mockImplementationOnce(() => {
        throw err;
      });

      try {
        applyDiff(testHunk, "/project");
      } catch {
        // expected
      }

      expect(unlinkSync).toHaveBeenCalledTimes(1);
    });

    it("propagates git error even when cleanup fails", () => {
      const applyError = Object.assign(new Error("apply failed"), {
        stderr: "patch error",
      });
      (execSync as ReturnType<typeof vi.fn>).mockImplementationOnce(() => {
        throw applyError;
      });
      (unlinkSync as ReturnType<typeof vi.fn>).mockImplementationOnce(() => {
        throw new Error("cleanup failed");
      });

      // The git apply error should propagate, not the cleanup error
      expect(() => applyDiff(testHunk, "/project")).toThrow("git apply: patch error");
    });
  });
});

// ---------------------------------------------------------------------------
// generateColoredHunk (pure function — no mocks needed)
// ---------------------------------------------------------------------------

describe("generateColoredHunk", () => {
  it("new file: all lines are type 'add' with correct newLineNo", () => {
    const result = generateColoredHunk("", "line1\nline2\nline3", "test.ts");
    expect(result.lines.every(l => l.type === "add")).toBe(true);
    expect(result.linesAdded).toBe(3);
    expect(result.linesRemoved).toBe(0);
    expect(result.lines[0]?.newLineNo).toBe(1);
    expect(result.lines[2]?.newLineNo).toBe(3);
  });

  it("deleted file: all lines are type 'remove' with correct oldLineNo", () => {
    const result = generateColoredHunk("line1\nline2", "", "test.ts");
    expect(result.lines.every(l => l.type === "remove")).toBe(true);
    expect(result.linesRemoved).toBe(2);
    expect(result.linesAdded).toBe(0);
    expect(result.lines[0]?.oldLineNo).toBe(1);
  });

  it("modified file: produces correct mix of add/remove/context lines", () => {
    const result = generateColoredHunk("line1\nline2\nline3", "line1\nchanged\nline3", "test.ts");
    const types = result.lines.map(l => l.type);
    expect(types).toContain("remove");
    expect(types).toContain("add");
  });

  it("hunk headers appear before changed sections", () => {
    const result = generateColoredHunk("a\nb\nc", "a\nx\nc", "test.ts");
    const headerIdx = result.lines.findIndex(l => l.type === "hunk_header");
    expect(headerIdx).toBeGreaterThanOrEqual(0);
    expect(result.lines[headerIdx]?.content).toContain("@@");
  });

  it("truncation at MAX_DIFF_LINES sets truncated=true and fullLineCount", () => {
    const oldLines = Array.from({ length: 100 }, (_, i) => `old-${i}`).join("\n");
    const newLines = Array.from({ length: 100 }, (_, i) => `new-${i}`).join("\n");
    const result = generateColoredHunk(oldLines, newLines, "big.ts");
    if (result.fullLineCount > 80) {
      expect(result.truncated).toBe(true);
      expect(result.lines.length).toBeLessThanOrEqual(80);
    }
  });

  it("binary file detection returns single hunk_header line", () => {
    const result = generateColoredHunk("hello\x00world", "new content", "image.png");
    expect(result.lines).toHaveLength(1);
    expect(result.lines[0]?.type).toBe("hunk_header");
    expect(result.lines[0]?.content).toContain("Binary file");
    expect(result.linesAdded).toBe(0);
    expect(result.linesRemoved).toBe(0);
  });

  it("linesAdded count matches add-type lines in DiffLine[]", () => {
    const result = generateColoredHunk("a", "a\nb\nc", "test.ts");
    const addCount = result.lines.filter(l => l.type === "add").length;
    expect(result.linesAdded).toBe(addCount);
  });

  it("linesRemoved count matches remove-type lines in DiffLine[]", () => {
    const result = generateColoredHunk("a\nb\nc", "a", "test.ts");
    const removeCount = result.lines.filter(l => l.type === "remove").length;
    expect(result.linesRemoved).toBe(removeCount);
  });

  it("CRLF line endings handled correctly", () => {
    const result = generateColoredHunk("", "line1\r\nline2\r\n", "test.ts");
    expect(result.linesAdded).toBeGreaterThan(0);
    expect(result.lines.some(l => l.content.includes("\r"))).toBe(false);
  });
});
