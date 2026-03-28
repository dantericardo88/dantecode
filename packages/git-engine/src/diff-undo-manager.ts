// ============================================================================
// @dantecode/git-engine — Diff/Undo Manager (aider-derived)
// Auto-commit after every edit with easy undo, diff view, and session isolation.
// Builds on existing autoCommit infrastructure with session-aware history.
// ============================================================================

import { execFileSync } from "node:child_process";
import { autoCommit, getLastCommitHash, type CommitResult } from "./commit.js";
import type { GitCommitSpec } from "@dantecode/config-types";

// ----------------------------------------------------------------------------
// Types
// ----------------------------------------------------------------------------

/**
 * Configuration for the diff/undo manager.
 */
export interface DiffUndoConfig {
  /** Whether to automatically commit after every Write/Edit tool use. */
  autoCommitEnabled: boolean;
  /** Whether to show diff preview before auto-committing. */
  showDiffPreview: boolean;
  /** Session ID to tag commits with (for isolation). */
  sessionId?: string;
  /** Custom commit message prefix (e.g. "[session-abc]"). */
  commitPrefix?: string;
}

/**
 * A single entry in the session commit history.
 */
export interface CommitHistoryEntry {
  hash: string;
  message: string;
  files: string[];
  timestamp: string;
  sessionId?: string;
}

/**
 * Result of showing a diff for a commit.
 */
export interface DiffResult {
  diff: string;
  filesChanged: string[];
  insertions: number;
  deletions: number;
}

/**
 * Result of undoing one or more commits.
 */
export interface UndoResult {
  /** Commits that were undone (newest first). */
  undoneCommits: CommitHistoryEntry[];
  /** The new HEAD commit hash after undo. */
  newHead: string;
  /** Files that were modified by the undo operation. */
  filesRestored: string[];
}

// ----------------------------------------------------------------------------
// Helpers
// ----------------------------------------------------------------------------

/**
 * Execute a git command via execFileSync (no shell — injection-safe).
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


// ----------------------------------------------------------------------------
// Public API
// ----------------------------------------------------------------------------

/**
 * DiffUndoManager provides auto-commit, diff viewing, and undo capabilities
 * for session-aware git workflows.
 */
export class DiffUndoManager {
  private config: DiffUndoConfig;
  private projectRoot: string;

  constructor(projectRoot: string, config: Partial<DiffUndoConfig> = {}) {
    this.projectRoot = projectRoot;
    this.config = {
      autoCommitEnabled: config.autoCommitEnabled ?? true,
      showDiffPreview: config.showDiffPreview ?? false,
      sessionId: config.sessionId,
      commitPrefix: config.commitPrefix,
    };
  }

  /**
   * Update configuration.
   */
  setConfig(updates: Partial<DiffUndoConfig>): void {
    this.config = { ...this.config, ...updates };
  }

  /**
   * Auto-commit the specified files with a generated message.
   * This is the primary method called after Write/Edit tool use.
   */
  async autoCommitAfterEdit(files: string[], message: string): Promise<CommitResult> {
    if (!this.config.autoCommitEnabled) {
      throw new Error("Auto-commit is disabled in DiffUndoManager config");
    }

    // Build commit message with session prefix if configured
    const fullMessage = this.config.commitPrefix
      ? `${this.config.commitPrefix} ${message}`
      : message;

    const spec: GitCommitSpec = {
      message: fullMessage,
      files,
      footer: "",
      allowEmpty: false,
      ...(this.config.sessionId ? { body: `Session: ${this.config.sessionId}` } : {}),
    };

    return autoCommit(spec, this.projectRoot);
  }

  /**
   * Show the diff for a specific commit (or HEAD if no hash provided).
   */
  async showDiff(commitHash?: string): Promise<DiffResult> {
    const target = commitHash ?? "HEAD";

    // Get diff stats
    const stats = git(["show", "--stat", "--format=", target], this.projectRoot);
    const statsLines = stats.split("\n").filter((line) => line.trim().length > 0);

    // Parse stats for insertions/deletions
    let insertions = 0;
    let deletions = 0;
    const lastLine = statsLines[statsLines.length - 1];
    if (lastLine) {
      // Match patterns like: "1 file changed, 5 insertions(+), 2 deletions(-)"
      const insertMatch = lastLine.match(/(\d+)\s+insertion/);
      const deleteMatch = lastLine.match(/(\d+)\s+deletion/);
      if (insertMatch) {
        insertions = parseInt(insertMatch[1] ?? "0", 10);
      }
      if (deleteMatch) {
        deletions = parseInt(deleteMatch[1] ?? "0", 10);
      }
    }

    // Get list of changed files
    const filesChanged = git(["show", "--name-only", "--format=", target], this.projectRoot)
      .split("\n")
      .filter((line) => line.trim().length > 0);

    // Get full diff
    const diff = git(["show", target], this.projectRoot);

    return {
      diff,
      filesChanged,
      insertions,
      deletions,
    };
  }

