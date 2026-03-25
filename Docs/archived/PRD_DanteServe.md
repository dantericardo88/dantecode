# EXECUTION PACKET: DanteServe — HTTP Server Mode
## IDE / Terminal Integration (7.0 → 9.0+)

## Document Control

| Field | Value |
|---|---|
| **Version** | 1.0.0 |
| **Codename** | DanteServe |
| **Author** | Council of Minds (Claude Opus + Ricky) |
| **Target Packages** | `@dantecode/cli` (new serve command + HTTP layer) |
| **Branch** | `feat/dantecode-9plus-complete-matrix` |
| **Estimated LOC** | ~1,200 source + ~500 tests |
| **Sprint Time** | 3-4 hours for Claude Code |

---

## 1. The Problem

DanteCode's live surfaces are: CLI REPL and VSCode extension. Both require the user to be physically at the terminal or IDE. There's no way to:

- Start a task from your phone and check results later
- Drive DanteCode from a web browser
- Connect a JetBrains IDE without building a full plugin
- Run DanteCode as a headless API for CI/CD integration
- Let multiple frontends connect to the same DanteCode backend

Claude Code solved this with multi-surface architecture — terminal, VSCode, JetBrains, Desktop, Web, iOS all share the same engine via `/teleport` and Remote Control. OpenCode solved it with a client/server architecture where the TUI is just one frontend and `opencode serve` exposes an HTTP API that any client can drive. Codex has `codex exec --json` for non-interactive scripting.

DanteCode needs the same architectural split: **the backend becomes an HTTP server, the REPL becomes one of many possible frontends.**

---

## 2. Competitive Landscape

### Claude Code Multi-Surface (9.0)
- Terminal CLI, VSCode, JetBrains, Desktop app, Web, iOS
- `/teleport` for cross-surface session handoff
- Remote Control for phone monitoring
- All surfaces share CLAUDE.md, settings, MCP servers

### OpenCode Client/Server (9.0)
- `opencode serve` starts HTTP API server
- `opencode web` starts HTTP + browser UI
- mDNS service discovery for network access
- TUI is just one client; any frontend can connect
- ACP (Agent Client Protocol) for Zed editor integration

### Codex CLI (8.5)
- `codex exec` for non-interactive CI/CD scripting
- `codex exec --json` for structured output
- `codex app` for desktop experience
- Session history shared across surfaces

### DanteCode Current (7.0)
- CLI REPL (readline-based)
- VSCode extension (substantial — sidebar, diagnostics, diff review, inline completion)
- MCP server (stdio only, exposes DanteForge tools)
- No HTTP mode, no headless API, no cross-surface handoff
- `--continue` flag exists for session resume

---

## 3. Architecture: The Server Split

The key insight: **don't build a new server from scratch. Extract the agent-loop and session management into an HTTP-accessible service, and make the existing REPL a client of that service.**

```
BEFORE:
  CLI REPL → agent-loop → tools → model → output to stdout

AFTER:
  CLI REPL ─────┐
  Web Browser ──┤
  Mobile App ───┤──→ HTTP Server → agent-loop → tools → model
  JetBrains ────┤          ↑
  CI Script ────┘      Shared: sessions, STATE.yaml, MCP servers,
                       DanteForge verification, evidence chain
```

The server uses Node's built-in `http` module. **No Express, no Fastify, no external dependencies.** The routing is simple enough that a lightweight hand-rolled router handles it.

---

## 4. Component Specifications

### 4.1 — HTTP Server Core (`cli/src/serve/server.ts`)

```typescript
/**
 * DanteCode HTTP server.
 * Exposes the agent-loop, session management, and tool execution
 * as a JSON API. Zero external dependencies — uses node:http only.
 *
 * Security:
 * - Binds to localhost by default (127.0.0.1)
 * - Optional password auth via DANTECODE_SERVER_PASSWORD env var
 * - CORS restricted to configured origins
 * - No filesystem access beyond the project root
 */

import * as http from "node:http";

export interface ServeOptions {
  port?: number;              // Default: 3210
  host?: string;              // Default: "127.0.0.1" (localhost only)
  projectRoot: string;
  password?: string;          // From env DANTECODE_SERVER_PASSWORD
  corsOrigins?: string[];     // Additional allowed CORS origins
  enableMdns?: boolean;       // mDNS service discovery (default: false)
}

export interface DanteCodeServer {
  /** The underlying HTTP server. */
  server: http.Server;
  /** The port the server is listening on. */
  port: number;
  /** Stop the server. */
  stop(): Promise<void>;
  /** Server URL for clients. */
  url: string;
}

/**
 * Start the DanteCode HTTP server.
 */
export async function startServer(options: ServeOptions): Promise<DanteCodeServer>;
```

