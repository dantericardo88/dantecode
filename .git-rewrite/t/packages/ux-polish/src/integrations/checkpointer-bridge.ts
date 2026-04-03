/**
 * checkpointer-bridge.ts — @dantecode/ux-polish
 *
 * G14 — Checkpointer weld.
 * Bridges ProgressOrchestrator to the EventSourcedCheckpointer for
 * resume-capable long-running progress displays.
 *
 * Hard rule: checkpointer is OPTIONAL — progress works without it.
 * No circular dependency: uses structural interfaces only.
 */

import type { ProgressOrchestrator } from "../progress-orchestrator.js";
import type { ProgressState } from "../types.js";

// ---------------------------------------------------------------------------
// Structural types — match EventSourcedCheckpointer shape without importing it
// ---------------------------------------------------------------------------

/** Minimal checkpointer interface (structural). */
export interface CheckpointerLike {
  put(
    sessionId: string,
    checkpoint: {
      v: number;
      id: string;
      ts: string;
      step: number;
      channelValues: Record<string, unknown>;
      channelVersions: Record<string, number>;
    },
    metadata: { source: string; step: number },
    writes: Array<{ taskId: string; channel: string; value: unknown; timestamp: string }>,
  ): Promise<void>;
  getTuple(sessionId: string): Promise<{
    checkpoint: { channelValues: Record<string, unknown>; step: number };
    metadata: { step: number };
  } | null>;
}

// ---------------------------------------------------------------------------
// CheckpointedProgress
// ---------------------------------------------------------------------------

export interface CheckpointedProgressOptions {
  /** ProgressOrchestrator instance to checkpoint. */
  orchestrator: ProgressOrchestrator;
  /** Optional checkpointer for persistence. If omitted, state is in-memory only. */
  checkpointer?: CheckpointerLike | null;
}

/**
 * Wraps a ProgressOrchestrator with optional checkpoint/restore capability.
 *
 * When a checkpointer is provided:
 * - saveCheckpoint() serializes all active progress states to the checkpoint store.
 * - restoreCheckpoint() hydrates the orchestrator from a previous session.
 * - formatResumedStatus() returns a human-readable summary of restored items.
 *
 * When no checkpointer is provided, all methods are no-ops (safe to call always).
 */
export class CheckpointedProgress {
  private _orchestrator: ProgressOrchestrator;
  private _checkpointer: CheckpointerLike | null;
  private _restoredStep = 0;

  constructor(opts: CheckpointedProgressOptions) {
    this._orchestrator = opts.orchestrator;
    this._checkpointer = opts.checkpointer ?? null;
  }

  /** Whether a checkpointer is wired in. */
  get hasCheckpointer(): boolean {
    return this._checkpointer !== null;
  }

  /**
   * Saves the current orchestrator state to the checkpoint store.
   * No-op if no checkpointer.
   */
  async saveCheckpoint(sessionId: string): Promise<void> {
    if (!this._checkpointer) return;

    const serialized = this._orchestrator.serialize();
    const step = this._restoredStep + 1;

    await this._checkpointer.put(
      sessionId,
      {
        v: 1,
        id: `ux-${sessionId}-${Date.now()}`,
        ts: new Date().toISOString(),
        step,
        channelValues: { progressState: serialized },
        channelVersions: { progressState: step },
      },
      { source: "loop", step },
      [
        {
          taskId: "ux-progress",
          channel: "progressState",
          value: serialized,
          timestamp: new Date().toISOString(),
        },
      ],
    );

    this._restoredStep = step;
  }

  /**
   * Restores progress state from a previous checkpoint.
   * Returns true if state was found and restored, false otherwise.
   */
  async restoreCheckpoint(sessionId: string): Promise<boolean> {
    if (!this._checkpointer) return false;

    const tuple = await this._checkpointer.getTuple(sessionId);
    if (!tuple) return false;

    const raw = tuple.checkpoint.channelValues["progressState"];
    if (typeof raw !== "object" || raw === null) return false;

    try {
      this._orchestrator.restore(raw as Record<string, ProgressState>);
      this._restoredStep = tuple.checkpoint.step;
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Returns a human-readable summary of restored progress items.
   * Used to greet the user when resuming a workflow.
   */
  formatResumedStatus(sessionId: string): string {
    const items = this._orchestrator.getAllProgress();
    if (items.length === 0) {
      return `Session ${sessionId}: no in-progress items found.`;
    }

    const lines: string[] = [`Resuming session ${sessionId}:`];
    for (const item of items) {
      const pct = item.progress !== undefined ? ` (${item.progress}%)` : "";
      const status = item.status === "completed" ? "✓" : item.status === "failed" ? "✗" : "⟳";
      lines.push(`  ${status} ${item.phase}${pct} — ${item.status}`);
    }
    return lines.join("\n");
  }

  /**
   * Returns the wrapped orchestrator (for full API access).
   */
  get orchestrator(): ProgressOrchestrator {
    return this._orchestrator;
  }
}