  /**
   * Undo the last N commits using git reset --soft.
   * This moves HEAD back but keeps changes in the working tree.
   */
  async undo(steps = 1): Promise<UndoResult> {
    if (steps < 1) {
      throw new Error("Undo steps must be at least 1");
    }

    // Get commit history before undo (disable session filter for undo)
    const savedSessionId = this.config.sessionId;
    this.config.sessionId = undefined;
    const history = await this.getCommitHistory(steps);
    this.config.sessionId = savedSessionId;

    if (history.length === 0) {
      throw new Error("No commits to undo");
    }

    // Collect files from commits being undone
    const filesRestored = new Set<string>();
    for (const entry of history) {
      entry.files.forEach((file) => filesRestored.add(file));
    }

    // Perform soft reset
    git(["reset", "--soft", `HEAD~${steps}`], this.projectRoot);

    const newHead = getLastCommitHash(this.projectRoot);

    return {
      undoneCommits: history,
      newHead,
      filesRestored: Array.from(filesRestored),
    };
  }

  /**
   * Get commit history for the current session (or all commits if no session filter).
   * Returns commits in reverse chronological order (newest first).
   */
  async getCommitHistory(limit = 10): Promise<CommitHistoryEntry[]> {
    // Format: hash%ntimestamp%nmessage with --name-only for files
    // Note: git log with --name-only produces: hash\ntimestamp\nmessage\n\nfile1\nfile2\n\n
    const format = "%H%n%aI%n%s";
    const args = ["log", `--format=${format}`, "--name-only", `-n${limit}`];

    // If sessionId is set, filter by commit body containing the session ID
    if (this.config.sessionId) {
      args.push(`--grep=Session: ${this.config.sessionId}`);
    }

    let output: string;
    try {
      output = git(args, this.projectRoot);
    } catch {
      // If git log fails (e.g., no commits), return empty array
      return [];
    }

    if (!output) {
      return [];
    }

    // Parse commits line by line with state machine
    const commits: CommitHistoryEntry[] = [];
    const lines = output.split("\n");
    let i = 0;

    while (i < lines.length) {
      // Expect hash, timestamp, message
      if (i + 2 >= lines.length) break;

      const hash = lines[i]?.trim();
      const timestamp = lines[i + 1]?.trim();
      const message = lines[i + 2]?.trim();

      if (!hash || !timestamp || !message) break;

      // Skip blank line after message
      i += 3;
      if (i < lines.length && lines[i]?.trim() === "") {
        i++;
      }

      // Collect files until we hit an empty line or EOF
      const files: string[] = [];
      while (i < lines.length) {
        const line = lines[i]?.trim();
        if (!line) {
          i++; // Skip empty line between commits
          break;
        }
        // Check if this looks like a hash (40 hex chars) — start of next commit
        if (line.length === 40 && /^[0-9a-f]+$/.test(line)) {
          // This is the next commit, don't advance i
          break;
        }
        files.push(line);
        i++;
      }

      commits.push({
        hash,
        timestamp,
        message,
        files,
        sessionId: this.config.sessionId,
      });
    }

    return commits;
  }

  /**
   * Create a session branch for isolated work.
   * This is a convenience method that creates a new branch with the session ID.
   */
  async createSessionBranch(sessionId: string): Promise<string> {
    const branchName = `session/${sessionId}`;

    // Check if branch already exists
    try {
      git(["rev-parse", "--verify", branchName], this.projectRoot);
      throw new Error(`Session branch ${branchName} already exists`);
    } catch (error) {
      // Branch doesn't exist, proceed to create it
      if (error instanceof Error && !error.message.includes("already exists")) {
        // This is expected — the branch doesn't exist yet
      } else {
        throw error;
      }
    }

    // Create and checkout new branch
    git(["checkout", "-b", branchName], this.projectRoot);

    return branchName;
  }

  /**
   * Get the current branch name.
   */
  async getCurrentBranch(): Promise<string> {
    const branch = git(["rev-parse", "--abbrev-ref", "HEAD"], this.projectRoot);
    if (!branch || branch === "HEAD") {
      throw new Error("Detached HEAD state — not on a branch");
    }
    return branch;
  }

  /**
   * Check if the working tree is clean (no uncommitted changes).
   */
  async isWorkingTreeClean(): Promise<boolean> {
    try {
      const status = git(["status", "--porcelain"], this.projectRoot);
      return status.trim().length === 0;
    } catch {
      return false;
    }
  }
}

/**
 * Create a DiffUndoManager instance for the given project root.
 * This is the primary factory function.
 */
export function createDiffUndoManager(
  projectRoot: string,
  config?: Partial<DiffUndoConfig>,
): DiffUndoManager {
  return new DiffUndoManager(projectRoot, config);
}
