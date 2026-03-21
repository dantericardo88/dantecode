// ============================================================================
// @dantecode/core — Council Worktree Observer
// Watches per-agent worktrees for branch drift, new commits, and file changes.
// Emits structured events consumed by the overlap detector and council router.
// Uses async git operations with per-lane fault isolation and timeouts.
// ============================================================================

import { exec } from "node:child_process";
import { promisify } from "node:util";
import { EventEmitter } from "node:events";
import type { AgentKind } from "./council-types.js";

const execAsync = promisify(exec);

/** Timeout for a single git operation (ms). */
const GIT_OP_TIMEOUT_MS = 5_000;

// ----------------------------------------------------------------------------
// Types
// ----------------------------------------------------------------------------

export interface WorktreeSnapshot {
  laneId: string;
  agentKind: AgentKind;
  worktreePath: string;
  branch: string;
  headCommit: string;
  /** Files modified relative to the base branch. */
  modifiedFiles: string[];
  capturedAt: string;
}

export interface WorktreeDriftEvent {
  laneId: string;
  previousHeadCommit: string;
  currentHeadCommit: string;
  newModifiedFiles: string[];
  droppedFiles: string[];
  detectedAt: string;
}

export interface WorktreeObserverOptions {
  /** Polling interval in ms (default 10 seconds). */
  pollIntervalMs?: number;
  /** Base branch used for diff computation (default "main"). */
  baseBranch?: string;
  /** Timeout per git operation in ms (default 5 seconds). */
  gitTimeoutMs?: number;
}

type WorktreeObserverEvents = {
  drift: [WorktreeDriftEvent];
  snapshot: [WorktreeSnapshot];
  error: [{ laneId: string; error: string }];
};

// ----------------------------------------------------------------------------
// Helpers
// ----------------------------------------------------------------------------

async function gitAsync(args: string, cwd: string, timeoutMs: number): Promise<string> {
  const { stdout } = await execAsync(`git ${args}`, {
    cwd,
    timeout: timeoutMs,
    maxBuffer: 10 * 1024 * 1024,
  });
  return stdout.trim();
}

async function getModifiedFilesAsync(
  worktreePath: string,
  baseBranch: string,
  timeoutMs: number,
): Promise<string[]> {
  try {
    const raw = await gitAsync(`diff --name-only ${baseBranch}...HEAD`, worktreePath, timeoutMs);
    return raw ? raw.split("\n").filter(Boolean) : [];
  } catch {
    // Fallback: unstaged changes
    try {
      const raw = await gitAsync("diff --name-only HEAD", worktreePath, timeoutMs);
      return raw ? raw.split("\n").filter(Boolean) : [];
    } catch {
      return [];
    }
  }
}

async function getHeadCommitAsync(worktreePath: string, timeoutMs: number): Promise<string> {
  try {
    return await gitAsync("rev-parse HEAD", worktreePath, timeoutMs);
  } catch {
    return "unknown";
  }
}

async function getBranchAsync(worktreePath: string, timeoutMs: number): Promise<string> {
  try {
    return await gitAsync("rev-parse --abbrev-ref HEAD", worktreePath, timeoutMs);
  } catch {
    return "unknown";
  }
}

// ----------------------------------------------------------------------------
// WorktreeObserver
// ----------------------------------------------------------------------------

/**
 * Polls all registered worktrees and emits events when drift or file changes
 * are detected. Uses async git operations with per-lane fault isolation — a
 * slow or failing lane does not stall observation of other lanes.
 */
export class WorktreeObserver extends EventEmitter<WorktreeObserverEvents> {
  private readonly pollIntervalMs: number;
  private readonly baseBranch: string;
  private readonly gitTimeoutMs: number;
  private readonly lanes = new Map<
    string,
    { agentKind: AgentKind; worktreePath: string; lastSnapshot: WorktreeSnapshot | null }
  >();
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(options: WorktreeObserverOptions = {}) {
    super();
    this.pollIntervalMs = options.pollIntervalMs ?? 10_000;
    this.baseBranch = options.baseBranch ?? "main";
    this.gitTimeoutMs = options.gitTimeoutMs ?? GIT_OP_TIMEOUT_MS;
  }

  /** Register a worktree lane for observation. */
  register(laneId: string, agentKind: AgentKind, worktreePath: string): void {
    this.lanes.set(laneId, { agentKind, worktreePath, lastSnapshot: null });
  }

  /** Unregister a lane. */
  unregister(laneId: string): void {
    this.lanes.delete(laneId);
  }

  /** Start periodic polling. */
  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => void this.pollAll(), this.pollIntervalMs);
  }

  /** Stop periodic polling. */
  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  /**
   * Take an immediate snapshot of all lanes in parallel.
   * Per-lane fault isolation: a failing lane emits an error event but does
   * not prevent other lanes from being snapshotted.
   */
  async pollAll(): Promise<WorktreeSnapshot[]> {
    const tasks = [...this.lanes.entries()].map(async ([laneId, entry]) => {
      const snapshot = await this.snapshotLane(laneId, entry.agentKind, entry.worktreePath);
      if (snapshot) {
        this.checkDrift(laneId, entry.lastSnapshot, snapshot);
        entry.lastSnapshot = snapshot;
        this.emit("snapshot", snapshot);
      }
      return snapshot;
    });

    const results = await Promise.allSettled(tasks);
    const snapshots: WorktreeSnapshot[] = [];
    for (const result of results) {
      if (result.status === "fulfilled" && result.value) {
        snapshots.push(result.value);
      }
      // rejected results: the individual task already emitted an error event
    }
    return snapshots;
  }

  /** Take a snapshot of a single lane (async, with timeout). */
  async snapshotLane(
    laneId: string,
    agentKind: AgentKind,
    worktreePath: string,
  ): Promise<WorktreeSnapshot | null> {
    try {
      const [branch, headCommit, modifiedFiles] = await Promise.all([
        getBranchAsync(worktreePath, this.gitTimeoutMs),
        getHeadCommitAsync(worktreePath, this.gitTimeoutMs),
        getModifiedFilesAsync(worktreePath, this.baseBranch, this.gitTimeoutMs),
      ]);

      return {
        laneId,
        agentKind,
        worktreePath,
        branch,
        headCommit,
        modifiedFiles,
        capturedAt: new Date().toISOString(),
      };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      this.emit("error", { laneId, error: msg });
      return null;
    }
  }

  /** Get the most recent snapshot for a lane. */
  getSnapshot(laneId: string): WorktreeSnapshot | null {
    return this.lanes.get(laneId)?.lastSnapshot ?? null;
  }

  /** Get all registered lane IDs. */
  getLaneIds(): string[] {
    return Array.from(this.lanes.keys());
  }

  private checkDrift(
    laneId: string,
    previous: WorktreeSnapshot | null,
    current: WorktreeSnapshot,
  ): void {
    if (!previous) return;
    if (previous.headCommit === current.headCommit) return;

    const prevSet = new Set(previous.modifiedFiles);
    const currSet = new Set(current.modifiedFiles);

    const newFiles = current.modifiedFiles.filter((f) => !prevSet.has(f));
    const droppedFiles = previous.modifiedFiles.filter((f) => !currSet.has(f));

    if (newFiles.length > 0 || droppedFiles.length > 0) {
      const event: WorktreeDriftEvent = {
        laneId,
        previousHeadCommit: previous.headCommit,
        currentHeadCommit: current.headCommit,
        newModifiedFiles: newFiles,
        droppedFiles,
        detectedAt: new Date().toISOString(),
      };
      this.emit("drift", event);
    }
  }
}
