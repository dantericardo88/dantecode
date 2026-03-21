// ============================================================================
// @dantecode/debug-trail — Git Bridge (Aider-inspired)
// Enriches trail events with Git context: branch, worktree, commit hash, diff.
// Treats Git as a first-class safety/control layer (Aider pattern).
// ============================================================================

import { exec } from "node:child_process";
import { promisify } from "node:util";
import type { TrailProvenance } from "../types.js";
import type { AuditLogger } from "../audit-logger.js";

const execAsync = promisify(exec);

// ---------------------------------------------------------------------------
// Git context
// ---------------------------------------------------------------------------

export interface GitContext {
  branch: string | null;
  commitHash: string | null;
  worktreePath: string | null;
  isDirty: boolean;
  modifiedFiles: string[];
  stagedFiles: string[];
}

// ---------------------------------------------------------------------------
// Git Bridge
// ---------------------------------------------------------------------------

export class GitBridge {
  constructor(
    private readonly logger: AuditLogger,
    private readonly cwd?: string,
  ) {}

  /**
   * Read current Git context from the working directory.
   */
  async readContext(): Promise<GitContext> {
    const cwd = this.cwd ?? process.cwd();
    try {
      const [branchResult, commitResult, statusResult] = await Promise.allSettled([
        execAsync("git rev-parse --abbrev-ref HEAD", { cwd }),
        execAsync("git rev-parse HEAD", { cwd }),
        execAsync("git status --porcelain", { cwd }),
      ]);

      const branch = branchResult.status === "fulfilled" ? branchResult.value.stdout.trim() : null;
      const commitHash =
        commitResult.status === "fulfilled" ? commitResult.value.stdout.trim() : null;

      const statusLines =
        statusResult.status === "fulfilled"
          ? statusResult.value.stdout.trim().split("\n").filter(Boolean)
          : [];

      const modifiedFiles = statusLines
        .filter((l) => l.startsWith(" M") || l.startsWith("M "))
        .map((l) => l.slice(3).trim());

      const stagedFiles = statusLines
        .filter((l) => l.startsWith("M ") || l.startsWith("A "))
        .map((l) => l.slice(3).trim());

      const isDirty = statusLines.length > 0;

      return { branch, commitHash, worktreePath: cwd, isDirty, modifiedFiles, stagedFiles };
    } catch {
      return {
        branch: null,
        commitHash: null,
        worktreePath: cwd,
        isDirty: false,
        modifiedFiles: [],
        stagedFiles: [],
      };
    }
  }

  /**
   * Enrich the current audit logger provenance with Git context.
   */
  async enrichProvenance(): Promise<void> {
    const ctx = await this.readContext();
    if (ctx.branch || ctx.worktreePath) {
      this.logger.setGitContext(ctx.worktreePath ?? undefined, ctx.branch ?? undefined);
    }
  }

  /**
   * Get the diff for a specific file (staged or unstaged).
   */
  async fileDiff(filePath: string): Promise<string> {
    const cwd = this.cwd ?? process.cwd();
    try {
      const { stdout } = await execAsync(`git diff -- "${filePath}"`, { cwd });
      if (stdout.trim()) return stdout;
      // Try staged diff
      const { stdout: staged } = await execAsync(`git diff --cached -- "${filePath}"`, { cwd });
      return staged;
    } catch {
      return "";
    }
  }

  /**
   * Get a safe restore point by creating a git stash snapshot (without popping it).
   * Returns stash ref or null.
   */
  async createSafePoint(message: string): Promise<string | null> {
    const cwd = this.cwd ?? process.cwd();
    try {
      const { stdout } = await execAsync(`git stash create "debug-trail: ${message}"`, { cwd });
      const ref = stdout.trim();
      if (ref) {
        await this.logger.log(
          "workflow_event",
          "GitBridge",
          `Git safe-point created: ${ref.slice(0, 8)}`,
          { stashRef: ref, message },
        );
        return ref;
      }
      return null;
    } catch {
      return null;
    }
  }

  /**
   * Map a set of trail events to their associated git commits/refs.
   */
  async enrichTrailEvent(_filePath: string, _eventId: string): Promise<Partial<TrailProvenance>> {
    const ctx = await this.readContext();
    return {
      worktreePath: ctx.worktreePath ?? undefined,
      branch: ctx.branch ?? undefined,
    };
  }

  /**
   * Get recent git log entries for a file.
   */
  async fileLog(
    filePath: string,
    limit = 5,
  ): Promise<Array<{ hash: string; message: string; date: string }>> {
    const cwd = this.cwd ?? process.cwd();
    try {
      const { stdout } = await execAsync(
        `git log --oneline --format="%H|%s|%ai" -n ${limit} -- "${filePath}"`,
        { cwd },
      );
      return stdout
        .trim()
        .split("\n")
        .filter(Boolean)
        .map((line) => {
          const [hash, message, date] = line.split("|");
          return { hash: hash ?? "", message: message ?? "", date: date ?? "" };
        });
    } catch {
      return [];
    }
  }
}
