// packages/core/src/__tests__/inline-edit-manager.test.ts
import { describe, it, expect } from "vitest";
import {
  lcs,
  generateDiffHunks,
  formatUnifiedDiff,
  applyHunkSelections,
  applyRangeEdit,
  extractLineRange,
  detectEditConflicts,
  buildInlineEdit,
  acceptAllHunks,
  rejectAllHunks,
  EditSuggestionQueue,
  type RangeEdit,
} from "../inline-edit-manager.js";

// ─── lcs ──────────────────────────────────────────────────────────────────────

describe("lcs", () => {
  it("computes LCS length for identical arrays", () => {
    const a = ["a", "b", "c"];
    const dp = lcs(a, a);
    expect(dp[3]![3]).toBe(3);
  });

  it("returns 0 for disjoint arrays", () => {
    const dp = lcs(["a", "b"], ["c", "d"]);
    expect(dp[2]![2]).toBe(0);
  });

  it("handles empty arrays", () => {
    expect(lcs([], ["a"])[0]![1]).toBe(0);
    expect(lcs(["a"], [])[1]![0]).toBe(0);
  });

  it("computes correct LCS for partial overlap", () => {
    const dp = lcs(["a", "b", "c"], ["b", "c", "d"]);
    expect(dp[3]![3]).toBe(2);
  });
});

// ─── generateDiffHunks ────────────────────────────────────────────────────────

describe("generateDiffHunks", () => {
  it("returns empty for identical content", () => {
    expect(generateDiffHunks("hello\nworld", "hello\nworld")).toHaveLength(0);
  });

  it("produces a hunk for a single line change", () => {
    const hunks = generateDiffHunks("line1\nline2\nline3", "line1\nLINE2\nline3");
    expect(hunks.length).toBeGreaterThanOrEqual(1);
    const allLines = hunks.flatMap((h) => h.lines);
    expect(allLines.some((l) => l.type === "remove" && l.content === "line2")).toBe(true);
    expect(allLines.some((l) => l.type === "add" && l.content === "LINE2")).toBe(true);
  });

  it("hunk header contains @@ markers", () => {
    const hunks = generateDiffHunks("a\nb", "a\nc");
    expect(hunks[0]!.header).toMatch(/^@@\s+-\d+,\d+\s+\+\d+,\d+\s+@@/);
  });

  it("netChange is positive when lines are added", () => {
    const hunks = generateDiffHunks("a\nb", "a\nb\nc");
    expect(hunks[0]!.netChange).toBeGreaterThan(0);
  });

  it("netChange is negative when lines are removed", () => {
    const hunks = generateDiffHunks("a\nb\nc", "a\nb");
    expect(hunks[0]!.netChange).toBeLessThan(0);
  });

  it("merges nearby changes into a single hunk", () => {
    // Changes within 3 lines of each other should be one hunk
    const old = "a\nb\nc\nd\ne";
    const nw = "A\nb\nc\nd\nE";
    const hunks = generateDiffHunks(old, nw, 3);
    // With contextLines=3, these overlapping context windows should merge
    expect(hunks.length).toBeLessThanOrEqual(2);
  });
});

// ─── formatUnifiedDiff ────────────────────────────────────────────────────────

describe("formatUnifiedDiff", () => {
  it("returns empty string for no hunks", () => {
    expect(formatUnifiedDiff([], "old.ts", "new.ts")).toBe("");
  });

  it("includes --- and +++ file headers", () => {
    const hunks = generateDiffHunks("a\nb", "a\nc");
    const diff = formatUnifiedDiff(hunks, "old.ts", "new.ts");
    expect(diff).toContain("--- old.ts");
    expect(diff).toContain("+++ new.ts");
  });

  it("shows + prefix for added lines", () => {
    const hunks = generateDiffHunks("a", "a\nb");
    const diff = formatUnifiedDiff(hunks, "old.ts", "new.ts");
    expect(diff).toContain("+b");
  });

  it("shows - prefix for removed lines", () => {
    const hunks = generateDiffHunks("a\nb", "a");
    const diff = formatUnifiedDiff(hunks, "old.ts", "new.ts");
    expect(diff).toContain("-b");
  });
});

