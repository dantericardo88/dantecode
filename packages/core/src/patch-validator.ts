// ============================================================================
// Patch Validator — git-diff validation and safe commit gating
// Harvested from Aider's git-aligned verification + OpenHands patch validation.
// Validates that changes match expectations before committing, using
// structured git-diff analysis and PDSE-gated approval.
// ============================================================================

import { execSync } from "node:child_process";
import { resolve } from "node:path";

/** Result of validating the current patch state. */
export interface PatchValidationResult {
  valid: boolean;
  filesChanged: string[];
  insertions: number;
  deletions: number;
  conflicts: string[];
}

/** Result of validating git diff against expected file list. */
export interface DiffValidationResult {
  matches: boolean;
  /** Files changed that weren't expected. */
  unexpected: string[];
  /** Files expected but not changed. */
  missing: string[];
  /** All actually changed files. */
  actual: string[];
}

/** Result of a PDSE-gated commit attempt. */
export interface CommitGateResult {
  committed: boolean;
  sha?: string;
  reason?: string;
}

/** Options for PatchValidator construction. */
export interface PatchValidatorOptions {
  /** Injectable execSync for testing. */
  execSyncFn?: typeof execSync;
}

/**
 * Git-diff validation and safe commit gating.
 *
 * Provides structured analysis of git diffs, validates that changes match
 * expectations, and gates commits behind a PDSE (Post-Deployment Success
 * Estimation) score threshold.
 */
export class PatchValidator {
  private readonly projectRoot: string;
  private readonly exec: typeof execSync;

  constructor(projectRoot: string, options: PatchValidatorOptions = {}) {
    this.projectRoot = resolve(projectRoot);
    this.exec = options.execSyncFn ?? execSync;
  }

  /**
   * Get list of changed files from git diff.
   * @param staged - If true, show only staged changes (--staged). Default: false.
   */
  getChangedFiles(staged = false): string[] {
    try {
      const flag = staged ? " --staged" : "";
      const output = this.exec(`git diff --name-only${flag}`, {
        cwd: this.projectRoot,
        encoding: "utf-8",
        timeout: 10000,
        stdio: ["pipe", "pipe", "pipe"],
      }).trim();

      if (!output) return [];
      return output.split("\n").filter((f) => f.length > 0);
    } catch {
      return [];
    }
  }

  /**
   * Get diff stats (insertions/deletions) for unstaged changes.
   * Parses the --shortstat output format:
   * "N files changed, X insertions(+), Y deletions(-)"
   */
  getDiffStats(): { insertions: number; deletions: number } {
    try {
      const output = this.exec("git diff --shortstat", {
        cwd: this.projectRoot,
        encoding: "utf-8",
        timeout: 10000,
        stdio: ["pipe", "pipe", "pipe"],
      }).trim();

      if (!output) return { insertions: 0, deletions: 0 };

      const insertMatch = output.match(/(\d+)\s+insertion/);
      const deleteMatch = output.match(/(\d+)\s+deletion/);

      return {
        insertions: insertMatch ? parseInt(insertMatch[1]!, 10) : 0,
        deletions: deleteMatch ? parseInt(deleteMatch[1]!, 10) : 0,
      };
    } catch {
      return { insertions: 0, deletions: 0 };
    }
  }

  /**
   * Validate that current changes are clean (no conflicts, expected files).
   * Checks for merge conflicts via `git diff --check` and composes a full result.
   */
  validateCurrentState(): PatchValidationResult {
    const filesChanged = this.getChangedFiles();
    const stats = this.getDiffStats();
    const conflicts = this.getConflicts();

    return {
      valid: conflicts.length === 0,
      filesChanged,
      insertions: stats.insertions,
      deletions: stats.deletions,
      conflicts,
    };
  }

  /**
   * Validate that git diff matches expected file list.
   * Compares actual changed files against the expected set.
   */
  validateGitDiff(expectedFiles: string[]): DiffValidationResult {
    const actual = this.getChangedFiles();
    const expectedSet = new Set(expectedFiles);
    const actualSet = new Set(actual);

    const unexpected = actual.filter((f) => !expectedSet.has(f));
    const missing = expectedFiles.filter((f) => !actualSet.has(f));

    return {
      matches: unexpected.length === 0 && missing.length === 0,
      unexpected,
      missing,
      actual,
    };
  }

  /** Check if working directory is clean (no changes at all). */
  isClean(): boolean {
    try {
      const output = this.exec("git status --porcelain", {
        cwd: this.projectRoot,
        encoding: "utf-8",
        timeout: 5000,
        stdio: ["pipe", "pipe", "pipe"],
      }).trim();

      return output.length === 0;
    } catch {
      return false;
    }
  }

  /** Check for uncommitted changes. */
  hasUncommittedChanges(): boolean {
    return !this.isClean();
  }

  /**
   * Safe commit gate: only commit if PDSE score meets threshold.
   * Validates current state, checks for conflicts, then stages and commits.
   */
  commitIfValid(
    pdseScore: number,
    pdseThreshold: number,
    message: string,
    files?: string[],
  ): CommitGateResult {
    // PDSE gate
    if (pdseScore < pdseThreshold) {
      return {
        committed: false,
        reason: `PDSE score ${pdseScore} below threshold ${pdseThreshold}`,
      };
    }

    // Validate current state
    const state = this.validateCurrentState();
    if (state.conflicts.length > 0) {
      return {
        committed: false,
        reason: "Merge conflicts detected",
      };
    }

    try {
      // Stage files
      const addTarget = files ? files.join(" ") : ".";
      this.exec(`git add ${addTarget}`, {
        cwd: this.projectRoot,
        encoding: "utf-8",
        timeout: 10000,
        stdio: ["pipe", "pipe", "pipe"],
      });

      // Commit
      this.exec(`git commit -m "${message}"`, {
        cwd: this.projectRoot,
        encoding: "utf-8",
        timeout: 15000,
        stdio: ["pipe", "pipe", "pipe"],
      });

      const sha = this.getLatestCommitSha();

      return {
        committed: true,
        sha,
      };
    } catch (err) {
      return {
        committed: false,
        reason: err instanceof Error ? err.message : "Commit failed",
      };
    }
  }

  /** Get the latest commit SHA. */
  getLatestCommitSha(): string {
    try {
      return this.exec("git rev-parse HEAD", {
        cwd: this.projectRoot,
        encoding: "utf-8",
        timeout: 5000,
        stdio: ["pipe", "pipe", "pipe"],
      }).trim();
    } catch {
      return "";
    }
  }

  // ── Private helpers ──────────────────────────────────────────────────────

  /** Detect merge conflict markers via `git diff --check`. */
  private getConflicts(): string[] {
    try {
      this.exec("git diff --check", {
        cwd: this.projectRoot,
        encoding: "utf-8",
        timeout: 10000,
        stdio: ["pipe", "pipe", "pipe"],
      });
      // If it succeeds with no output, no conflicts
      return [];
    } catch (err) {
      // git diff --check exits non-zero when conflicts/whitespace issues found
      if (err instanceof Error && "stdout" in err) {
        const stdout = (err as { stdout: string }).stdout || "";
        if (typeof stdout === "string" && stdout.trim().length > 0) {
          return stdout
            .trim()
            .split("\n")
            .filter((line) => line.length > 0);
        }
      }
      // If the error has output text directly
      const message = err instanceof Error ? err.message : "";
      if (message.includes("conflict")) {
        return [message];
      }
      return [];
    }
  }
}