### 4.2 — API Router (`cli/src/serve/router.ts`)

Simple pattern-matching router. No framework needed.

```typescript
/**
 * Lightweight HTTP router for DanteCode serve mode.
 * Pattern matching on method + path. JSON request/response.
 */

export type HttpMethod = "GET" | "POST" | "PUT" | "DELETE";

export interface RouteHandler {
  (req: ParsedRequest): Promise<RouteResponse>;
}

export interface ParsedRequest {
  method: HttpMethod;
  path: string;
  params: Record<string, string>;  // URL path params
  query: Record<string, string>;   // Query string params
  body: unknown;                   // Parsed JSON body
  headers: Record<string, string>;
}

export interface RouteResponse {
  status: number;
  body: unknown;
  headers?: Record<string, string>;
}

export class Router {
  private routes: Array<{
    method: HttpMethod;
    pattern: RegExp;
    paramNames: string[];
    handler: RouteHandler;
  }> = [];

  /** Register a route. Supports :param path segments. */
  route(method: HttpMethod, path: string, handler: RouteHandler): void;

  /** Match a request to a route and execute it. */
  async handle(req: ParsedRequest): Promise<RouteResponse>;

  /** GET shorthand. */
  get(path: string, handler: RouteHandler): void;

  /** POST shorthand. */
  post(path: string, handler: RouteHandler): void;
}
```

### 4.3 — API Endpoints (`cli/src/serve/routes.ts`)

```typescript
/**
 * DanteCode API route definitions.
 * Each route maps to existing functionality — no new business logic.
 */

export function registerRoutes(router: Router, context: ServerContext): void {
  // ── Session Management ──
  router.get("/api/sessions", listSessions);           // List all sessions
  router.get("/api/sessions/:id", getSession);         // Get session details
  router.post("/api/sessions", createSession);         // Create new session
  router.post("/api/sessions/:id/resume", resumeSession); // Resume a session

  // ── Agent Interaction ──
  router.post("/api/sessions/:id/message", sendMessage);  // Send prompt to agent
  router.get("/api/sessions/:id/stream", streamResponse); // SSE stream for real-time output
  router.post("/api/sessions/:id/abort", abortGeneration); // Cancel in-flight generation

  // ── Tool Execution ──
  router.post("/api/sessions/:id/approve", approveAction);  // Approve pending tool call
  router.post("/api/sessions/:id/deny", denyAction);        // Deny pending tool call

  // ── Status & Config ──
  router.get("/api/status", getStatus);                  // Server status + model info
  router.get("/api/config", getConfig);                  // Current STATE.yaml config
  router.post("/api/config/model", switchModel);         // Switch model mid-session

  // ── Slash Commands ──
  router.post("/api/sessions/:id/command", runSlashCommand); // Execute any slash command

  // ── DanteForge ──
  router.post("/api/verify", runVerification);           // Run DanteForge verification
  router.get("/api/evidence/:sessionId", getEvidence);   // Get session evidence chain

  // ── Skills ──
  router.get("/api/skills", listSkills);                 // List installed skills
  router.post("/api/skills/install", installSkill);      // Install a skill

  // ── Health ──
  router.get("/api/health", healthCheck);                // Simple health check
}
```

### 4.4 — SSE Streaming for Real-Time Output (`cli/src/serve/sse-stream.ts`)

The critical piece — clients need real-time streaming of agent output, not just request/response.

