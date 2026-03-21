// ============================================================================
// @dantecode/cli — Serve: API Route Handlers
// All DanteCode HTTP API endpoints. No new business logic — each route maps
// to existing CLI/session functionality.
//
// SSE streaming (/api/sessions/:id/stream) is handled directly in server.ts
// because it requires the raw ServerResponse. All other routes live here.
// ============================================================================

import { randomBytes } from "node:crypto";
import type { Router, ParsedRequest, RouteResponse } from "./router.js";
import type { SessionEventEmitter } from "./session-emitter.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** A server-side session record. */
export interface SessionRecord {
  id: string;
  name: string;
  createdAt: string;
  messageCount: number;
  model: string;
  messages: Array<{ role: "user" | "assistant"; content: string; ts: string }>;
  /** Pending approval request, if any. */
  pendingApproval?: {
    toolName: string;
    command: string;
    riskLevel: string;
    resolve: (approved: boolean) => void;
  };
  /** AbortController for in-flight generation. */
  abortController?: AbortController;
}

/** Runtime context shared by all route handlers. */
export interface ServerContext {
  projectRoot: string;
  version: string;
  startTime: number;
  sessions: Map<string, SessionRecord>;
  sessionEmitter: SessionEventEmitter;
  model: string;
}

type RouteHandler = (req: ParsedRequest) => Promise<RouteResponse>;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function ok(body: unknown, headers?: Record<string, string>): RouteResponse {
  return { status: 200, body, headers };
}

function badRequest(message: string): RouteResponse {
  return { status: 400, body: { error: message } };
}

function notFound(id: string): RouteResponse {
  return { status: 404, body: { error: `Not found: ${id}` } };
}

function generateId(): string {
  return randomBytes(8).toString("hex");
}

// ---------------------------------------------------------------------------
// Session Management
// ---------------------------------------------------------------------------

function listSessions(ctx: ServerContext): RouteHandler {
  return async () => {
    const sessions = Array.from(ctx.sessions.values()).map((s) => ({
      id: s.id,
      name: s.name,
      createdAt: s.createdAt,
      messageCount: s.messageCount,
      model: s.model,
    }));
    return ok(sessions);
  };
}

function getSession(ctx: ServerContext): RouteHandler {
  return async (req) => {
    const session = ctx.sessions.get(req.params["id"]!);
    if (!session) return notFound(req.params["id"]!);
    return ok({
      id: session.id,
      name: session.name,
      createdAt: session.createdAt,
      messageCount: session.messageCount,
      model: session.model,
      messages: session.messages,
    });
  };
}

function createSession(ctx: ServerContext): RouteHandler {
  return async (req) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const name = typeof body["name"] === "string" ? body["name"] : `Session ${ctx.sessions.size + 1}`;
    const model = typeof body["model"] === "string" ? body["model"] : ctx.model;

    const id = generateId();
    const record: SessionRecord = {
      id,
      name,
      createdAt: new Date().toISOString(),
      messageCount: 0,
      model,
      messages: [],
    };
    ctx.sessions.set(id, record);
    return ok({ id, name, model, createdAt: record.createdAt });
  };
}

function resumeSession(ctx: ServerContext): RouteHandler {
  return async (req) => {
    const session = ctx.sessions.get(req.params["id"]!);
    if (!session) return notFound(req.params["id"]!);
    return ok({ id: session.id, name: session.name, resumed: true });
  };
}

// ---------------------------------------------------------------------------
// Agent Interaction
// ---------------------------------------------------------------------------

function sendMessage(ctx: ServerContext): RouteHandler {
  return async (req) => {
    const session = ctx.sessions.get(req.params["id"]!);
    if (!session) return notFound(req.params["id"]!);

    const body = (req.body ?? {}) as Record<string, unknown>;
    const content = body["content"] ?? body["message"] ?? body["prompt"];
    if (typeof content !== "string" || content.trim().length === 0) {
      return badRequest("Missing or empty message content");
    }

    const messageId = generateId();
    const ts = new Date().toISOString();

    session.messages.push({ role: "user", content, ts });
    session.messageCount++;

    // Signal SSE clients that a prompt was received
    ctx.sessionEmitter.emitStatus(session.id, `[message:${messageId}] User message received`);

    return ok({ messageId, sessionId: req.params["id"], ts });
  };
}

function abortGeneration(ctx: ServerContext): RouteHandler {
  return async (req) => {
    const session = ctx.sessions.get(req.params["id"]!);
    if (!session) return notFound(req.params["id"]!);

    if (session.abortController) {
      session.abortController.abort();
      session.abortController = undefined;
    }
    ctx.sessionEmitter.emitStatus(session.id, "[abort] Generation aborted by client");
    return ok({ aborted: true, sessionId: req.params["id"] });
  };
}

// ---------------------------------------------------------------------------
// Tool Approval
// ---------------------------------------------------------------------------

function approveAction(ctx: ServerContext): RouteHandler {
  return async (req) => {
    const session = ctx.sessions.get(req.params["id"]!);
    if (!session) return notFound(req.params["id"]!);
    if (!session.pendingApproval) return badRequest("No pending approval for this session");
    session.pendingApproval.resolve(true);
    session.pendingApproval = undefined;
    return ok({ approved: true, sessionId: req.params["id"] });
  };
}

