// ============================================================================
// @dantecode/core — Webhook Server
// Lightweight HTTP server that receives GitHub/Slack webhooks and dispatches
// them to the EventTriggerRegistry for processing by BackgroundAgentRunner.
// Uses only node:http — no Express, no Fastify, no external dependencies.
// ============================================================================

import { createServer, type IncomingMessage, type ServerResponse, type Server } from "node:http";
import type { EventTriggerRegistry } from "./event-triggers.js";
import type { BackgroundAgentRunner } from "./background-agent.js";
import { appendAuditEvent } from "./audit.js";
import { IssueToPRPipeline } from "./issue-to-pr.js";
import type { IssueToPRConfig, AgentExecutor, GitHubIssueInfo } from "./issue-to-pr.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface WebhookServerConfig {
  /** Port to listen on. */
  port: number;
  /** Event trigger registry for creating normalized AgentTask objects. */
  eventRegistry: EventTriggerRegistry;
  /** Background agent runner for enqueuing tasks. */
  backgroundRunner: BackgroundAgentRunner;
  /** Absolute path to the project root. */
  projectRoot: string;
  /** Optional bearer token for the /api/tasks endpoint. */
  apiToken?: string;
  /** Optional Slack signing secret for verifying Slack webhook signatures. */
  slackSigningSecret?: string;
  /** Optional config for the Issue-to-PR pipeline. When set, issue webhooks
   *  trigger the full pipeline (worktree → agent → verify → PR → comment). */
  issueToPR?: IssueToPRConfig;
  /** Agent executor for issue-to-PR pipeline. Called with (prompt, workdir). */
  agentExecutor?: AgentExecutor;
}

export interface WebhookServerHandle {
  /** The underlying Node.js HTTP server. */
  server: Server;
  /** Start listening on the configured port. Resolves once the server is ready. */
  start(): Promise<void>;
  /** Gracefully stop the server. Resolves once all connections are closed. */
  stop(): Promise<void>;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Collect all chunks from an IncomingMessage into a UTF-8 string. */
function readBody(req: IncomingMessage): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf-8")));
    req.on("error", reject);
  });
}

/** Send a JSON response with the given status code. */
function sendJSON(res: ServerResponse, status: number, data: unknown): void {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Content-Length": Buffer.byteLength(body),
  });
  res.end(body);
}

// ---------------------------------------------------------------------------
// Route Handlers
// ---------------------------------------------------------------------------

/**
 * POST /webhooks/github
 *
 * Reads the raw body, verifies the HMAC-SHA256 signature via
 * `eventRegistry.verifyGitHubSignature()`, parses the JSON payload,
 * creates an AgentTask via `eventRegistry.fromGitHub()`, and enqueues
 * it in the background runner.
 */
