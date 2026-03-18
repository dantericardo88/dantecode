// ============================================================================
// @dantecode/core — Webhook Server Tests
// ============================================================================

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createHmac } from "node:crypto";
import { request } from "node:http";
import { createWebhookServer } from "./webhook-server.js";
import { EventTriggerRegistry } from "./event-triggers.js";
import { BackgroundAgentRunner } from "./background-agent.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const TEST_GITHUB_SECRET = "test-github-secret";
const TEST_SLACK_SECRET = "test-slack-secret";
const TEST_API_TOKEN = "test-bearer-token-abc";

/** Make an HTTP request to the test server and return { status, body }. */
function httpRequest(
  port: number,
  method: string,
  path: string,
  body?: string,
  headers?: Record<string, string>,
): Promise<{ status: number; body: Record<string, unknown> }> {
  return new Promise((resolve, reject) => {
    const req = request(
      {
        hostname: "127.0.0.1",
        port,
        path,
        method,
        headers: {
          "Content-Type": "application/json",
          ...headers,
        },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (chunk: Buffer) => chunks.push(chunk));
        res.on("end", () => {
          const raw = Buffer.concat(chunks).toString("utf-8");
          try {
            resolve({ status: res.statusCode ?? 0, body: JSON.parse(raw) });
          } catch {
            resolve({
              status: res.statusCode ?? 0,
              body: { _raw: raw } as Record<string, unknown>,
            });
          }
        });
        res.on("error", reject);
      },
    );

    req.on("error", reject);

    if (body) {
      req.write(body);
    }
    req.end();
  });
}

/** Compute a GitHub-compatible HMAC-SHA256 signature for a body string. */
function makeGitHubSignature(body: string, secret: string): string {
  return "sha256=" + createHmac("sha256", secret).update(body).digest("hex");
}

/** Compute a Slack v0 signature for a body string and timestamp. */
function makeSlackSignature(body: string, timestamp: string, secret: string): string {
  const baseString = `v0:${timestamp}:${body}`;
  return "v0=" + createHmac("sha256", secret).update(baseString).digest("hex");
}

// ---------------------------------------------------------------------------
// Test Suite
// ---------------------------------------------------------------------------

