// packages/vscode/src/__tests__/git-context-wiring.test.ts
// Sprint C — Dim 8: Git context wired into sidebar chat (git-native editing: 7→9)
import { describe, it, expect, vi } from "vitest";

// We test the underlying core module directly since sidebar-provider requires a full
// VSCode environment. The wiring tests verify that captureGitContext + formatGitContextForPrompt
// produce the right output that would be injected into the user message.

vi.mock("@dantecode/core", async () => {
  const actual = await vi.importActual<typeof import("@dantecode/core")>("@dantecode/core");
  return { ...actual };
});

import {
  captureGitContext,
  formatGitContextForPrompt,
  parsePorcelainBlame,
  parseGitLog,
  parseWorkingTreeDiff,
} from "@dantecode/core";

// ─── captureGitContext with mock exec ────────────────────────────────────────

describe("captureGitContext (mock exec)", () => {
  const makeExec = (responses: Record<string, string>) =>
    (_cmd: string, args: string[], _opts: { cwd: string; encoding: "utf-8" }) => {
      const key = args.join(" ");
      return responses[key] ?? "";
    };

  it("captures current branch from rev-parse output", () => {
    const exec = makeExec({ "rev-parse --abbrev-ref HEAD": "main\n" });
    const snapshot = captureGitContext("/repo", { execFileFn: exec });
    expect(snapshot.currentBranch).toBe("main");
  });

  it("returns 'unknown' for branch when git fails", () => {
    const exec = makeExec({});
    const snapshot = captureGitContext("/repo", { execFileFn: exec });
    expect(snapshot.currentBranch).toBe("unknown");
  });

  it("parses recent commits from log output", () => {
    const logOutput = `commit abc12345
Author: Alice <alice@example.com>
Date:   2026-04-15

    Add REST endpoint

src/routes.ts
src/index.ts

`;
    const exec = makeExec({
      "rev-parse --abbrev-ref HEAD": "feat/api\n",
      "log --max-count=5 --name-only --date=short": logOutput,
      "diff --unified=3 HEAD": "",
    });
    const snapshot = captureGitContext("/repo", { recentCommitCount: 5, execFileFn: exec });
    expect(snapshot.recentChanges.length).toBeGreaterThan(0);
    expect(snapshot.recentChanges[0]!.message).toContain("Add REST endpoint");
  });

  it("parses working-tree diffs", () => {
    const diffOutput = `diff --git a/src/foo.ts b/src/foo.ts
index 000..111 100644
--- a/src/foo.ts
+++ b/src/foo.ts
@@ -1,3 +1,4 @@
 import x from 'y';
+const newVar = 1;
 export function foo() {}
`;
    const exec = makeExec({
      "rev-parse --abbrev-ref HEAD": "main\n",
      "log --max-count=5 --name-only --date=short": "",
      "diff --unified=3 HEAD": diffOutput,
    });
    const snapshot = captureGitContext("/repo", { recentCommitCount: 5, execFileFn: exec });
    expect(snapshot.workingTreeDiffs.length).toBeGreaterThan(0);
    expect(snapshot.workingTreeDiffs[0]!.file).toContain("foo.ts");
  });

  it("snapshot always includes generatedAt ISO string", () => {
    const exec = makeExec({ "rev-parse --abbrev-ref HEAD": "main\n" });
    const snapshot = captureGitContext("/repo", { execFileFn: exec });
    expect(snapshot.generatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("truncates diffs exceeding maxDiffTokens", () => {
    const longDiff = `diff --git a/big.ts b/big.ts
index 000..111 100644
--- a/big.ts
+++ b/big.ts
@@ -1,1 +1,1 @@
+` + "x".repeat(20_000) + `
`;
    const exec = makeExec({
      "rev-parse --abbrev-ref HEAD": "main\n",
      "log --max-count=5 --name-only --date=short": "",
      "diff --unified=3 HEAD": longDiff,
    });
    const snapshot = captureGitContext("/repo", {
      recentCommitCount: 5,
      maxDiffTokens: 100,
      execFileFn: exec,
    });
    expect(snapshot.workingTreeDiffs[0]!.diff).toContain("diff truncated");
  });
});

// ─── formatGitContextForPrompt ────────────────────────────────────────────────

describe("formatGitContextForPrompt", () => {
  const baseSnapshot = {
    repoRoot: "/repo",
    recentChanges: [
      { commit: "abc123", message: "fix: login bug", author: "Bob", date: "2026-04-15", files: ["auth.ts"] },
    ],
    workingTreeDiffs: [
      { file: "src/auth.ts", diff: "--- a/auth.ts\n+++ b/auth.ts\n+const x = 1;\n", additions: 1, deletions: 0 },
    ],
    currentBranch: "feat/auth",
    generatedAt: "2026-04-15T12:00:00.000Z",
  };

  it("includes current branch in output", () => {
    const out = formatGitContextForPrompt(baseSnapshot);
    expect(out).toContain("feat/auth");
  });

  it("includes recent commit message", () => {
    const out = formatGitContextForPrompt(baseSnapshot);
    expect(out).toContain("fix: login bug");
  });

  it("includes working-tree diff file path", () => {
    const out = formatGitContextForPrompt(baseSnapshot);
    expect(out).toContain("src/auth.ts");
  });

  it("omits recent changes when showRecentChanges is false", () => {
    const out = formatGitContextForPrompt(baseSnapshot, { showRecentChanges: false });
    expect(out).not.toContain("fix: login bug");
  });

  it("omits working-tree diff when showWorkingTreeDiff is false", () => {
    const out = formatGitContextForPrompt(baseSnapshot, { showWorkingTreeDiff: false });
    expect(out).not.toContain("src/auth.ts");
  });

  it("respects maxDiffFiles limit", () => {
    const manyDiffs = Array.from({ length: 10 }, (_, i) => ({
      file: `src/file${i}.ts`,
      diff: `+const x${i} = ${i};\n`,
      additions: 1,
      deletions: 0,
    }));
    const out = formatGitContextForPrompt(
      { ...baseSnapshot, workingTreeDiffs: manyDiffs },
      { maxDiffFiles: 2 },
    );
    const matchCount = (out.match(/src\/file\d+\.ts/g) ?? []).length;
    expect(matchCount).toBeLessThanOrEqual(2);
  });

  it("returns a non-empty markdown string", () => {
    const out = formatGitContextForPrompt(baseSnapshot);
    expect(typeof out).toBe("string");
    expect(out.length).toBeGreaterThan(10);
    expect(out).toMatch(/##/);
  });
});

// ─── parsePorcelainBlame ─────────────────────────────────────────────────────

describe("parsePorcelainBlame", () => {
  it("parses a basic porcelain blame block", () => {
    const raw = `abc123def4567890abc123def4567890abc12345 1 1 1
author Alice
author-time 1713000000
\tconst x = 1;
`;
    const entries = parsePorcelainBlame(raw);
    expect(entries.length).toBe(1);
    expect(entries[0]!.author).toBe("Alice");
    expect(entries[0]!.content).toBe("const x = 1;");
    expect(entries[0]!.line).toBe(1);
  });

  it("returns empty array for empty input", () => {
    expect(parsePorcelainBlame("")).toEqual([]);
  });
});

// ─── parseGitLog ─────────────────────────────────────────────────────────────

describe("parseGitLog", () => {
  it("parses a single commit block", () => {
    const raw = `commit def456789012345678901234567890def45678
Author: Carol <carol@example.com>
Date:   2026-04-15

    refactor: cleanup

routes.ts
`;
    const changes = parseGitLog(raw);
    expect(changes.length).toBeGreaterThan(0);
    expect(changes[0]!.author).toBe("Carol");
    expect(changes[0]!.message).toBe("refactor: cleanup");
    expect(changes[0]!.files).toContain("routes.ts");
  });
});

// ─── parseWorkingTreeDiff ─────────────────────────────────────────────────────

describe("parseWorkingTreeDiff", () => {
  it("parses a unified diff with additions and deletions", () => {
    const raw = `diff --git a/src/foo.ts b/src/foo.ts
index 000..111 100644
--- a/src/foo.ts
+++ b/src/foo.ts
@@ -1,2 +1,3 @@
 import x from 'y';
+const newVar = 1;
-export const old = 0;
`;
    const diffs = parseWorkingTreeDiff(raw);
    expect(diffs.length).toBeGreaterThan(0);
    expect(diffs[0]!.file).toContain("foo.ts");
    expect(diffs[0]!.additions).toBeGreaterThan(0);
  });
});
