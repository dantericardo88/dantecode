// packages/core/src/__tests__/git-context-provider.test.ts
import { describe, it, expect, vi } from "vitest";
import {
  parsePorcelainBlame,
  parseGitLog,
  parseWorkingTreeDiff,
  captureGitContext,
  formatGitContextForPrompt,
  getRecentlyModifiedFiles,
} from "../git-context-provider.js";

// ─── parsePorcelainBlame ──────────────────────────────────────────────────────

describe("parsePorcelainBlame", () => {
  const SAMPLE = [
    "abc12345def67890abc12345def67890abc12345 1 1 1",
    "author Alice",
    "author-time 1700000000",
    "summary init",
    "\tconst x = 1;",
    "abc12345def67890abc12345def67890abc12346 2 2 1",
    "author Bob",
    "author-time 1700100000",
    "summary fix",
    "\treturn x;",
  ].join("\n");

  it("parses author names", () => {
    const entries = parsePorcelainBlame(SAMPLE);
    expect(entries.some((e) => e.author === "Alice")).toBe(true);
    expect(entries.some((e) => e.author === "Bob")).toBe(true);
  });

  it("parses line numbers", () => {
    const entries = parsePorcelainBlame(SAMPLE);
    expect(entries[0]?.line).toBe(1);
    expect(entries[1]?.line).toBe(2);
  });

  it("parses commit SHAs as short (8 chars)", () => {
    const entries = parsePorcelainBlame(SAMPLE);
    for (const e of entries) {
      expect(e.commit.length).toBe(8);
    }
  });

  it("parses content lines (strips leading tab)", () => {
    const entries = parsePorcelainBlame(SAMPLE);
    expect(entries[0]?.content).toBe("const x = 1;");
  });

  it("converts unix timestamp to ISO date string", () => {
    const entries = parsePorcelainBlame(SAMPLE);
    expect(entries[0]?.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("returns empty array for empty input", () => {
    expect(parsePorcelainBlame("")).toEqual([]);
  });
});

// ─── parseGitLog ─────────────────────────────────────────────────────────────

describe("parseGitLog", () => {
  const SAMPLE = `commit abc1234
Author: Alice <alice@example.com>
Date:   Mon Jan 1 00:00:00 2024

    Add feature

src/index.ts
src/utils.ts

commit def5678
Author: Bob <bob@example.com>
Date:   Tue Jan 2 00:00:00 2024

    Fix bug

src/fix.ts
`;

  it("parses commit SHAs", () => {
    const changes = parseGitLog(SAMPLE);
    expect(changes.some((c) => c.commit === "abc1234")).toBe(true);
    expect(changes.some((c) => c.commit === "def5678")).toBe(true);
  });

  it("parses author names", () => {
    const changes = parseGitLog(SAMPLE);
    expect(changes.some((c) => c.author === "Alice")).toBe(true);
    expect(changes.some((c) => c.author === "Bob")).toBe(true);
  });

  it("parses commit messages", () => {
    const changes = parseGitLog(SAMPLE);
    expect(changes.some((c) => c.message === "Add feature")).toBe(true);
  });

  it("parses file lists", () => {
    const changes = parseGitLog(SAMPLE);
    const first = changes.find((c) => c.message === "Add feature");
    expect(first?.files).toContain("src/index.ts");
    expect(first?.files).toContain("src/utils.ts");
  });

  it("returns empty array for empty input", () => {
    expect(parseGitLog("")).toEqual([]);
  });
});

// ─── parseWorkingTreeDiff ────────────────────────────────────────────────────

describe("parseWorkingTreeDiff", () => {
  const SAMPLE = `diff --git a/src/index.ts b/src/index.ts
index abc..def 100644
--- a/src/index.ts
+++ b/src/index.ts
@@ -1,3 +1,4 @@
 const x = 1;
+const y = 2;
-const z = 3;
 export { x };
diff --git a/src/utils.ts b/src/utils.ts
index 111..222 100644
--- a/src/utils.ts
+++ b/src/utils.ts
@@ -1,2 +1,2 @@
-export function old() {}
+export function newFn() {}
`;

  it("parses file names", () => {
    const diffs = parseWorkingTreeDiff(SAMPLE);
    expect(diffs.some((d) => d.file === "src/index.ts")).toBe(true);
    expect(diffs.some((d) => d.file === "src/utils.ts")).toBe(true);
  });

  it("counts additions and deletions", () => {
    const diffs = parseWorkingTreeDiff(SAMPLE);
    const indexDiff = diffs.find((d) => d.file === "src/index.ts");
    expect(indexDiff?.additions).toBe(1);
    expect(indexDiff?.deletions).toBe(1);
  });

  it("includes diff text in output", () => {
    const diffs = parseWorkingTreeDiff(SAMPLE);
    expect(diffs[0]?.diff).toContain("diff --git");
  });

  it("returns empty array for empty input", () => {
    expect(parseWorkingTreeDiff("")).toEqual([]);
  });
});

// ─── captureGitContext ────────────────────────────────────────────────────────

describe("captureGitContext", () => {
  function makeExecFn(responses: Record<string, string>) {
    return vi.fn((_cmd: string, args: string[], _opts: unknown) => {
      const key = args.join(" ");
      for (const [pattern, response] of Object.entries(responses)) {
        if (key.includes(pattern)) return response;
      }
      return "";
    });
  }

  it("returns currentBranch from git rev-parse", () => {
    const execFn = makeExecFn({ "rev-parse": "main\n" });
    const snap = captureGitContext("/repo", { execFileFn: execFn as never });
    expect(snap.currentBranch).toBe("main");
  });

  it("returns 'unknown' when git fails", () => {
    const execFn = vi.fn(() => "");
    const snap = captureGitContext("/repo", { execFileFn: execFn as never });
    expect(snap.currentBranch).toBe("unknown");
  });

  it("includes repoRoot and generatedAt", () => {
    const execFn = vi.fn(() => "");
    const snap = captureGitContext("/my/repo", { execFileFn: execFn as never });
    expect(snap.repoRoot).toBe("/my/repo");
    expect(snap.generatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("skips blame when blameFile not specified", () => {
    const execFn = vi.fn(() => "");
    const snap = captureGitContext("/repo", { execFileFn: execFn as never });
    expect(snap.blame).toBeUndefined();
  });

  it("parses blame when blameFile is specified", () => {
    const blameRaw = [
      "abc12345def67890abc12345def67890abc12345 1 1 1",
      "author Alice",
      "author-time 1700000000",
      "summary init",
      "\tconst x = 1;",
    ].join("\n");
    const execFn = makeExecFn({ blame: blameRaw });
    const snap = captureGitContext("/repo", {
      blameFile: "src/index.ts",
      execFileFn: execFn as never,
    });
    expect(snap.blame).toBeDefined();
    expect(snap.blame!.length).toBeGreaterThan(0);
  });

  it("limits blame to maxBlameLines", () => {
    const blameLines: string[] = [];
    for (let i = 1; i <= 10; i++) {
      blameLines.push(`abc12345def67890abc12345def67890abc1234${i % 10} ${i} ${i} 1`);
      blameLines.push(`author User${i}`);
      blameLines.push(`author-time 1700000000`);
      blameLines.push(`summary line${i}`);
      blameLines.push(`\tline content ${i}`);
    }
    const execFn = makeExecFn({ blame: blameLines.join("\n") });
    const snap = captureGitContext("/repo", {
      blameFile: "file.ts",
      maxBlameLines: 3,
      execFileFn: execFn as never,
    });
    expect(snap.blame?.length).toBeLessThanOrEqual(3);
  });

  it("parses working-tree diffs", () => {
    const diffRaw = `diff --git a/src/index.ts b/src/index.ts
--- a/src/index.ts
+++ b/src/index.ts
@@ -1,1 +1,2 @@
+const y = 2;
 const x = 1;
`;
    const execFn = makeExecFn({ "diff": diffRaw, "rev-parse": "main\n" });
    const snap = captureGitContext("/repo", { execFileFn: execFn as never });
    expect(snap.workingTreeDiffs.length).toBeGreaterThan(0);
  });

  it("never throws on git errors", () => {
    const execFn = vi.fn(() => { throw new Error("git not found"); });
    expect(() => captureGitContext("/repo", { execFileFn: execFn as never })).not.toThrow();
  });

  it("truncates large diffs to maxDiffTokens", () => {
    const bigDiff = `diff --git a/src/big.ts b/src/big.ts
--- a/src/big.ts
+++ b/src/big.ts
@@ -1,1 +1,2 @@
+${"x".repeat(50000)}
 const x = 1;
`;
    const execFn = makeExecFn({ "diff": bigDiff, "rev-parse": "main" });
    const snap = captureGitContext("/repo", { maxDiffTokens: 10, execFileFn: execFn as never });
    // Each diff should be ≤ 10*4 chars + marker
    for (const d of snap.workingTreeDiffs) {
      expect(d.diff.length).toBeLessThanOrEqual(10 * 4 + 30);
    }
  });
});

// ─── formatGitContextForPrompt ────────────────────────────────────────────────

describe("formatGitContextForPrompt", () => {
  function makeSnapshot(overrides = {}): Parameters<typeof formatGitContextForPrompt>[0] {
    return {
      repoRoot: "/repo",
      currentBranch: "main",
      recentChanges: [
        { commit: "abc1234", message: "Add feature", author: "Alice", date: "2024-01-01", files: ["src/index.ts"] },
      ],
      workingTreeDiffs: [
        { file: "src/index.ts", diff: "diff --git ...", additions: 3, deletions: 1 },
      ],
      generatedAt: "2024-01-01T00:00:00.000Z",
      ...overrides,
    };
  }

  it("includes '## Git Context' header", () => {
    const output = formatGitContextForPrompt(makeSnapshot());
    expect(output).toContain("## Git Context");
  });

  it("shows current branch", () => {
    const output = formatGitContextForPrompt(makeSnapshot());
    expect(output).toContain("main");
  });

  it("shows recent commits", () => {
    const output = formatGitContextForPrompt(makeSnapshot());
    expect(output).toContain("Add feature");
    expect(output).toContain("abc1234");
  });

  it("shows working-tree diff file names", () => {
    const output = formatGitContextForPrompt(makeSnapshot());
    expect(output).toContain("src/index.ts");
  });

  it("shows +/- counts for working-tree diffs", () => {
    const output = formatGitContextForPrompt(makeSnapshot());
    expect(output).toContain("+3/-1");
  });

  it("shows 'none' when no uncommitted changes", () => {
    const snap = makeSnapshot({ workingTreeDiffs: [] });
    const output = formatGitContextForPrompt(snap);
    expect(output).toContain("none");
  });

  it("omits recent changes when showRecentChanges=false", () => {
    const output = formatGitContextForPrompt(makeSnapshot(), { showRecentChanges: false });
    expect(output).not.toContain("Add feature");
  });

  it("includes blame summary when blame is present", () => {
    const snap = makeSnapshot({
      blame: [
        { commit: "abc1234", author: "Alice", date: "2024-01-01", line: 1, content: "const x = 1;" },
        { commit: "abc1234", author: "Alice", date: "2024-01-01", line: 2, content: "const y = 2;" },
      ],
    });
    const output = formatGitContextForPrompt(snap, { showBlame: true });
    expect(output).toContain("Alice");
    expect(output).toContain("2 lines");
  });

  it("respects maxDiffFiles", () => {
    const snap = makeSnapshot({
      workingTreeDiffs: [
        { file: "a.ts", diff: "...", additions: 1, deletions: 0 },
        { file: "b.ts", diff: "...", additions: 1, deletions: 0 },
        { file: "c.ts", diff: "...", additions: 1, deletions: 0 },
      ],
    });
    const output = formatGitContextForPrompt(snap, { maxDiffFiles: 2 });
    expect(output).toContain("a.ts");
    expect(output).toContain("b.ts");
    expect(output).toContain("1 more");
  });
});

// ─── getRecentlyModifiedFiles ────────────────────────────────────────────────

describe("getRecentlyModifiedFiles", () => {
  it("returns files from recent commits, deduplicated", () => {
    const snap = {
      repoRoot: "/repo",
      currentBranch: "main",
      recentChanges: [
        { commit: "a", message: "m1", author: "A", date: "2024-01-01", files: ["src/a.ts", "src/b.ts"] },
        { commit: "b", message: "m2", author: "B", date: "2024-01-02", files: ["src/b.ts", "src/c.ts"] },
      ],
      workingTreeDiffs: [],
      generatedAt: "2024-01-01T00:00:00Z",
    };
    const files = getRecentlyModifiedFiles(snap);
    expect(files).toContain("src/a.ts");
    expect(files).toContain("src/b.ts");
    expect(files).toContain("src/c.ts");
    // b.ts appears in both commits but deduplicated
    expect(files.filter((f) => f === "src/b.ts")).toHaveLength(1);
  });

  it("respects n limit", () => {
    const snap = {
      repoRoot: "/repo",
      currentBranch: "main",
      recentChanges: [
        { commit: "a", message: "m", author: "A", date: "2024-01-01", files: ["a.ts", "b.ts", "c.ts"] },
      ],
      workingTreeDiffs: [],
      generatedAt: "2024-01-01T00:00:00Z",
    };
    const files = getRecentlyModifiedFiles(snap, 2);
    expect(files.length).toBeLessThanOrEqual(2);
  });

  it("returns empty array when no recent changes", () => {
    const snap = {
      repoRoot: "/repo",
      currentBranch: "main",
      recentChanges: [],
      workingTreeDiffs: [],
      generatedAt: "2024-01-01T00:00:00Z",
    };
    expect(getRecentlyModifiedFiles(snap)).toEqual([]);
  });
});
