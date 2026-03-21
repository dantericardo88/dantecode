// ============================================================================
// @dantecode/debug-trail — Audit Logger (Lár-inspired glass-box design)
// Central append-only forensic logger for all DanteCode operations.
// Always-on, hot-path optimized, immutable event records.
// ============================================================================

import { randomUUID } from "node:crypto";
import type { TrailEvent, TrailEventKind, TrailProvenance, DebugTrailConfig } from "./types.js";
import { defaultConfig, DiskWriteError } from "./types.js";
import { TrailStore, getTrailStore } from "./sqlite-store.js";
import { TrailEventIndex } from "./state/trail-index.js";
import { SessionMap } from "./state/session-map.js";
import { makeTrailEventId } from "./hash-engine.js";

// ---------------------------------------------------------------------------
// Logger options
// ---------------------------------------------------------------------------

export interface AuditLoggerOptions {
  config?: Partial<DebugTrailConfig>;
  /** Current session ID. If not provided, a new one is created. */
  sessionId?: string;
  /** Current run ID. */
  runId?: string;
  /** Git worktree path. */
  worktreePath?: string;
  /** Git branch. */
  branch?: string;
}

// ---------------------------------------------------------------------------
// Audit Logger
// ---------------------------------------------------------------------------

export class AuditLogger {
  private config: DebugTrailConfig;
  private store: TrailStore;
  private index = new TrailEventIndex();
  private sessionMap = new SessionMap();
  private provenance: TrailProvenance;
  private seqCounter = 0;
  private initialized = false;
  // Gap 4: async write queue — keeps hot path non-blocking while maintaining order
  private writeQueue: Promise<void> = Promise.resolve();
  // Gap 5: callback registered by CliBridge for cache invalidation
  private onNewEvent?: () => void;

  constructor(options: AuditLoggerOptions = {}) {
    this.config = { ...defaultConfig(), ...options.config };
    this.store = getTrailStore(this.config.storageRoot);

    const sessionId = options.sessionId ?? `sess_${randomUUID()}`;
    const runId = options.runId ?? `run_${randomUUID()}`;

    this.provenance = {
      sessionId,
      runId,
      worktreePath: options.worktreePath,
      branch: options.branch,
    };

    this.sessionMap.startSession({
      sessionId,
      runId,
      worktreePath: options.worktreePath,
      branch: options.branch,
    });
  }

  // -------------------------------------------------------------------------
  // Initialization
  // -------------------------------------------------------------------------

  async init(): Promise<void> {
    if (this.initialized) return;
    await this.store.init();
    // Warm up index from existing events
    const existing = await this.store.readAllEvents();
    this.index.bulkIndex(existing);
    const lastSeq = this.store.getLastSeq();
    this.seqCounter = lastSeq + 1;
    this.initialized = true;
  }

  // -------------------------------------------------------------------------
  // Core logging (Lár-style: central glass-box record)
  // -------------------------------------------------------------------------

  /** Log any trail event. Returns the event ID. */
  async log(
    kind: TrailEventKind,
    actor: string,
    summary: string,
    payload: Record<string, unknown> = {},
    extras?: Partial<
      Pick<TrailEvent, "beforeHash" | "afterHash" | "beforeSnapshotId" | "afterSnapshotId" | "trustScore">
    > & { provenance?: Partial<TrailProvenance> },
  ): Promise<string> {
    if (!this.config.enabled) return "";
    if (!this.initialized) await this.init();

    const seq = this.seqCounter++;
    const id = makeTrailEventId(seq, this.provenance.sessionId);
    const now = new Date().toISOString();

    const mergedProvenance: TrailProvenance = {
      ...this.provenance,
      ...extras?.provenance,
    };

    const event: TrailEvent = {
      id,
      seq,
      timestamp: now,
      kind,
      actor,
      summary,
      payload,
      provenance: mergedProvenance,
      beforeHash: extras?.beforeHash,
      afterHash: extras?.afterHash,
      beforeSnapshotId: extras?.beforeSnapshotId,
      afterSnapshotId: extras?.afterSnapshotId,
      trustScore: extras?.trustScore,
    };

    // Gap 4: chain write onto the queue — maintains sequential write order even
    // when multiple callers fire concurrently. We also await the per-event
    // write so that a caller doing `await logger.log(...)` gets disk durability
    // (backward-compatible with integration tests that query a separate engine
    // immediately after logging). The queue provides the ordering guarantee and
    // `drain()` guarantees all inflight writes have completed.

    // Create a settler for this write slot
    let settleWrite!: (err?: unknown) => void;
    const writeSettled = new Promise<void>((res, rej) => {
      settleWrite = (err) => (err ? rej(err) : res());
    });

    // Chain onto queue: ordering guaranteed, error surfaces to caller
    this.writeQueue = this.writeQueue
      .then(() => this.store.appendEvent(event))
      .then(() => settleWrite(), (err) => settleWrite(err));

    try {
      await writeSettled;
    } catch (cause) {
      throw new DiskWriteError(id, seq, cause);
    }

    // Index synchronously so in-process queries see the event immediately
    this.index.index(event);

    // Gap 5: notify registered listener (e.g. TrailQueryEngine.invalidateCache)
    this.onNewEvent?.();

    // Update session stats
    const kind2 =
      kind === "file_write" ? "file_write" : kind === "file_delete" ? "file_delete" : "other";
    this.sessionMap.recordEvent(mergedProvenance.sessionId, kind2);

    return id;
  }

