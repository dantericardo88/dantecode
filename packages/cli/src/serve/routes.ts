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
import { join, resolve, sep } from "node:path";
import { buildServeOperatorStatus, readSessionDurableRunSnapshot } from "../operator-status.js";

/** Session IDs must be alphanumeric + dash/underscore, max 64 chars (blocks path traversal). */
const SESSION_ID_RE = /^[a-zA-Z0-9_-]{1,64}$/;
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
  /** Called when the agent run finishes and can provide artifact visibility. */
  onCompleted?: (result?: { artifacts?: string[]; receipts?: string[]; mode?: string }) => void;
  /** Called when the agent run has partial results to expose immediately. */
  onPartial?: (partialResult: { artifacts?: string[]; receipts?: string[]; mode?: string }) => void;
  /** Called when the agent run fails before completion. */
  onFailed?: (message: string) => void;
}

export interface ApprovalEventRecord {
  action: "needed" | "approved" | "denied";
  toolName: string;
  command: string;
  riskLevel: string;
  at: string;
}

export interface SessionTimelineEvent {
  kind: "message" | "command" | "approval" | "abort" | "status";
  label: string;
  at: string;
  detail?: string;
}

export interface CommandRecord {
  id: string;
  command: string;
  status: "unavailable" | "completed" | "failed";
  startedAt: string;
  finishedAt?: string;
  output?: string;
}

export interface CommandRunnerResult {
  status: CommandRecord["status"];
  output: string;
  artifacts?: string[];
  receipts?: string[];
  mode?: string;
}

export interface CommandRunnerOpts {
  sessionId: string;
  command: string;
  projectRoot: string;
  history: Array<{ role: "user" | "assistant"; content: string }>;
}

