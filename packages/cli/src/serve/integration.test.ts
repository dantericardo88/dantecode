// ============================================================================
// @dantecode/cli — Serve: Route Integration Tests
// Tests the full HTTP request/response cycle for all non-stub routes.
// Uses real HTTP requests against a live server on an ephemeral port.
// runAgentLoop is mocked so tests do not require an Anthropic API key.
// ============================================================================

import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { request } from "node:http";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

// ---------------------------------------------------------------------------
// Mock runAgentLoop before importing server (which transitively imports it)
// ---------------------------------------------------------------------------

vi.mock("../agent-loop.js", () => ({
  runAgentLoop: vi.fn().mockResolvedValue({
    id: "mock-session",
    projectRoot: "/tmp",
    messages: [
      {
        id: "msg-1",
        role: "assistant",
        content: "Agent response",
        timestamp: new Date().toISOString(),
      },
    ],
    activeFiles: [],
    readOnlyFiles: [],
    model: {
      provider: "anthropic",
      modelId: "claude-sonnet-4-6",
      maxTokens: 8096,
      temperature: 0,
      contextWindow: 200000,
      supportsVision: true,
      supportsToolCalls: true,
    },
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    agentStack: [],
    todoList: [],
  }),
}));

// Also mock readOrInitializeState so we don't need a real project
vi.mock("@dantecode/core", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    readOrInitializeState: vi.fn().mockResolvedValue({
      version: "1.0.0",
      projectRoot: "/tmp",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      model: {
        default: {
          provider: "anthropic",
          modelId: "claude-sonnet-4-6",
          maxTokens: 8096,
          temperature: 0,
          contextWindow: 200000,
          supportsVision: true,
          supportsToolCalls: true,
        },
        fallback: [],
        taskOverrides: {},
      },
      pdse: { threshold: 0.7, hardViolationsAllowed: 0, maxRegenerationAttempts: 3, weights: { completeness: 1 } },
      autoforge: {},
      git: {},
      sandbox: {},
      skills: {},
      agents: {},
      audit: {},
      sessionHistory: [],
      lessons: {},
      project: {},
    }),
  };
});

import { startServer } from "./server.js";
import type { DanteCodeServer } from "./server.js";

// ---------------------------------------------------------------------------
// HTTP helper (identical to server.test.ts)
// ---------------------------------------------------------------------------

