// ============================================================================
// packages/vscode/src/__tests__/inline-edit-manager-wiring.test.ts
//
// Sprint 11 — Dim 6: InlineEditManager wiring tests.
// Verifies that generateDiffHunks, buildInlineEdit, applyHunkSelections, and
// EditSuggestionQueue from @dantecode/core are properly wired and functional.
// ============================================================================

import { describe, it, expect } from "vitest";
import {
  generateDiffHunks,
  buildInlineEdit,
  applyHunkSelections,
  acceptAllHunks,
  rejectAllHunks,
  EditSuggestionQueue,
  formatUnifiedDiff,
} from "@dantecode/core";

describe("generateDiffHunks — LCS-based diff (Sprint 11)", () => {

  it("returns empty hunks when original equals proposed", () => {
    const hunks = generateDiffHunks("const x = 1;", "const x = 1;");
    expect(hunks).toHaveLength(0);
  });

  it("detects a simple one-line change", () => {
    const old = "const x = 1;\nconst y = 2;\nconst z = 3;";
    const neu = "const x = 1;\nconst y = 99;\nconst z = 3;";
    const hunks = generateDiffHunks(old, neu);
    expect(hunks.length).toBeGreaterThan(0);
    const changed = hunks.flatMap((h) => h.lines).filter((l) => l.type !== "context");
    expect(changed.some((l) => l.content.includes("99"))).toBe(true);
  });

  it("detects added lines (type === 'add')", () => {
    const old = "line one\nline two";
    const neu = "line one\nnew line\nline two";
    const hunks = generateDiffHunks(old, neu);
    const adds = hunks.flatMap((h) => h.lines).filter((l) => l.type === "add");
    expect(adds.some((l) => l.content.includes("new line"))).toBe(true);
  });

  it("detects removed lines (type === 'remove')", () => {
    const old = "line one\ndelete me\nline two";
    const neu = "line one\nline two";
    const hunks = generateDiffHunks(old, neu);
    const removes = hunks.flatMap((h) => h.lines).filter((l) => l.type === "remove");
    expect(removes.some((l) => l.content.includes("delete me"))).toBe(true);
  });

});

describe("buildInlineEdit + applyHunkSelections (Sprint 11)", () => {

  it("acceptAllHunks produces the proposed content when applied", () => {
    const original = "function greet() {\n  return 'hello';\n}";
    const proposed = "function greet(name: string) {\n  return `hello, ${name}`;\n}";
    const edit = buildInlineEdit("/src/greet.ts", original, proposed, "add name param");
    acceptAllHunks(edit);
    const result = applyHunkSelections(edit);
    expect(result).toBe(proposed);
  });

  it("rejectAllHunks restores the original content when applied", () => {
    const original = "const a = 1;\nconst b = 2;";
    const proposed = "const a = 99;\nconst b = 2;";
    const edit = buildInlineEdit("/src/test.ts", original, proposed);
    rejectAllHunks(edit);
    const result = applyHunkSelections(edit);
    expect(result).toBe(original);
  });

  it("buildInlineEdit creates hunkStatus entries for each hunk", () => {
    const edit = buildInlineEdit("/f.ts", "const x = 1;", "const x = 99;");
    expect(edit.hunks.length).toBeGreaterThan(0);
    for (const hunk of edit.hunks) {
      expect(edit.hunkStatus.get(hunk.id)).toBe("pending");
    }
  });

});

describe("EditSuggestionQueue (Sprint 11)", () => {

  it("returns suggestions in priority order", () => {
    const q = new EditSuggestionQueue();
    q.push("/f.ts", { filePath: "/f.ts", startLine: 1, endLine: 1, newContent: "low" }, 1);
    q.push("/f.ts", { filePath: "/f.ts", startLine: 2, endLine: 2, newContent: "high" }, 10);
    const first = q.peek();
    expect(first?.priority).toBe(10);
  });

  it("shift removes the top suggestion", () => {
    const q = new EditSuggestionQueue();
    q.push("/a.ts", { filePath: "/a.ts", startLine: 1, endLine: 1, newContent: "x" }, 5);
    q.push("/b.ts", { filePath: "/b.ts", startLine: 1, endLine: 1, newContent: "y" }, 3);
    const top = q.shift();
    expect(top?.priority).toBe(5);
    expect(q.size).toBe(1);
  });

  it("formatUnifiedDiff produces --- / +++ header", () => {
    const hunks = generateDiffHunks("a\nb", "a\nc");
    const diff = formatUnifiedDiff(hunks, "old.ts", "new.ts");
    expect(diff).toContain("--- old.ts");
    expect(diff).toContain("+++ new.ts");
  });

});