```typescript
/**
 * Server-Sent Events (SSE) stream for real-time agent output.
 * Clients connect to GET /api/sessions/:id/stream and receive events as they happen.
 *
 * Event types:
 *   - token: streaming token from model
 *   - tool_start: tool execution starting
 *   - tool_end: tool execution completed
 *   - diff: file change diff
 *   - pdse: PDSE verification score
 *   - status: status update (thinking, executing, verifying)
 *   - error: error occurred
 *   - done: generation complete
 *   - approval_needed: waiting for user approval on a tool call
 */

export interface SSEEvent {
  type: "token" | "tool_start" | "tool_end" | "diff" | "pdse" | "status" | "error" | "done" | "approval_needed";
  data: Record<string, unknown>;
  timestamp: string;
}

/**
 * Create an SSE response for a session.
 * The response stays open and sends events as the agent works.
 */
export function createSSEStream(
  res: http.ServerResponse,
  sessionId: string,
  context: ServerContext,
): void {
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    "Connection": "keep-alive",
    "Access-Control-Allow-Origin": "*",
  });

  // Subscribe to session events
  const unsubscribe = context.sessionEmitter.on(sessionId, (event: SSEEvent) => {
    res.write(`event: ${event.type}\n`);
    res.write(`data: ${JSON.stringify(event.data)}\n\n`);
  });

  // Clean up on disconnect
  res.on("close", () => {
    unsubscribe();
  });
}
```

### 4.5 — Session Event Emitter (`cli/src/serve/session-emitter.ts`)

Bridge between the agent-loop (which writes to stdout) and the HTTP server (which streams to clients).

```typescript
/**
 * Event emitter that bridges agent-loop output to HTTP/SSE clients.
 * When the agent loop produces output, it emits events here.
 * SSE streams subscribe and forward events to connected clients.
 *
 * This replaces process.stdout.write for serve mode.
 * In REPL mode, the emitter is not active — stdout works as before.
 */

import { EventEmitter } from "node:events";

export class SessionEventEmitter extends EventEmitter {
  private subscribers = new Map<string, Set<(event: SSEEvent) => void>>();

  /** Subscribe to events for a session. Returns unsubscribe function. */
  on(sessionId: string, handler: (event: SSEEvent) => void): () => void;

  /** Emit an event for a session. */
  emit(sessionId: string, event: SSEEvent): void;

  /** Emit a token event (streaming model output). */
  emitToken(sessionId: string, token: string): void;

  /** Emit a tool execution event. */
  emitToolStart(sessionId: string, toolName: string, args: Record<string, unknown>): void;
  emitToolEnd(sessionId: string, toolName: string, result: string, isError: boolean): void;

  /** Emit a diff event (file change). */
  emitDiff(sessionId: string, filePath: string, diff: string, additions: number, deletions: number): void;

  /** Emit a PDSE score event. */
  emitPDSE(sessionId: string, score: number, passed: boolean): void;

  /** Emit an approval-needed event. */
  emitApprovalNeeded(sessionId: string, toolName: string, command: string, riskLevel: string): void;

  /** Emit generation complete. */
  emitDone(sessionId: string, tokensUsed: number, durationMs: number): void;

  /** Get count of active subscribers for a session. */
  subscriberCount(sessionId: string): number;
}
```

### 4.6 — Auth Middleware (`cli/src/serve/auth.ts`)

```typescript
/**
 * Simple password-based authentication for the DanteCode server.
 * Uses HTTP Basic Auth. Password set via DANTECODE_SERVER_PASSWORD env var.
 * When no password is set, auth is disabled (localhost-only use case).
 */

export interface AuthConfig {
  password?: string;           // From env DANTECODE_SERVER_PASSWORD
  username?: string;           // Default: "dantecode"
}

/**
 * Validate an incoming request's authorization.
 * Returns true if authorized, false if not.
 */
export function checkAuth(headers: Record<string, string>, config: AuthConfig): boolean;

/**
 * Build a 401 response for unauthorized requests.
 */
export function unauthorizedResponse(): RouteResponse;
```

### 4.7 — CLI Command: `dantecode serve` (`cli/src/commands/serve.ts`)

