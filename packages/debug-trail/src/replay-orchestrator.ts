// ============================================================================
// @dantecode/debug-trail — Replay Orchestrator (LangGraph-inspired)
// Time-travel through session events. Read-only by default.
// Reconstructs decision chains and file-state at any step.
// ============================================================================

import type {
  TrailEvent,
  ReplayCursor,
  DebugReplayResult,
  DebugTrailConfig,
} from "./types.js";
import { defaultConfig } from "./types.js";
import { TrailStore, getTrailStore } from "./sqlite-store.js";
import { FileSnapshotter } from "./file-snapshotter.js";

// ---------------------------------------------------------------------------
// Replay session state
// ---------------------------------------------------------------------------

interface ReplaySession {
  sessionId: string;
  events: TrailEvent[];
  /** filePath → current snapshotId at the cursor position */
  fileStateAtStep: Map<string, string>;
  currentStep: number;
}

// ---------------------------------------------------------------------------
// Replay Orchestrator
// ---------------------------------------------------------------------------

export class ReplayOrchestrator {
  private config: DebugTrailConfig;
  private store: TrailStore;
  private snapshotter: FileSnapshotter;
  /** In-memory replay sessions keyed by sessionId */
  private replaySessions = new Map<string, ReplaySession>();
  // E1: cap in-memory replay sessions to prevent unbounded growth in long-running processes.
  private static readonly MAX_REPLAY_SESSIONS = 50;

  constructor(
    config?: Partial<DebugTrailConfig>,
    snapshotter?: FileSnapshotter,
  ) {
    this.config = { ...defaultConfig(), ...config };
    this.store = getTrailStore(this.config.storageRoot);
    this.snapshotter = snapshotter ?? new FileSnapshotter(this.config);
  }

  // -------------------------------------------------------------------------
  // Start / reset a replay session
  // -------------------------------------------------------------------------

  async startReplay(sessionId: string): Promise<ReplayCursor> {
    await this.store.init();
    const events = await this.store.queryBySession(sessionId);

    if (events.length === 0) {
      return {
        sessionId,
        currentStep: 0,
        totalSteps: 0,
        events: [],
        fileStateMap: {},
        complete: true,
      };
    }

    // Sort by seq
    const sorted = events.sort((a, b) => a.seq - b.seq);

    const session: ReplaySession = {
      sessionId,
      events: sorted,
      fileStateAtStep: new Map(),
      currentStep: 0,
    };
    this.evictIfNeeded();
    this.replaySessions.set(sessionId, session);

    return this.buildCursor(session);
  }

  // -------------------------------------------------------------------------
  // Step forward
  // -------------------------------------------------------------------------

  async stepForward(sessionId: string, steps = 1): Promise<ReplayCursor> {
    const session = this.replaySessions.get(sessionId);
    if (!session) {
      return this.startReplay(sessionId);
    }

    const targetStep = Math.min(session.currentStep + steps, session.events.length);

    // Advance file state map through each new event
    for (let i = session.currentStep; i < targetStep; i++) {
      const event = session.events[i]!;
      this.applyEventToFileState(event, session.fileStateAtStep);
    }

    session.currentStep = targetStep;
    return this.buildCursor(session);
  }

  // -------------------------------------------------------------------------
  // Jump to specific step
  // -------------------------------------------------------------------------

  async jumpToStep(sessionId: string, step: number): Promise<ReplayCursor> {
    const session = this.replaySessions.get(sessionId);
    if (!session) {
      const cursor = await this.startReplay(sessionId);
      if (step === 0) return cursor;
    }

    const existing = this.replaySessions.get(sessionId);
    if (!existing) return { sessionId, currentStep: 0, totalSteps: 0, events: [], fileStateMap: {}, complete: true };

    // Rebuild file state from scratch to the target step
    existing.fileStateAtStep.clear();
    const targetStep = Math.max(0, Math.min(step, existing.events.length));

    for (let i = 0; i < targetStep; i++) {
      this.applyEventToFileState(existing.events[i]!, existing.fileStateAtStep);
    }

    existing.currentStep = targetStep;
    return this.buildCursor(existing);
  }

  // -------------------------------------------------------------------------
  // Replay an entire session (returns full replay result)
  // -------------------------------------------------------------------------