describe("WebhookServer", () => {
  let registry: EventTriggerRegistry;
  let runner: BackgroundAgentRunner;
  let serverHandle: ReturnType<typeof createWebhookServer>;
  let port: number;

  beforeAll(async () => {
    registry = new EventTriggerRegistry({
      enabledSources: ["github", "slack", "api", "manual"],
      githubSecret: TEST_GITHUB_SECRET,
      defaultPriority: "normal",
    });

    runner = new BackgroundAgentRunner(2, "/tmp/test-project");

    // Use port 0 so the OS picks an available ephemeral port
    serverHandle = createWebhookServer({
      port: 0,
      eventRegistry: registry,
      backgroundRunner: runner,
      projectRoot: "/tmp/test-project",
      apiToken: TEST_API_TOKEN,
      slackSigningSecret: TEST_SLACK_SECRET,
    });

    await serverHandle.start();

    // Read the actual port assigned by the OS
    const addr = serverHandle.server.address();
    if (typeof addr === "object" && addr !== null) {
      port = addr.port;
    } else {
      throw new Error("Server did not bind to a port");
    }
  });

  afterAll(async () => {
    await serverHandle.stop();
  });

  // ── GET /health ─────────────────────────────────────────────────────────

  describe("GET /health", () => {
    it("returns 200 with status ok", async () => {
      const { status, body } = await httpRequest(port, "GET", "/health");

      expect(status).toBe(200);
      expect(body.status).toBe("ok");
      expect(typeof body.uptime).toBe("number");
      expect(typeof body.activeTasks).toBe("number");
      expect(body.taskCounts).toBeDefined();
    });
  });

  // ── POST /webhooks/github ──────────────────────────────────────────────

  describe("POST /webhooks/github", () => {
    it("dispatches a task for a valid GitHub issue webhook", async () => {
      const payload = JSON.stringify({
        action: "opened",
        repository: { full_name: "acme/app" },
        issue: {
          number: 99,
          title: "Bug: login fails",
          body: "Steps to reproduce...",
          labels: [],
        },
      });

      const signature = makeGitHubSignature(payload, TEST_GITHUB_SECRET);

      const { status, body } = await httpRequest(port, "POST", "/webhooks/github", payload, {
        "x-hub-signature-256": signature,
        "x-github-event": "issues",
      });

      expect(status).toBe(200);
      expect(body.accepted).toBe(true);
      expect(body.taskId).toBeTruthy();
      expect(body.agentTaskId).toBeTruthy();
      expect(body.source).toBe("github");
    });

    it("returns 401 for an invalid GitHub signature", async () => {
      const payload = JSON.stringify({
        action: "opened",
        repository: { full_name: "acme/app" },
        issue: { number: 1, title: "Test", body: "", labels: [] },
      });

      const { status, body } = await httpRequest(port, "POST", "/webhooks/github", payload, {
        "x-hub-signature-256": "sha256=invalid_signature_value",
        "x-github-event": "issues",
      });

      expect(status).toBe(401);
      expect(body.error).toContain("Invalid");
    });

    it("returns 401 when signature header is missing", async () => {
      const payload = JSON.stringify({ action: "opened" });

      const { status, body } = await httpRequest(port, "POST", "/webhooks/github", payload, {
        "x-github-event": "issues",
      });

      expect(status).toBe(401);
      expect(body.error).toContain("Missing");
    });

    it("returns 200 with accepted=false for unsupported event types", async () => {
      const payload = JSON.stringify({
        action: "created",
        repository: { full_name: "acme/app" },
      });
      const signature = makeGitHubSignature(payload, TEST_GITHUB_SECRET);

      const { status, body } = await httpRequest(port, "POST", "/webhooks/github", payload, {
        "x-hub-signature-256": signature,
        "x-github-event": "fork",
      });

      expect(status).toBe(200);
      expect(body.accepted).toBe(false);
    });
  });

  // ── POST /webhooks/slack ───────────────────────────────────────────────

  describe("POST /webhooks/slack", () => {
    it("dispatches a task for a valid Slack event", async () => {
      const timestamp = String(Math.floor(Date.now() / 1000));
      const payload = JSON.stringify({
        type: "event_callback",
        event: {
          type: "message",
          text: "Deploy to production",
          channel: "#ops",
          user: "U12345",
          ts: "1710672000.000100",
        },
      });
      const signature = makeSlackSignature(payload, timestamp, TEST_SLACK_SECRET);

      const { status, body } = await httpRequest(port, "POST", "/webhooks/slack", payload, {
        "x-slack-signature": signature,
        "x-slack-request-timestamp": timestamp,
      });

      expect(status).toBe(200);
      expect(body.accepted).toBe(true);
      expect(body.taskId).toBeTruthy();
      expect(body.source).toBe("slack");
    });

    it("returns 401 for an invalid Slack signature", async () => {
      const timestamp = String(Math.floor(Date.now() / 1000));
      const payload = JSON.stringify({
        type: "event_callback",
        event: { text: "test", channel: "#c", user: "U1", ts: "1" },
      });

      const { status, body } = await httpRequest(port, "POST", "/webhooks/slack", payload, {
        "x-slack-signature": "v0=invalid_signature",
        "x-slack-request-timestamp": timestamp,
      });

      expect(status).toBe(401);
      expect(body.error).toContain("Invalid");
    });
  });

  // ── POST /api/tasks ───────────────────────────────────────────────────

  describe("POST /api/tasks", () => {
    it("enqueues a task with valid bearer token", async () => {
      const payload = JSON.stringify({ prompt: "Run diagnostics on staging" });

      const { status, body } = await httpRequest(port, "POST", "/api/tasks", payload, {
        Authorization: `Bearer ${TEST_API_TOKEN}`,
      });

      expect(status).toBe(200);
      expect(body.accepted).toBe(true);
      expect(body.taskId).toBeTruthy();
      expect(body.source).toBe("api");
    });

    it("returns 401 without a bearer token", async () => {
      const payload = JSON.stringify({ prompt: "Unauthorized task" });

      const { status, body } = await httpRequest(port, "POST", "/api/tasks", payload);

      expect(status).toBe(401);
      expect(body.error).toBe("Unauthorized");
    });

    it("returns 401 with an incorrect bearer token", async () => {
      const payload = JSON.stringify({ prompt: "Wrong token task" });

      const { status, body } = await httpRequest(port, "POST", "/api/tasks", payload, {
        Authorization: "Bearer wrong-token",
      });

      expect(status).toBe(401);
      expect(body.error).toBe("Unauthorized");
    });

    it("returns 400 for missing prompt", async () => {
      const payload = JSON.stringify({ notAPrompt: true });

      const { status, body } = await httpRequest(port, "POST", "/api/tasks", payload, {
        Authorization: `Bearer ${TEST_API_TOKEN}`,
      });

      expect(status).toBe(400);
      expect(body.error).toContain("prompt");
    });
  });

  // ── 404 for unknown routes ────────────────────────────────────────────

  describe("404 handling", () => {
    it("returns 404 for unknown routes", async () => {
      const { status, body } = await httpRequest(port, "GET", "/unknown/path");

      expect(status).toBe(404);
      expect(body.error).toBe("Not found");
    });

    it("returns 404 for GET on webhook endpoints", async () => {
      const { status, body } = await httpRequest(port, "GET", "/webhooks/github");

      expect(status).toBe(404);
      expect(body.error).toBe("Not found");
    });
  });
});

