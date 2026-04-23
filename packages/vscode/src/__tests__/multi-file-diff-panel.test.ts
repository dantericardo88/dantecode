import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("vscode", () => ({
  window: {
    createWebviewPanel: vi.fn(() => ({
      webview: {
        html: "",
        onDidReceiveMessage: vi.fn(() => ({ dispose: vi.fn() })),
        asWebviewUri: vi.fn((u: unknown) => u),
      },
      onDidDispose: vi.fn(),
      dispose: vi.fn(),
      reveal: vi.fn(),
    })),
  },
  ViewColumn: { Beside: 2 },
  Uri: { joinPath: vi.fn() },
}));

vi.mock("node:fs/promises", () => ({
  readFile: vi.fn().mockResolvedValue("original content\nline2\n"),
}));

vi.mock("@dantecode/core", () => ({
  applySearchReplaceBlock: vi.fn((content: string) => ({
    matched: true,
    updatedContent: content + "\n// applied",
  })),
  generateDiffHunks: vi.fn((original: string, proposed: string) => {
    const origLines = original.split("\n");
    const propLines = proposed.split("\n");
    const added = propLines.filter((l) => !origLines.includes(l)).length;
    const removed = origLines.filter((l) => !propLines.includes(l)).length;
    // Return a minimal hunk structure with the right counts
    return added > 0 || removed > 0 ? [{
      id: "h1", header: "@@ -1 +1 @@", oldStart: 1, oldCount: removed || 0, newStart: 1, newCount: added || 0,
      lines: [
        ...origLines.filter((l) => !propLines.includes(l)).map((content) => ({ type: "remove" as const, content })),
        ...propLines.filter((l) => !origLines.includes(l)).map((content) => ({ type: "add" as const, content })),
      ],
      netChange: added - removed,
    }] : [];
  }),
  parseMultiFileDiff: vi.fn(() => []),
  buildMultiFileDiff: vi.fn(() => ({ files: [], totalAdditions: 0, totalDeletions: 0, totalFiles: 0, annotations: [] })),
  formatDiffForPrompt: vi.fn(() => "## Code Review (0 files)"),
  addAnnotation: vi.fn(),
  getAnnotationsForFile: vi.fn(
    (diff: { annotations?: unknown[] }, filePath: string) =>
      (diff.annotations ?? []).filter(
        (a: unknown) => (a as { filePath?: string }).filePath === filePath,
      ),
  ),
  getBlockingAnnotations: vi.fn(
    (diff: { annotations?: unknown[] }) =>
      (diff.annotations ?? []).filter(
        (a: unknown) => (a as { severity?: string }).severity === "blocking",
      ),
  ),
}));

import { buildPendingEntries, renderDiffHtml, getReviewHtml, getDiffReviewContext } from "../multi-file-diff-panel.js";
import type { SearchReplaceBlock, DiffReviewAnnotation } from "@dantecode/core";

const makeBlock = (filePath: string): SearchReplaceBlock => ({
  filePath,
  searchContent: "original content",
  replaceContent: "new content",
  sourceOffset: 0,
});

describe("buildPendingEntries()", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("groups blocks by file and reads original content for each unique file", async () => {
    const blocks = [makeBlock("src/foo.ts"), makeBlock("src/bar.ts")];
    const entries = await buildPendingEntries(blocks, "/project");

    // Should produce two entries (one per unique file)
    expect(entries).toHaveLength(2);
    // Each entry should have originalContent from the mocked readFile
    for (const entry of entries) {
      expect(entry.originalContent).toBe("original content\nline2\n");
    }
  });

  it("sets relativePath correctly relative to projectRoot", async () => {
    const blocks = [makeBlock("src/utils.ts")];
    const entries = await buildPendingEntries(blocks, "/project");

    expect(entries).toHaveLength(1);
    // relativePath should be the file path relative to projectRoot, using forward slashes
    expect(entries[0]!.relativePath).toMatch(/src[\\/]utils\.ts/);
  });

  it("computes linesAdded and linesRemoved from content diff", async () => {
    // applySearchReplaceBlock mock appends "\n// applied" to content
    // original: "original content\nline2\n" (3 lines when split)
    // proposed: "original content\nline2\n\n// applied" (4 lines when split)
    // The added line "// applied" is not in original → linesAdded >= 1
    const blocks = [makeBlock("src/a.ts")];
    const entries = await buildPendingEntries(blocks, "/project");

    expect(entries).toHaveLength(1);
    const entry = entries[0]!;
    // proposed has at least one line not in original
    expect(entry.linesAdded).toBeGreaterThanOrEqual(1);
    expect(typeof entry.linesRemoved).toBe("number");
  });

  it("returns empty array for empty blocks input", async () => {
    const entries = await buildPendingEntries([], "/project");
    expect(entries).toEqual([]);
  });
});

