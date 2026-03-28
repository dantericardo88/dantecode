/**
 * recovery-manager.ts
 *
 * Recovery Manager for detecting stale sessions and offering recovery options.
 * Pattern source: agent-orchestrator RecoveryManager with scan/validate/recover.
 *
 * Wave 2 Task 2.4: Recovery Manager
 */

import { readdir, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { execFileSync } from "node:child_process";
import type { Checkpoint } from "./checkpointer.js";
import type { DurableEventStore } from "./durable-event-store.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Session status classification
 */
export type SessionStatus = "resumable" | "stale" | "corrupt";

/**
 * A stale or resumable session discovered on disk
 */
export interface StaleSession {
  /** Session ID */
  sessionId: string;
  /** Absolute path to checkpoint file */
  checkpointPath: string;
  /** Classification: resumable, stale, or corrupt */
  status: SessionStatus;
  /** Human-readable reason for classification */
  reason?: string;
  /** Last event ID at checkpoint time */
  lastEventId?: number;
  /** Git worktree ref if present */
  worktreeRef?: string;
  /** Git snapshot hash if present */
  gitSnapshotHash?: string;
  /** Checkpoint timestamp */
  timestamp?: string;
  /** Checkpoint step index */
  step?: number;
}

/**
 * Options for recovery operations
 */
export interface RecoveryOptions {
  /** Project root directory */
  projectRoot: string;
  /** Base directory for checkpoints (default: .dantecode/checkpoints) */
  checkpointsDir?: string;
  /** Base directory for event logs (default: .dantecode/events) */
  eventsDir?: string;
}

/**
 * Result of a session recovery operation
 */
export interface SessionRecoveryResult {
  /** Whether recovery was successful */
  success: boolean;
  /** Session ID that was recovered */
  sessionId: string;
  /** Action taken: resume, fork, cleanup, skip */
  action: "resume" | "fork" | "cleanup" | "skip";
  /** Human-readable message */
  message: string;
}

// ---------------------------------------------------------------------------
// RecoveryManager
// ---------------------------------------------------------------------------

/**
 * RecoveryManager
 *
 * Scans for stale sessions on startup, validates checkpoint integrity,
 * and offers recovery options to the operator.
 *
 * Features:
 * - Scans .dantecode/checkpoints/ for session directories
 * - Validates checkpoint file integrity
 * - Checks if worktree exists (if worktreeRef present)
 * - Checks if event log exists and is readable
 * - Classifies sessions as resumable/stale/corrupt
 *
 * @example
 * ```ts
 * const manager = new RecoveryManager({ projectRoot: process.cwd() });
 * const sessions = await manager.scanStaleSessions();
 *
 * for (const session of sessions) {
 *   console.log(`${session.sessionId}: ${session.status} - ${session.reason}`);
 * }
 *
 * // Validate a specific checkpoint
 * const isValid = await manager.validateCheckpoint(checkpoint);
 * ```
 */
export class RecoveryManager {
  private readonly projectRoot: string;
  private readonly checkpointsDir: string;
  private readonly eventsDir: string;

  constructor(options: RecoveryOptions) {
    this.projectRoot = options.projectRoot;
    this.checkpointsDir =
      options.checkpointsDir ?? resolve(options.projectRoot, ".dantecode", "checkpoints");
    this.eventsDir = options.eventsDir ?? resolve(options.projectRoot, ".dantecode", "events");
  }

  /**
   * Scan for stale sessions by walking the checkpoints directory.
   *
   * For each session directory:
   * 1. Load base_state.json
   * 2. Check if worktree exists (git worktree list)
   * 3. Check if event log exists
   * 4. Classify as resumable/stale/corrupt
   *
   * @returns Array of discovered sessions with status
   */
  async scanStaleSessions(): Promise<StaleSession[]> {
    if (!existsSync(this.checkpointsDir)) {
      return [];
    }

    const sessions: StaleSession[] = [];

    try {
      const entries = await readdir(this.checkpointsDir, { withFileTypes: true });

      for (const entry of entries) {
        if (!entry.isDirectory()) continue;

        const sessionId = entry.name;
        const checkpointPath = join(this.checkpointsDir, sessionId, "base_state.json");

        // Check if checkpoint file exists
        if (!existsSync(checkpointPath)) {
          sessions.push({
            sessionId,
            checkpointPath,
            status: "corrupt",
            reason: "Missing base_state.json",
          });
          continue;
        }

        // Try to load and classify the checkpoint
        try {
          const raw = await readFile(checkpointPath, "utf-8");
          const { checkpoint } = JSON.parse(raw) as { checkpoint: Checkpoint };

          // Validate checkpoint structure
          if (!checkpoint || !checkpoint.id || !checkpoint.channelValues) {
            sessions.push({
              sessionId,
              checkpointPath,
              status: "corrupt",
              reason: "Invalid checkpoint structure",
            });
            continue;
          }

          // Check if event log exists
          const eventLogPath = join(this.eventsDir, `${sessionId}.jsonl`);
          const hasEventLog = existsSync(eventLogPath);

          // Check if worktree exists (if worktreeRef is present)
          let worktreeExists = true; // Default to true if no worktree expected
          if (checkpoint.worktreeRef) {
            worktreeExists = this.checkWorktreeExists(checkpoint.worktreeRef);
          }

          // Classify the session
          let status: SessionStatus;
          let reason: string;

          if (!hasEventLog) {
            status = "stale";
            reason = "Event log missing";
          } else if (checkpoint.worktreeRef && !worktreeExists) {
            status = "stale";
            reason = `Worktree ${checkpoint.worktreeRef} not found`;
          } else {
            status = "resumable";
            reason = "All checks passed";
          }

          sessions.push({
            sessionId,
            checkpointPath,
            status,
            reason,
            lastEventId: checkpoint.eventId,
            worktreeRef: checkpoint.worktreeRef,
            gitSnapshotHash: checkpoint.gitSnapshotHash,
            timestamp: checkpoint.ts,
            step: checkpoint.step,
          });
        } catch (error) {
          sessions.push({
            sessionId,
            checkpointPath,
            status: "corrupt",
            reason: `Failed to parse checkpoint: ${error instanceof Error ? error.message : "Unknown error"}`,
          });
        }
      }
    } catch (error) {
      // If we can't read the checkpoints directory, return empty array
      return [];
    }

    return sessions;
  }

  /**
   * Validate a checkpoint's integrity and git state.
   *
   * Checks:
   * 1. Checkpoint has valid structure
   * 2. If worktreeRef is present, worktree exists
   * 3. If gitSnapshotHash is present, stash exists
   * 4. Channel values are not empty
   *
   * @param checkpoint - The checkpoint to validate
   * @returns true if checkpoint is valid and can be resumed
   */
  async validateCheckpoint(checkpoint: Checkpoint): Promise<boolean> {
    try {
      // Check basic structure
      if (!checkpoint || !checkpoint.id || !checkpoint.channelValues) {
        return false;
      }

      // Check if channel values is empty (suspicious)
      if (Object.keys(checkpoint.channelValues).length === 0) {
        return false;
      }

      // Check worktree exists if specified
      if (checkpoint.worktreeRef) {
        if (!this.checkWorktreeExists(checkpoint.worktreeRef)) {
          return false;
        }
      }

      // Check git snapshot exists if specified
      if (checkpoint.gitSnapshotHash) {
        if (!this.checkGitStashExists(checkpoint.gitSnapshotHash)) {
          return false;
        }
      }

      return true;
    } catch {
      return false;
    }
  }

  /**
   * Validate that an event log is readable and contains valid events.
   *
   * @param eventStore - The event store to validate
   * @returns true if event log is readable and contains at least one valid event
   */
  async validateEventLog(eventStore: DurableEventStore): Promise<boolean> {
    try {
      const latestId = await eventStore.getLatestId();
      return latestId > 0;
    } catch {
      return false;
    }
  }

  /**
   * Offer recovery options for stale sessions.
   *
   * This is a no-op that returns immediately. The actual recovery UI
   * is implemented in CLI/VS Code layers via /recover command.
   *
   * This method exists for interface compatibility and as a hook point
   * for future automated recovery policies.
   *
   * @param _staleSessions - Array of stale sessions to offer recovery for
   */
  async offerRecovery(_staleSessions: StaleSession[]): Promise<void> {
    // No-op: Recovery UI is handled by CLI/VS Code
    // This method exists as a hook point for future automated recovery
    return;
  }

  /**
   * Get the checkpoints directory path.
   */
  getCheckpointsDir(): string {
    return this.checkpointsDir;
  }

  /**
   * Get the events directory path.
   */
  getEventsDir(): string {
    return this.eventsDir;
  }

  // ---------------------------------------------------------------------------
  // Private Helpers
  // ---------------------------------------------------------------------------

  /**
   * Check if a git worktree exists.
   *
   * @param worktreeRef - Git ref (branch name) to check
   * @returns true if worktree exists
   */
  private checkWorktreeExists(worktreeRef: string): boolean {
    try {
      const output = execFileSync("git", ["worktree", "list", "--porcelain"], {
        cwd: this.projectRoot,
        encoding: "utf-8",
        stdio: ["pipe", "pipe", "pipe"],
      });

      // Parse porcelain output and look for matching branch
      // Format: worktree <path>\nhead <sha>\nbranch <ref>\n\n
      const lines = output.split("\n");
      for (const line of lines) {
        if (line.startsWith("branch ")) {
          const branch = line.slice(7).trim();
          if (branch === worktreeRef || branch === `refs/heads/${worktreeRef}`) {
            return true;
          }
        }
      }

      return false;
    } catch {
      // git command failed or not in a git repo
      return false;
    }
  }

  /**
   * Check if a git stash exists.
   *
   * @param stashHash - Stash commit hash to check
   * @returns true if stash exists
   */
  private checkGitStashExists(stashHash: string): boolean {
    try {
      execFileSync("git", ["cat-file", "-e", stashHash], {
        cwd: this.projectRoot,
        encoding: "utf-8",
        stdio: ["pipe", "pipe", "pipe"],
      });
      return true;
    } catch {
      return false;
    }
  }
}

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

/**
 * Get a human-readable summary of a stale session.
 *
 * @param session - The stale session to summarize
 * @returns Multi-line string summary
 */
export function formatStaleSessionSummary(session: StaleSession): string {
  const lines: string[] = [];

  lines.push(`Session: ${session.sessionId}`);
  lines.push(`Status:  ${session.status.toUpperCase()}`);

  if (session.reason) {
    lines.push(`Reason:  ${session.reason}`);
  }

  if (session.timestamp) {
    lines.push(`Time:    ${session.timestamp}`);
  }

  if (session.step !== undefined) {
    lines.push(`Step:    ${session.step}`);
  }

  if (session.lastEventId !== undefined) {
    lines.push(`Events:  ${session.lastEventId}`);
  }

  if (session.worktreeRef) {
    lines.push(`Worktree: ${session.worktreeRef}`);
  }

  if (session.gitSnapshotHash) {
    lines.push(`Snapshot: ${session.gitSnapshotHash.slice(0, 8)}`);
  }

  lines.push(`Path:    ${session.checkpointPath}`);

  return lines.join("\n");
}

/**
 * Filter stale sessions by status.
 *
 * @param sessions - Array of stale sessions
 * @param status - Status to filter by
 * @returns Filtered array
 */
export function filterSessionsByStatus(
  sessions: StaleSession[],
  status: SessionStatus,
): StaleSession[] {
  return sessions.filter((s) => s.status === status);
}

/**
 * Sort stale sessions by timestamp (newest first).
 *
 * @param sessions - Array of stale sessions
 * @returns Sorted array (mutates original)
 */
export function sortSessionsByTime(sessions: StaleSession[]): StaleSession[] {
  return sessions.sort((a, b) => {
    if (!a.timestamp) return 1;
    if (!b.timestamp) return -1;
    return b.timestamp.localeCompare(a.timestamp);
  });
}