```typescript
/**
 * `dantecode serve` — Start the HTTP server.
 *
 * Usage:
 *   dantecode serve                          — Start on default port (3210)
 *   dantecode serve --port 8080              — Custom port
 *   dantecode serve --host 0.0.0.0           — Listen on all interfaces (not just localhost)
 *   dantecode serve --open                   — Start server and open browser
 *   dantecode serve --mdns                   — Enable mDNS discovery
 *
 * Environment:
 *   DANTECODE_SERVER_PASSWORD — Set to require auth (HTTP Basic)
 */

export async function runServeCommand(args: string[]): Promise<void> {
  const port = parsePort(args) ?? 3210;
  const host = parseHost(args) ?? "127.0.0.1";
  const openBrowser = args.includes("--open");
  const enableMdns = args.includes("--mdns");
  const projectRoot = process.cwd();
  const password = process.env.DANTECODE_SERVER_PASSWORD;

  const server = await startServer({
    port,
    host,
    projectRoot,
    password,
    enableMdns,
  });

  console.log(`\nDanteCode server running at ${server.url}`);
  console.log(`Project: ${projectRoot}`);
  if (password) {
    console.log(`Auth: enabled (HTTP Basic, username: dantecode)`);
  } else {
    console.log(`Auth: disabled (set DANTECODE_SERVER_PASSWORD to enable)`);
  }
  console.log(`\nAPI: ${server.url}/api/health`);
  console.log(`SSE: ${server.url}/api/sessions/:id/stream`);
  console.log(`\nPress Ctrl+C to stop.\n`);

  if (openBrowser) {
    const { exec } = await import("node:child_process");
    const openCmd = process.platform === "darwin" ? "open"
      : process.platform === "win32" ? "start"
      : "xdg-open";
    exec(`${openCmd} ${server.url}`);
  }

  // Keep process alive
  process.on("SIGINT", async () => {
    console.log("\nShutting down...");
    await server.stop();
    process.exit(0);
  });
}
```

### 4.8 — Agent-Loop Output Adapter

The agent-loop currently writes to `process.stdout`. In serve mode, it should write to the `SessionEventEmitter` instead. This is a thin adapter, not a rewrite.

**Modify:** `packages/cli/src/agent-loop.ts`

Add an optional `outputAdapter` to `AgentLoopConfig`:

```typescript
export interface AgentLoopConfig {
  // ... existing fields ...

  /** When set, agent output goes to this emitter instead of stdout.
   *  Used in serve mode for SSE streaming. */
  eventEmitter?: SessionEventEmitter;
  /** Session ID for event routing. */
  eventSessionId?: string;
}
```

Then, wherever the agent-loop calls `process.stdout.write()` or `StreamRenderer.write()`, check for the emitter:

```typescript
// Adapter function used throughout agent-loop:
function emitOrWrite(output: string, type: SSEEvent["type"] = "token"): void {
  if (config.eventEmitter && config.eventSessionId) {
    config.eventEmitter.emit(config.eventSessionId, {
      type,
      data: { content: output },
      timestamp: new Date().toISOString(),
    });
  } else {
    process.stdout.write(output);
  }
}
```

This is the most invasive change but it's mechanical — find each `process.stdout.write` in agent-loop.ts and replace with `emitOrWrite()`. The REPL path (no eventEmitter) works exactly as before.

---

## 5. File Inventory

### NEW Files

| # | Path | LOC Est. | Description |
|---|---|---|---|
| 1 | `packages/cli/src/serve/server.ts` | 150 | HTTP server core (node:http) |
| 2 | `packages/cli/src/serve/router.ts` | 120 | Lightweight pattern-matching router |
| 3 | `packages/cli/src/serve/routes.ts` | 250 | All API endpoint handlers |
| 4 | `packages/cli/src/serve/sse-stream.ts` | 80 | SSE streaming for real-time output |
| 5 | `packages/cli/src/serve/session-emitter.ts` | 100 | Event bridge between agent-loop and HTTP |
| 6 | `packages/cli/src/serve/auth.ts` | 50 | HTTP Basic auth middleware |
| 7 | `packages/cli/src/commands/serve.ts` | 60 | `dantecode serve` CLI command |
| 8 | `packages/cli/src/serve/server.test.ts` | 150 | Server integration tests |
| 9 | `packages/cli/src/serve/router.test.ts` | 100 | Router unit tests |
| 10 | `packages/cli/src/serve/auth.test.ts` | 60 | Auth tests |
| 11 | `packages/cli/src/serve/session-emitter.test.ts` | 80 | Event emitter tests |