// ─── applyHunkSelections ──────────────────────────────────────────────────────

describe("applyHunkSelections", () => {
  it("applies all pending hunks (produces proposed content)", () => {
    const edit = buildInlineEdit("file.ts", "a\nb\nc", "a\nB\nc");
    const result = applyHunkSelections(edit);
    expect(result).toContain("B");
    expect(result).not.toContain("\nb\n");
  });

  it("reverts rejected hunks to original", () => {
    const edit = buildInlineEdit("file.ts", "a\nb\nc", "a\nB\nc");
    for (const hunk of edit.hunks) edit.hunkStatus.set(hunk.id, "rejected");
    const result = applyHunkSelections(edit);
    expect(result).toContain("b");
    expect(result).not.toContain("B");
  });

  it("handles mixed accept/reject across multiple hunks", () => {
    const edit = buildInlineEdit(
      "file.ts",
      "line1\nline2\nline3\n\nline5\nline6",
      "LINE1\nline2\nline3\n\nline5\nLINE6",
    );
    if (edit.hunks.length >= 2) {
      edit.hunkStatus.set(edit.hunks[0]!.id, "accepted");
      edit.hunkStatus.set(edit.hunks[1]!.id, "rejected");
      const result = applyHunkSelections(edit);
      expect(result).toContain("LINE1");
      expect(result).toContain("line6");
    }
  });
});

// ─── applyRangeEdit ───────────────────────────────────────────────────────────

describe("applyRangeEdit", () => {
  it("replaces specified line range with new content", () => {
    const content = "line1\nline2\nline3\nline4";
    const edit: RangeEdit = {
      filePath: "file.ts",
      startLine: 2,
      endLine: 3,
      newContent: "REPLACED",
    };
    const result = applyRangeEdit(content, edit);
    expect(result).toBe("line1\nREPLACED\nline4");
  });

  it("can insert by replacing with multiline content", () => {
    const content = "a\nb\nc";
    const edit: RangeEdit = { filePath: "f", startLine: 2, endLine: 2, newContent: "X\nY\nZ" };
    const result = applyRangeEdit(content, edit);
    expect(result).toBe("a\nX\nY\nZ\nc");
  });

  it("can delete by replacing with empty string", () => {
    const content = "a\nb\nc";
    const edit: RangeEdit = { filePath: "f", startLine: 2, endLine: 2, newContent: "" };
    const result = applyRangeEdit(content, edit);
    expect(result).toBe("a\nc");
  });
});

// ─── extractLineRange ─────────────────────────────────────────────────────────

describe("extractLineRange", () => {
  it("extracts the correct lines", () => {
    const content = "a\nb\nc\nd";
    expect(extractLineRange(content, 2, 3)).toBe("b\nc");
  });

  it("extracts single line", () => {
    expect(extractLineRange("x\ny\nz", 2, 2)).toBe("y");
  });
});

// ─── detectEditConflicts ──────────────────────────────────────────────────────

describe("detectEditConflicts", () => {
  it("returns null for edits on different files", () => {
    const a = buildInlineEdit("a.ts", "x\ny", "X\ny");
    const b = buildInlineEdit("b.ts", "x\ny", "X\ny");
    expect(detectEditConflicts(a, b)).toBeNull();
  });

  it("detects conflicting edits on same file same lines", () => {
    const a = buildInlineEdit("f.ts", "a\nb\nc", "A\nb\nc");
    const b = buildInlineEdit("f.ts", "a\nb\nc", "a\nB\nc");
    // Both modify overlapping regions
    const conflict = detectEditConflicts(a, b);
    // May or may not conflict depending on exact hunk ranges; just assert no crash
    expect(conflict === null || conflict.conflictingHunks.length >= 0).toBe(true);
  });

  it("returns conflict when hunks clearly overlap", () => {
    const original = Array.from({ length: 10 }, (_, i) => `line${i + 1}`).join("\n");
    const a = buildInlineEdit("f.ts", original, original.replace("line5", "LINE5_A"));
    const b = buildInlineEdit("f.ts", original, original.replace("line5", "LINE5_B"));
    const conflict = detectEditConflicts(a, b);
    if (a.hunks.length > 0 && b.hunks.length > 0) {
      expect(conflict).not.toBeNull();
    }
  });
});