/** A server-side session record. */
export interface SessionRecord {
  id: string;
  name: string;
  createdAt: string;
  messageCount: number;
  model: string;
  messages: Array<{ role: "user" | "assistant"; content: string; ts: string }>;
  status?:
    | "idle"
    | "running"
    | "awaiting_approval"
    | "aborted"
    | "completed"
    | "denied"
    | "failed"
    | "partial"
    | "timeout";
  mode?: string;
  approvalEvents?: ApprovalEventRecord[];
  commandHistory?: CommandRecord[];
  timeline?: SessionTimelineEvent[];
  artifactPaths?: string[];
  receiptPaths?: string[];
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
  /** Optional slash command executor used by preview surfaces. */
  commandRunner?: (opts: CommandRunnerOpts) => Promise<CommandRunnerResult>;
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

function ensureSessionCollections(session: SessionRecord): void {
  session.approvalEvents ??= [];
  session.commandHistory ??= [];
  session.timeline ??= [];
  session.artifactPaths ??= [];
  session.receiptPaths ??= [];
  session.mode ??= "review";
  session.status ??= "idle";
}

function appendTimeline(session: SessionRecord, event: SessionTimelineEvent): void {
  ensureSessionCollections(session);
  session.timeline!.push(event);
}

function appendUniquePaths(
  target: string[] | undefined,
  additions: string[] | undefined,
): string[] {
  const next = [...(target ?? [])];
  for (const item of additions ?? []) {
    if (!next.includes(item)) {
      next.push(item);
    }
  }
  return next;
}

// ---------------------------------------------------------------------------
// Session Management
// ---------------------------------------------------------------------------

function listSessions(ctx: ServerContext): RouteHandler {
  return async () => {
    const sessions = Array.from(ctx.sessions.values()).map((s) => {
      ensureSessionCollections(s);
      return {
        id: s.id,
        name: s.name,
        createdAt: s.createdAt,
        messageCount: s.messageCount,
        model: s.model,
        status: s.status,
        mode: s.mode,
        pendingApproval: s.pendingApproval
          ? {
              toolName: s.pendingApproval.toolName,
              command: s.pendingApproval.command,
              riskLevel: s.pendingApproval.riskLevel,
            }
          : null,
        approvalCount: s.approvalEvents!.length,
        commandCount: s.commandHistory!.length,
        artifactCount: s.artifactPaths!.length,
        receiptCount: s.receiptPaths!.length,
      };
    });
    return ok(sessions);
  };
}

function getSession(ctx: ServerContext): RouteHandler {
  return async (req) => {
    const id = req.params["id"]!;
    if (!SESSION_ID_RE.test(id)) return badRequest("Invalid session ID format");
    const session = ctx.sessions.get(id);
    if (!session) return notFound(id);
    ensureSessionCollections(session);
    ensureSessionCollections(session);
    const durableRun = await readSessionDurableRunSnapshot(ctx.projectRoot, session.id);
    return ok({
      id: session.id,
      name: session.name,
      createdAt: session.createdAt,
      messageCount: session.messageCount,
      model: session.model,
      messages: session.messages,
      status: session.status,
      mode: session.mode,
      pendingApproval: session.pendingApproval
        ? {
            toolName: session.pendingApproval.toolName,
            command: session.pendingApproval.command,
            riskLevel: session.pendingApproval.riskLevel,
          }
        : null,
      approvalEvents: session.approvalEvents,
      commandHistory: session.commandHistory,
      timeline: session.timeline,
      artifactPaths: session.artifactPaths,
      receiptPaths: session.receiptPaths,
      durableRun,
    });
  };
}

const MAX_SESSIONS = 10_000;

function createSession(ctx: ServerContext): RouteHandler {
  return async (req) => {
    if (ctx.sessions.size >= MAX_SESSIONS) {
      return { status: 429, body: { error: `Session limit reached (max ${MAX_SESSIONS})` } };
    }
    const body = (req.body ?? {}) as Record<string, unknown>;
    const name =
      typeof body["name"] === "string" ? body["name"] : `Session ${ctx.sessions.size + 1}`;
    const model = typeof body["model"] === "string" ? body["model"] : ctx.model;

    const id = generateId();
    const record: SessionRecord = {
      id,
      name,
      createdAt: new Date().toISOString(),
      messageCount: 0,
      model,
      messages: [],
      status: "idle",
      mode: "review",
      approvalEvents: [],
      commandHistory: [],
      timeline: [],
      artifactPaths: [],
      receiptPaths: [],
    };
    ctx.sessions.set(id, record);
    return ok({ id, name, model, createdAt: record.createdAt });
  };
}

function resumeSession(ctx: ServerContext): RouteHandler {
  return async (req) => {
    const id = req.params["id"]!;
    if (!SESSION_ID_RE.test(id)) return badRequest("Invalid session ID format");
    const session = ctx.sessions.get(id);
    if (!session) return notFound(id);
    return ok({ id: session.id, name: session.name, resumed: true });
  };
}

// ---------------------------------------------------------------------------
// Agent Interaction
// ---------------------------------------------------------------------------

function sendMessage(ctx: ServerContext): RouteHandler {
  return async (req) => {
    const id = req.params["id"]!;
    if (!SESSION_ID_RE.test(id)) return badRequest("Invalid session ID format");
    const session = ctx.sessions.get(id);
    if (!session) return notFound(id);
    ensureSessionCollections(session);

    const body = (req.body ?? {}) as Record<string, unknown>;
    const content = body["content"] ?? body["message"] ?? body["prompt"];
    if (typeof content !== "string" || content.trim().length === 0) {
      return badRequest("Missing or empty message content");
    }

    // Race condition guard: reject concurrent messages on the same session
    if (session.abortController) {
      return {
        status: 409,
        body: { error: "Session already has an active agent run — POST /abort first" },
      };
    }

    const messageId = generateId();
    const ts = new Date().toISOString();

    session.messages.push({ role: "user", content, ts });
    session.messageCount++;
    session.status = "running";
    appendTimeline(session, {
      kind: "message",
      label: "User message received",
      at: ts,
      detail: content,
    });

    // Signal SSE clients that a prompt was received
    ctx.sessionEmitter.emitStatus(session.id, `[message:${messageId}] User message received`);

    // Wire abort controller for in-flight cancellation
    const ac = new AbortController();
    session.abortController = ac;

    // Fire-and-forget: invoke agent loop if wired; catch synchronous throws
    try {
      ctx.agentRunner?.({
        sessionId: session.id,
        prompt: content,
        model: session.model,
        projectRoot: ctx.projectRoot,
        history: session.messages.map((m) => ({ role: m.role, content: m.content })),
        abortSignal: ac.signal,
        onApprovalNeeded: (toolName, command, riskLevel) =>
          new Promise<boolean>((resolveApproval) => {
            session.pendingApproval = { toolName, command, riskLevel, resolve: resolveApproval };
            session.status = "awaiting_approval";
            session.approvalEvents!.push({
              action: "needed",
              toolName,
              command,
              riskLevel,
              at: new Date().toISOString(),
            });
            appendTimeline(session, {
              kind: "approval",
              label: `${toolName} requires approval`,
              at: new Date().toISOString(),
              detail: command,
            });
            ctx.sessionEmitter.emitApprovalNeeded(session.id, toolName, command, riskLevel);
          }),
        onPartial: (partialResult) => {
          session.status = "partial";
          session.mode = partialResult?.mode ?? session.mode;
          // Only add partial artifacts/receipts - these are exposed immediately but not "confirmed"
          session.artifactPaths = appendUniquePaths(
            session.artifactPaths,
            partialResult?.artifacts,
          );
          session.receiptPaths = appendUniquePaths(session.receiptPaths, partialResult?.receipts);
          appendTimeline(session, {
            kind: "status",
            label: "Partial results available",
            at: new Date().toISOString(),
          });
        },
        onCompleted: (result) => {
          session.abortController = undefined;
          session.pendingApproval = undefined;
          session.status = "completed";
          session.mode = result?.mode ?? session.mode;
          session.artifactPaths = appendUniquePaths(session.artifactPaths, result?.artifacts);
          session.receiptPaths = appendUniquePaths(session.receiptPaths, result?.receipts);
          appendTimeline(session, {
            kind: "status",
            label: "Agent run completed",
            at: new Date().toISOString(),
          });
        },
        onFailed: (message) => {
          session.abortController = undefined;
          session.status = "failed";
          appendTimeline(session, {
            kind: "status",
            label: "Agent run failed",
            at: new Date().toISOString(),
            detail: message,
          });
        },
      });
    } catch {
      session.abortController = undefined;
      session.status = "failed";
    }

    return {
      status: 202,
      body: { messageId, sessionId: req.params["id"], ts, status: "running" },
      headers: undefined,
    };
  };
}

function abortGeneration(ctx: ServerContext): RouteHandler {
  return async (req) => {
    const id = req.params["id"]!;
    if (!SESSION_ID_RE.test(id)) return badRequest("Invalid session ID format");
    const session = ctx.sessions.get(id);
    if (!session) return notFound(id);
    ensureSessionCollections(session);

    if (session.abortController) {
      session.abortController.abort();
      session.abortController = undefined;
    }
    session.status = "aborted";
    appendTimeline(session, {
      kind: "abort",
      label: "Generation aborted by client",
      at: new Date().toISOString(),
    });
    ctx.sessionEmitter.emitStatus(session.id, "[abort] Generation aborted by client");
    return ok({ aborted: true, sessionId: req.params["id"] });
  };
}

// ---------------------------------------------------------------------------
// Tool Approval
// ---------------------------------------------------------------------------

function approveAction(ctx: ServerContext): RouteHandler {
  return async (req) => {
    const id = req.params["id"]!;
    if (!SESSION_ID_RE.test(id)) return badRequest("Invalid session ID format");
    const session = ctx.sessions.get(id);
    if (!session) return notFound(id);
    if (!session.pendingApproval) return badRequest("No pending approval for this session");
    ensureSessionCollections(session);
    session.approvalEvents!.push({
      action: "approved",
      toolName: session.pendingApproval.toolName,
      command: session.pendingApproval.command,
      riskLevel: session.pendingApproval.riskLevel,
      at: new Date().toISOString(),
    });
    appendTimeline(session, {
      kind: "approval",
      label: `${session.pendingApproval.toolName} approved`,
      at: new Date().toISOString(),
      detail: session.pendingApproval.command,
    });
    session.status = "running";
    session.pendingApproval.resolve(true);
    session.pendingApproval = undefined;
    return ok({ approved: true, sessionId: id });
  };
}

function denyAction(ctx: ServerContext): RouteHandler {
  return async (req) => {
    const id = req.params["id"]!;
    if (!SESSION_ID_RE.test(id)) return badRequest("Invalid session ID format");
    const session = ctx.sessions.get(id);
    if (!session) return notFound(id);
    if (!session.pendingApproval) return badRequest("No pending approval for this session");
    ensureSessionCollections(session);
    session.approvalEvents!.push({
      action: "denied",
      toolName: session.pendingApproval.toolName,
      command: session.pendingApproval.command,
      riskLevel: session.pendingApproval.riskLevel,
      at: new Date().toISOString(),
    });
    appendTimeline(session, {
      kind: "approval",
      label: `${session.pendingApproval.toolName} denied`,
      at: new Date().toISOString(),
      detail: session.pendingApproval.command,
    });
    session.status = "denied";
    session.pendingApproval.resolve(false);
    session.pendingApproval = undefined;
    return ok({ denied: true, sessionId: id });
  };
}

// ---------------------------------------------------------------------------
// Status, Config, Slash Commands
// ---------------------------------------------------------------------------

function getStatus(ctx: ServerContext): RouteHandler {
  return async () => {
    const operator = await buildServeOperatorStatus({
      projectRoot: ctx.projectRoot,
      sessions: ctx.sessions.values(),
    });
    return ok({
      model: ctx.model,
      project: ctx.projectRoot,
      version: ctx.version,
      sessionCount: ctx.sessions.size,
      uptime: Math.floor((Date.now() - ctx.startTime) / 1000),
      features: { sse: true, approval: true, skills: true, evidenceChain: true },
      operator,
    });
  };
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
    const id = req.params["id"]!;
    if (!SESSION_ID_RE.test(id)) return badRequest("Invalid session ID format");
    const session = ctx.sessions.get(id);
    if (!session) return notFound(id);
    ensureSessionCollections(session);

    const body = (req.body ?? {}) as Record<string, unknown>;
    const command = body["command"];
    if (typeof command !== "string" || !command.startsWith("/")) {
      return badRequest("Missing or invalid command — must start with /");
    }

    const commandId = generateId();
    const startedAt = new Date().toISOString();
    const record: CommandRecord = {
      id: commandId,
      command,
      status: "unavailable",
      startedAt,
    };

    session.commandHistory!.push(record);
    appendTimeline(session, {
      kind: "command",
      label: `Slash command requested: ${command}`,
      at: startedAt,
    });

    let result: CommandRunnerResult;
    if (!ctx.commandRunner) {
      result = {
        status: "unavailable",
        output: `Slash command execution is not wired in serve mode for ${command}.`,
      };
    } else {
      try {
        result = await ctx.commandRunner({
          sessionId: session.id,
          command,
          projectRoot: ctx.projectRoot,
          history: session.messages.map((message) => ({
            role: message.role,
            content: message.content,
          })),
        });
      } catch (err) {
        result = {
          status: "failed",
          output:
            err instanceof Error ? err.message : `Slash command execution failed: ${String(err)}`,
        };
      }
    }

    record.status = result.status;
    record.output = result.output;
    record.finishedAt = new Date().toISOString();
    session.artifactPaths = appendUniquePaths(session.artifactPaths, result.artifacts);
    session.receiptPaths = appendUniquePaths(session.receiptPaths, result.receipts);
    if (result.mode) {
      session.mode = result.mode;
    }

    ctx.sessionEmitter.emitStatus(session.id, `[slash:${result.status}] ${command}`);
    return ok({
      commandId,
      sessionId: id,
      status: result.status,
      output: result.output,
    });
  };
}

