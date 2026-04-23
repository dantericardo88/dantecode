// packages/core/src/__tests__/multi-file-diff-reviewer.test.ts
import { describe, it, expect } from "vitest";
import {
  parseMultiFileDiff,
  buildMultiFileDiff,
  sortFilesByChangeSize,
  filterFilesByStatus,
  addAnnotation,
  getAnnotationsForFile,
  getBlockingAnnotations,
  formatDiffForPrompt,
  formatDiffSummary,
} from "../multi-file-diff-reviewer.js";

// ─── Sample Diffs ─────────────────────────────────────────────────────────────

const SIMPLE_DIFF = `diff --git a/src/index.ts b/src/index.ts
--- a/src/index.ts
+++ b/src/index.ts
@@ -1,3 +1,4 @@
 import { x } from './x';
-const a = 1;
+const a = 2;
+const b = 3;
 export { a };
`;

const TWO_FILE_DIFF = `diff --git a/src/a.ts b/src/a.ts
--- a/src/a.ts
+++ b/src/a.ts
@@ -1,2 +1,3 @@
 line1
+line2
 line3
diff --git a/src/b.ts b/src/b.ts
--- a/src/b.ts
+++ b/src/b.ts
@@ -1,3 +1,2 @@
 lineA
-lineB
 lineC
`;

const NEW_FILE_DIFF = `diff --git a/src/new.ts b/src/new.ts
new file mode 100644
--- /dev/null
+++ b/src/new.ts
@@ -0,0 +1,3 @@
+export function hello() {}
+export function world() {}
+export const VERSION = "1";
`;

const BINARY_DIFF = `diff --git a/image.png b/image.png
Binary files a/image.png and b/image.png differ
`;

const RENAME_DIFF = `diff --git a/old.ts b/new.ts
rename from old.ts
rename to new.ts
--- a/old.ts
+++ b/new.ts
@@ -1,2 +1,2 @@
-const x = 1;
+const x = 2;
 export { x };
`;

// ─── parseMultiFileDiff ───────────────────────────────────────────────────────

describe("parseMultiFileDiff", () => {
  it("parses a single file diff", () => {
    const files = parseMultiFileDiff(SIMPLE_DIFF);
    expect(files).toHaveLength(1);
    expect(files[0]!.newPath).toBe("src/index.ts");
  });

  it("parses two file diffs", () => {
    const files = parseMultiFileDiff(TWO_FILE_DIFF);
    expect(files).toHaveLength(2);
  });

  it("counts additions correctly", () => {
    const files = parseMultiFileDiff(SIMPLE_DIFF);
    expect(files[0]!.additions).toBe(2);
  });

  it("counts deletions correctly", () => {
    const files = parseMultiFileDiff(SIMPLE_DIFF);
    expect(files[0]!.deletions).toBe(1);
  });

  it("computes netChange = additions - deletions", () => {
    const files = parseMultiFileDiff(SIMPLE_DIFF);
    expect(files[0]!.netChange).toBe(1);
  });

  it("detects new file status", () => {
    const files = parseMultiFileDiff(NEW_FILE_DIFF);
    expect(files[0]!.status).toBe("added");
    expect(files[0]!.additions).toBe(3);
    expect(files[0]!.deletions).toBe(0);
  });

  it("detects binary files", () => {
    const files = parseMultiFileDiff(BINARY_DIFF);
    expect(files[0]!.isBinary).toBe(true);
    expect(files[0]!.hunks).toHaveLength(0);
  });

  it("detects renamed files", () => {
    const files = parseMultiFileDiff(RENAME_DIFF);
    expect(files[0]!.status).toBe("renamed");
    expect(files[0]!.oldPath).toBe("old.ts");
    expect(files[0]!.newPath).toBe("new.ts");
  });

  it("returns empty array for empty input", () => {
    expect(parseMultiFileDiff("")).toHaveLength(0);
  });

  it("parses hunk header correctly", () => {
    const files = parseMultiFileDiff(SIMPLE_DIFF);
    const hunk = files[0]!.hunks[0]!;
    expect(hunk.oldStart).toBe(1);
    expect(hunk.newStart).toBe(1);
    expect(hunk.header).toContain("@@");
  });

  it("classifies add/remove/context lines", () => {
    const files = parseMultiFileDiff(SIMPLE_DIFF);
    const lines = files[0]!.hunks[0]!.lines;
    expect(lines.some((l) => l.type === "add")).toBe(true);
    expect(lines.some((l) => l.type === "remove")).toBe(true);
    expect(lines.some((l) => l.type === "context")).toBe(true);
  });
});

