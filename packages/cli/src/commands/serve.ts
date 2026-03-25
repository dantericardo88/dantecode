// ============================================================================
// @dantecode/cli — Command: dantecode serve
// Starts the DanteCode HTTP server and exposes the agent-loop as a JSON API.
//
// Usage:
//   dantecode serve                    Start on default port (3210)
//   dantecode serve --port 8080        Custom port
//   dantecode serve --host 0.0.0.0     Listen on all interfaces (not just localhost)
//   dantecode serve --open             Start server and open browser
//   dantecode serve --mdns             Enable mDNS service discovery
//
// Environment:
//   DANTECODE_SERVER_PASSWORD  Set to require HTTP Basic auth
// ============================================================================

import http from "node:http";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { startServer } from "../serve/server.js";
import { runAgentLoop } from "../agent-loop.js";
import type { AgentLoopConfig } from "../agent-loop.js";
import type { AgentRunnerOpts } from "../serve/routes.js";
import { readOrInitializeState, ModelRouterImpl } from "@dantecode/core";

const __dirname = dirname(fileURLToPath(import.meta.url));

// ANSI color codes (inline to avoid circular imports)
const GREEN = "\x1b[32m";
const YELLOW = "\x1b[33m";
const DIM = "\x1b[2m";
const BOLD = "\x1b[1m";
const RESET = "\x1b[0m";

// ============================================================================
// OpenAI-compatible HTTP API handlers
// (exported for unit testing without starting a real server)
// ============================================================================

export interface ServeConfig {
  port: number;
  host: string;
  authToken?: string;
  projectRoot: string;
  silent?: boolean;
}

interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

interface ChatCompletionRequest {
  model?: string;
  messages: ChatMessage[];
  stream?: boolean;
  max_tokens?: number;
  temperature?: number;
}

/** Read package version from nearest package.json */
function getVersion(): string {
  try {
    const pkg = JSON.parse(readFileSync(join(__dirname, "../../package.json"), "utf-8")) as {
      version: string;
    };
    return pkg.version ?? "0.0.0";
  } catch {
    return "0.0.0";
  }
}

/** Auth middleware — returns true if request is authorized */
function isAuthorized(req: http.IncomingMessage, authToken: string | undefined): boolean {
  if (!authToken) return true;
  const header = req.headers["authorization"] ?? "";
  return header === `Bearer ${authToken}`;
}

/** Read request body as string */
async function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf-8")));
    req.on("error", reject);
  });
}

/** Send JSON response */
function sendJson(res: http.ServerResponse, status: number, body: unknown): void {
  const json = JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Content-Length": Buffer.byteLength(json),
  });
  res.end(json);
}

/** Send SSE stream */
function sendSse(res: http.ServerResponse, modelId: string, text: string): void {
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
  });

  // Chunk the text into ~20-char pieces to simulate streaming
  const chunkSize = 20;
  const words = text.split(" ");
  let buffer = "";

  for (const word of words) {
    buffer += (buffer ? " " : "") + word;
    if (buffer.length >= chunkSize) {
      const chunk = JSON.stringify({
        id: `chatcmpl-${Date.now()}`,
        object: "chat.completion.chunk",
        model: modelId,
        choices: [{ index: 0, delta: { content: buffer + " " }, finish_reason: null }],
      });
      res.write(`data: ${chunk}\n\n`);
      buffer = "";
    }
  }
  if (buffer) {
    const chunk = JSON.stringify({
      id: `chatcmpl-${Date.now()}`,
      object: "chat.completion.chunk",
      model: modelId,
      choices: [{ index: 0, delta: { content: buffer }, finish_reason: null }],
    });
    res.write(`data: ${chunk}\n\n`);
  }

  res.write(
    'data: {"id":"done","object":"chat.completion.chunk","choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}\n\n',
  );
  res.write("data: [DONE]\n\n");
  res.end();
}

