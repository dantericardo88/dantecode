import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  autoCommit,
  getLastCommitHash,
  revertLastCommit,
  getStatus,
  pushBranch,
  type CommitResult,
} from "./commit.js";
import { execSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

describe("commit system", () => {
  let repoDir: string;

  beforeEach(async () => {
    repoDir = await mkdtemp(join(tmpdir(), "dantecode-commit-test-"));
    // Initialize a git repo with an initial commit so HEAD exists
    execSync("git init", { cwd: repoDir, stdio: "pipe" });
    execSync('git config user.email "test@test.com"', {
      cwd: repoDir,
      stdio: "pipe",
    });
    execSync('git config user.name "Test"', { cwd: repoDir, stdio: "pipe" });
    await writeFile(join(repoDir, "init.txt"), "init");
    execSync("git add .", { cwd: repoDir, stdio: "pipe" });
    execSync('git commit -m "initial"', { cwd: repoDir, stdio: "pipe" });
  });

  afterEach(async () => {
    await rm(repoDir, { recursive: true, force: true });
  });

  describe("getStatus", () => {
    it("returns empty result for clean repo", () => {
      const status = getStatus(repoDir);
      expect(status.staged).toHaveLength(0);
      expect(status.unstaged).toHaveLength(0);
      expect(status.untracked).toHaveLength(0);
      expect(status.conflicted).toHaveLength(0);
    });

    it("detects untracked files", async () => {
      await writeFile(join(repoDir, "new.txt"), "hello");
      const status = getStatus(repoDir);
      expect(status.untracked).toHaveLength(1);
      expect(status.untracked[0]?.path).toBe("new.txt");
    });

    it("detects staged files", async () => {
      await writeFile(join(repoDir, "staged.txt"), "staged content");
      execSync("git add staged.txt", { cwd: repoDir, stdio: "pipe" });
      const status = getStatus(repoDir);
      expect(status.staged).toHaveLength(1);
      expect(status.staged[0]?.path).toBe("staged.txt");
    });

    it("detects unstaged modifications (via MM status)", async () => {
      // Stage a modification, then modify again to get MM status
      // This avoids a known edge case where the git() helper's .trim()
      // strips the leading space from pure worktree modifications on the first line
      await writeFile(join(repoDir, "dual.txt"), "original\n");
      execSync("git add dual.txt", { cwd: repoDir, stdio: "pipe" });
      execSync('git commit -m "add dual"', { cwd: repoDir, stdio: "pipe" });
      await writeFile(join(repoDir, "dual.txt"), "staged change\n");
      execSync("git add dual.txt", { cwd: repoDir, stdio: "pipe" });
      await writeFile(join(repoDir, "dual.txt"), "unstaged change\n");
      const status = getStatus(repoDir);
      // MM = modified in index AND worktree, appears in both staged and unstaged
      expect(status.staged.some((e) => e.path === "dual.txt")).toBe(true);
      expect(status.unstaged.some((e) => e.path === "dual.txt")).toBe(true);
    });

    it("returns empty for non-git directory", async () => {
      const nonGitDir = await mkdtemp(join(tmpdir(), "non-git-"));
      const status = getStatus(nonGitDir);
      expect(status.staged).toHaveLength(0);
      expect(status.untracked).toHaveLength(0);
      await rm(nonGitDir, { recursive: true, force: true });
    });

    it("handles renames with arrow syntax", async () => {
      await writeFile(join(repoDir, "old-name.txt"), "rename test");
      execSync("git add old-name.txt", { cwd: repoDir, stdio: "pipe" });
      execSync('git commit -m "add file"', { cwd: repoDir, stdio: "pipe" });
      execSync("git mv old-name.txt new-name.txt", {
        cwd: repoDir,
        stdio: "pipe",
      });
      const status = getStatus(repoDir);
      const renamed = status.staged.find((e) => e.path === "new-name.txt");
      expect(renamed).toBeDefined();
      expect(renamed?.origPath).toBe("old-name.txt");
    });
  });

  describe("autoCommit", () => {
    it("commits specified files and returns result", async () => {
      await writeFile(join(repoDir, "feature.ts"), "export const x = 1;");
      const result: CommitResult = autoCommit(
        {
          message: "feat: add feature module",
          footer: "Co-Authored-By: Test <test@test.com>",
          files: ["feature.ts"],
          allowEmpty: false,
        },
        repoDir,
      );
      expect(result.commitHash).toMatch(/^[0-9a-f]{40}$/);
      expect(result.message).toContain("feat: add feature module");
      expect(result.filesCommitted).toEqual(["feature.ts"]);
    });

    it("includes body in commit message when provided", async () => {
      await writeFile(join(repoDir, "body.txt"), "body test");
      const result = autoCommit(
        {
          message: "fix: patch bug",
          body: "This fixes a critical edge case in the parser.",
          footer: "Signed-off-by: Test",
          files: ["body.txt"],
          allowEmpty: false,
        },
        repoDir,
      );
      expect(result.message).toContain("This fixes a critical edge case");
    });

    it("uses DanteCode footer when no custom footer provided", async () => {
      await writeFile(join(repoDir, "footer.txt"), "footer test");
      const result = autoCommit(
        {
          message: "chore: test footer",
          footer: "",
          files: ["footer.txt"],
          allowEmpty: false,
        },
        repoDir,
      );
      // When footer is empty/falsy, buildCommitMessage uses DANTE_FOOTER
      expect(result.message).toContain("DanteCode");
    });

    it("truncates long subject lines", async () => {
      await writeFile(join(repoDir, "long.txt"), "long subject test");
      const longSubject =
        "feat: this is an extremely long commit message subject line that should definitely be truncated because it exceeds the limit";
      const result = autoCommit(
        {
          message: longSubject,
          footer: "Footer",
          files: ["long.txt"],
          allowEmpty: false,
        },
        repoDir,
      );
      const firstLine = result.message.split("\n")[0]!;
      expect(firstLine.length).toBeLessThanOrEqual(72);
      expect(firstLine).toContain("...");
    });

    it("supports allowEmpty commits", () => {
      const result = autoCommit(
        {
          message: "chore: empty commit",
          footer: "Footer",
          files: [],
          allowEmpty: true,
        },
        repoDir,
      );
      expect(result.commitHash).toMatch(/^[0-9a-f]{40}$/);
    });

    it("throws when nothing to commit", () => {
      expect(() =>
        autoCommit(
          {
            message: "nothing here",
            footer: "Footer",
            files: [],
            allowEmpty: false,
          },
          repoDir,
        ),
      ).toThrow("nothing to commit");
    });

    it("stages files in batches for large file lists", async () => {
      // Create 55 files to trigger batch staging (batch size is 50)
      for (let i = 0; i < 55; i++) {
        await writeFile(join(repoDir, `file-${i}.txt`), `content ${i}`);
      }
      const files = Array.from({ length: 55 }, (_, i) => `file-${i}.txt`);
      const result = autoCommit(
        {
          message: "feat: batch staging",
          footer: "Footer",
          files,
          allowEmpty: false,
        },
        repoDir,
      );
      expect(result.filesCommitted).toHaveLength(55);
      expect(result.commitHash).toMatch(/^[0-9a-f]{40}$/);
    });
  });

  describe("getLastCommitHash", () => {
    it("returns a valid SHA hash", () => {
      const hash = getLastCommitHash(repoDir);
      expect(hash).toMatch(/^[0-9a-f]{40}$/);
    });
  });

  describe("revertLastCommit", () => {
    it("creates a revert commit", async () => {
      await writeFile(join(repoDir, "to-revert.txt"), "revert me");
      autoCommit(
        {
          message: "feat: will be reverted",
          footer: "Footer",
          files: ["to-revert.txt"],
          allowEmpty: false,
        },
        repoDir,
      );

      const beforeHash = getLastCommitHash(repoDir);
      revertLastCommit(repoDir);
      const afterHash = getLastCommitHash(repoDir);
      expect(afterHash).not.toBe(beforeHash);
    });
  });

  describe("pushBranch", () => {
    it("pushes HEAD to the remote and verifies the remote ref", async () => {
      const remoteDir = await mkdtemp(join(tmpdir(), "dantecode-remote-"));
      execSync("git init --bare", { cwd: remoteDir, stdio: "pipe" });
      execSync(`git remote add origin "${remoteDir}"`, { cwd: repoDir, stdio: "pipe" });

      await writeFile(join(repoDir, "push.txt"), "push me");
      autoCommit(
        {
          message: "feat: add push target",
          footer: "Footer",
          files: ["push.txt"],
          allowEmpty: false,
        },
        repoDir,
      );

      const result = pushBranch({ setUpstream: true }, repoDir);
      expect(result.branch).toBeTruthy();
      expect(result.localCommit).toBe(result.remoteCommit);

      const remoteRef = execSync(`git ls-remote origin refs/heads/${result.branch}`, {
        cwd: repoDir,
        encoding: "utf-8",
        stdio: "pipe",
      }).trim();
      expect(remoteRef.startsWith(result.localCommit)).toBe(true);

      await rm(remoteDir, { recursive: true, force: true });
    });

    it("throws a helpful error when the remote is missing", () => {
      expect(() => pushBranch({}, repoDir)).toThrow(/git push:/);
    });
  });
});