  // -------------------------------------------------------------------------
  // Convenience methods (Lár glass-box pattern)
  // -------------------------------------------------------------------------

  /** Log a tool call. */
  async logToolCall(
    toolName: string,
    args: Record<string, unknown>,
    extras?: Partial<TrailProvenance>,
  ): Promise<string> {
    return this.log(
      "tool_call",
      toolName,
      `Tool call: ${toolName}`,
      { args },
      { provenance: extras },
    );
  }

  /** Log a tool result. */
  async logToolResult(
    toolName: string,
    result: unknown,
    eventId: string,
    extras?: Partial<TrailProvenance>,
  ): Promise<string> {
    return this.log(
      "tool_result",
      toolName,
      `Tool result: ${toolName}`,
      { result: typeof result === "string" ? result.slice(0, 500) : result, sourceEventId: eventId },
      { provenance: extras },
    );
  }

  /** Log a model decision. */
  async logModelDecision(
    model: string,
    decision: string,
    extras?: Partial<TrailProvenance>,
  ): Promise<string> {
    return this.log(
      "model_decision",
      model,
      `Model decision: ${decision.slice(0, 120)}`,
      { decision: decision.slice(0, 1000) },
      { provenance: extras },
    );
  }

  /** Log a file write event. */
  async logFileWrite(
    filePath: string,
    beforeHash?: string,
    afterHash?: string,
    beforeSnapshotId?: string,
    afterSnapshotId?: string,
  ): Promise<string> {
    return this.log(
      "file_write",
      "FileSystem",
      `File write: ${filePath}`,
      { filePath },
      { beforeHash, afterHash, beforeSnapshotId, afterSnapshotId },
    );
  }

  /** Log a file delete event. */
  async logFileDelete(
    filePath: string,
    beforeHash?: string,
    beforeSnapshotId?: string,
    tombstoneId?: string,
  ): Promise<string> {
    return this.log(
      "file_delete",
      "FileSystem",
      `File delete: ${filePath}`,
      { filePath, tombstoneId },
      { beforeHash, beforeSnapshotId },
    );
  }

  /** Log a file move event. */
  async logFileMove(from: string, to: string, hash?: string): Promise<string> {
    return this.log("file_move", "FileSystem", `File move: ${from} → ${to}`, { from, to }, { afterHash: hash });
  }

  /**
   * Atomic wrapper: capture before-state, perform a file write, capture after-state,
   * and log both events. Use this instead of manual before/after capture pairs.
   */
  async logFileWriteTransaction(
    filePath: string,
    perform: () => Promise<void>,
    snapshotter: {
      captureBeforeState(fp: string, id: string, prov: TrailProvenance): Promise<{ beforeSnapshotId: string | null; beforeHash: string | null }>;
      captureAfterState(fp: string, id: string, prov: TrailProvenance): Promise<{ afterSnapshotId: string | null; afterHash: string | null }>;
    },
  ): Promise<{ eventId: string; beforeSnapshotId: string | null; afterSnapshotId: string | null }> {
    const prov = this.getProvenance();
    const tempId = makeTrailEventId(this.seqCounter, prov.sessionId);

    const before = await snapshotter.captureBeforeState(filePath, tempId, prov);
    await perform();
    const after = await snapshotter.captureAfterState(filePath, tempId, prov);

    const eventId = await this.logFileWrite(
      filePath,
      before.beforeHash ?? undefined,
      after.afterHash ?? undefined,
      before.beforeSnapshotId ?? undefined,
      after.afterSnapshotId ?? undefined,
    );

    return {
      eventId,
      beforeSnapshotId: before.beforeSnapshotId,
      afterSnapshotId: after.afterSnapshotId,
    };
  }

