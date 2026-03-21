// ============================================================================
// @dantecode/git-engine — Merge Helpers
// Git merge utilities for the Council Orchestrator.
// Provides candidate preservation, safe merge attempts, and rollback.
// ============================================================================

import { execSync } from "node:child_process";
import { writeFileSync, unlinkSync, mkdirSync } from "node:fs";
import { writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";

// ----------------------------------------------------------------------------
// Types
// ----------------------------------------------------------------------------

/** Result of a merge attempt. */
export interface MergeAttemptResult {
  success: boolean;
  mergeCommitHash?: string;
  conflictedFiles: string[];
  /** Whether merge was aborted and rolled back. */
  aborted: boolean;
}

/** Preserved candidate snapshot before merge. */
export interface CandidateSnapshot {
  branch: string;
  headCommit: string;
  patchPath: string;
  capturedAt: string;
}

export interface MergeOptions {
  /** Whether to produce a merge commit (default true). */
  noFf?: boolean;
  /** Commit message for the merge commit. */
  message?: string;
  /** If true, abort on any conflict rather than leaving markers. */
  abortOnConflict?: boolean;
}

// ----------------------------------------------------------------------------
// Helpers
// ----------------------------------------------------------------------------

function git(args: string, cwd: string): string {
  try {
    return execSync(`git ${args}`, {
      cwd,
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
      maxBuffer: 10 * 1024 * 1024,
    }).trim();
  } catch (err: unknown) {
    const e = err as { stderr?: string; message?: string };
    throw new Error((e.stderr ?? e.message ?? "git error").trim());
  }
}

function gitSafe(args: string, cwd: string): string {
  try {
    return git(args, cwd);
  } catch {
    return "";
  }
}

// ----------------------------------------------------------------------------
// Public API
// ----------------------------------------------------------------------------

/**
 * Preserve the current state of a branch as a patch file.
 * Used to keep originals before synthesis, per PRD hard rule.
 *
 * @param repoRoot - Repository root.
 * @param branch   - Branch to snapshot.
 * @param outputDir - Directory to write the patch file.
 * @returns Snapshot metadata.
 */
export async function preserveCandidate(
  repoRoot: string,
  branch: string,
  outputDir: string,
): Promise<CandidateSnapshot> {
  const headCommit = gitSafe(`rev-parse ${branch}`, repoRoot);
  const safeBranchName = branch.replace(/[^a-z0-9-]/gi, "_");
  const patchFile = `${safeBranchName}-${headCommit.slice(0, 8)}.patch`;
  const patchPath = join(outputDir, patchFile);

  await mkdir(outputDir, { recursive: true });

  // Use format-patch to produce a portable patch
  try {
    const baseMerge = gitSafe(`merge-base HEAD ${branch}`, repoRoot);
    const patch = git(`diff ${baseMerge} ${branch}`, repoRoot);
    await writeFile(patchPath, patch, "utf-8");
  } catch {
    await writeFile(patchPath, "", "utf-8");
  }

  return {
    branch,
    headCommit,
    patchPath,
    capturedAt: new Date().toISOString(),
  };
}

/**
 * Attempt a merge of `sourceBranch` into `targetBranch`.
 * Always preserves the pre-merge state.
 *
 * @param repoRoot      - Repository root (main working tree).
 * @param targetBranch  - Branch to merge into.
 * @param sourceBranch  - Branch to merge from.
 * @param options       - Merge options.
 */
export function attemptMerge(
  repoRoot: string,
  targetBranch: string,
  sourceBranch: string,
  options: MergeOptions = {},
): MergeAttemptResult {
  const { noFf = true, message, abortOnConflict = false } = options;

  // Ensure we're on the target branch
  try {
    git(`checkout "${targetBranch}"`, repoRoot);
  } catch (_err: unknown) {
    return {
      success: false,
      conflictedFiles: [],
      aborted: false,
    };
  }

  const mergeFlags = noFf ? "--no-ff" : "--ff";
  const msgFlag = message ? `--message "${message.replace(/"/g, '\\"')}"` : "--no-edit";

  try {
    git(`merge ${mergeFlags} ${msgFlag} "${sourceBranch}"`, repoRoot);
    const mergeCommitHash = gitSafe("rev-parse HEAD", repoRoot);
    return { success: true, mergeCommitHash, conflictedFiles: [], aborted: false };
  } catch {
    // Check for conflicts
    const conflictedRaw = gitSafe("diff --name-only --diff-filter=U", repoRoot);
    const conflictedFiles = conflictedRaw ? conflictedRaw.split("\n").filter(Boolean) : [];

    if (abortOnConflict || conflictedFiles.length > 0) {
      try {
        git("merge --abort", repoRoot);
      } catch {
        // ignore abort errors
      }
      return { success: false, conflictedFiles, aborted: true };
    }

    return { success: false, conflictedFiles, aborted: false };
  }
}

/**
 * Roll back the last commit (merge commit) using `git reset --hard HEAD~1`.
 * Only call this if you are certain the last commit was the merge.
 */
export function rollbackMerge(repoRoot: string): void {
  git("reset --hard HEAD~1", repoRoot);
}

/**
 * Apply a unified diff patch to a branch using `git apply`.
 * Performs a dry-run first; if successful, applies for real.
 */
export function applyPatch(
  repoRoot: string,
  patchContent: string,
  dryRun = false,
): { success: boolean; error?: string } {
  const tmpFile = join(repoRoot, ".dantecode", "council", `tmp-${Date.now()}.patch`);

  try {
    // Write patch to a temp file
    mkdirSync(join(repoRoot, ".dantecode", "council"), { recursive: true });
    writeFileSync(tmpFile, patchContent, "utf-8");

    if (dryRun) {
      git(`apply --check "${tmpFile}"`, repoRoot);
    } else {
      git(`apply "${tmpFile}"`, repoRoot);
    }

    return { success: true };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return { success: false, error: msg };
  } finally {
    try {
      unlinkSync(tmpFile);
    } catch {
      // ignore cleanup failure
    }
  }
}

/**
 * Get a list of branches that have been merged into the target branch.
 */
export function getMergedBranches(repoRoot: string, targetBranch: string): string[] {
  try {
    const raw = git(`branch --merged "${targetBranch}"`, repoRoot);
    return raw
      .split("\n")
      .map((b) => b.replace(/^\*?\s+/, "").trim())
      .filter((b) => b && b !== targetBranch);
  } catch {
    return [];
  }
}

/**
 * Get the common ancestor (merge base) of two branches.
 */
export function getMergeBase(repoRoot: string, branchA: string, branchB: string): string {
  return gitSafe(`merge-base "${branchA}" "${branchB}"`, repoRoot);
}
