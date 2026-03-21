// ============================================================================
// @dantecode/debug-trail — VS Code Bridge
// Surfaces trail data to the VS Code sidebar panel.
// Same core trail semantics — no UI-only dependency for core functionality.
// ============================================================================

import type { TrailEvent } from "../types.js";
import { CliBridge } from "./cli-bridge.js";
import type { AuditLogger } from "../audit-logger.js";
import type { DebugTrailConfig } from "../types.js";

// ---------------------------------------------------------------------------
// VS Code message types (for webview communication)
// ---------------------------------------------------------------------------

export type VsCodeTrailMessageKind =
  | "trail_query_result"
  | "snapshot_result"
  | "restore_result"
  | "replay_result"
  | "export_result"
  | "session_list"
  | "file_list"
  | "recent_events";

export interface VsCodeTrailMessage {
  kind: VsCodeTrailMessageKind;
  sessionId?: string;
  data: unknown;
  timestamp: string;
}

// ---------------------------------------------------------------------------
// VS Code Bridge
// ---------------------------------------------------------------------------

export class VsCodeBridge {
  private cli: CliBridge;

  constructor(logger: AuditLogger, config?: Partial<DebugTrailConfig>) {
    this.cli = new CliBridge(logger, config);
  }

  // -------------------------------------------------------------------------
  // Command handlers (called from VS Code webview messages)
  // -------------------------------------------------------------------------

  async handleQuery(query?: string): Promise<VsCodeTrailMessage> {
    try {
      const result = await this.cli.debugTrail(query);
      return this.wrap("trail_query_result", { success: true, ...result });
    } catch (err) {
      return this.wrap("trail_query_result", {
        success: false,
        error: err instanceof Error ? err.message : String(err),
        errorCode: "query_failed",
        results: [],
        totalMatches: 0,
        latencyMs: 0,
      });
    }
  }

  async handleSnapshot(fileOrSession?: string): Promise<VsCodeTrailMessage> {
    try {
      const result = await this.cli.debugSnapshot(fileOrSession);
      return this.wrap("snapshot_result", { success: true, ...result });
    } catch (err) {
      return this.wrap("snapshot_result", {
        success: false,
        error: err instanceof Error ? err.message : String(err),
        errorCode: "snapshot_failed",
      });
    }
  }

  async handleRestore(id: string): Promise<VsCodeTrailMessage> {
    try {
      const result = await this.cli.debugRestore(id);
      return this.wrap("restore_result", { success: true, ...result });
    } catch (err) {
      return this.wrap("restore_result", {
        success: false,
        error: err instanceof Error ? err.message : String(err),
        errorCode: "restore_failed",
      });
    }
  }

  async handleReplay(sessionId: string, step?: number): Promise<VsCodeTrailMessage> {
    try {
      const result = await this.cli.debugReplay(sessionId, step);
      return this.wrap("replay_result", { success: true, ...result });
    } catch (err) {
      return this.wrap("replay_result", {
        success: false,
        error: err instanceof Error ? err.message : String(err),
        errorCode: "replay_failed",
      });
    }
  }

  async handleExport(sessionId: string): Promise<VsCodeTrailMessage> {
    try {
      const result = await this.cli.auditExport(sessionId);
      return this.wrap("export_result", { success: true, ...result });
    } catch (err) {
      return this.wrap("export_result", {
        success: false,
        error: err instanceof Error ? err.message : String(err),
        errorCode: "export_failed",
      });
    }
  }

  /** Get recent events for the sidebar's "Recent Activity" panel. */
  async getRecentEvents(limit = 20): Promise<VsCodeTrailMessage> {
    try {
      // B2: use debugTrailRecent so the limit is respected end-to-end (not capped at 20 then sliced).
      const result = await this.cli.debugTrailRecent(limit);
      return this.wrap("recent_events", {
        success: true,
        events: result.results,
        totalMatches: result.totalMatches,
      });
    } catch (err) {
      return this.wrap("recent_events", {
        success: false,
        error: err instanceof Error ? err.message : String(err),
        errorCode: "recent_events_failed",
        events: [],
        totalMatches: 0,
      });
    }
  }

  /** B1: List all in-memory sessions. */
  handleSessionList(): VsCodeTrailMessage {
    const sessions = this.cli.getSessionList();
    return this.wrap("session_list", { success: true, sessions });
  }

  /** B1: List all indexed file paths. */
  handleFileList(): VsCodeTrailMessage {
    const files = this.cli.getFileList();
    return this.wrap("file_list", { success: true, files });
  }

  // -------------------------------------------------------------------------
  // Dispatch from webview
  // -------------------------------------------------------------------------

  async dispatch(command: string, args: Record<string, unknown>): Promise<VsCodeTrailMessage> {
    try {
      switch (command) {
        case "query":
          return this.handleQuery(args["query"] as string | undefined);
        case "snapshot":
          return this.handleSnapshot(args["target"] as string | undefined);
        case "restore":
          return this.handleRestore(args["id"] as string);
        case "replay":
          return this.handleReplay(args["sessionId"] as string, args["step"] as number | undefined);
        case "export":
          return this.handleExport(args["sessionId"] as string);
        case "recent":
          return this.getRecentEvents(args["limit"] as number | undefined);
        case "session_list":
          return this.handleSessionList();
        case "file_list":
          return this.handleFileList();
        default:
          return this.wrap("trail_query_result", {
            success: false,
            error: `Unknown command: ${command}`,
            results: [],
            totalMatches: 0,
            latencyMs: 0,
          });
      }
    } catch (err) {
      return this.wrap("trail_query_result", {
        success: false,
        error: err instanceof Error ? err.message : String(err),
        command,
        errorCode: "dispatch_failed",
        results: [],
        totalMatches: 0,
        latencyMs: 0,
      });
    }
  }

  // -------------------------------------------------------------------------
  // Format events for webview display
  // -------------------------------------------------------------------------

  /** Format a trail event as a simple sidebar-friendly object. */
  static formatEventForSidebar(event: TrailEvent): Record<string, unknown> {
    return {
      id: event.id,
      seq: event.seq,
      kind: event.kind,
      actor: event.actor,
      summary: event.summary,
      timestamp: event.timestamp,
      filePath: event.payload["filePath"] ?? null,
      hasSnapshot: !!(event.afterSnapshotId || event.beforeSnapshotId),
      trustScore: event.trustScore ?? null,
      // B3: provenance fields needed by sidebar consumers to group/filter by session or lane.
      sessionId: event.provenance.sessionId,
      laneId: event.provenance.laneId ?? null,
    };
  }

  private wrap(
    kind: VsCodeTrailMessageKind,
    data: unknown,
    sessionId?: string,
  ): VsCodeTrailMessage {
    return {
      kind,
      sessionId,
      data,
      timestamp: new Date().toISOString(),
    };
  }
}