// ─── buildMultiFileDiff ───────────────────────────────────────────────────────

describe("buildMultiFileDiff", () => {
  it("aggregates totals correctly", () => {
    const files = parseMultiFileDiff(TWO_FILE_DIFF);
    const diff = buildMultiFileDiff(files);
    expect(diff.totalFiles).toBe(2);
    expect(diff.totalAdditions).toBe(files.reduce((s, f) => s + f.additions, 0));
    expect(diff.totalDeletions).toBe(files.reduce((s, f) => s + f.deletions, 0));
  });

  it("starts with empty annotations", () => {
    const diff = buildMultiFileDiff([]);
    expect(diff.annotations).toHaveLength(0);
  });
});

// ─── sortFilesByChangeSize ────────────────────────────────────────────────────

describe("sortFilesByChangeSize", () => {
  it("sorts largest change first", () => {
    const files = parseMultiFileDiff(TWO_FILE_DIFF);
    const sorted = sortFilesByChangeSize(files);
    expect(sorted[0]!.additions + sorted[0]!.deletions).toBeGreaterThanOrEqual(
      sorted[1]!.additions + sorted[1]!.deletions,
    );
  });
});

// ─── filterFilesByStatus ──────────────────────────────────────────────────────

describe("filterFilesByStatus", () => {
  it("filters to added files only", () => {
    const files = parseMultiFileDiff(SIMPLE_DIFF + NEW_FILE_DIFF);
    const added = filterFilesByStatus(files, "added");
    expect(added.every((f) => f.status === "added")).toBe(true);
  });

  it("returns empty when no matches", () => {
    const files = parseMultiFileDiff(SIMPLE_DIFF);
    expect(filterFilesByStatus(files, "added")).toHaveLength(0);
  });
});

// ─── Annotations ─────────────────────────────────────────────────────────────

describe("addAnnotation / getAnnotationsForFile / getBlockingAnnotations", () => {
  it("adds annotation to diff", () => {
    const files = parseMultiFileDiff(SIMPLE_DIFF);
    const diff = buildMultiFileDiff(files);
    addAnnotation(diff, "src/index.ts", 2, "new", "This looks risky", "warning");
    expect(diff.annotations).toHaveLength(1);
  });

  it("getAnnotationsForFile returns only matching file", () => {
    const files = parseMultiFileDiff(TWO_FILE_DIFF);
    const diff = buildMultiFileDiff(files);
    addAnnotation(diff, "src/a.ts", 1, "new", "Note A");
    addAnnotation(diff, "src/b.ts", 1, "old", "Note B");
    expect(getAnnotationsForFile(diff, "src/a.ts")).toHaveLength(1);
    expect(getAnnotationsForFile(diff, "src/a.ts")[0]!.filePath).toBe("src/a.ts");
  });

  it("getBlockingAnnotations returns only blocking severity", () => {
    const diff = buildMultiFileDiff([]);
    addAnnotation(diff, "f.ts", 1, "new", "Suggestion", "suggestion");
    addAnnotation(diff, "f.ts", 2, "new", "BLOCKER", "blocking");
    const blocking = getBlockingAnnotations(diff);
    expect(blocking).toHaveLength(1);
    expect(blocking[0]!.severity).toBe("blocking");
  });

  it("annotation has unique ID", () => {
    const diff = buildMultiFileDiff([]);
    const a1 = addAnnotation(diff, "f.ts", 1, "new", "c1");
    const a2 = addAnnotation(diff, "f.ts", 2, "new", "c2");
    expect(a1.id).not.toBe(a2.id);
  });
});

