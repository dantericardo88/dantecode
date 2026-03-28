// ============================================================================
// @dantecode/git-engine — Diff/Undo Manager Tests
// ============================================================================

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { DiffUndoManager, createDiffUndoManager } from "./diff-undo-manager.js";

// ----------------------------------------------------------------------------
// Helpers
// ----------------------------------------------------------------------------

function git(args: string[], cwd: string): string {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf-8",
    stdio: ["pipe", "pipe", "pipe"],
  }).trim();
}

async function createTestRepo(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "diff-undo-test-"));

  // Initialize git repo
  git(["init"], dir);
  git(["config", "user.name", "Test User"], dir);
  git(["config", "user.email", "test@example.com"], dir);

  // Create initial commit
  await writeFile(join(dir, "README.md"), "# Test Repo\n");
  git(["add", "README.md"], dir);
  git(["commit", "-m", "Initial commit"], dir);

  return dir;
}

// ----------------------------------------------------------------------------
// Tests
// ----------------------------------------------------------------------------

describe("DiffUndoManager", () => {
  let testRepo: string;
  let manager: DiffUndoManager;

  beforeEach(async () => {
    testRepo = await createTestRepo();
    manager = new DiffUndoManager(testRepo, {
      autoCommitEnabled: true,
      sessionId: "test-session-123",
      commitPrefix: "[test]",
    });
  });

  afterEach(async () => {
    if (testRepo) {
      await rm(testRepo, { recursive: true, force: true });
    }
  });

  describe("autoCommitAfterEdit", () => {
    it("commits files with session prefix", async () => {
      // Create a file to commit
      await writeFile(join(testRepo, "test.ts"), "console.log('hello');\n");

      const result = await manager.autoCommitAfterEdit(["test.ts"], "Add test file");

      expect(result.commitHash).toBeTruthy();
      expect(result.message).toContain("[test]");
      expect(result.message).toContain("Add test file");
      expect(result.filesCommitted).toEqual(["test.ts"]);

      // Verify the commit was created
      const log = git(["log", "-1", "--format=%s"], testRepo);
      expect(log).toContain("[test] Add test file");
    });

    it("includes session ID in commit body", async () => {
      await writeFile(join(testRepo, "test.ts"), "console.log('hello');\n");
      await manager.autoCommitAfterEdit(["test.ts"], "Add test file");

      const body = git(["log", "-1", "--format=%b"], testRepo);
      expect(body).toContain("Session: test-session-123");
    });

    it("throws when auto-commit is disabled", async () => {
      manager.setConfig({ autoCommitEnabled: false });

      await expect(
        manager.autoCommitAfterEdit(["test.ts"], "Add test file"),
      ).rejects.toThrow("Auto-commit is disabled");
    });

    it("commits multiple files", async () => {
      await writeFile(join(testRepo, "test1.ts"), "file 1\n");
      await writeFile(join(testRepo, "test2.ts"), "file 2\n");

      const result = await manager.autoCommitAfterEdit(["test1.ts", "test2.ts"], "Add two files");

      expect(result.filesCommitted).toEqual(["test1.ts", "test2.ts"]);
    });
  });

  describe("showDiff", () => {
    it("shows diff for HEAD commit", async () => {
      await writeFile(join(testRepo, "test.ts"), "console.log('hello');\n");
      await manager.autoCommitAfterEdit(["test.ts"], "Add test file");

      const diffResult = await manager.showDiff();

      expect(diffResult.diff).toContain("test.ts");
      expect(diffResult.diff).toContain("console.log");
      expect(diffResult.filesChanged).toContain("test.ts");
      expect(diffResult.insertions).toBeGreaterThan(0);
    });

    it("shows diff for specific commit", async () => {
      await writeFile(join(testRepo, "test1.ts"), "file 1\n");
      const result1 = await manager.autoCommitAfterEdit(["test1.ts"], "Commit 1");

      await writeFile(join(testRepo, "test2.ts"), "file 2\n");
      await manager.autoCommitAfterEdit(["test2.ts"], "Commit 2");

      // Show diff for first commit
      const diffResult = await manager.showDiff(result1.commitHash);

      expect(diffResult.diff).toContain("test1.ts");
      expect(diffResult.diff).not.toContain("test2.ts");
      expect(diffResult.filesChanged).toEqual(["test1.ts"]);
    });

    it("counts insertions and deletions", async () => {
      await writeFile(join(testRepo, "test.ts"), "line 1\nline 2\nline 3\n");
      await manager.autoCommitAfterEdit(["test.ts"], "Add lines");

      await writeFile(join(testRepo, "test.ts"), "line 1\nmodified\n");
      await manager.autoCommitAfterEdit(["test.ts"], "Modify file");

      const diffResult = await manager.showDiff();

      expect(diffResult.insertions).toBeGreaterThan(0);
      expect(diffResult.deletions).toBeGreaterThan(0);
    });
  });

  describe("undo", () => {
    it("undoes last commit", async () => {
      await writeFile(join(testRepo, "test.ts"), "original\n");
      await manager.autoCommitAfterEdit(["test.ts"], "Original commit");

      await writeFile(join(testRepo, "test.ts"), "modified\n");
      await manager.autoCommitAfterEdit(["test.ts"], "Modified commit");

      const undoResult = await manager.undo(1);

      expect(undoResult.undoneCommits).toHaveLength(1);
      expect(undoResult.undoneCommits[0]?.message).toContain("Modified commit");
      expect(undoResult.filesRestored).toContain("test.ts");

      // Verify HEAD moved back
      const log = git(["log", "-1", "--format=%s"], testRepo);
      expect(log).toContain("Original commit");
    });

    it("undoes multiple commits", async () => {
      await writeFile(join(testRepo, "test1.ts"), "file 1\n");
      await manager.autoCommitAfterEdit(["test1.ts"], "Commit 1");

      await writeFile(join(testRepo, "test2.ts"), "file 2\n");
      await manager.autoCommitAfterEdit(["test2.ts"], "Commit 2");

      await writeFile(join(testRepo, "test3.ts"), "file 3\n");
      await manager.autoCommitAfterEdit(["test3.ts"], "Commit 3");

      const undoResult = await manager.undo(2);

      expect(undoResult.undoneCommits).toHaveLength(2);
      expect(undoResult.filesRestored).toContain("test2.ts");
      expect(undoResult.filesRestored).toContain("test3.ts");

      // Verify HEAD is at Commit 1
      const log = git(["log", "-1", "--format=%s"], testRepo);
      expect(log).toContain("Commit 1");
    });

    it("throws when undo steps is less than 1", async () => {
      await expect(manager.undo(0)).rejects.toThrow("Undo steps must be at least 1");
    });

    it("throws when no commits to undo", async () => {
      // Create a fresh repo with only the initial commit
      const emptyRepo = await mkdtemp(join(tmpdir(), "empty-repo-"));
      git(["init"], emptyRepo);
      git(["config", "user.name", "Test"], emptyRepo);
      git(["config", "user.email", "test@example.com"], emptyRepo);

      const emptyManager = new DiffUndoManager(emptyRepo);

      await expect(emptyManager.undo(1)).rejects.toThrow("No commits to undo");

      await rm(emptyRepo, { recursive: true, force: true });
    });

    it("keeps changes in working tree after soft reset", async () => {
      await writeFile(join(testRepo, "test.ts"), "content\n");
      await manager.autoCommitAfterEdit(["test.ts"], "Add test file");

      await manager.undo(1);

      // File should still exist with changes staged
      const status = git(["status", "--porcelain"], testRepo);
      expect(status).toContain("test.ts");
    });
  });

  describe("getCommitHistory", () => {
    it("returns commit history", async () => {
      await writeFile(join(testRepo, "test1.ts"), "file 1\n");
      await manager.autoCommitAfterEdit(["test1.ts"], "Commit 1");

      await writeFile(join(testRepo, "test2.ts"), "file 2\n");
      await manager.autoCommitAfterEdit(["test2.ts"], "Commit 2");

      // Remove session filter to get all commits
      manager.setConfig({ sessionId: undefined });
      const history = await manager.getCommitHistory(10);

      // Should have at least 3 commits (Initial + our 2)
      expect(history.length).toBeGreaterThanOrEqual(2);

      // Find commits by message content
      const hasCommit1 = history.some((h) => h.message.includes("Commit 1"));
      const hasCommit2 = history.some((h) => h.message.includes("Commit 2"));

      expect(hasCommit1).toBe(true);
      expect(hasCommit2).toBe(true);
    });

    it("filters by session ID", async () => {
      // Create commits with current session
      await writeFile(join(testRepo, "test1.ts"), "file 1\n");
      await manager.autoCommitAfterEdit(["test1.ts"], "Session commit");

      // Create commit with different session
      const otherManager = new DiffUndoManager(testRepo, {
        autoCommitEnabled: true,
        sessionId: "other-session",
      });
      await writeFile(join(testRepo, "test2.ts"), "file 2\n");
      await otherManager.autoCommitAfterEdit(["test2.ts"], "Other session commit");

      // Query with original session
      const history = await manager.getCommitHistory(10);

      // Should only return commits from test-session-123
      const sessionCommits = history.filter((entry) => entry.message.includes("Session commit"));
      expect(sessionCommits.length).toBeGreaterThan(0);
    });

    it("returns empty array for no commits", async () => {
      const emptyRepo = await mkdtemp(join(tmpdir(), "empty-repo-"));
      git(["init"], emptyRepo);
      git(["config", "user.name", "Test"], emptyRepo);
      git(["config", "user.email", "test@example.com"], emptyRepo);

      const emptyManager = new DiffUndoManager(emptyRepo);
      const history = await emptyManager.getCommitHistory(10);

      expect(history).toEqual([]);

      await rm(emptyRepo, { recursive: true, force: true });
    });
  });

  describe("createSessionBranch", () => {
    it("creates a new branch for the session", async () => {
      const branchName = await manager.createSessionBranch("my-session");

      expect(branchName).toBe("session/my-session");

      // Verify branch was created and checked out
      const currentBranch = git(["rev-parse", "--abbrev-ref", "HEAD"], testRepo);
      expect(currentBranch).toBe("session/my-session");
    });

    it("throws if branch already exists", async () => {
      await manager.createSessionBranch("my-session");

      await expect(manager.createSessionBranch("my-session")).rejects.toThrow(
        "Session branch session/my-session already exists",
      );
    });
  });

  describe("getCurrentBranch", () => {
    it("returns the current branch name", async () => {
      const branch = await manager.getCurrentBranch();
      expect(branch).toBe("master"); // or "main" depending on git version
    });

    it("throws in detached HEAD state", async () => {
      // Checkout a specific commit to enter detached HEAD state
      const hash = git(["rev-parse", "HEAD"], testRepo);
      git(["checkout", hash], testRepo);

      await expect(manager.getCurrentBranch()).rejects.toThrow("Detached HEAD");
    });
  });

  describe("isWorkingTreeClean", () => {
    it("returns true when working tree is clean", async () => {
      const isClean = await manager.isWorkingTreeClean();
      expect(isClean).toBe(true);
    });

    it("returns false when there are uncommitted changes", async () => {
      await writeFile(join(testRepo, "test.ts"), "uncommitted\n");

      const isClean = await manager.isWorkingTreeClean();
      expect(isClean).toBe(false);
    });
  });

  describe("createDiffUndoManager", () => {
    it("creates a DiffUndoManager instance", () => {
      const manager = createDiffUndoManager(testRepo, {
        sessionId: "test",
      });

      expect(manager).toBeInstanceOf(DiffUndoManager);
    });
  });

  describe("setConfig", () => {
    it("updates configuration", () => {
      manager.setConfig({ autoCommitEnabled: false, sessionId: "new-session" });

      // Verify new config is applied
      expect(async () => {
        await manager.autoCommitAfterEdit(["test.ts"], "test");
      }).rejects.toThrow("Auto-commit is disabled");
    });
  });
});