function httpRequest(
  port: number,
  method: string,
  path: string,
  body?: string,
  headers?: Record<string, string>,
): Promise<{ status: number; body: Record<string, unknown>; headers: Record<string, string> }> {
  return new Promise((resolve, reject) => {
    const req = request(
      {
        hostname: "127.0.0.1",
        port,
        path,
        method,
        headers: {
          "Content-Type": "application/json",
          ...(body ? { "Content-Length": Buffer.byteLength(body) } : {}),
          ...headers,
        },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (chunk: Buffer) => chunks.push(chunk));
        res.on("end", () => {
          const raw = Buffer.concat(chunks).toString("utf-8");
          let parsed: Record<string, unknown> = {};
          try {
            parsed = JSON.parse(raw) as Record<string, unknown>;
          } catch {
            parsed = { raw };
          }
          const responseHeaders: Record<string, string> = {};
          for (const [k, v] of Object.entries(res.headers)) {
            responseHeaders[k] = Array.isArray(v) ? (v[0] ?? "") : (v ?? "");
          }
          resolve({ status: res.statusCode ?? 0, body: parsed, headers: responseHeaders });
        });
        res.on("error", reject);
      },
    );
    req.on("error", reject);
    if (body) req.write(body);
    req.end();
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("DanteCode HTTP Server — Integration", () => {
  let server: DanteCodeServer;
  let port: number;
  const projectRoot = join(tmpdir(), `dante-serve-integration-${Date.now()}`);

  beforeAll(async () => {
    mkdirSync(projectRoot, { recursive: true });
    server = await startServer({ port: 0, projectRoot });
    port = server.port;
  });

  afterAll(async () => {
    await server.stop();
  });

  it("POST /api/sessions/:id/message returns 202 Accepted", async () => {
    // Create a session first
    const created = await httpRequest(
      port,
      "POST",
      "/api/sessions",
      JSON.stringify({ name: "msg-test" }),
    );
    expect(created.status).toBe(200);
    const sessionId = created.body["id"] as string;

    // Send a message — should return 202 immediately (agent runs async)
    const res = await httpRequest(
      port,
      "POST",
      `/api/sessions/${sessionId}/message`,
      JSON.stringify({ content: "Hello agent" }),
    );
    expect(res.status).toBe(202);
    expect(res.body["status"]).toBe("running");
    expect(typeof res.body["messageId"]).toBe("string");
    expect(res.body["sessionId"]).toBe(sessionId);
  });

  it("POST /api/sessions/:id/message stores user message in session history", async () => {
    const created = await httpRequest(
      port,
      "POST",
      "/api/sessions",
      JSON.stringify({ name: "history-test" }),
    );
    expect(created.status).toBe(200);
    const sessionId = created.body["id"] as string;

    await httpRequest(
      port,
      "POST",
      `/api/sessions/${sessionId}/message`,
      JSON.stringify({ content: "test message" }),
    );

    // messageCount should be >= 1 (user message stored synchronously)
    const session = await httpRequest(port, "GET", `/api/sessions/${sessionId}`);
    expect(session.status).toBe(200);
    expect(session.body["messageCount"]).toBeGreaterThanOrEqual(1);
    expect(Array.isArray(session.body["messages"])).toBe(true);
    const messages = session.body["messages"] as Array<Record<string, unknown>>;
    expect(messages.length).toBeGreaterThanOrEqual(1);
    expect(messages[0]!["role"]).toBe("user");
    expect(messages[0]!["content"]).toBe("test message");
  });

  it("POST /api/verify returns pdseScore (null for empty file list) and findings array", async () => {
    const res = await httpRequest(
      port,
      "POST",
      "/api/verify",
      JSON.stringify({ files: [] }),
    );
    expect(res.status).toBe(200);
    // pdseScore should be null when no files were given
    expect("pdseScore" in res.body).toBe(true);
    expect(res.body["pdseScore"]).toBeNull();
    expect(Array.isArray(res.body["findings"])).toBe(true);
    expect(res.body["findings"]).toHaveLength(0);
    expect(res.body["projectRoot"]).toBe(projectRoot);
  });

  it("GET /api/evidence/:sessionId returns evidence structure for known session", async () => {
    const created = await httpRequest(
      port,
      "POST",
      "/api/sessions",
      JSON.stringify({ name: "evidence-test" }),
    );
    expect(created.status).toBe(200);
    const sessionId = created.body["id"] as string;

    const res = await httpRequest(port, "GET", `/api/evidence/${sessionId}`);
    expect(res.status).toBe(200);
    expect(res.body["sessionId"]).toBe(sessionId);
    expect(Array.isArray(res.body["chain"])).toBe(true);
    expect(Array.isArray(res.body["receipts"])).toBe(true);
    expect(res.body["merkleRoot"]).toBeNull();
    expect(res.body["seal"]).toBeNull();
  });

  it("GET /api/skills returns skills array (empty catalog for fresh project)", async () => {
    const res = await httpRequest(port, "GET", "/api/skills");
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body["skills"])).toBe(true);
  }, 10000);

  it("POST /api/sessions/:id/abort aborts in-flight generation and returns aborted:true", async () => {
    const created = await httpRequest(
      port,
      "POST",
      "/api/sessions",
      JSON.stringify({ name: "abort-test" }),
    );
    expect(created.status).toBe(200);
    const sessionId = created.body["id"] as string;

    // Start a message (fires agent async — does not block)
    await httpRequest(
      port,
      "POST",
      `/api/sessions/${sessionId}/message`,
      JSON.stringify({ content: "long task" }),
    );

    // Abort the in-flight generation
    const abortRes = await httpRequest(
      port,
      "POST",
      `/api/sessions/${sessionId}/abort`,
    );
    expect(abortRes.status).toBe(200);
    expect(abortRes.body["aborted"]).toBe(true);
    expect(abortRes.body["sessionId"]).toBe(sessionId);
  });

  // -------------------------------------------------------------------------
  // Security: path traversal prevention
  // -------------------------------------------------------------------------

  it("GET /api/evidence with path-traversal sessionId returns 400", async () => {
    // ../etc/passwd contains characters not in [a-zA-Z0-9_-]
    const res = await httpRequest(port, "GET", "/api/evidence/..%2Fetc%2Fpasswd");
    expect(res.status).toBe(400);
    expect(typeof res.body["error"]).toBe("string");
  });

  it("GET /api/evidence with dotdot sessionId returns 400", async () => {
    const res = await httpRequest(port, "GET", "/api/evidence/..");
    expect(res.status).toBe(400);
    expect(typeof res.body["error"]).toBe("string");
  });

  it("GET /api/evidence with valid alphanumeric sessionId returns 404 for unknown session", async () => {
    // Valid format passes SESSION_ID_RE; reaches session-not-found check (not path-traversal check)
    const res = await httpRequest(port, "GET", "/api/evidence/validid123");
    expect(res.status).toBe(404);
  });

  // -------------------------------------------------------------------------
  // Security: race condition — concurrent messages on same session
  // -------------------------------------------------------------------------

  it("concurrent POST /message on same session returns 409 on second request", async () => {
    const created = await httpRequest(
      port,
      "POST",
      "/api/sessions",
      JSON.stringify({ name: "concurrent-test" }),
    );
    expect(created.status).toBe(200);
    const sessionId = created.body["id"] as string;

    // First message — sets abortController, returns 202
    const first = await httpRequest(
      port,
      "POST",
      `/api/sessions/${sessionId}/message`,
      JSON.stringify({ content: "first" }),
    );
    expect(first.status).toBe(202);

    // Second message on same session while first is still in-flight — must get 409
    const second = await httpRequest(
      port,
      "POST",
      `/api/sessions/${sessionId}/message`,
      JSON.stringify({ content: "concurrent" }),
    );
    expect(second.status).toBe(409);
    expect(typeof second.body["error"]).toBe("string");
  });

  // -------------------------------------------------------------------------
  // Session lifecycle: DELETE endpoint
  // -------------------------------------------------------------------------

  it("DELETE /api/sessions/:id removes the session (200 → then GET returns 404)", async () => {
    const created = await httpRequest(
      port,
      "POST",
      "/api/sessions",
      JSON.stringify({ name: "delete-test" }),
    );
    expect(created.status).toBe(200);
    const sessionId = created.body["id"] as string;

    // Verify it exists
    const before = await httpRequest(port, "GET", `/api/sessions/${sessionId}`);
    expect(before.status).toBe(200);

    // Delete it
    const deleted = await httpRequest(port, "DELETE", `/api/sessions/${sessionId}`);
    expect(deleted.status).toBe(200);
    expect(deleted.body["deleted"]).toBe(true);
    expect(deleted.body["sessionId"]).toBe(sessionId);

    // Verify it's gone
    const after = await httpRequest(port, "GET", `/api/sessions/${sessionId}`);
    expect(after.status).toBe(404);
  });

  it("DELETE /api/sessions/:id for unknown session returns 404", async () => {
    const res = await httpRequest(port, "DELETE", "/api/sessions/nonexistent-id");
    expect(res.status).toBe(404);
  });

  // -------------------------------------------------------------------------
  // Session lifecycle: reuse after abort (verifies abortController is cleared)
  // -------------------------------------------------------------------------

  it("session can accept a second message after first is aborted", async () => {
    const created = await httpRequest(
      port,
      "POST",
      "/api/sessions",
      JSON.stringify({ name: "reuse-test" }),
    );
    expect(created.status).toBe(200);
    const sessionId = created.body["id"] as string;

    // First message — sets abortController, returns 202
    const first = await httpRequest(
      port,
      "POST",
      `/api/sessions/${sessionId}/message`,
      JSON.stringify({ content: "first message" }),
    );
    expect(first.status).toBe(202);

    // Abort to clear the controller
    const abort = await httpRequest(port, "POST", `/api/sessions/${sessionId}/abort`);
    expect(abort.status).toBe(200);
    expect(abort.body["aborted"]).toBe(true);

    // Second message should now succeed (not 409)
    const second = await httpRequest(
      port,
      "POST",
      `/api/sessions/${sessionId}/message`,
      JSON.stringify({ content: "second message" }),
    );
    expect(second.status).toBe(202);
  });
});