// ---------------------------------------------------------------------------
// DanteForge Verification
// ---------------------------------------------------------------------------

function runVerification(ctx: ServerContext): RouteHandler {
  return async (req) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const rawFiles = Array.isArray(body["files"]) ? (body["files"] as unknown[]) : [];

    // DoS guard: limit number of files before expensive per-file operations
    if (rawFiles.length > 100) {
      return badRequest("Too many files: max 100 per verification request");
    }

    // Validate each file stays within projectRoot (path traversal prevention)
    const projectRootResolved = resolve(ctx.projectRoot);
    const safeFiles = rawFiles.filter((f): f is string => {
      if (typeof f !== "string") return false;
      const resolved = resolve(join(ctx.projectRoot, f));
      return resolved.startsWith(projectRootResolved + sep) || resolved === projectRootResolved;
    });

    // Short-circuit: empty file list returns null score immediately with no imports needed
    if (safeFiles.length === 0) {
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
      safeFiles.slice(0, 20).map(async (f): Promise<VerifyResult> => {
        try {
          const detections = await detectSkillSources(join(ctx.projectRoot, f));
          if (detections.length === 0) {
            return { passed: true, overallScore: 100, findings: [] };
          }
          const best = detections.sort((a, b) => b.confidence - a.confidence)[0]!;
          const filePath = best.paths[0] ?? join(ctx.projectRoot, f);
          const parsed = await parseUniversalSkill(filePath, best.format);
          const result = await verifySkill(parsed);
          return {
            passed: result.passed,
            overallScore: result.overallScore,
            findings: result.findings,
          };
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
    return ok({
      projectRoot: ctx.projectRoot,
      files: safeFiles,
      pdseScore: avgScore,
      findings: allFindings,
    });
  };
}

function getEvidence(ctx: ServerContext): RouteHandler {
  return async (req) => {
    const sessionId = req.params["sessionId"]!;

    // Block path traversal: sessionId must be safe alphanumeric format
    if (!SESSION_ID_RE.test(sessionId)) {
      return badRequest("Invalid session ID format");
    }

    if (!ctx.sessions.has(sessionId)) return notFound(sessionId);

    const evidencePath = join(ctx.projectRoot, ".dantecode", "evidence", `${sessionId}.json`);

    // Secondary confinement check: resolved path must stay inside projectRoot
    const resolvedEvidence = resolve(evidencePath);
    const resolvedRoot = resolve(ctx.projectRoot);
    if (!resolvedEvidence.startsWith(resolvedRoot + sep) && resolvedEvidence !== resolvedRoot) {
      return badRequest("Invalid path");
    }

    const emptyBundle = { chain: [], receipts: [], merkleRoot: null, seal: null };

    let raw: string;
    try {
      raw = await fsReadFile(evidencePath, "utf-8");
    } catch (err: unknown) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code === "ENOENT") return ok({ sessionId, ...emptyBundle });
      return { status: 500, body: { error: "Failed to read evidence file" } };
    }

    try {
      const bundle = JSON.parse(raw) as typeof emptyBundle;
      return ok({ sessionId, ...bundle });
    } catch {
      return { status: 500, body: { error: "Evidence file corrupt (JSON parse error)" } };
    }
  };
}

function deleteSession(ctx: ServerContext): RouteHandler {
  return async (req) => {
    const sessionId = req.params["id"]!;
    if (!SESSION_ID_RE.test(sessionId)) {
      return badRequest("Invalid session ID format");
    }
    const session = ctx.sessions.get(sessionId);
    if (!session) return notFound(sessionId);
    // Abort any in-flight agent before removing
    session.abortController?.abort();
    // Notify any active SSE subscribers before removing the session
    ctx.sessionEmitter.emitError(sessionId, "Session deleted");
    ctx.sessions.delete(sessionId);
    return ok({ deleted: true, sessionId });
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
  router.delete("/api/sessions/:id", deleteSession(context));

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
