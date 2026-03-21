// ============================================================================
// @dantecode/cli — Serve: Session Event Emitter
// Bridges agent-loop output to HTTP/SSE clients.
// In serve mode, the agent loop emits events here instead of writing to stdout.
// SSE streams subscribe and forward events to connected clients.
// ============================================================================

import { EventEmitter } from "node:events";

/** All SSE event types emitted by the agent loop. */
export type SSEEventType =
  | "token"
  | "tool_start"
  | "tool_end"
  | "diff"
  | "pdse"
  | "status"
  | "error"
  | "done"
  | "approval_needed";

/** A single SSE event. */
export interface SSEEvent {
  type: SSEEventType;
  data: Record<string, unknown>;
  timestamp: string;
}

/**
 * Event emitter that bridges agent-loop output to HTTP/SSE clients.
 *
 * Lifecycle:
 *   1. SSE stream opens → subscribe(sessionId, handler)
 *   2. Agent loop runs  → emit(sessionId, event) for each output
 *   3. SSE stream closes → call the returned unsubscribe()
 *
 * In REPL mode (no HTTP server), this emitter is never used — stdout works
 * exactly as before.
 */
export class SessionEventEmitter extends EventEmitter {
  private subscribers = new Map<string, Set<(event: SSEEvent) => void>>();

  /**
   * Subscribe to events for a session.
   * Returns an unsubscribe function — call it when the SSE connection closes.
   */
  subscribe(sessionId: string, handler: (event: SSEEvent) => void): () => void {
    if (!this.subscribers.has(sessionId)) {
      this.subscribers.set(sessionId, new Set());
    }
    this.subscribers.get(sessionId)!.add(handler);
    return () => {
      const set = this.subscribers.get(sessionId);
      if (set) {
        set.delete(handler);
        if (set.size === 0) {
          this.subscribers.delete(sessionId);
        }
      }
    };
  }

  /**
   * Emit a typed SSE event for a session.
   * All subscribers for that session receive the event.
   */
  emitEvent(sessionId: string, event: SSEEvent): void {
    const set = this.subscribers.get(sessionId);
    if (!set) return;
    for (const handler of set) {
      handler(event);
    }
  }

  /** Emit a streaming token from the model. */
  emitToken(sessionId: string, token: string): void {
    this.emitEvent(sessionId, {
      type: "token",
      data: { content: token },
      timestamp: new Date().toISOString(),
    });
  }

  /** Emit tool execution start. */
  emitToolStart(
    sessionId: string,
    toolName: string,
    args: Record<string, unknown>,
  ): void {
    this.emitEvent(sessionId, {
      type: "tool_start",
      data: { toolName, args },
      timestamp: new Date().toISOString(),
    });
  }

  /** Emit tool execution end. */
  emitToolEnd(
    sessionId: string,
    toolName: string,
    result: string,
    isError: boolean,
  ): void {
    this.emitEvent(sessionId, {
      type: "tool_end",
      data: { toolName, result: result.slice(0, 500), isError },
      timestamp: new Date().toISOString(),
    });
  }

  /** Emit a file diff event. */
  emitDiff(
    sessionId: string,
    filePath: string,
    diff: string,
    additions: number,
    deletions: number,
  ): void {
    this.emitEvent(sessionId, {
      type: "diff",
      data: { filePath, diff, additions, deletions },
      timestamp: new Date().toISOString(),
    });
  }

  /** Emit a PDSE verification score. */
  emitPDSE(sessionId: string, score: number, passed: boolean): void {
    this.emitEvent(sessionId, {
      type: "pdse",
      data: { score, passed },
      timestamp: new Date().toISOString(),
    });
  }

  /** Emit an approval-needed event (agent is waiting for user confirmation). */
  emitApprovalNeeded(
    sessionId: string,
    toolName: string,
    command: string,
    riskLevel: string,
  ): void {
    this.emitEvent(sessionId, {
      type: "approval_needed",
      data: { toolName, command, riskLevel },
      timestamp: new Date().toISOString(),
    });
  }

  /** Emit a status/diagnostic message. */
  emitStatus(sessionId: string, message: string): void {
    this.emitEvent(sessionId, {
      type: "status",
      data: { message },
      timestamp: new Date().toISOString(),
    });
  }

  /** Emit an error event. */
  emitError(sessionId: string, message: string): void {
    this.emitEvent(sessionId, {
      type: "error",
      data: { message },
      timestamp: new Date().toISOString(),
    });
  }

  /** Emit generation complete. */
  emitDone(sessionId: string, tokensUsed: number, durationMs: number): void {
    this.emitEvent(sessionId, {
      type: "done",
      data: { tokensUsed, durationMs },
      timestamp: new Date().toISOString(),
    });
  }

  /** Get the number of active SSE subscribers for a session. */
  subscriberCount(sessionId: string): number {
    return this.subscribers.get(sessionId)?.size ?? 0;
  }
}
