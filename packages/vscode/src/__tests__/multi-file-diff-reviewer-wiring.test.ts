// ============================================================================
// packages/vscode/src/__tests__/multi-file-diff-reviewer-wiring.test.ts
//
// Sprint 12 — Dim 7: MultiFileDiffReviewer wiring tests.
// Verifies parseMultiFileDiff, buildMultiFileDiff, formatDiffForPrompt, and
// addAnnotation from @dantecode/core are wired into multi-file-diff-panel.ts.
// ============================================================================

import { describe, it, expect, vi } from "vitest";

vi.mock("vscode", () => ({
  window: { createWebviewPanel: vi.fn(), showErrorMessage: vi.fn(), withProgress: vi.fn() },
  ViewColumn: { One: 1 },
  Uri: { parse: vi.fn((s: string) => ({ toString: () => s })), file: vi.fn((s: string) => ({ toString: () => s, fsPath: s })) },
  EventEmitter: vi.fn(() => ({ fire: vi.fn(), event: vi.fn(), dispose: vi.fn() })),
}));
import {
  parseMultiFileDiff,
  buildMultiFileDiff,
  formatDiffForPrompt,
  addAnnotation,
  getBlockingAnnotations,
  formatDiffSummary,
} from "@dantecode/core";
import { getDiffReviewContext } from "../multi-file-diff-panel.js";

const SAMPLE_GIT_DIFF = `diff --git a/src/auth.ts b/src/auth.ts
--- a/src/auth.ts
+++ b/src/auth.ts
@@ -1,5 +1,6 @@
 import jwt from 'jsonwebtoken';
-function signToken(id: string) { return jwt.sign({ id }, 'secret'); }
+function signToken(id: string, secret: string) { return jwt.sign({ id }, secret); }
+// parameterized secret for testability
 export { signToken };`;

describe("parseMultiFileDiff (Sprint 12)", () => {

  it("parses a simple git diff into FileDiff objects", () => {
    const files = parseMultiFileDiff(SAMPLE_GIT_DIFF);
    expect(files.length).toBeGreaterThan(0);
    expect(files[0]!.newPath).toContain("auth.ts");
  });

  it("counts additions and deletions correctly", () => {
    const files = parseMultiFileDiff(SAMPLE_GIT_DIFF);
    const f = files[0]!;
    expect(f.additions).toBeGreaterThan(0);
    expect(f.deletions).toBeGreaterThan(0);
  });

  it("returns [] for empty diff string", () => {
    const files = parseMultiFileDiff("");
    expect(files).toHaveLength(0);
  });

});

describe("buildMultiFileDiff + formatDiffForPrompt (Sprint 12)", () => {

  it("formatDiffForPrompt includes file header with +/- counts", () => {
    const files = parseMultiFileDiff(SAMPLE_GIT_DIFF);
    const diff = buildMultiFileDiff(files);
    const result = formatDiffForPrompt(diff);
    expect(result).toContain("auth.ts");
    expect(result).toContain("## Code Review");
  });

  it("addAnnotation adds to diff.annotations", () => {
    const files = parseMultiFileDiff(SAMPLE_GIT_DIFF);
    const diff = buildMultiFileDiff(files);
    addAnnotation(diff, "src/auth.ts", 2, "new", "Secret should be env var", "blocking");
    expect(diff.annotations.length).toBe(1);
    expect(diff.annotations[0]!.comment).toContain("Secret");
  });

  it("getBlockingAnnotations filters severity correctly", () => {
    const diff = buildMultiFileDiff([]);
    addAnnotation(diff, "f.ts", 1, "new", "ok", "suggestion");
    addAnnotation(diff, "f.ts", 2, "new", "danger", "blocking");
    const blocking = getBlockingAnnotations(diff);
    expect(blocking).toHaveLength(1);
    expect(blocking[0]!.severity).toBe("blocking");
  });

  it("formatDiffSummary produces a one-line summary", () => {
    const files = parseMultiFileDiff(SAMPLE_GIT_DIFF);
    const diff = buildMultiFileDiff(files);
    const summary = formatDiffSummary(diff);
    expect(summary).toMatch(/\d+ file/);
  });

});

describe("getDiffReviewContext — panel integration (Sprint 12)", () => {

  it("returns a non-empty review context block for a changed entry", () => {
    const entry = {
      filePath: "/src/auth.ts",
      relativePath: "src/auth.ts",
      originalContent: "function foo() { return 1; }",
      proposedContent: "function foo() { return 99; }",
      blocks: [],
      linesAdded: 1,
      linesRemoved: 1,
    };
    const result = getDiffReviewContext(entry);
    expect(result.length).toBeGreaterThan(0);
    expect(result).toContain("auth.ts");
  });

  it("returns 'No changes' for identical original and proposed", () => {
    const entry = {
      filePath: "/src/noop.ts",
      relativePath: "src/noop.ts",
      originalContent: "const x = 1;",
      proposedContent: "const x = 1;",
      blocks: [],
      linesAdded: 0,
      linesRemoved: 0,
    };
    const result = getDiffReviewContext(entry);
    expect(result).toContain("No changes");
  });

  it("respects maxChars budget", () => {
    const bigOriginal = "const x = 1;\n".repeat(500);
    const bigProposed = "const x = 99;\n".repeat(500);
    const entry = {
      filePath: "/src/big.ts",
      relativePath: "src/big.ts",
      originalContent: bigOriginal,
      proposedContent: bigProposed,
      blocks: [],
      linesAdded: 500,
      linesRemoved: 500,
    };
    const result = getDiffReviewContext(entry, 200);
    expect(result.length).toBeLessThanOrEqual(300); // truncation adds "... (diff truncated)"
  });

});
