// ============================================================================
// @dantecode/debug-trail — Sandbox Bridge
// Ensures sandboxed file operations still emit trail entries.
// Storage always lives outside the mutable sandbox workspace.
// ============================================================================

import type { AuditLogger } from "../audit-logger.js";
import type { FileSnapshotter } from "../file-snapshotter.js";
import type { TrailProvenance } from "../types.js";

// ---------------------------------------------------------------------------
// Sandbox context
// ---------------------------------------------------------------------------

export interface SandboxContext {
  /** Unique sandbox ID (e.g. worktree path hash). */
  sandboxId: string;
  /** Root path of the sandbox. */
  sandboxRoot: string;
  /** Parent session that spawned the sandbox. */
  parentSessionId: string;
  /** Lane ID if this sandbox is part of a council run. */
  laneId?: string;
}

// ---------------------------------------------------------------------------
// Sandbox Bridge
// ---------------------------------------------------------------------------

export class SandboxBridge {
  constructor(
    private readonly logger: AuditLogger,
    private readonly snapshotter: FileSnapshotter,
    private readonly context: SandboxContext,
  ) {
    // Wire lane context into logger
    if (context.laneId) {
      this.logger.setLaneContext(context.laneId, context.parentSessionId);
    }
  }

  /**
   * Intercept a file write inside a sandbox.
   * Captures before/after state and emits a trail event.
   */
  async onFileWrite(filePath: string, _newContent: string | Buffer): Promise<string> {
    const provenance = this.enrichProvenance();

    // Capture before state
    const before = await this.snapshotter.captureBeforeState(filePath, "sandbox-write", provenance);

    // The actual write would be done by the caller — we just track it
    const eventId = await this.logger.logFileWrite(
      filePath,
      before.beforeHash ?? undefined,
      undefined, // after hash — caller should update after write
      before.beforeSnapshotId ?? undefined,
    );

    return eventId;
  }

  /**
   * Called after the write is complete to capture after-state.
   */
  async onFileWriteComplete(filePath: string, writeEventId: string): Promise<void> {
    const provenance = this.enrichProvenance();
    const after = await this.snapshotter.captureAfterState(filePath, writeEventId, provenance);
    // Log the after-state as a supplementary event
    if (after.afterHash) {
      await this.logger.log(
        "tool_result",
        "SandboxFileSystem",
        `File write completed: ${filePath} (hash: ${after.afterHash.slice(0, 8)})`,
        {
          filePath,
          afterHash: after.afterHash,
          afterSnapshotId: after.afterSnapshotId,
          writeEventId,
        },
        { afterHash: after.afterHash, afterSnapshotId: after.afterSnapshotId ?? undefined },
      );
    }
  }

  /**
   * Intercept a file delete inside a sandbox.
   */
  async onFileDelete(filePath: string): Promise<string> {
    const provenance = this.enrichProvenance();
    const tombstone = await this.snapshotter.recordDeletion(
      filePath,
      "sandbox-delete",
      provenance,
      "SandboxFileSystem",
    );
    const eventId = await this.logger.logFileDelete(
      filePath,
      tombstone.contentHash,
      tombstone.lastSnapshotId,
      tombstone.tombstoneId,
    );
    return eventId;
  }

  /**
   * Log an arbitrary sandbox event (e.g. subprocess execution, tool call).
   */
  async logSandboxEvent(
    actor: string,
    summary: string,
    payload?: Record<string, unknown>,
  ): Promise<string> {
    return this.logger.log("tool_call", `Sandbox:${actor}`, summary, {
      sandboxId: this.context.sandboxId,
      sandboxRoot: this.context.sandboxRoot,
      ...payload,
    });
  }

  private enrichProvenance(): TrailProvenance {
    const base = this.logger.getProvenance();
    return {
      ...base,
      laneId: this.context.laneId ?? base.laneId,
    };
  }
}
