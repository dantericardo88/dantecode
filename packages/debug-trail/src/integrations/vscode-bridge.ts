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
    const result = await this.cli.debugTrail(query);
    return this.wrap("trail_query_result", result);
  }

  async handleSnapshot(fileOrSession?: string): Promise<VsCodeTrailMessage> {
    const result = await this.cli.debugSnapshot(fileOrSession);
    return this.wrap("snapshot_result", result);
  }

  async handleRestore(id: string): Promise<VsCodeTrailMessage> {
    const result = await this.cli.debugRestore(id);
    return this.wrap("restore_result", result);
  }

  async handleReplay(sessionId: string, step?: number): Promise<VsCodeTrailMessage> {
    const result = await this.cli.debugReplay(sessionId, step);
    return this.wrap("replay_result", result);
  }

  async handleExport(sessionId: string): Promise<VsCodeTrailMessage> {
    const result = await this.cli.auditExport(sessionId);
    return this.wrap("export_result", result);
  }

  /** Get recent events for the sidebar's "Recent Activity" panel. */
  async getRecentEvents(limit = 20): Promise<VsCodeTrailMessage> {
    const result = await this.cli.debugTrail(undefined);
    // Take most recent N events
    const recent = result.results.slice(0, limit);
    return this.wrap("recent_events", { events: recent, totalMatches: result.totalMatches });
  }

  // -------------------------------------------------------------------------
  // Dispatch from webview
  // -------------------------------------------------------------------------

  async dispatch(command: string, args: Record<string, unknown>): Promise<VsCodeTrailMessage> {
    switch (command) {
      case "query":
        return this.handleQuery(args["query"] as string | undefined);
      case "snapshot":
        return this.handleSnapshot(args["target"] as string | undefined);
      case "restore":
        return this.handleRestore(args["id"] as string);
      case "replay":
        return this.handleReplay(
          args["sessionId"] as string,
          args["step"] as number | undefined,
        );
      case "export":
        return this.handleExport(args["sessionId"] as string);
      case "recent":
        return this.getRecentEvents(args["limit"] as number | undefined);
      default:
        return this.wrap("trail_query_result", { error: `Unknown command: ${command}` });
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
    };
  }

  private wrap(kind: VsCodeTrailMessageKind, data: unknown, sessionId?: string): VsCodeTrailMessage {
    return {
      kind,
      sessionId,
      data,
      timestamp: new Date().toISOString(),
    };
  }
}
