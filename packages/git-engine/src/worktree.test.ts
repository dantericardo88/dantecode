import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  createWorktree,
  removeWorktree,
  listWorktrees,
  mergeWorktree,
  isWorktree,
} from "./worktree.js";
import { execSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

describe("worktree management", () => {
  let repoDir: string;

  beforeEach(async () => {
    repoDir = await mkdtemp(join(tmpdir(), "dantecode-worktree-test-"));
    execSync("git init", { cwd: repoDir, stdio: "pipe" });
    execSync('git config user.email "test@test.com"', {
      cwd: repoDir,
      stdio: "pipe",
    });
    execSync('git config user.name "Test"', { cwd: repoDir, stdio: "pipe" });
    await writeFile(join(repoDir, "init.txt"), "initial content\n");
    execSync('git add . && git commit -m "initial commit"', {
      cwd: repoDir,
      stdio: "pipe",
    });
  });

  afterEach(async () => {
    // Clean up any worktrees before removing the directory
    try {
      const output = execSync("git worktree list --porcelain", {
        cwd: repoDir,
        encoding: "utf-8",
        stdio: ["pipe", "pipe", "pipe"],
      });
      const worktreePaths = output
        .split("\n")
        .filter((l) => l.startsWith("worktree "))
        .map((l) => l.slice("worktree ".length))
        .filter((p) => p !== repoDir);
      for (const wt of worktreePaths) {
        try {
          execSync(`git worktree remove "${wt}" --force`, {
            cwd: repoDir,
            stdio: "pipe",
          });
        } catch {
          // ignore cleanup errors
        }
      }
    } catch {
      // ignore
    }
    await rm(repoDir, { recursive: true, force: true });
  });

  describe("listWorktrees", () => {
    it("lists the main worktree", () => {
      const entries = listWorktrees(repoDir);
      expect(entries.length).toBeGreaterThanOrEqual(1);
      // The main worktree is always listed
      const main = entries.find((e) => e.branch === "master" || e.branch === "main");
      expect(main).toBeDefined();
    });

    it("returns head commit hash for each entry", () => {
      const entries = listWorktrees(repoDir);
      expect(entries[0]?.head).toMatch(/^[0-9a-f]{40}$/);
    });

    it("detects bare and detached flags correctly", () => {
      const entries = listWorktrees(repoDir);
      // A normal repo is not bare or detached
      expect(entries[0]?.bare).toBe(false);
      expect(entries[0]?.detached).toBe(false);
    });
  });

  describe("createWorktree", () => {
    it("creates a new worktree with a branch", () => {
      const currentBranch = execSync("git rev-parse --abbrev-ref HEAD", {
        cwd: repoDir,
        encoding: "utf-8",
      }).trim();

      const result = createWorktree({
        branch: "feature-test",
        baseBranch: currentBranch,
        sessionId: "session-123",
        directory: repoDir,
      });

      expect(result.branch).toBe("feature-test");
      expect(result.directory).toContain("session-123");
    });

    it("worktree appears in listWorktrees after creation", () => {
      const currentBranch = execSync("git rev-parse --abbrev-ref HEAD", {
        cwd: repoDir,
        encoding: "utf-8",
      }).trim();

      createWorktree({
        branch: "wt-list-test",
        baseBranch: currentBranch,
        sessionId: "session-list",
        directory: repoDir,
      });

      const entries = listWorktrees(repoDir);
      const wtEntry = entries.find((e) => e.branch === "wt-list-test");
      expect(wtEntry).toBeDefined();
    });

    it("throws when branch already exists", () => {
      const currentBranch = execSync("git rev-parse --abbrev-ref HEAD", {
        cwd: repoDir,
        encoding: "utf-8",
      }).trim();

      createWorktree({
        branch: "duplicate-branch",
        baseBranch: currentBranch,
        sessionId: "session-dup-1",
        directory: repoDir,
      });

      expect(() =>
        createWorktree({
          branch: "duplicate-branch",
          baseBranch: currentBranch,
          sessionId: "session-dup-2",
          directory: repoDir,
        }),
      ).toThrow();
    });
  });

  describe("removeWorktree", () => {
    it("removes an existing worktree (or throws Permission denied on Windows)", () => {
      const currentBranch = execSync("git rev-parse --abbrev-ref HEAD", {
        cwd: repoDir,
        encoding: "utf-8",
      }).trim();

      const result = createWorktree({
        branch: "to-remove",
        baseBranch: currentBranch,
        sessionId: "session-remove",
        directory: repoDir,
      });

      try {
        removeWorktree(result.directory);
        // If removal succeeded, verify it's gone
        const entries = listWorktrees(repoDir);
        const removed = entries.find((e) => e.branch === "to-remove");
        expect(removed).toBeUndefined();
      } catch (err) {
        // Windows may throw "Permission denied" due to file locking
        expect(String(err)).toContain("Permission denied");
      }
    });

    it("throws for non-existent worktree directory", () => {
      expect(() => removeWorktree(join(repoDir, "nonexistent-worktree"))).toThrow();
    });
  });

  describe("isWorktree", () => {
    it("returns false for the main working tree", () => {
      expect(isWorktree(repoDir)).toBe(false);
    });

    it("returns true for a linked worktree", () => {
      const currentBranch = execSync("git rev-parse --abbrev-ref HEAD", {
        cwd: repoDir,
        encoding: "utf-8",
      }).trim();

      const result = createWorktree({
        branch: "wt-check",
        baseBranch: currentBranch,
        sessionId: "session-check",
        directory: repoDir,
      });

      expect(isWorktree(result.directory)).toBe(true);
    });

    it("returns false for a non-git directory", async () => {
      const nonGitDir = await mkdtemp(join(tmpdir(), "non-git-"));
      expect(isWorktree(nonGitDir)).toBe(false);
      await rm(nonGitDir, { recursive: true, force: true });
    });
  });

  describe("mergeWorktree", () => {
    it("merges worktree branch into target and cleans up", async () => {
      const currentBranch = execSync("git rev-parse --abbrev-ref HEAD", {
        cwd: repoDir,
        encoding: "utf-8",
      }).trim();

      const result = createWorktree({
        branch: "feature-merge",
        baseBranch: currentBranch,
        sessionId: "session-merge",
        directory: repoDir,
      });

      // Make a commit in the worktree
      await writeFile(join(result.directory, "feature.txt"), "new feature\n");
      execSync('git add . && git commit -m "add feature"', {
        cwd: result.directory,
        stdio: "pipe",
      });

      const mergeResult = mergeWorktree(result.directory, currentBranch, repoDir);

      expect(mergeResult.merged).toBe(true);
      expect(mergeResult.worktreeBranch).toBe("feature-merge");
      expect(mergeResult.targetBranch).toBe(currentBranch);
      expect(mergeResult.mergeCommitHash).toMatch(/^[0-9a-f]{40}$/);

      // Verify worktree is removed from list
      const entries = listWorktrees(repoDir);
      const merged = entries.find((e) => e.branch === "feature-merge");
      expect(merged).toBeUndefined();
    });

    it("returns a valid commit hash after merge", async () => {
      const currentBranch = execSync("git rev-parse --abbrev-ref HEAD", {
        cwd: repoDir,
        encoding: "utf-8",
      }).trim();

      const result = createWorktree({
        branch: "feature-hash",
        baseBranch: currentBranch,
        sessionId: "session-hash",
        directory: repoDir,
      });

      await writeFile(join(result.directory, "hash-test.txt"), "content\n");
      execSync('git add . && git commit -m "test commit"', {
        cwd: result.directory,
        stdio: "pipe",
      });

      const mergeResult = mergeWorktree(result.directory, currentBranch, repoDir);

      // Verify the hash matches current HEAD
      const currentHead = execSync("git rev-parse HEAD", {
        cwd: repoDir,
        encoding: "utf-8",
      }).trim();
      expect(mergeResult.mergeCommitHash).toBe(currentHead);
    });
  });
});