### MODIFIED Files

| # | Path | Change |
|---|---|---|
| 12 | `packages/cli/src/index.ts` | Add `serve` command routing |
| 13 | `packages/cli/src/agent-loop.ts` | Add `eventEmitter` to AgentLoopConfig, add `emitOrWrite()` adapter |
| 14 | `packages/cli/src/repl.ts` | Minor: pass eventEmitter=undefined (no change to REPL behavior) |

### Total: 11 new files + 3 modified, ~1,200 LOC source + ~390 LOC tests

---

## 6. API Reference (for future frontend developers)

```
GET  /api/health                    → { status: "ok", version, uptime }
GET  /api/status                    → { model, project, features, sessionCount }
GET  /api/config                    → STATE.yaml as JSON

GET  /api/sessions                  → [{ id, name, createdAt, messageCount }]
POST /api/sessions                  → { id, name } (create new)
GET  /api/sessions/:id              → { id, messages, tokens, model }
POST /api/sessions/:id/resume       → { id } (resume existing)
POST /api/sessions/:id/message      → { messageId } (send prompt)
GET  /api/sessions/:id/stream       → SSE stream (real-time output)
POST /api/sessions/:id/abort        → { aborted: true }
POST /api/sessions/:id/approve      → { approved: true }
POST /api/sessions/:id/deny         → { denied: true }
POST /api/sessions/:id/command      → { output } (run slash command)

POST /api/verify                    → { pdseScore, findings }
GET  /api/evidence/:sessionId       → { chain, receipts, merkleRoot, seal }

GET  /api/skills                    → [{ name, description, score }]
POST /api/skills/install            → { name, installedPath, verification }

POST /api/config/model              → { model } (switch model)
```

All endpoints return JSON. All POST endpoints accept JSON body. Auth via HTTP Basic when DANTECODE_SERVER_PASSWORD is set.

---

## 7. Tests

### `server.test.ts` (~10 tests)
1. Server starts on specified port
2. Server responds to /api/health
3. Server returns 404 for unknown routes
4. Server handles JSON body parsing
5. Server binds to localhost by default
6. Server with password rejects unauthenticated requests
7. Server with password accepts authenticated requests
8. Server without password allows all requests
9. Server stop() cleans up cleanly
10. CORS headers present on responses

### `router.test.ts` (~8 tests)
1. Exact path matching: GET /api/health
2. Path parameter extraction: GET /api/sessions/:id
3. Query parameter parsing: GET /api/sessions?limit=10
4. Method matching: GET vs POST on same path
5. 404 for unmatched routes
6. Multiple params: /api/sessions/:sessionId/messages/:messageId
7. Route registration order matters (first match wins)
8. Handler receives parsed body for POST

### `auth.test.ts` (~4 tests)
1. No password configured → always returns true
2. Correct credentials → returns true
3. Wrong credentials → returns false
4. Missing Authorization header → returns false

### `session-emitter.test.ts` (~5 tests)
1. Subscribe → emit → handler receives event
2. Multiple subscribers → all receive event
3. Unsubscribe → no longer receives events
4. emitToken convenience method sends correct event type
5. subscriberCount returns correct number

**Total: ~27 tests**

---

## 8. Claude Code Execution Instructions

**Single sprint, 3-4 hours. 3 phases.**

```
Phase 1: Server Infrastructure (1.5-2h)
  1. Create packages/cli/src/serve/ directory
  2. Create auth.ts — HTTP Basic auth
  3. Create router.ts — pattern-matching router
  4. Create session-emitter.ts — event bridge
  5. Create sse-stream.ts — SSE response helper
  6. Create server.ts — HTTP server using router + auth
  7. Create test files for auth, router, session-emitter
  8. Run: npx vitest run packages/cli/src/serve/
  GATE: All new tests pass

Phase 2: Routes + Agent-Loop Adapter (1-1.5h)
  9. Create routes.ts — all API endpoint handlers
  10. Modify packages/cli/src/agent-loop.ts:
      - Add eventEmitter + eventSessionId to AgentLoopConfig
      - Add emitOrWrite() helper function
      - Replace key process.stdout.write calls with emitOrWrite()
      - CRITICAL: when eventEmitter is undefined, behavior is IDENTICAL to before
  11. Create server.test.ts — integration tests
  12. Run: npx turbo test
  GATE: Full test suite passes, ESPECIALLY all existing agent-loop tests

Phase 3: CLI Command + Wiring (0.5h)
  13. Create packages/cli/src/commands/serve.ts
  14. Modify packages/cli/src/index.ts — add "serve" command routing
  15. Run: npx turbo test
  GATE: Full test suite passes
```