describe("renderDiffHtml()", () => {
  it("wraps lines only in proposed with class da", () => {
    const original = "line1\nline2";
    const proposed = "line1\nline2\nnew line";

    const html = renderDiffHtml(original, proposed);

    expect(html).toContain('class="da"');
    expect(html).toContain("+new line");
  });

  it("wraps lines only in original with class dr", () => {
    const original = "line1\nremoved line\nline3";
    const proposed = "line1\nline3";

    const html = renderDiffHtml(original, proposed);

    expect(html).toContain('class="dr"');
    expect(html).toContain("-removed line");
  });

  it("HTML-escapes <, >, & in diff content", () => {
    const original = "a < b && c > d";
    const proposed = "a < b && c > d\nextra";

    const html = renderDiffHtml(original, proposed);

    // The original line appears as context — must be escaped
    expect(html).toContain("&lt;");
    expect(html).toContain("&gt;");
    expect(html).toContain("&amp;");
    // Raw characters must not appear unescaped inside tags
    expect(html).not.toContain("<b");
  });

  it("for identical content produces only context (.dc) divs", () => {
    const content = "line1\nline2\nline3";

    const html = renderDiffHtml(content, content);

    expect(html).toContain('class="dc"');
    expect(html).not.toContain('class="da"');
    expect(html).not.toContain('class="dr"');
  });
});

// ── Helpers ───────────────────────────────────────────────────────────────────

const FAKE_WEBVIEW = {} as unknown as import("vscode").Webview;

const makeEntry = (relativePath = "src/foo.ts"): import("../multi-file-diff-panel.js").PendingDiffEntry => ({
  filePath: `/project/${relativePath}`,
  relativePath,
  originalContent: "line1",
  proposedContent: "line1\nnew",
  blocks: [],
  linesAdded: 1,
  linesRemoved: 0,
});

const makeAnnotation = (
  filePath: string,
  severity: DiffReviewAnnotation["severity"],
  comment = "test comment",
): DiffReviewAnnotation => ({
  id: `ann-${Math.random().toString(36).slice(2)}`,
  filePath,
  lineNo: 1,
  side: "new",
  comment,
  severity,
  createdAt: Date.now(),
});

// ── getReviewHtml annotation badge tests (Sprint 19) ─────────────────────────