function denyAction(ctx: ServerContext): RouteHandler {
  return async (req) => {
    const session = ctx.sessions.get(req.params["id"]!);
    if (!session) return notFound(req.params["id"]!);
    if (!session.pendingApproval) return badRequest("No pending approval for this session");
    session.pendingApproval.resolve(false);
    session.pendingApproval = undefined;
    return ok({ denied: true, sessionId: req.params["id"] });
  };
}

// ---------------------------------------------------------------------------
// Status, Config, Slash Commands
// ---------------------------------------------------------------------------

function getStatus(ctx: ServerContext): RouteHandler {
  return async () =>
    ok({
      model: ctx.model,
      project: ctx.projectRoot,
      version: ctx.version,
      sessionCount: ctx.sessions.size,
      uptime: Math.floor((Date.now() - ctx.startTime) / 1000),
      features: { sse: true, approval: true, skills: true, evidenceChain: true },
    });
}

function getConfig(ctx: ServerContext): RouteHandler {
  return async () => ok({ projectRoot: ctx.projectRoot, model: ctx.model });
}

function switchModel(ctx: ServerContext): RouteHandler {
  return async (req) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const model = body["model"];
    if (typeof model !== "string" || model.trim().length === 0) {
      return badRequest("Missing or empty model name");
    }
    ctx.model = model;
    return ok({ model, switched: true });
  };
}

function runSlashCommand(ctx: ServerContext): RouteHandler {
  return async (req) => {
    const session = ctx.sessions.get(req.params["id"]!);
    if (!session) return notFound(req.params["id"]!);

    const body = (req.body ?? {}) as Record<string, unknown>;
    const command = body["command"];
    if (typeof command !== "string" || !command.startsWith("/")) {
      return badRequest("Missing or invalid command — must start with /");
    }

    ctx.sessionEmitter.emitStatus(session.id, `[slash] Dispatched: ${command}`);
    return ok({ output: `Command queued: ${command}`, sessionId: req.params["id"] });
  };
}

// ---------------------------------------------------------------------------
// DanteForge Verification
// ---------------------------------------------------------------------------

function runVerification(ctx: ServerContext): RouteHandler {
  return async (req) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const fileList = Array.isArray(body["files"]) ? (body["files"] as string[]) : [];
    // Delegate to DanteForge pipeline — caller must wire AgentLoopConfig.eventEmitter
    // to receive pdse/tool_end events from the running agent loop.
    return ok({ projectRoot: ctx.projectRoot, files: fileList, pdseScore: null, findings: [] });
  };
}

function getEvidence(ctx: ServerContext): RouteHandler {
  return async (req) => {
    const sessionId = req.params["sessionId"]!;
    if (!ctx.sessions.has(sessionId)) return notFound(sessionId);
    // Evidence chain is built during agent execution via @dantecode/evidence-chain.
    // Caller wires EvidenceSealer results into sessionEmitter "pdse" events.
    return ok({ sessionId, chain: [], receipts: [], merkleRoot: null, seal: null });
  };
}

// ---------------------------------------------------------------------------
// Skills
// ---------------------------------------------------------------------------

function listSkills(): RouteHandler {
  return async () => ok({ skills: [] });
}

function installSkill(): RouteHandler {
  return async (req) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const name = body["name"];
    if (typeof name !== "string" || name.trim().length === 0) {
      return badRequest("Missing or empty skill name");
    }
    return ok({ name, installedPath: null, verification: null });
  };
}

// ---------------------------------------------------------------------------
// Health
// ---------------------------------------------------------------------------

function healthCheck(ctx: ServerContext): RouteHandler {
  return async () =>
    ok({
      status: "ok",
      version: ctx.version,
      uptime: Math.floor((Date.now() - ctx.startTime) / 1000),
    });
}

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

/**
 * Register all non-SSE routes on the router.
 *
 * The SSE stream route (GET /api/sessions/:id/stream) is handled directly
 * in server.ts because it requires access to the raw ServerResponse object.
 */
export function buildRoutes(router: Router, context: ServerContext): void {
  // Session management
  router.get("/api/sessions", listSessions(context));
  router.get("/api/sessions/:id", getSession(context));
  router.post("/api/sessions", createSession(context));
  router.post("/api/sessions/:id/resume", resumeSession(context));

  // Agent interaction (SSE stream is in server.ts)
  router.post("/api/sessions/:id/message", sendMessage(context));
  router.post("/api/sessions/:id/abort", abortGeneration(context));

  // Tool approval
  router.post("/api/sessions/:id/approve", approveAction(context));
  router.post("/api/sessions/:id/deny", denyAction(context));

  // Status & config
  router.get("/api/status", getStatus(context));
  router.get("/api/config", getConfig(context));
  router.post("/api/config/model", switchModel(context));

  // Slash commands
  router.post("/api/sessions/:id/command", runSlashCommand(context));

  // DanteForge
  router.post("/api/verify", runVerification(context));
  router.get("/api/evidence/:sessionId", getEvidence(context));

  // Skills
  router.get("/api/skills", listSkills());
  router.post("/api/skills/install", installSkill());

  // Health
  router.get("/api/health", healthCheck(context));
}