/** Route handler: GET /health — OpenAI-compatible health check */
export function handleHealth(_req: http.IncomingMessage, res: http.ServerResponse): void {
  sendJson(res, 200, {
    ok: true,
    version: getVersion(),
    uptime: Math.floor(process.uptime()),
  });
}

/** Route handler: GET /v1/models — OpenAI-compatible model list */
export function handleModels(
  _req: http.IncomingMessage,
  res: http.ServerResponse,
  modelId: string,
): void {
  sendJson(res, 200, {
    object: "list",
    data: [
      {
        id: modelId,
        object: "model",
        created: Math.floor(Date.now() / 1000),
        owned_by: "dantecode",
      },
    ],
  });
}

/** Route handler: POST /v1/chat/completions — OpenAI-compatible chat completions */
export async function handleChatCompletions(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  router: ModelRouterImpl,
  modelId: string,
): Promise<void> {
  try {
    const body = await readBody(req);
    const parsed = JSON.parse(body) as ChatCompletionRequest;
    const { messages, stream = false } = parsed;

    if (!Array.isArray(messages) || messages.length === 0) {
      sendJson(res, 400, {
        error: {
          message: "messages array required",
          type: "invalid_request_error",
        },
      });
      return;
    }

    // Convert to CoreMessage format expected by ModelRouterImpl
    const coreMessages = messages.map((m) => ({
      role: m.role as "user" | "assistant" | "system",
      content: m.content,
    }));

    const responseText = await router.generate(coreMessages, {
      maxTokens: parsed.max_tokens ?? 1024,
    });

    if (stream) {
      sendSse(res, modelId, responseText);
    } else {
      sendJson(res, 200, {
        id: `chatcmpl-${Date.now()}`,
        object: "chat.completion",
        model: modelId,
        choices: [
          {
            index: 0,
            message: { role: "assistant", content: responseText },
            finish_reason: "stop",
          },
        ],
        usage: {
          prompt_tokens: 0,
          completion_tokens: 0,
          total_tokens: 0,
        },
      });
    }
  } catch (err) {
    sendJson(res, 500, {
      error: { message: String(err), type: "internal_error" },
    });
  }
}

/**
 * Start a minimal OpenAI-compatible HTTP server.
 * Exposes /health, /v1/models, and /v1/chat/completions.
 */
export async function startServe(config: ServeConfig): Promise<void> {
  const state = await readOrInitializeState(config.projectRoot);
  const modelId = state.model.default.modelId;
  const routerConfig = {
    default: state.model.default,
    fallback: state.model.fallback,
    overrides: state.model.taskOverrides,
  };
  const router = new ModelRouterImpl(routerConfig, config.projectRoot, "serve");

  const server = http.createServer(async (req, res) => {
    // CORS headers
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");

    if (req.method === "OPTIONS") {
      res.writeHead(204);
      res.end();
      return;
    }

    // Auth check
    if (!isAuthorized(req, config.authToken)) {
      sendJson(res, 401, {
        error: { message: "Unauthorized", type: "auth_error" },
      });
      return;
    }

    const url = req.url ?? "/";
    const method = req.method ?? "GET";

    if (url === "/health" && method === "GET") {
      handleHealth(req, res);
      return;
    }

    if (url === "/v1/models" && method === "GET") {
      handleModels(req, res, modelId);
      return;
    }

    if (url === "/v1/chat/completions" && method === "POST") {
      await handleChatCompletions(req, res, router, modelId);
      return;
    }

    sendJson(res, 404, {
      error: {
        message: `Route not found: ${method} ${url}`,
        type: "not_found",
      },
    });
  });

  await new Promise<void>((resolve, reject) => {
    server.on("error", reject);
    server.listen(config.port, config.host, () => {
      if (!config.silent) {
        console.log(`DanteCode HTTP server running on http://${config.host}:${config.port}`);
        console.log(`  GET  /health`);
        console.log(`  GET  /v1/models`);
        console.log(`  POST /v1/chat/completions`);
        if (config.authToken) {
          console.log(`  Auth: Bearer token required`);
        }
      }
      resolve();
    });
  });

  // Keep server running
  await new Promise<void>((_, reject) => {
    server.on("error", reject);
    process.on("SIGINT", () => {
      server.close();
      process.exit(0);
    });
  });
}