async function handleGitHubWebhook(
  req: IncomingMessage,
  res: ServerResponse,
  config: WebhookServerConfig,
): Promise<void> {
  const rawBody = await readBody(req);

  // Signature verification
  const signatureHeader = req.headers["x-hub-signature-256"];
  if (typeof signatureHeader !== "string" || !signatureHeader) {
    sendJSON(res, 401, { error: "Missing X-Hub-Signature-256 header" });
    return;
  }

  if (!config.eventRegistry.verifyGitHubSignature(rawBody, signatureHeader)) {
    sendJSON(res, 401, { error: "Invalid webhook signature" });
    return;
  }

  // Parse the JSON payload
  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(rawBody) as Record<string, unknown>;
  } catch {
    sendJSON(res, 400, { error: "Invalid JSON body" });
    return;
  }

  // Determine the event type from the header
  const eventName = req.headers["x-github-event"];
  if (typeof eventName !== "string" || !eventName) {
    sendJSON(res, 400, { error: "Missing X-GitHub-Event header" });
    return;
  }

  // Create an AgentTask from the event
  const task = config.eventRegistry.fromGitHub(eventName, payload);
  if (!task) {
    sendJSON(res, 200, { accepted: false, reason: "Event type not actionable" });
    return;
  }

  // Route issue-to-PR tasks through the full pipeline if configured
  if (
    task.metadata.type === "issue-to-pr" &&
    config.issueToPR &&
    config.agentExecutor
  ) {
    const issueInfo: GitHubIssueInfo = {
      number: task.metadata.issueNumber as number,
      title: task.metadata.issueTitle as string,
      body: task.metadata.issueBody as string,
      labels: (task.metadata.issueLabels as string[]) ?? [],
      url: task.metadata.issueUrl as string,
    };

    // Run the pipeline in the background — don't block the HTTP response
    const pipeline = new IssueToPRPipeline(config.projectRoot, config.issueToPR);
    pipeline.setProgressCallback((progress) => {
      process.stdout.write(
        `[issue-to-pr] #${issueInfo.number} ${progress.stage}: ${progress.message}\n`,
      );
    });

    // Fire and forget — the pipeline handles its own error reporting
    pipeline.run(issueInfo, config.agentExecutor).then((result) => {
      if (result.success) {
        process.stdout.write(
          `[issue-to-pr] #${issueInfo.number} completed → PR ${result.prUrl}\n`,
        );
      } else {
        process.stdout.write(
          `[issue-to-pr] #${issueInfo.number} failed: ${result.error}\n`,
        );
      }
    }).catch(() => {/* pipeline handles its own errors */});

    appendAuditEvent(config.projectRoot, {
      sessionId: task.id,
      timestamp: new Date().toISOString(),
      type: "webhook_received",
      payload: { source: "github", event: eventName, pipeline: "issue-to-pr", issueNumber: issueInfo.number, agentTaskId: task.id },
      modelId: "",
      projectRoot: config.projectRoot,
    }).catch(() => {/* non-fatal */});

    sendJSON(res, 200, {
      accepted: true,
      pipeline: "issue-to-pr",
      issueNumber: issueInfo.number,
      agentTaskId: task.id,
      source: task.source,
    });
    return;
  }

  // Default: enqueue the task in the background runner
  const taskId = config.backgroundRunner.enqueue(task.prompt);

  // Audit log the webhook event
  appendAuditEvent(config.projectRoot, {
    sessionId: task.id,
    timestamp: new Date().toISOString(),
    type: "webhook_received",
    payload: { source: "github", event: eventName, taskId, agentTaskId: task.id },
    modelId: "",
    projectRoot: config.projectRoot,
  }).catch(() => {/* non-fatal */});

  sendJSON(res, 200, {
    accepted: true,
    taskId,
    agentTaskId: task.id,
    source: task.source,
  });
}

/**
 * POST /webhooks/slack
 *
 * Reads the raw body, verifies the Slack v0 signature via
 * `eventRegistry.verifySlackSignature()`, parses the payload,
 * creates an AgentTask via `eventRegistry.fromSlack()`, and enqueues it.
 */
async function handleSlackWebhook(
  req: IncomingMessage,
  res: ServerResponse,
  config: WebhookServerConfig,
): Promise<void> {
  const rawBody = await readBody(req);

  // Signature verification
  const signatureHeader = req.headers["x-slack-signature"];
  const timestamp = req.headers["x-slack-request-timestamp"];

  if (typeof signatureHeader !== "string" || !signatureHeader) {
    sendJSON(res, 401, { error: "Missing X-Slack-Signature header" });
    return;
  }

  if (typeof timestamp !== "string" || !timestamp) {
    sendJSON(res, 401, { error: "Missing X-Slack-Request-Timestamp header" });
    return;
  }

  if (!config.slackSigningSecret) {
    sendJSON(res, 500, { error: "Slack signing secret not configured" });
    return;
  }

  if (
    !config.eventRegistry.verifySlackSignature(
      rawBody,
      timestamp,
      signatureHeader,
      config.slackSigningSecret,
    )
  ) {
    sendJSON(res, 401, { error: "Invalid Slack signature" });
    return;
  }

  // Parse the JSON payload
  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(rawBody) as Record<string, unknown>;
  } catch {
    sendJSON(res, 400, { error: "Invalid JSON body" });
    return;
  }

  // Slack URL verification challenge
  if (payload.type === "url_verification") {
    sendJSON(res, 200, { challenge: payload.challenge });
    return;
  }

  // Extract the Slack event data
  const event = payload.event as Record<string, unknown> | undefined;
  if (!event) {
    sendJSON(res, 400, { error: "Missing event payload" });
    return;
  }

  const task = config.eventRegistry.fromSlack({
    text: (event.text as string) ?? "",
    channel: (event.channel as string) ?? "",
    user: (event.user as string) ?? "",
    timestamp: (event.ts as string) ?? timestamp,
  });

  if (!task) {
    sendJSON(res, 200, { accepted: false, reason: "Slack event not actionable" });
    return;
  }

  const taskId = config.backgroundRunner.enqueue(task.prompt);

  appendAuditEvent(config.projectRoot, {
    sessionId: task.id,
    timestamp: new Date().toISOString(),
    type: "webhook_received",
    payload: { source: "slack", event: "message", taskId, agentTaskId: task.id },
    modelId: "",
    projectRoot: config.projectRoot,
  }).catch(() => {/* non-fatal */});

  sendJSON(res, 200, {
    accepted: true,
    taskId,
    agentTaskId: task.id,
    source: task.source,
  });
}

