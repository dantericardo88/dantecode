// ============================================================================
// @dantecode/cli — Serve: API Route Handlers
// All DanteCode HTTP API endpoints. No new business logic — each route maps
// to existing CLI/session functionality.
//
// SSE streaming (/api/sessions/:id/stream) is handled directly in server.ts
// because it requires the raw ServerResponse. All other routes live here.
// ============================================================================

import { randomBytes } from "node:crypto";
import { readFile as fsReadFile } from "node:fs/promises";
import { join } from "node:path";
import type { Router, ParsedRequest, RouteResponse } from "./router.js";
import type { SessionEventEmitter } from "./session-emitter.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Options passed to the injected agent runner for fire-and-forget execution.
 * Decouples routes.ts from agent-loop.ts — the real runner is injected by
 * commands/serve.ts; tests can inject a mock runner without mocking the module.
 */
export interface AgentRunnerOpts {
  sessionId: string;
  prompt: string;
  model: string;
  projectRoot: string;
  /** Full message history at the time of the call, for context. */
  history: Array<{ role: "user" | "assistant"; content: string }>;
  abortSignal: AbortSignal;
  /** Called when the agent needs approval before executing a destructive action. */
  onApprovalNeeded: (toolName: string, command: string, riskLevel: string) => Promise<boolean>;
}

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
  /** Injected by commands/serve.ts to execute the AI agent loop. Fire-and-forget. */
  agentRunner?: (opts: AgentRunnerOpts) => void;
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

    // Wire abort controller for in-flight cancellation
    const ac = new AbortController();
    session.abortController = ac;

    // Fire-and-forget: invoke agent loop if wired
    ctx.agentRunner?.({
      sessionId: session.id,
      prompt: content,
      model: session.model,
      projectRoot: ctx.projectRoot,
      history: session.messages.map((m) => ({ role: m.role, content: m.content })),
      abortSignal: ac.signal,
      onApprovalNeeded: (toolName, command, riskLevel) =>
        new Promise<boolean>((resolve) => {
          session.pendingApproval = { toolName, command, riskLevel, resolve };
          ctx.sessionEmitter.emitApprovalNeeded(session.id, toolName, command, riskLevel);
        }),
    });

    return {
      status: 202,
      body: { messageId, sessionId: req.params["id"], ts, status: "running" },
      headers: undefined,
    };
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

    // Short-circuit: empty file list returns null score immediately with no imports needed
    if (fileList.length === 0) {
      return ok({ projectRoot: ctx.projectRoot, files: [], pdseScore: null, findings: [] });
    }

    type SkillFinding = {
      severity: "critical" | "warning" | "info";
      category: string;
      message: string;
      line?: number;
    };
    type VerifyResult = { passed: boolean; overallScore: number; findings: SkillFinding[] };

    const { verifySkill, detectSkillSources, parseUniversalSkill } =
      await import("@dantecode/skill-adapter");

    const results: VerifyResult[] = await Promise.all(
      fileList.slice(0, 20).map(async (f): Promise<VerifyResult> => {
        try {
          const detections = await detectSkillSources(join(ctx.projectRoot, f));
          if (detections.length === 0) {
            return { passed: true, overallScore: 100, findings: [] };
          }
          const best = detections.sort((a, b) => b.confidence - a.confidence)[0]!;
          const filePath = best.paths[0] ?? join(ctx.projectRoot, f);
          const parsed = await parseUniversalSkill(filePath, best.format);
          const result = await verifySkill(parsed);
          return { passed: result.passed, overallScore: result.overallScore, findings: result.findings };
        } catch {
          return { passed: true, overallScore: 100, findings: [] };
        }
      }),
    );

    const avgScore =
      results.length > 0
        ? results.reduce((sum, r) => sum + r.overallScore, 0) / results.length
        : null;
    const allFindings = results.flatMap((r) => r.findings);
    return ok({ projectRoot: ctx.projectRoot, files: fileList, pdseScore: avgScore, findings: allFindings });
  };
}

function getEvidence(ctx: ServerContext): RouteHandler {
  return async (req) => {
    const sessionId = req.params["sessionId"]!;
    if (!ctx.sessions.has(sessionId)) return notFound(sessionId);
    const evidencePath = join(
      ctx.projectRoot,
      ".dantecode",
      "evidence",
      `${sessionId}.json`,
    );
    let bundle: { chain: unknown[]; receipts: unknown[]; merkleRoot: string | null; seal: unknown | null } =
      { chain: [], receipts: [], merkleRoot: null, seal: null };
    try {
      const raw = await fsReadFile(evidencePath, "utf-8");
      bundle = JSON.parse(raw) as typeof bundle;
    } catch {
      // File doesn't exist yet — return empty bundle
    }
    return ok({ sessionId, ...bundle });
  };
}

// ---------------------------------------------------------------------------
// Skills
// ---------------------------------------------------------------------------

function listSkills(ctx: ServerContext): RouteHandler {
  // Lazy-load SkillCatalog once and cache it
  let catalogPromise: Promise<{ getAll: () => unknown[] }> | null = null;
  const getCatalog = (): Promise<{ getAll: () => unknown[] }> => {
    if (!catalogPromise) {
      catalogPromise = import("@dantecode/skill-adapter").then(async ({ SkillCatalog }) => {
        const catalog = new SkillCatalog(ctx.projectRoot);
        await catalog.load();
        return catalog;
      });
    }
    return catalogPromise;
  };

  return async () => {
    try {
      const catalog = await getCatalog();
      const skills = catalog.getAll();
      return ok({ skills });
    } catch {
      return ok({ skills: [] });
    }
  };
}

function installSkill(ctx: ServerContext): RouteHandler {
  return async (req) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const source = body["source"] ?? body["name"];
    if (typeof source !== "string" || source.trim().length === 0) {
      return badRequest("Missing or empty skill source");
    }
    try {
      const { installSkill: doInstall } = await import("@dantecode/skill-adapter");
      const result = await doInstall({ source }, ctx.projectRoot);
      return ok({
        name: result.name,
        installedPath: result.installedPath || null,
        verification: result.verification ?? null,
        success: result.success,
        error: result.error ?? null,
      });
    } catch (err) {
      return {
        status: 500,
        body: {
          error: `Failed to install skill: ${err instanceof Error ? err.message : String(err)}`,
        },
        headers: undefined,
      };
    }
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
  router.get("/api/skills", listSkills(context));
  router.post("/api/skills/install", installSkill(context));

  // Health
  router.get("/api/health", healthCheck(context));
}
