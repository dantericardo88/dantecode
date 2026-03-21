// ============================================================================
// @dantecode/cli — Serve: SSE Stream Helper
// Creates and manages Server-Sent Events responses for real-time agent output.
// Clients connect to GET /api/sessions/:id/stream and receive events as they
// happen during agent execution.
// ============================================================================

import type { ServerResponse } from "node:http";
import type { SessionEventEmitter, SSEEvent } from "./session-emitter.js";

/** Context passed to createSSEStream. */
export interface SSEContext {
  sessionEmitter: SessionEventEmitter;
  /** Allowed CORS origins. Empty array means allow all ("*"). */
  corsOrigins?: string[];
  /** The request's Origin header value (used to compute CORS response header). */
  requestOrigin?: string;
}

/**
 * Write a single SSE event to the response stream.
 *
 * SSE format:
 *   event: <type>\n
 *   data: <JSON>\n
 *   \n
 */
function writeSSEEvent(res: ServerResponse, event: SSEEvent): void {
  const data = JSON.stringify({ ...event.data, timestamp: event.timestamp });
  res.write(`event: ${event.type}\ndata: ${data}\n\n`);
}

/**
 * Initialize an SSE response for a session.
 *
 * - Sets Content-Type: text/event-stream headers.
 * - Subscribes to the SessionEventEmitter for the given sessionId.
 * - Sends a heartbeat comment every 30s to keep the connection alive through proxies.
 * - Cleans up the subscription and interval when the client disconnects.
 *
 * The response stays open indefinitely until the client disconnects or
 * the agent emits a "done" event.
 */
export function createSSEStream(
  res: ServerResponse,
  sessionId: string,
  context: SSEContext,
): void {
  const corsOrigins = context.corsOrigins ?? [];
  const allowOrigin =
    corsOrigins.length === 0
      ? "*"
      : corsOrigins.includes(context.requestOrigin ?? "")
        ? (context.requestOrigin ?? "")
        : "";

  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
    ...(allowOrigin ? { "Access-Control-Allow-Origin": allowOrigin } : {}),
    "X-Accel-Buffering": "no", // Disable nginx buffering for SSE
  });

  // Send an initial comment so the client knows the stream is open
  res.write(`: connected to DanteCode SSE stream for session ${sessionId}\n\n`);

  // Subscribe to agent events
  const unsubscribe = context.sessionEmitter.subscribe(sessionId, (event: SSEEvent) => {
    writeSSEEvent(res, event);
  });

  // Heartbeat to keep the connection alive through proxies that time out idle connections
  const heartbeatInterval = setInterval(() => {
    if (!res.writableEnded) {
      res.write(`: heartbeat\n\n`);
    }
  }, 30_000);

  // Clean up when client disconnects
  res.on("close", () => {
    unsubscribe();
    clearInterval(heartbeatInterval);
  });
}
