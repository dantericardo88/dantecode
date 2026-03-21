// ============================================================================
// @dantecode/debug-trail — CLI Bridge
// Exposes debugTrail / debugSnapshot / debugRestore / debugReplay / auditExport
// as answerable CLI commands. Same trail semantics as VS Code surface.
// ============================================================================

import type {
  DebugTrailResult,
  DebugSnapshotResult,
  DebugRestoreResult,
  DebugReplayResult,
  AuditExportResult,
  DebugTrailConfig,
} from "../types.js";
import { defaultConfig } from "../types.js";
import { AuditLogger } from "../audit-logger.js";
import { FileSnapshotter } from "../file-snapshotter.js";
import { TrailQueryEngine } from "../trail-query-engine.js";
import { ReplayOrchestrator } from "../replay-orchestrator.js";
import { RestoreEngine } from "../restore-engine.js";
import { ExportEngine } from "../export-engine.js";
import { getTrailStore } from "../sqlite-store.js";

// ---------------------------------------------------------------------------
// CLI Bridge — thin adapter over the core engines
// ---------------------------------------------------------------------------

export class CliBridge {
  private config: DebugTrailConfig;
  private logger: AuditLogger;
  private snapshotter: FileSnapshotter;
  private queryEngine: TrailQueryEngine;
  private replayOrchestrator: ReplayOrchestrator;
  private restoreEngine: RestoreEngine;
  private exportEngine: ExportEngine;

  constructor(logger: AuditLogger, config?: Partial<DebugTrailConfig>) {
    this.config = { ...defaultConfig(), ...config };
    this.logger = logger;
    this.snapshotter = new FileSnapshotter(this.config);
    this.queryEngine = new TrailQueryEngine(this.config, logger.getIndex());
    this.replayOrchestrator = new ReplayOrchestrator(this.config, this.snapshotter);
    this.restoreEngine = new RestoreEngine(this.snapshotter, logger);
    this.exportEngine = new ExportEngine(this.config);
    // Gap 5: invalidate query cache whenever a new event is logged
    logger.setOnNewEventCallback(() => this.queryEngine.invalidateCache());
  }

  /** Search the debug trail. Accepts natural language or structured query. */
  async debugTrail(query?: string): Promise<DebugTrailResult> {
    if (!query) {
      return this.queryEngine.query({ limit: 20, order: "desc" });
    }
    return this.queryEngine.query(query);
  }

  /** Capture a snapshot of a file or current session. */
  async debugSnapshot(fileOrSession?: string): Promise<DebugSnapshotResult> {
    const provenance = this.logger.getProvenance();

    if (!fileOrSession) {
      // Snapshot current session state summary
      const sessionId = this.logger.getSessionId();
      return {
        snapshotId: `session:${sessionId}`,
        target: sessionId,
        created: true,
      };
    }

    // Assume it's a file path
    const snap = await this.snapshotter.captureSnapshot(fileOrSession, "cli-manual-snapshot", provenance);
    if (!snap) {
      return { snapshotId: "", target: fileOrSession, created: false };
    }

    await this.logger.logFileWrite(fileOrSession, undefined, snap.contentHash, undefined, snap.snapshotId);

    return {
      snapshotId: snap.snapshotId,
      target: fileOrSession,
      created: true,
      contentHash: snap.contentHash,
      sizeBytes: snap.sizeBytes,
    };
  }

  /** Restore a file from a snapshot ID or from its most recent tombstone. */
  async debugRestore(id: string): Promise<DebugRestoreResult> {
    // 1. Try as tombstone/snapshotId lookup
    const allTombstones = this.snapshotter.getTombstones().all();
    const tomb = allTombstones.find(
      (t) => t.tombstoneId === id || t.lastSnapshotId === id || t.filePath === id,
    );
    if (tomb) {
      return this.restoreEngine.restoreDeletedFile(tomb.filePath);
    }

    // 2. If id looks like a file path, restore by path directly
    if (id.includes("/") || id.includes("\\") || /\.\w{1,6}$/.test(id)) {
      return this.restoreEngine.restoreDeletedFile(id);
    }

    // 3. Try as direct snapshot ID — look up original file path from events
    const events = await getTrailStore(this.config.storageRoot).readAllEvents();
    const matchEvent = events.find(
      (e) => e.afterSnapshotId === id || e.beforeSnapshotId === id,
    );
    const filePath =
      matchEvent && typeof matchEvent.payload["filePath"] === "string"
        ? matchEvent.payload["filePath"]
        : undefined;

    return this.restoreEngine.restoreFromSnapshot(id, filePath ?? id);
  }

  /** Replay a session. */
  async debugReplay(sessionId: string, step?: number): Promise<DebugReplayResult> {
    return this.replayOrchestrator.replaySession(sessionId, step);
  }

  /** Export a session as an immutable forensic report. */
  async auditExport(sessionId: string): Promise<AuditExportResult> {
    return this.exportEngine.exportSession(sessionId, {
      format: "json",
      includeCompleteness: true,
      includeTombstones: true,
    });
  }

  /** Print a human-readable summary to a string. */
  async summary(sessionId?: string): Promise<string> {
    const sid = sessionId ?? this.logger.getSessionId();
    const result = await this.queryEngine.query({ sessionId: sid, limit: 10, order: "desc" });
    const lines: string[] = [
      `Debug Trail Summary — Session: ${sid}`,
      `Total matches: ${result.totalMatches}`,
      `Query latency: ${result.latencyMs}ms`,
      ``,
    ];
    for (const e of result.results) {
      lines.push(`[${e.seq}] ${e.kind} | ${e.actor} | ${e.summary}`);
    }
    return lines.join("\n");
  }
}