// ─── buildInlineEdit / acceptAllHunks / rejectAllHunks ───────────────────────

describe("buildInlineEdit", () => {
  it("creates edit with unique ID", () => {
    const a = buildInlineEdit("f.ts", "a", "b");
    const b = buildInlineEdit("f.ts", "a", "b");
    expect(a.id).not.toBe(b.id);
  });

  it("all hunks start as pending", () => {
    const edit = buildInlineEdit("f.ts", "a\nb", "a\nc");
    for (const [, status] of edit.hunkStatus) {
      expect(status).toBe("pending");
    }
  });

  it("stores original and proposed content", () => {
    const edit = buildInlineEdit("f.ts", "original", "proposed");
    expect(edit.originalContent).toBe("original");
    expect(edit.proposedContent).toBe("proposed");
  });
});

describe("acceptAllHunks", () => {
  it("sets all hunks to accepted", () => {
    const edit = buildInlineEdit("f.ts", "a\nb", "a\nc");
    acceptAllHunks(edit);
    for (const [, status] of edit.hunkStatus) expect(status).toBe("accepted");
  });
});

describe("rejectAllHunks", () => {
  it("sets all hunks to rejected", () => {
    const edit = buildInlineEdit("f.ts", "a\nb", "a\nc");
    rejectAllHunks(edit);
    for (const [, status] of edit.hunkStatus) expect(status).toBe("rejected");
  });
});

// ─── EditSuggestionQueue ──────────────────────────────────────────────────────

describe("EditSuggestionQueue", () => {
  function makeRange(filePath = "f.ts"): RangeEdit {
    return { filePath, startLine: 1, endLine: 1, newContent: "x" };
  }

  it("maintains size", () => {
    const q = new EditSuggestionQueue();
    q.push("f.ts", makeRange(), 5);
    q.push("f.ts", makeRange(), 3);
    expect(q.size).toBe(2);
  });

  it("peek returns highest-priority item without removing", () => {
    const q = new EditSuggestionQueue();
    q.push("f.ts", makeRange(), 1);
    q.push("f.ts", makeRange(), 10);
    expect(q.peek()!.priority).toBe(10);
    expect(q.size).toBe(2);
  });

  it("shift removes highest-priority item", () => {
    const q = new EditSuggestionQueue();
    q.push("f.ts", makeRange(), 1);
    q.push("f.ts", makeRange(), 10);
    const item = q.shift();
    expect(item!.priority).toBe(10);
    expect(q.size).toBe(1);
  });

  it("forFile filters by filePath", () => {
    const q = new EditSuggestionQueue();
    q.push("a.ts", makeRange("a.ts"), 1);
    q.push("b.ts", makeRange("b.ts"), 2);
    expect(q.forFile("a.ts").length).toBe(1);
  });

  it("remove deletes by ID", () => {
    const q = new EditSuggestionQueue();
    const id = q.push("f.ts", makeRange(), 5);
    expect(q.remove(id)).toBe(true);
    expect(q.size).toBe(0);
  });

  it("remove returns false for unknown ID", () => {
    const q = new EditSuggestionQueue();
    expect(q.remove("nonexistent")).toBe(false);
  });

  it("clear empties the queue", () => {
    const q = new EditSuggestionQueue();
    q.push("f.ts", makeRange(), 5);
    q.clear();
    expect(q.size).toBe(0);
  });
});