// ─── formatDiffForPrompt ──────────────────────────────────────────────────────

describe("formatDiffForPrompt", () => {
  it("includes '## Code Review' header", () => {
    const diff = buildMultiFileDiff(parseMultiFileDiff(SIMPLE_DIFF));
    expect(formatDiffForPrompt(diff)).toContain("## Code Review");
  });

  it("includes file path", () => {
    const diff = buildMultiFileDiff(parseMultiFileDiff(SIMPLE_DIFF));
    expect(formatDiffForPrompt(diff)).toContain("src/index.ts");
  });

  it("includes + and - lines", () => {
    const diff = buildMultiFileDiff(parseMultiFileDiff(SIMPLE_DIFF));
    const result = formatDiffForPrompt(diff);
    expect(result).toContain("+const a = 2;");
    expect(result).toContain("-const a = 1;");
  });

  it("truncates at maxChars", () => {
    const largeDiff = Array.from({ length: 50 }, (_, i) => `diff --git a/f${i}.ts b/f${i}.ts\n--- a/f${i}.ts\n+++ b/f${i}.ts\n@@ -1,1 +1,1 @@\n-old${i}\n+new${i}\n`).join("\n");
    const diff = buildMultiFileDiff(parseMultiFileDiff(largeDiff));
    const result = formatDiffForPrompt(diff, { maxChars: 500 });
    expect(result.length).toBeLessThanOrEqual(530);
    expect(result).toContain("truncated");
  });

  it("shows binary file note", () => {
    const diff = buildMultiFileDiff(parseMultiFileDiff(BINARY_DIFF));
    expect(formatDiffForPrompt(diff)).toContain("Binary");
  });

  it("includes annotation in output", () => {
    const files = parseMultiFileDiff(SIMPLE_DIFF);
    const diff = buildMultiFileDiff(files);
    addAnnotation(diff, "src/index.ts", 2, "new", "Consider renaming this variable", "suggestion");
    const result = formatDiffForPrompt(diff, { includeAnnotations: true });
    expect(result).toContain("Consider renaming");
  });

  it("shows blocking issues section when blocking annotations exist", () => {
    const diff = buildMultiFileDiff(parseMultiFileDiff(SIMPLE_DIFF));
    addAnnotation(diff, "src/index.ts", 1, "new", "SQL injection risk!", "blocking");
    expect(formatDiffForPrompt(diff)).toContain("Blocking Issues");
  });

  it("fileFilter limits files shown", () => {
    const files = parseMultiFileDiff(TWO_FILE_DIFF);
    const diff = buildMultiFileDiff(files);
    const result = formatDiffForPrompt(diff, { fileFilter: (f) => f.newPath === "src/a.ts" });
    expect(result).toContain("src/a.ts");
    expect(result).not.toContain("src/b.ts");
  });
});

// ─── formatDiffSummary ────────────────────────────────────────────────────────

describe("formatDiffSummary", () => {
  it("includes file count", () => {
    const diff = buildMultiFileDiff(parseMultiFileDiff(TWO_FILE_DIFF));
    expect(formatDiffSummary(diff)).toContain("2 files");
  });

  it("includes total additions and deletions", () => {
    const diff = buildMultiFileDiff(parseMultiFileDiff(SIMPLE_DIFF));
    const summary = formatDiffSummary(diff);
    expect(summary).toContain("+2");
    expect(summary).toContain("-1");
  });

  it("includes individual file paths", () => {
    const diff = buildMultiFileDiff(parseMultiFileDiff(TWO_FILE_DIFF));
    const summary = formatDiffSummary(diff);
    expect(summary).toContain("src/a.ts");
    expect(summary).toContain("src/b.ts");
  });

  it("shows [new] badge for added files", () => {
    const diff = buildMultiFileDiff(parseMultiFileDiff(NEW_FILE_DIFF));
    expect(formatDiffSummary(diff)).toContain("[new]");
  });
});
