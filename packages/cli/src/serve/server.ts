// ============================================================================
// @dantecode/cli — Serve: HTTP Server Core
// Starts the DanteCode HTTP server using node:http only.
// Exposes the agent-loop, session management, and tool execution as a JSON API.
//
// Security:
//   - Binds to localhost (127.0.0.1) by default — not network-accessible.
//   - Optional password auth via DANTECODE_SERVER_PASSWORD env var (HTTP Basic).
//   - CORS headers on every response.
//   - No filesystem access beyond the project root.
// ============================================================================

import { createServer, type IncomingMessage, type ServerResponse, type Server } from "node:http";
import { Router } from "./router.js";
import { buildRoutes } from "./routes.js";
import { SessionEventEmitter } from "./session-emitter.js";
import { createSSEStream } from "./sse-stream.js";
import { checkAuth, unauthorizedResponse } from "./auth.js";
import type { AuthConfig } from "./auth.js";
import type { ServerContext, AgentRunnerOpts, SessionRecord } from "./routes.js";

const VERSION = "1.0.0";

// ---------------------------------------------------------------------------
// Public Types
// ---------------------------------------------------------------------------

/** Options for starting the DanteCode HTTP server. */
export interface ServeOptions {
  /** Port to listen on. Default: 3210. */
  port?: number;
  /** Interface to bind to. Default: "127.0.0.1" (localhost only). */
  host?: string;
  /** Absolute path to the project root. */
  projectRoot: string;
  /** Password for HTTP Basic auth (from DANTECODE_SERVER_PASSWORD). */
  password?: string;
  /** Additional CORS origins to allow beyond localhost. */
  corsOrigins?: string[];
  /** Enable mDNS service discovery. Default: false. */
  enableMdns?: boolean;
  /**
   * Injected agent runner. When provided, sendMessage fires the AI agent loop.
   * Injected by commands/serve.ts; omitted in tests to avoid needing an API key.
   */
  agentRunner?: (opts: AgentRunnerOpts) => void;
}

/** Handle returned by startServer. */
export interface DanteCodeServer {
  /** The underlying Node.js HTTP server. */
  server: Server;
  /** The port the server is actually listening on. */
  port: number;
  /** Stop the server gracefully. */
  stop(): Promise<void>;
  /** URL clients should connect to. */
  url: string;
  /** The session event emitter — use to subscribe to real-time agent events. */
  sessionEmitter: SessionEventEmitter;
  /** Live session map — readable by agentRunner to clear abortController on completion. */
  sessions: Map<string, SessionRecord>;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const MAX_BODY_BYTES = 1_048_576; // 1 MB

/** Collect all chunks from an IncomingMessage into a UTF-8 string. */
function readBody(req: IncomingMessage): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const chunks: Buffer[] = [];
    let totalBytes = 0;
    req.on("data", (chunk: Buffer) => {
      totalBytes += chunk.length;
      if (totalBytes > MAX_BODY_BYTES) {
        req.destroy();
        reject(new Error("PAYLOAD_TOO_LARGE"));
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf-8")));
    req.on("error", reject);
  });
}

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

/** Returns the CORS origin value for a given request origin. */
function getAllowOrigin(requestOrigin: string | undefined, corsOrigins: string[]): string {
  if (corsOrigins.length === 0) return "*";
  return corsOrigins.includes(requestOrigin ?? "") ? (requestOrigin ?? "") : "";
}

/** Send a JSON response with the given status and optional extra headers. */
function sendJSON(
  res: ServerResponse,
  status: number,
  data: unknown,
  extraHeaders?: Record<string, string>,
): void {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Content-Length": Buffer.byteLength(body),
    ...CORS_HEADERS,
    ...extraHeaders,
  });
  res.end(body);
}

/** Parse a URL into path + query object. */
function parseURL(rawUrl: string): { path: string; query: Record<string, string> } {
  const qMark = rawUrl.indexOf("?");
  if (qMark === -1) return { path: rawUrl, query: {} };

  const path = rawUrl.slice(0, qMark);
  const queryStr = rawUrl.slice(qMark + 1);
  const query: Record<string, string> = {};
  for (const pair of queryStr.split("&")) {
    if (!pair) continue;
    const eq = pair.indexOf("=");
    const key = decodeURIComponent(eq === -1 ? pair : pair.slice(0, eq));
    const val = decodeURIComponent(eq === -1 ? "" : pair.slice(eq + 1));
    query[key] = val;
  }
  return { path, query };
}

/** Extract the session ID from a path matching /api/sessions/:id/stream */
const SSE_STREAM_RE = /^\/api\/sessions\/([^/]+)\/stream$/;