describe("getReviewHtml() annotation badges (Sprint 19)", () => {

  it("renders ann-blocking class when blocking annotation present for file", () => {
    const ann = makeAnnotation("src/foo.ts", "blocking", "Missing auth check");
    const html = getReviewHtml("nonce123", [makeEntry("src/foo.ts")], FAKE_WEBVIEW, [ann]);
    expect(html).toContain('class="ann ann-blocking"');
  });

  it("renders ann-warning class for warning severity annotation", () => {
    const ann = makeAnnotation("src/foo.ts", "warning", "Performance concern");
    const html = getReviewHtml("nonce123", [makeEntry("src/foo.ts")], FAKE_WEBVIEW, [ann]);
    expect(html).toContain('class="ann ann-warning"');
  });

  it("renders ann-suggestion class for suggestion severity annotation", () => {
    const ann = makeAnnotation("src/foo.ts", "suggestion", "Consider refactoring");
    const html = getReviewHtml("nonce123", [makeEntry("src/foo.ts")], FAKE_WEBVIEW, [ann]);
    expect(html).toContain('class="ann ann-suggestion"');
  });

  it("renders no ann-row when annotations array is empty", () => {
    const html = getReviewHtml("nonce123", [makeEntry("src/foo.ts")], FAKE_WEBVIEW, []);
    expect(html).not.toContain('class="ann-row"');
    expect(html).not.toContain('class="ann ');
  });

  it("badge count matches number of annotations per file", () => {
    const annotations = [
      makeAnnotation("src/foo.ts", "blocking", "Issue 1"),
      makeAnnotation("src/foo.ts", "warning", "Issue 2"),
      makeAnnotation("src/bar.ts", "suggestion", "Other file"),
    ];
    const html = getReviewHtml("nonce123", [makeEntry("src/foo.ts")], FAKE_WEBVIEW, annotations);
    // foo.ts should have 2 badges (blocking + warning), not the bar.ts suggestion
    const annMatches = html.match(/class="ann ann-/g) ?? [];
    expect(annMatches).toHaveLength(2);
  });

  it("blocking badge CSS uses red background #f44747", () => {
    const html = getReviewHtml("nonce123", [makeEntry("src/foo.ts")], FAKE_WEBVIEW, []);
    expect(html).toContain(".ann-blocking");
    expect(html).toContain("#f44747");
  });

  it("getDiffReviewContext returns non-empty string (regression guard)", () => {
    const entry = makeEntry("src/a.ts");
    const result = getDiffReviewContext(entry);
    expect(typeof result).toBe("string");
    expect(result.length).toBeGreaterThan(0);
  });

  it("HTML-escapes annotation comment text to prevent XSS", () => {
    const xssPayload = '<script>alert("xss")</script>';
    const ann = makeAnnotation("src/foo.ts", "blocking", xssPayload);
    const html = getReviewHtml("nonce123", [makeEntry("src/foo.ts")], FAKE_WEBVIEW, [ann]);
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
  });

});

// ── Sprint A: getBlockingAnnotations routing + file-risk badge ────────────────

describe("getReviewHtml() Sprint A — getBlockingAnnotations + file-risk badge", () => {

  it("renders file-risk-blocking badge when blocking annotation present for file", () => {
    const ann = makeAnnotation("src/foo.ts", "blocking", "Auth bypass");
    const html = getReviewHtml("nonce123", [makeEntry("src/foo.ts")], FAKE_WEBVIEW, [ann]);
    expect(html).toContain('class="file-risk file-risk-blocking"');
  });

  it("file-risk badge shows blocking count", () => {
    const ann = makeAnnotation("src/foo.ts", "blocking", "Critical issue");
    const html = getReviewHtml("nonce123", [makeEntry("src/foo.ts")], FAKE_WEBVIEW, [ann]);
    expect(html).toContain("1 blocking");
  });

  it("no file-risk badge rendered when no blocking annotations for file", () => {
    const ann = makeAnnotation("src/foo.ts", "warning", "Style issue");
    const html = getReviewHtml("nonce123", [makeEntry("src/foo.ts")], FAKE_WEBVIEW, [ann]);
    // The CSS class .file-risk-blocking exists in <style> but no element should use it
    expect(html).not.toContain('class="file-risk file-risk-blocking"');
  });

  it("no file-risk badge when blocking annotation belongs to different file", () => {
    const ann = makeAnnotation("src/bar.ts", "blocking", "Other file issue");
    const html = getReviewHtml("nonce123", [makeEntry("src/foo.ts")], FAKE_WEBVIEW, [ann]);
    // bar.ts blocking annotation must not appear on foo.ts card
    expect(html).not.toContain('class="file-risk file-risk-blocking"');
  });

  it("file-risk CSS class defined in style block", () => {
    const html = getReviewHtml("nonce123", [makeEntry("src/foo.ts")], FAKE_WEBVIEW, []);
    expect(html).toContain(".file-risk-blocking");
  });

});