**Rules:**
- KiloCode: every file complete, under 500 LOC, no stubs
- Anti-Stub Absolute: zero TODOs, FIXMEs
- TypeScript strict, no `as any`
- **ZERO external dependencies** — only `node:http`, `node:events`, `node:crypto`
- **ZERO regressions on agent-loop tests** — this is the hardest constraint. The emitOrWrite adapter must be completely transparent when eventEmitter is undefined.
- Server binds to localhost (127.0.0.1) by default for security
- All route handlers must handle errors gracefully (return 500 with message, never crash server)
- SSE streams must handle client disconnect without leaking resources

---

## 9. Security Considerations

1. **Default bind: localhost only.** The server is not accessible from the network unless `--host 0.0.0.0` is explicitly passed. This prevents accidental exposure.

2. **Password auth when exposed.** If `--host 0.0.0.0` is used, the server SHOULD have DANTECODE_SERVER_PASSWORD set. The serve command warns (but doesn't block) when binding to non-localhost without a password.

3. **Project root sandboxing.** The server only operates within the project root. File operations cannot escape the project boundary.

4. **No credential leaking.** API endpoints never return API keys, vault contents, or DANTECODE_SERVER_PASSWORD in responses.

5. **Rate limiting.** Optional — can be added later. For localhost use, rate limiting is unnecessary.

---

## 10. What This Enables (Future PRDs)

Once `dantecode serve` exists, the following become straightforward:

1. **Web UI** — A React/HTML frontend that connects to the API. `dantecode serve --open` starts the server and opens the browser. The frontend is a separate package that talks to the API.

2. **Mobile remote control** — A lightweight mobile web app (or PWA) that connects to the server for monitoring and approvals. Similar to Claude Code's Remote Control.

3. **JetBrains integration** — A thin JetBrains plugin that talks to the HTTP API instead of embedding the runtime. Same as OpenCode's ACP approach.

4. **Multi-user** — Multiple developers connect to the same DanteCode server. Session isolation per user. Team-shared DanteForge verification.

5. **Teleport** — `/teleport` command moves a session from CLI to web or vice versa. The session state lives on the server, frontends are interchangeable.

6. **CI/CD API** — GitHub Actions or other CI systems call the API to trigger verification, review, or automation. `curl -X POST localhost:3210/api/verify` from a CI script.

All of these are separate PRDs that build on the server foundation. This PRD only builds the foundation.

---

## 11. Success Criteria

| Criteria | Target |
|---|---|
| `dantecode serve` starts HTTP server on localhost:3210 | ✅ |
| GET /api/health returns status | ✅ |
| POST /api/sessions → creates session | ✅ |
| POST /api/sessions/:id/message → sends prompt to agent | ✅ |
| GET /api/sessions/:id/stream → SSE stream of agent output | ✅ |
| Auth protects endpoints when password set | ✅ |
| Agent-loop works identically in REPL mode (no eventEmitter) | ✅ 0 regressions |
| Zero external dependencies | ✅ node:http only |
| All new files | PDSE ≥ 85, anti-stub clean |

---

## 12. The Architectural Payoff

This is the smallest PRD that produces the largest future optionality. ~1,200 LOC creates an HTTP surface that unlocks web UI, mobile, JetBrains, CI/CD, multi-user, and teleport — each as a separate, independent project.

The design philosophy matches OpenCode's approach: the backend is the product, the frontend is a view. Any view can connect. The REPL was the first view. The HTTP API makes every future view possible.

**One architectural change. Infinite surface area.**

---

*"The best platform isn't the one with the most features. It's the one any frontend can talk to."*
