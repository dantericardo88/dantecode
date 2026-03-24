// ============================================================================
// @dantecode/core — Durable Execution
// In-memory checkpoint/recovery system for agent loop state.
// Complements the disk-based EventSourcedCheckpointer with a lightweight
// in-memory variant for fast checkpoint/resume within a single session.
// ============================================================================

import { randomUUID } from "node:crypto";

// ────────────────────────────────────────────────────────────────────────────
// Types
// ────────────────────────────────────────────────────────────────────────────

/** Serializable snapshot of agent execution state. */
export interface ExecutionState {
  /** Unique checkpoint identifier. */
  checkpointId: string;
  /** Current step number in the execution. */
  stepNumber: number;
  /** Description of the current task being worked on. */
  currentTask: string;
  /** Partial output accumulated so far (e.g. generated text chunks). */
  partialOutput: string[];
  /** Arbitrary memory state (task variables, intermediate results). */
  memoryState: Record<string, unknown>;
  /** History of tool calls made during this execution. */
  toolCallHistory: Array<{
    tool: string;
    timestamp: number;
    success: boolean;
  }>;
  /** Timestamp when this checkpoint was created (ms since epoch). */
  createdAt: number;
}

// ────────────────────────────────────────────────────────────────────────────
// Constants
// ────────────────────────────────────────────────────────────────────────────

const DEFAULT_CHECKPOINT_INTERVAL = 5;

// ────────────────────────────────────────────────────────────────────────────
// DurableExecution
// ────────────────────────────────────────────────────────────────────────────

/**
 * In-memory checkpoint/recovery system for agent execution state.
 *
 * Provides:
 * - Fast checkpoint creation with unique IDs
 * - Recovery by checkpoint ID or most recent
 * - Automatic cleanup of old checkpoints
 * - Interval-based checkpoint scheduling
 *
 * This is intentionally in-memory only. For disk persistence,
 * use EventSourcedCheckpointer or AutoforgeCheckpointManager.
 */
export class DurableExecution {
  private checkpoints = new Map<string, ExecutionState>();
  /** Ordered list of checkpoint IDs (oldest first). */
  private order: string[] = [];

  /**
   * Creates a checkpoint from the given execution state.
   *
   * Assigns a unique checkpoint ID and records the creation timestamp.
   * Returns the checkpoint ID for later recovery.
   */
  checkpoint(state: Omit<ExecutionState, "checkpointId" | "createdAt">): string {
    const checkpointId = `cp-${randomUUID().slice(0, 8)}`;
    const fullState: ExecutionState = {
      ...state,
      checkpointId,
      createdAt: Date.now(),
      partialOutput: [...state.partialOutput],
      toolCallHistory: state.toolCallHistory.map((t) => ({ ...t })),
      memoryState: JSON.parse(JSON.stringify(state.memoryState)) as Record<string, unknown>,
    };

    this.checkpoints.set(checkpointId, fullState);
    this.order.push(checkpointId);
    return checkpointId;
  }

  /**
   * Recovers an execution state from a checkpoint.
   *
   * @param checkpointId - The checkpoint ID returned by `checkpoint()`.
   * @returns A deep copy of the execution state, or null if not found.
   */
  recover(checkpointId: string): ExecutionState | null {
    const state = this.checkpoints.get(checkpointId);
    if (!state) return null;

    return {
      ...state,
      partialOutput: [...state.partialOutput],
      toolCallHistory: state.toolCallHistory.map((t) => ({ ...t })),
      memoryState: JSON.parse(JSON.stringify(state.memoryState)) as Record<string, unknown>,
    };
  }

  /**
   * Returns the most recent checkpoint, or null if none exist.
   */
  getLastCheckpoint(): ExecutionState | null {
    if (this.order.length === 0) return null;
    const lastId = this.order[this.order.length - 1]!;
    return this.recover(lastId);
  }

  /**
   * Removes checkpoints older than `maxAge` milliseconds.
   *
   * @param maxAge - Maximum age in milliseconds. Checkpoints older than this are removed.
   * @returns The number of checkpoints deleted.
   */
  cleanup(maxAge: number): number {
    const cutoff = Date.now() - maxAge;
    let deleted = 0;

    const surviving: string[] = [];
    for (const id of this.order) {
      const state = this.checkpoints.get(id);
      if (state && state.createdAt < cutoff) {
        this.checkpoints.delete(id);
        deleted++;
      } else {
        surviving.push(id);
      }
    }

    this.order = surviving;
    return deleted;
  }

  /**
   * Determines whether a checkpoint should be taken at the given step.
   *
   * Returns true every `interval` steps (e.g. every 5th step by default).
   *
   * @param stepNumber - The current step number (1-based).
   * @param interval - How often to checkpoint (default: 5).
   */
  shouldCheckpoint(stepNumber: number, interval?: number): boolean {
    const n = interval ?? DEFAULT_CHECKPOINT_INTERVAL;
    if (n <= 0) return false;
    return stepNumber > 0 && stepNumber % n === 0;
  }

  /**
   * Returns the total number of stored checkpoints.
   */
  size(): number {
    return this.checkpoints.size;
  }
}