// ============================================================================
// End of OpenAI-compatible API
// ============================================================================

/** Parse --port <n> from args. Returns undefined if not found. */
function parsePort(args: string[]): number | undefined {
  const idx = args.indexOf("--port");
  if (idx === -1) return undefined;
  const val = args[idx + 1];
  if (!val) return undefined;
  const n = parseInt(val, 10);
  return Number.isFinite(n) && n > 0 && n < 65536 ? n : undefined;
}

/** Parse --host <addr> from args. Returns undefined if not found. */
function parseHost(args: string[]): string | undefined {
  const idx = args.indexOf("--host");
  if (idx === -1) return undefined;
  return args[idx + 1] ?? undefined;
}

/**
 * Run the `dantecode serve` command.
 *
 * Parses port/host/flags from args, starts the HTTP server, logs startup
 * info, and keeps the process alive until Ctrl+C.
 */
export async function runServeCommand(args: string[]): Promise<void> {
  const port = parsePort(args) ?? 3210;
  const host = parseHost(args) ?? "127.0.0.1";
  const openBrowser = args.includes("--open");
  const projectRoot = process.cwd();
  const password = process.env["DANTECODE_SERVER_PASSWORD"];

  // Security warning: non-localhost binding without auth is dangerous
  if (host !== "127.0.0.1" && host !== "localhost" && !password) {
    process.stderr.write(
      `${YELLOW}WARNING: Binding to ${host} without DANTECODE_SERVER_PASSWORD is insecure.${RESET}\n` +
        `${DIM}Set DANTECODE_SERVER_PASSWORD to require authentication.${RESET}\n\n`,
    );
  }

  // serverHandle is assigned immediately after startServer resolves.
  // The agentRunner closure only executes when a client sends a message —
  // which happens after the server is fully running — so serverHandle is
  // guaranteed to be set by the time agentRunner is first called.
  // The definite-assignment assertion (!) tells TypeScript this is safe.
  // eslint-disable-next-line prefer-const
  let serverHandle!: Awaited<ReturnType<typeof startServer>>;

  const agentRunner = (opts: AgentRunnerOpts): void => {
    void (async () => {
      let state;
      try {
        state = await readOrInitializeState(opts.projectRoot);
      } catch {
        serverHandle.sessionEmitter.emitError(opts.sessionId, "Failed to load project state");
        return;
      }

      // Build the minimal Session object required by runAgentLoop
      // V-01: Seed history (all messages except the current user prompt at end)
      const historyWithoutCurrentPrompt = opts.history.slice(0, -1);
      const now = new Date().toISOString();
      const loopSession: import("@dantecode/config-types").Session = {
        id: opts.sessionId,
        projectRoot: opts.projectRoot,
        messages: historyWithoutCurrentPrompt.map((m, i) => ({
          id: `msg-${i}`,
          role: m.role as "user" | "assistant",
          content: m.content,
          timestamp: now,
        })),
        activeFiles: [],
        readOnlyFiles: [],
        // V-03: Respect session-level model override
        model:
          opts.model && opts.model !== state.model.default.modelId
            ? { ...state.model.default, modelId: opts.model }
            : state.model.default,
        createdAt: now,
        updatedAt: now,
        agentStack: [],
        todoList: [],
      };

      const agentConfig: AgentLoopConfig = {
        state,
        verbose: false,
        enableGit: false,
        enableSandbox: false,
        silent: true,
        abortSignal: opts.abortSignal,
        eventEmitter: serverHandle.sessionEmitter,
        eventSessionId: opts.sessionId,
      };

      const startMs = Date.now();
      try {
        const resultSession = await runAgentLoop(opts.prompt, loopSession, agentConfig);
        // V-02: Sync new assistant messages back to the session record
        const newMessages = resultSession.messages.slice(opts.history.length);
        const ts = new Date().toISOString();
        const sessionRecord = serverHandle.sessions.get(opts.sessionId);
        if (sessionRecord) {
          for (const msg of newMessages) {
            if (msg.role === "assistant") {
              const content =
                typeof msg.content === "string"
                  ? msg.content
                  : Array.isArray(msg.content)
                    ? msg.content
                        .map((b) =>
                          typeof b === "object" && b !== null && "text" in b
                            ? String((b as { text: unknown }).text)
                            : "",
                        )
                        .join("")
                    : "";
              if (content) {
                sessionRecord.messages.push({ role: "assistant", content, ts });
                sessionRecord.messageCount++;
              }
            }
          }
        }
        // Emit done so SSE clients can close their stream
        serverHandle.sessionEmitter.emitDone(opts.sessionId, 0, Date.now() - startMs);
      } catch (err: unknown) {
        serverHandle.sessionEmitter.emitError(
          opts.sessionId,
          err instanceof Error ? err.message : String(err),
        );
      } finally {
        // Clear the abort controller so the session can accept new messages
        const sess = serverHandle.sessions.get(opts.sessionId);
        if (sess) sess.abortController = undefined;
      }
    })();
  };

  let server: Awaited<ReturnType<typeof startServer>>;
  try {
    server = await startServer({ port, host, projectRoot, password, agentRunner });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    process.stderr.write(`${"\x1b[31m"}Failed to start server: ${message}${RESET}\n`);
    process.exit(1);
  }

  // Assign serverHandle NOW — the server is running, clients can now send messages
  serverHandle = server;

  // Startup banner
  process.stdout.write(`\n${GREEN}${BOLD}DanteCode server running at ${server.url}${RESET}\n`);
  process.stdout.write(`${DIM}Project:${RESET} ${projectRoot}\n`);

  if (password) {
    process.stdout.write(
      `${DIM}Auth:${RESET} ${GREEN}enabled${RESET} ${DIM}(HTTP Basic, username: dantecode)${RESET}\n`,
    );
  } else {
    process.stdout.write(
      `${DIM}Auth:${RESET} ${YELLOW}disabled${RESET} ${DIM}(set DANTECODE_SERVER_PASSWORD to enable)${RESET}\n`,
    );
  }

  process.stdout.write(`\n${DIM}Endpoints:${RESET}\n`);
  process.stdout.write(`  ${DIM}Health:${RESET}   ${server.url}/api/health\n`);
  process.stdout.write(`  ${DIM}Status:${RESET}   ${server.url}/api/status\n`);
  process.stdout.write(`  ${DIM}Sessions:${RESET} ${server.url}/api/sessions\n`);
  process.stdout.write(`  ${DIM}Stream:${RESET}   ${server.url}/api/sessions/:id/stream\n`);
  process.stdout.write(`\n${DIM}Press Ctrl+C to stop.${RESET}\n\n`);

  // Open browser if requested
  if (openBrowser) {
    try {
      const { execFile } = await import("node:child_process");
      // V-04: `start` is a cmd.exe built-in on Windows — must use shell wrapper
      const [openCmd, ...openArgs] =
        process.platform === "darwin"
          ? (["open", server.url] as string[])
          : process.platform === "win32"
            ? (["cmd", "/c", "start", "", server.url] as string[])
            : (["xdg-open", server.url] as string[]);
      execFile(openCmd!, openArgs);
    } catch {
      // Non-fatal — browser open failure should not crash the server
    }
  }

  // V-05: Keep process alive until Ctrl+C or SIGTERM; guard against double shutdown
  await new Promise<void>((resolve) => {
    let shutdownCalled = false;
    const shutdown = async (): Promise<void> => {
      if (shutdownCalled) return;
      shutdownCalled = true;
      process.stdout.write(`\n${DIM}Shutting down DanteCode server...${RESET}\n`);
      try {
        await server.stop();
      } catch {
        // Non-fatal
      }
      resolve();
    };
    process.on("SIGINT", shutdown);
    process.on("SIGTERM", shutdown);
  });
}