// ---------------------------------------------------------------------------
// Server Factory
// ---------------------------------------------------------------------------

/**
 * Start the DanteCode HTTP server.
 *
 * Creates a node:http server, registers all API routes once, handles auth,
 * and returns a handle with stop() for clean shutdown.
 *
 * SSE streams are handled before the router to avoid the router needing
 * access to the raw ServerResponse object.
 */
export async function startServer(options: ServeOptions): Promise<DanteCodeServer> {
  const port = options.port ?? 3210;
  const host = options.host ?? "127.0.0.1";
  const startTime = Date.now();
  const corsOrigins = options.corsOrigins ?? [];

  const authConfig: AuthConfig = {
    password: options.password,
    username: "dantecode",
  };

  const sessionEmitter = new SessionEventEmitter();

  const context: ServerContext = {
    projectRoot: options.projectRoot,
    version: VERSION,
    startTime,
    sessions: new Map(),
    sessionEmitter,
    model: "claude-sonnet-4-6",
    agentRunner: options.agentRunner,
  };

  // Build the router once — all routes except SSE streams (which need raw `res`)
  const router = new Router();
  buildRoutes(router, context);

  const server: Server = createServer(
    async (req: IncomingMessage, res: ServerResponse) => {
      const method = (req.method?.toUpperCase() ?? "GET") as
        | "GET"
        | "POST"
        | "PUT"
        | "DELETE"
        | "OPTIONS";
      const rawUrl = req.url ?? "/";

      // Handle CORS preflight
      if (method === "OPTIONS") {
        res.writeHead(204, CORS_HEADERS);
        res.end();
        return;
      }

      // Normalize headers to lower-case keys for consistent lookup
      const headers: Record<string, string> = {};
      for (const [k, v] of Object.entries(req.headers)) {
        headers[k.toLowerCase()] = Array.isArray(v) ? (v[0] ?? "") : (v ?? "");
      }

      // Compute dynamic CORS origin header based on the request's Origin
      const requestOrigin = headers["origin"];
      const corsOriginHeader = getAllowOrigin(requestOrigin, corsOrigins);
      const corsOverride: Record<string, string> = corsOriginHeader
        ? { "Access-Control-Allow-Origin": corsOriginHeader }
        : {};

      // Auth check
      if (!checkAuth(headers, authConfig)) {
        const unauth = unauthorizedResponse();
        sendJSON(res, unauth.status, unauth.body, { ...unauth.headers, ...corsOverride });
        return;
      }

      const { path, query } = parseURL(rawUrl);

      // SSE streams need direct access to `res` — handle before the router
      const sseMatch = method === "GET" ? SSE_STREAM_RE.exec(path) : null;
      if (sseMatch) {
        const sessionId = sseMatch[1]!;
        const session = context.sessions.get(sessionId);
        if (!session) {
          sendJSON(res, 404, { error: `Session not found: ${sessionId}` }, corsOverride);
          return;
        }
        createSSEStream(res, sessionId, {
          sessionEmitter: context.sessionEmitter,
          corsOrigins,
          requestOrigin,
        });
        return;
      }

      // Parse JSON body for POST/PUT
      let body: unknown = undefined;
      if (method === "POST" || method === "PUT") {
        let raw = "";
        try {
          raw = await readBody(req);
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : "";
          if (msg === "PAYLOAD_TOO_LARGE") {
            sendJSON(res, 413, { error: "Payload too large (max 1 MB)" }, corsOverride);
            return;
          }
        }
        if (raw) {
          try {
            body = JSON.parse(raw);
          } catch {
            // Leave body as undefined — handlers validate
          }
        }
      }

      // Route the request
      try {
        const result = await router.handle({
          method: method as "GET" | "POST" | "PUT" | "DELETE",
          path,
          params: {},
          query,
          body,
          headers,
        });

        sendJSON(res, result.status, result.body, { ...result.headers, ...corsOverride });
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        sendJSON(res, 500, { error: "Internal server error", message }, corsOverride);
      }
    },
  );

  // Start listening
  await new Promise<void>((resolve, reject) => {
    server.on("error", reject);
    server.listen(port, host, () => {
      server.removeListener("error", reject);
      resolve();
    });
  });

  // Get the actual port (in case port 0 was specified)
  const addr = server.address();
  const actualPort = typeof addr === "object" && addr !== null ? addr.port : port;
  const url = `http://${host}:${actualPort}`;

  return {
    server,
    port: actualPort,
    url,
    sessionEmitter,
    sessions: context.sessions,
    stop(): Promise<void> {
      return new Promise<void>((resolve, reject) => {
        server.close((err) => {
          if (err) reject(err);
          else resolve();
        });
      });
    },
  };
}