/**
 * POST /api/tasks
 *
 * Bearer-token authenticated endpoint for submitting tasks via REST API.
 * Expects a JSON body with `{ prompt: string }`.
 */
async function handleAPITasks(
  req: IncomingMessage,
  res: ServerResponse,
  config: WebhookServerConfig,
): Promise<void> {
  // Bearer token auth
  if (config.apiToken) {
    const authHeader = req.headers.authorization;
    if (typeof authHeader !== "string" || authHeader !== `Bearer ${config.apiToken}`) {
      sendJSON(res, 401, { error: "Unauthorized" });
      return;
    }
  }

  const rawBody = await readBody(req);

  let body: Record<string, unknown>;
  try {
    body = JSON.parse(rawBody) as Record<string, unknown>;
  } catch {
    sendJSON(res, 400, { error: "Invalid JSON body" });
    return;
  }

  const prompt = body.prompt;
  if (typeof prompt !== "string" || prompt.trim().length === 0) {
    sendJSON(res, 400, { error: "Missing or empty 'prompt' field" });
    return;
  }

  // Create an API task through the registry and enqueue it
  const agentTask = config.eventRegistry.fromAPI(prompt, (body.metadata as Record<string, unknown>) ?? undefined);
  const taskId = config.backgroundRunner.enqueue(agentTask.prompt);

  appendAuditEvent(config.projectRoot, {
    sessionId: agentTask.id,
    timestamp: new Date().toISOString(),
    type: "webhook_received",
    payload: { source: "api", event: "task_submit", taskId, agentTaskId: agentTask.id },
    modelId: "",
    projectRoot: config.projectRoot,
  }).catch(() => {/* non-fatal */});

  sendJSON(res, 200, {
    accepted: true,
    taskId,
    agentTaskId: agentTask.id,
    source: agentTask.source,
  });
}

/**
 * GET /health
 *
 * Returns server health including uptime and active task counts.
 */
function handleHealth(
  res: ServerResponse,
  config: WebhookServerConfig,
  startTime: number,
): void {
  const counts = config.backgroundRunner.getStatusCounts();

  sendJSON(res, 200, {
    status: "ok",
    uptime: Math.floor((Date.now() - startTime) / 1000),
    activeTasks: counts.running + counts.queued,
    taskCounts: counts,
  });
}

// ---------------------------------------------------------------------------
// Server Factory
// ---------------------------------------------------------------------------

/**
 * Create a lightweight webhook HTTP server.
 *
 * Routes:
 *   POST /webhooks/github  — GitHub webhook receiver
 *   POST /webhooks/slack   — Slack webhook receiver
 *   POST /api/tasks        — REST API task submission
 *   GET  /health           — Health check
 *
 * @param config - Server configuration including port, registries, and auth.
 * @returns A handle with `start()` and `stop()` methods.
 */
export function createWebhookServer(config: WebhookServerConfig): WebhookServerHandle {
  const startTime = Date.now();

  const server: Server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    const method = req.method?.toUpperCase() ?? "";
    const url = req.url ?? "";

    try {
      // ── POST /webhooks/github ──────────────────────────────────────────
      if (method === "POST" && url === "/webhooks/github") {
        await handleGitHubWebhook(req, res, config);
        return;
      }

      // ── POST /webhooks/slack ───────────────────────────────────────────
      if (method === "POST" && url === "/webhooks/slack") {
        await handleSlackWebhook(req, res, config);
        return;
      }

      // ── POST /api/tasks ────────────────────────────────────────────────
      if (method === "POST" && url === "/api/tasks") {
        await handleAPITasks(req, res, config);
        return;
      }

      // ── GET /health ────────────────────────────────────────────────────
      if (method === "GET" && url === "/health") {
        handleHealth(res, config, startTime);
        return;
      }

      // ── 404 ────────────────────────────────────────────────────────────
      sendJSON(res, 404, { error: "Not found" });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      sendJSON(res, 500, { error: "Internal server error", message });
    }
  });

  return {
    server,

    start(): Promise<void> {
      return new Promise<void>((resolve, reject) => {
        server.on("error", reject);
        server.listen(config.port, () => {
          server.removeListener("error", reject);
          resolve();
        });
      });
    },

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