  async replaySession(sessionId: string, step?: number): Promise<DebugReplayResult> {
    const cursor = step != null
      ? await this.jumpToStep(sessionId, step)
      : await this.startReplay(sessionId);

    // If step not specified, advance to end for full replay
    let finalCursor = cursor;
    if (step == null) {
      finalCursor = await this.jumpToStep(sessionId, cursor.totalSteps);
    }

    // Gap 6: return ALL events for the session, not just the ±5 cursor window.
    // cursor.events is intentionally the windowed view — keep it for incremental display.
    const allSessionEvents = this.replaySessions.get(sessionId)?.events ?? [];
    const trailSlice =
      step != null
        ? allSessionEvents.slice(0, Math.min(step + 1, allSessionEvents.length))
        : allSessionEvents;

    return {
      sessionId,
      step,
      replayed: true,
      trail: trailSlice,
      cursor: finalCursor,
    };
  }

  // -------------------------------------------------------------------------
  // Get file content at a specific step
  // -------------------------------------------------------------------------

  async getFileAtStep(
    sessionId: string,
    filePath: string,
    step: number,
  ): Promise<{ content: Buffer | null; snapshotId: string | null }> {
    const cursor = await this.jumpToStep(sessionId, step);
    const snapshotId = cursor.fileStateMap[filePath];

    if (!snapshotId) {
      return { content: null, snapshotId: null };
    }

    const content = await this.snapshotter.readSnapshot(snapshotId);
    return { content, snapshotId };
  }

  // -------------------------------------------------------------------------
  // Decision chain reconstruction
  // -------------------------------------------------------------------------

  /**
   * Reconstruct the chain of events that led to a specific event.
   * Returns events sorted oldest-first leading up to (and including) the target.
   */
  async reconstructDecisionChain(
    sessionId: string,
    targetEventId: string,
    lookbackSteps = 10,
  ): Promise<TrailEvent[]> {
    await this.store.init();
    const events = await this.store.queryBySession(sessionId);
    const sorted = events.sort((a, b) => a.seq - b.seq);

    const targetIdx = sorted.findIndex((e) => e.id === targetEventId);
    if (targetIdx < 0) return [];

    const start = Math.max(0, targetIdx - lookbackSteps);
    return sorted.slice(start, targetIdx + 1);
  }

  // -------------------------------------------------------------------------
  // Checkpoint-aligned replay
  // -------------------------------------------------------------------------

  /**
   * Find all events associated with a specific checkpoint.
   */
  async eventsForCheckpoint(checkpointId: string): Promise<TrailEvent[]> {
    await this.store.init();
    const all = await this.store.readAllEvents();
    return all.filter((e) => e.provenance.checkpointId === checkpointId);
  }

  // -------------------------------------------------------------------------
  // Internal helpers
  // -------------------------------------------------------------------------

  // E1: FIFO eviction — Map preserves insertion order so .keys().next() is the oldest.
  private evictIfNeeded(): void {
    while (this.replaySessions.size >= ReplayOrchestrator.MAX_REPLAY_SESSIONS) {
      const oldest = this.replaySessions.keys().next().value;
      if (oldest !== undefined) {
        this.replaySessions.delete(oldest);
      } else {
        break;
      }
    }
  }

  private applyEventToFileState(event: TrailEvent, fileState: Map<string, string>): void {
    const fp = event.payload["filePath"];
    if (typeof fp !== "string") return;

    if (event.afterSnapshotId) {
      fileState.set(fp, event.afterSnapshotId);
    } else if (event.kind === "file_delete") {
      fileState.delete(fp);
    } else if (event.kind === "file_restore") {
      // E2: when afterSnapshotId is absent (after-state capture failed), fall back to
      // payload["snapshotId"] — the source snapshot used to restore the file.
      const sourceSnapshotId = event.payload["snapshotId"];
      if (typeof sourceSnapshotId === "string") {
        fileState.set(fp, sourceSnapshotId);
      }
    }

    // Handle file moves
    if (event.kind === "file_move") {
      const from = event.payload["from"];
      const to = event.payload["to"];
      if (typeof from === "string" && typeof to === "string") {
        const currentSnap = fileState.get(from);
        if (currentSnap) {
          fileState.set(to, currentSnap);
          fileState.delete(from);
        }
      }
    }
  }

  private buildCursor(session: ReplaySession): ReplayCursor {
    const windowStart = Math.max(0, session.currentStep - 5);
    const windowEnd = Math.min(session.events.length, session.currentStep + 5);
    const contextEvents = session.events.slice(windowStart, windowEnd);

    const fileStateMap: Record<string, string> = {};
    for (const [fp, sid] of session.fileStateAtStep) {
      fileStateMap[fp] = sid;
    }

    return {
      sessionId: session.sessionId,
      currentStep: session.currentStep,
      totalSteps: session.events.length,
      events: contextEvents,
      fileStateMap,
      complete: session.currentStep >= session.events.length,
    };
  }
}
