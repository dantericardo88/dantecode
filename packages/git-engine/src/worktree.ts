// ============================================================================
// @dantecode/git-engine — Git Worktree Management
// ============================================================================

import { execFileSync } from "node:child_process";
import path from "node:path";
import type { WorktreeSpec } from "@dantecode/config-types";

// ----------------------------------------------------------------------------
// Types
// ----------------------------------------------------------------------------

/** Result returned after successfully creating a worktree. */
export interface WorktreeCreateResult {
  directory: string;
  branch: string;
}

/** A single entry from `git worktree list --porcelain`. */
export interface WorktreeEntry {
  worktree: string;
  head: string;
  branch: string;
  bare: boolean;
  detached: boolean;
  prunable: boolean;
}

/** Result from merging a worktree branch back into a target. */
export interface WorktreeMergeResult {
  merged: boolean;
  worktreeBranch: string;
  targetBranch: string;
  mergeCommitHash: string;
}

// ----------------------------------------------------------------------------
// Helpers
// ----------------------------------------------------------------------------

/**
 * Execute a git command via execFileSync (no shell — injection-safe).
 * Arguments are passed as an array so branch names/paths are never interpolated.
 */
function git(args: string[], cwd: string): string {
  try {
    return execFileSync("git", args, {
      cwd,
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
      maxBuffer: 10 * 1024 * 1024,
    }).trim();
  } catch (error: unknown) {
    const err = error as { stderr?: string; message?: string };
    const stderr = typeof err.stderr === "string" ? err.stderr.trim() : "";
    const msg = stderr || err.message || "Unknown git error";
    throw new Error(`git ${args[0] ?? "?"}: ${msg}`);
  }
}

/**
 * Resolve the top-level git directory from any path within the repo.
 */
function getRepoRoot(cwd: string): string {
  return git(["rev-parse", "--show-toplevel"], cwd);
}

// ----------------------------------------------------------------------------
// Public API
// ----------------------------------------------------------------------------

/**
 * Create a new git worktree with a new branch based on the given base branch.
 *
 * Executes: `git worktree add -b <branch> <directory> <baseBranch>`
 *
 * @param spec - Worktree specification.
 * @returns The absolute directory and branch name.
 */
export function createWorktree(spec: WorktreeSpec): WorktreeCreateResult {
  const repoRoot = getRepoRoot(spec.directory);

  // Resolve the worktree directory to an absolute path relative to repo root
  const worktreeDir = path.resolve(repoRoot, ".dantecode", "worktrees", spec.sessionId);

  git(["worktree", "add", "-b", spec.branch, worktreeDir, spec.baseBranch], repoRoot);

  return {
    directory: worktreeDir,
    branch: spec.branch,
  };
}

/**
 * Remove an existing git worktree.
 *
 * @param directory - Absolute path to the worktree directory.
 */
export function removeWorktree(directory: string): void {
  // We need to run the command from the main repo, not from the worktree itself
  const repoRoot = getRepoRoot(directory);
  git(["worktree", "remove", directory, "--force"], repoRoot);
}

/**
 * List all worktrees in the repository by parsing `git worktree list --porcelain`.
 *
 * @param projectRoot - Absolute path to the repository (or any worktree of it).
 * @returns Array of parsed worktree entries.
 */
export function listWorktrees(projectRoot: string): WorktreeEntry[] {
  const raw = git(["worktree", "list", "--porcelain"], projectRoot);

  if (!raw) {
    return [];
  }

  const entries: WorktreeEntry[] = [];
  // Porcelain format: blocks separated by blank lines
  const blocks = raw.split("\n\n");

  for (const block of blocks) {
    const lines = block.split("\n").filter((l) => l.length > 0);
    if (lines.length === 0) {
      continue;
    }

    const entry: WorktreeEntry = {
      worktree: "",
      head: "",
      branch: "",
      bare: false,
      detached: false,
      prunable: false,
    };

    for (const line of lines) {
      if (line.startsWith("worktree ")) {
        entry.worktree = line.slice("worktree ".length);
      } else if (line.startsWith("HEAD ")) {
        entry.head = line.slice("HEAD ".length);
      } else if (line.startsWith("branch ")) {
        // branch refs/heads/my-branch -> my-branch
        const fullRef = line.slice("branch ".length);
        entry.branch = fullRef.replace("refs/heads/", "");
      } else if (line === "bare") {
        entry.bare = true;
      } else if (line === "detached") {
        entry.detached = true;
      } else if (line.startsWith("prunable")) {
        entry.prunable = true;
      }
    }

    if (entry.worktree) {
      entries.push(entry);
    }
  }

  return entries;
}

/**
 * Merge a worktree's branch into a target branch, then remove the worktree.
 *
 * Steps:
 *  1. From the main repo, check out the target branch
 *  2. Merge the worktree's branch
 *  3. Remove the worktree
 *  4. Delete the worktree branch
 *
 * @param worktreeDir - Absolute path to the worktree directory.
 * @param targetBranch - The branch to merge into (e.g. "main").
 * @param projectRoot - Absolute path to the main repository working tree.
 * @returns Merge result including the new commit hash.
 */
export function mergeWorktree(
  worktreeDir: string,
  targetBranch: string,
  projectRoot: string,
): WorktreeMergeResult {
  // Determine the branch name of the worktree
  const worktreeBranch = git(["rev-parse", "--abbrev-ref", "HEAD"], worktreeDir);

  // Switch to the target branch in the main working tree
  git(["checkout", targetBranch], projectRoot);

  // Merge the worktree branch
  git(["merge", worktreeBranch, "--no-edit"], projectRoot);

  // Get the resulting merge commit hash
  const mergeCommitHash = git(["rev-parse", "HEAD"], projectRoot);

  // Remove the worktree
  git(["worktree", "remove", worktreeDir, "--force"], projectRoot);

  // Delete the worktree branch (it's been merged)
  git(["branch", "-d", worktreeBranch], projectRoot);

  return {
    merged: true,
    worktreeBranch,
    targetBranch,
    mergeCommitHash,
  };
}

/**
 * Check whether the given directory is a git worktree (as opposed to the main
 * working tree).
 *
 * A worktree has a `.git` file (not directory) that points to the main repo's
 * `.git/worktrees/<name>` directory.
 *
 * @param directory - Absolute path to check.
 * @returns `true` if the directory is a linked worktree.
 */
export function isWorktree(directory: string): boolean {
  try {
    const gitCommonDir = git(["rev-parse", "--git-common-dir"], directory);
    const gitDir = git(["rev-parse", "--git-dir"], directory);

    // In a linked worktree, git-dir and git-common-dir differ.
    // In the main working tree, they are the same (both ".git").
    const normalizedCommon = path.resolve(directory, gitCommonDir);
    const normalizedGit = path.resolve(directory, gitDir);

    return normalizedCommon !== normalizedGit;
  } catch {
    // Not a git directory at all
    return false;
  }
}