  /** Log a verification event. */
  async logVerification(
    stage: string,
    passed: boolean,
    details?: string,
  ): Promise<string> {
    return this.log(
      "verification",
      "Verification",
      `Verification ${passed ? "PASS" : "FAIL"}: ${stage}`,
      { stage, passed, details },
    );
  }

  /** Log an error. */
  async logError(actor: string, error: string, context?: Record<string, unknown>): Promise<string> {
    return this.log("error", actor, `Error in ${actor}: ${error.slice(0, 120)}`, {
      error,
      ...context,
    });
  }

  /** Log a retry. */
  async logRetry(actor: string, attempt: number, reason: string): Promise<string> {
    return this.log("retry", actor, `Retry ${attempt} for ${actor}: ${reason.slice(0, 80)}`, {
      attempt,
      reason,
    });
  }

  /** Log a checkpoint transition. */
  async logCheckpointTransition(
    checkpointId: string,
    step: number,
    fromStep?: number,
  ): Promise<string> {
    return this.log(
      "checkpoint_transition",
      "Checkpointer",
      `Checkpoint transition: step ${step}`,
      { checkpointId, step, fromStep },
      { provenance: { checkpointId } },
    );
  }

  /** Log an anomaly flag. */
  async logAnomaly(
    anomalyType: string,
    description: string,
    relatedEventIds?: string[],
  ): Promise<string> {
    return this.log(
      "anomaly_flag",
      "AnomalyDetector",
      `Anomaly: ${anomalyType} — ${description.slice(0, 120)}`,
      { anomalyType, description, relatedEventIds },
    );
  }

  // -------------------------------------------------------------------------
  // Provenance management
  // -------------------------------------------------------------------------

  /** Update the current lane context (for council/subagent runs). */
  setLaneContext(laneId: string, parentLaneId?: string): void {
    this.provenance = { ...this.provenance, laneId, parentLaneId };
  }

  /** Update worktree/branch context. */
  setGitContext(worktreePath?: string, branch?: string): void {
    this.provenance = { ...this.provenance, worktreePath, branch };
  }

  /** Update checkpoint linkage. */
  setCheckpointContext(checkpointId: string): void {
    this.provenance = { ...this.provenance, checkpointId };
  }

  /** Get current provenance. */
  getProvenance(): TrailProvenance {
    return { ...this.provenance };
  }

  /** Get current session ID. */
  getSessionId(): string {
    return this.provenance.sessionId;
  }

  // -------------------------------------------------------------------------
  // Index access
  // -------------------------------------------------------------------------

  getIndex(): TrailEventIndex {
    return this.index;
  }

  getSessionMap(): SessionMap {
    return this.sessionMap;
  }

  getStore(): TrailStore {
    return this.store;
  }

  // -------------------------------------------------------------------------
  // Gap 5: Cache invalidation hook
  // -------------------------------------------------------------------------

  /** Register a callback invoked after each new event is indexed. */
  setOnNewEventCallback(cb: () => void): void {
    this.onNewEvent = cb;
  }

  // -------------------------------------------------------------------------
  // Flush / shutdown
  // -------------------------------------------------------------------------

  /** Gap 4: wait for all queued writes to complete. */
  async drain(): Promise<void> {
    await this.writeQueue;
  }

  async flush(): Promise<void> {
    await this.drain();
    await this.store.flush();
    this.sessionMap.endSession(this.provenance.sessionId);
  }
}

// ---------------------------------------------------------------------------
// Global singleton logger (for always-on operation)
// ---------------------------------------------------------------------------

let globalLogger: AuditLogger | null = null;

export function getGlobalLogger(options?: AuditLoggerOptions): AuditLogger {
  if (!globalLogger) {
    globalLogger = new AuditLogger(options);
  }
  return globalLogger;
}

export function resetGlobalLogger(): void {
  globalLogger = null;
}