// ---------------------------------------------------------------------------
// Issue-to-PR Pipeline Routing Tests
// ---------------------------------------------------------------------------

describe("WebhookServer — Issue-to-PR Pipeline", () => {
  let registry: EventTriggerRegistry;
  let runner: BackgroundAgentRunner;
  let serverHandle: ReturnType<typeof createWebhookServer>;
  let port: number;
  beforeAll(async () => {
    registry = new EventTriggerRegistry({
      enabledSources: ["github", "slack", "api", "manual"],
      githubSecret: TEST_GITHUB_SECRET,
      defaultPriority: "normal",
    });

    runner = new BackgroundAgentRunner(2, "/tmp/test-project");

    serverHandle = createWebhookServer({
      port: 0,
      eventRegistry: registry,
      backgroundRunner: runner,
      projectRoot: "/tmp/test-project",
      apiToken: TEST_API_TOKEN,
      slackSigningSecret: TEST_SLACK_SECRET,
      issueToPR: {
        githubToken: "ghp_test_token",
        repository: "acme/app",
        baseBranch: "main",
      },
      agentExecutor: async (_prompt, _workdir) => {
        return { output: "done", touchedFiles: ["src/fix.ts"] };
      },
    });

    await serverHandle.start();

    const addr = serverHandle.server.address();
    if (typeof addr === "object" && addr !== null) {
      port = addr.port;
    } else {
      throw new Error("Server did not bind to a port");
    }
  });

  afterAll(async () => {
    await serverHandle.stop();
  });

  it("routes issue webhook through IssueToPRPipeline when configured", async () => {
    const payload = JSON.stringify({
      action: "opened",
      repository: { full_name: "acme/app" },
      issue: {
        number: 42,
        title: "Fix authentication timeout",
        body: "Users are seeing timeouts on login after 30s",
        labels: [{ name: "bug" }],
        html_url: "https://github.com/acme/app/issues/42",
      },
    });

    const signature = makeGitHubSignature(payload, TEST_GITHUB_SECRET);

    const { status, body } = await httpRequest(port, "POST", "/webhooks/github", payload, {
      "x-hub-signature-256": signature,
      "x-github-event": "issues",
    });

    expect(status).toBe(200);
    expect(body.accepted).toBe(true);
    expect(body.pipeline).toBe("issue-to-pr");
    expect(body.issueNumber).toBe(42);
    expect(body.source).toBe("github");
    // No taskId since it goes through pipeline, not background runner
    expect(body.taskId).toBeUndefined();
  });

  it("falls back to background runner for non-issue GitHub events", async () => {
    const payload = JSON.stringify({
      action: "completed",
      repository: { full_name: "acme/app" },
      workflow_run: {
        name: "CI",
        conclusion: "failure",
        head_commit: { message: "fix: typo" },
      },
    });

    const signature = makeGitHubSignature(payload, TEST_GITHUB_SECRET);

    const { status, body } = await httpRequest(port, "POST", "/webhooks/github", payload, {
      "x-hub-signature-256": signature,
      "x-github-event": "workflow_run",
    });

    expect(status).toBe(200);
    expect(body.accepted).toBe(true);
    expect(body.taskId).toBeTruthy(); // Goes through background runner
    expect(body.pipeline).toBeUndefined(); // Not routed to pipeline
  });

  it("falls back to background runner for push events", async () => {
    const payload = JSON.stringify({
      ref: "refs/heads/main",
      repository: { full_name: "acme/app" },
      head_commit: { message: "feat: new feature" },
    });

    const signature = makeGitHubSignature(payload, TEST_GITHUB_SECRET);

    const { status, body } = await httpRequest(port, "POST", "/webhooks/github", payload, {
      "x-hub-signature-256": signature,
      "x-github-event": "push",
    });

    expect(status).toBe(200);
    expect(body.accepted).toBe(true);
    expect(body.taskId).toBeTruthy();
  });
});
