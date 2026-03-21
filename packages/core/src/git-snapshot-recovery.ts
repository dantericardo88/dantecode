// ============================================================================
// Git Snapshot Recovery — auto-rollback for verification failures
// Inspired by OpenCode's git snapshot pattern.
// Uses `git stash create` (no stash list interference) + `git checkout -- .`
// for zero-impact snapshots that can be rolled back to.
// ============================================================================

import { execSync } from "node:child_process";

/** A snapshot of the working tree at a point in time. */
export interface GitSnapshot {
  /** The git stash object hash (created via `git stash create`). */
  hash: string;
  /** Human-readable label for this snapshot. */
  label: string;
  /** ISO timestamp. */
  timestamp: string;
  /** Whether verification passed after this snapshot. */
  verified?: boolean;
}

/** Options for the recovery manager. */
export interface GitSnapshotOptions {
  /** Maximum snapshots to keep in memory. Default: 10. */
  maxSnapshots?: number;
  /** Function to execute git commands. Injectable for testing. */
  execSyncFn?: typeof execSync;
  /**
   * Controls whether `git clean -fd` runs during rollback.
   * Default: "preserve_untracked" — new files written by the pipeline survive rollback.
   * Set "clean_untracked" only when you explicitly want a fully clean state.
   */
  rollbackPolicy?: "preserve_untracked" | "clean_untracked";
}

/**
 * Git snapshot-based recovery that allows rolling back to a known-good state
 * when verification repeatedly fails.
 *
 * Uses `git stash create` which creates a stash entry object but does NOT
 * push it to the stash list — so it's invisible to the user's `git stash` workflow.
 * The objects are garbage-collected by git eventually if not referenced.
 */
export class GitSnapshotRecovery {
  private snapshots: GitSnapshot[] = [];
  private readonly maxSnapshots: number;
  private readonly projectRoot: string;
  private readonly exec: typeof execSync;
  private readonly rollbackPolicy: "preserve_untracked" | "clean_untracked";

  constructor(projectRoot: string, options: GitSnapshotOptions = {}) {
    this.projectRoot = projectRoot;
    this.maxSnapshots = options.maxSnapshots ?? 10;
    this.rollbackPolicy = options.rollbackPolicy ?? "preserve_untracked";
    this.exec = options.execSyncFn ?? execSync;
  }

  /**
   * Take a snapshot of the current working tree.
   * Returns null if there are no uncommitted changes to snapshot.
   */
  takeSnapshot(label: string): GitSnapshot | null {
    if (!this.hasUncommittedChanges()) {
      return null;
    }

    try {
      const hash = this.exec("git stash create", {
        cwd: this.projectRoot,
        encoding: "utf-8",
        timeout: 10000,
        stdio: ["pipe", "pipe", "pipe"],
      }).trim();

      if (!hash) return null;

      const snapshot: GitSnapshot = {
        hash,
        label,
        timestamp: new Date().toISOString(),
      };

      this.snapshots.push(snapshot);

      // Prune old snapshots
      if (this.snapshots.length > this.maxSnapshots) {
        this.snapshots = this.snapshots.slice(-this.maxSnapshots);
      }

      return snapshot;
    } catch {
      return null;
    }
  }

  /**
   * Roll back to a specific snapshot.
   * Discards current working tree changes and applies the snapshot.
   */
  rollback(snapshotHash: string): boolean {
    const snapshot = this.snapshots.find((s) => s.hash === snapshotHash);
    if (!snapshot) return false;

    try {
      // Discard current changes
      this.exec("git checkout -- .", {
        cwd: this.projectRoot,
        encoding: "utf-8",
        timeout: 10000,
        stdio: ["pipe", "pipe", "pipe"],
      });

      // Only remove untracked files when explicitly configured — the default preserves them
      // so new files written during a pipeline survive rollback of tracked-file changes.
      if (this.rollbackPolicy === "clean_untracked") {
        this.exec("git clean -fd", {
          cwd: this.projectRoot,
          encoding: "utf-8",
          timeout: 10000,
          stdio: ["pipe", "pipe", "pipe"],
        });
      }

      // Apply the snapshot
      this.exec(`git stash apply ${snapshotHash}`, {
        cwd: this.projectRoot,
        encoding: "utf-8",
        timeout: 10000,
        stdio: ["pipe", "pipe", "pipe"],
      });

      return true;
    } catch {
      return false;
    }
  }

  /**
   * Roll back to the last snapshot marked as verified (good state).
   * If no verified snapshots exist, rolls back to the most recent snapshot.
   */
  rollbackToLastGoodState(): GitSnapshot | null {
    // First try verified snapshots
    const verified = this.snapshots.filter((s) => s.verified);
    if (verified.length > 0) {
      const target = verified[verified.length - 1]!;
      if (this.rollback(target.hash)) return target;
    }

    // Fall back to most recent snapshot
    if (this.snapshots.length > 0) {
      const target = this.snapshots[this.snapshots.length - 1]!;
      if (this.rollback(target.hash)) return target;
    }

    return null;
  }

  /** Mark a snapshot as verified (good state). */
  markVerified(snapshotHash: string): void {
    const snapshot = this.snapshots.find((s) => s.hash === snapshotHash);
    if (snapshot) {
      snapshot.verified = true;
    }
  }

  /** Check whether the working tree has uncommitted changes. */
  hasUncommittedChanges(): boolean {
    try {
      const status = this.exec("git status --porcelain", {
        cwd: this.projectRoot,
        encoding: "utf-8",
        timeout: 5000,
        stdio: ["pipe", "pipe", "pipe"],
      }).trim();

      return status.length > 0;
    } catch {
      return false;
    }
  }

  /** Remove old snapshots, keeping only the most recent N. */
  prune(keepCount = 5): void {
    if (this.snapshots.length > keepCount) {
      this.snapshots = this.snapshots.slice(-keepCount);
    }
  }

  /** Get all snapshots. */
  getSnapshots(): GitSnapshot[] {
    return [...this.snapshots];
  }

  /** Get the count of stored snapshots. */
  get size(): number {
    return this.snapshots.length;
  }
}
