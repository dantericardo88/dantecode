// ============================================================================
// @dantecode/cli — Serve: Server Integration Tests
// Uses node:http.request() to make real HTTP requests against a live server.
// Port 0 lets the OS pick an ephemeral port to avoid conflicts.
// ============================================================================

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { request } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mkdirSync } from "node:fs";
import { startServer } from "./server.js";
import type { DanteCodeServer } from "./server.js";

// ---------------------------------------------------------------------------
// HTTP helper
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
// Test suites
// ---------------------------------------------------------------------------

describe("DanteCode HTTP Server", () => {
  let server: DanteCodeServer;
  let port: number;
  const projectRoot = join(tmpdir(), `dante-serve-test-${Date.now()}`);

  beforeAll(async () => {
    mkdirSync(projectRoot, { recursive: true });
    server = await startServer({ port: 0, projectRoot });
    port = server.port;
  });

  afterAll(async () => {
    await server.stop();
  });

  it("server starts and returns a port number", () => {
    expect(port).toBeGreaterThan(0);
    expect(server.url).toContain(`127.0.0.1:${port}`);
  });

  it("GET /api/health returns status ok", async () => {
    const res = await httpRequest(port, "GET", "/api/health");
    expect(res.status).toBe(200);
    expect(res.body["status"]).toBe("ok");
    expect(typeof res.body["uptime"]).toBe("number");
  });

  it("returns 404 for unknown routes", async () => {
    const res = await httpRequest(port, "GET", "/api/nonexistent");
    expect(res.status).toBe(404);
    expect(res.body["error"]).toBeDefined();
  });

  it("handles JSON body parsing for POST requests", async () => {
    const body = JSON.stringify({ name: "test-session" });
    const res = await httpRequest(port, "POST", "/api/sessions", body);
    expect(res.status).toBe(200);
    expect(typeof res.body["id"]).toBe("string");
    expect(res.body["name"]).toBe("test-session");
  });

  it("binds to localhost (127.0.0.1) by default", () => {
    // server.url should start with http://127.0.0.1
    expect(server.url).toMatch(/^http:\/\/127\.0\.0\.1:/);
  });

  it("CORS headers are present on responses", async () => {
    const res = await httpRequest(port, "GET", "/api/health");
    expect(res.headers["access-control-allow-origin"]).toBe("*");
  });

  it("handles OPTIONS preflight correctly", async () => {
    const res = await httpRequest(port, "OPTIONS", "/api/health");
    expect(res.status).toBe(204);
  });

  it("server stop() resolves cleanly", async () => {
    const testServer = await startServer({ port: 0, projectRoot });
    await expect(testServer.stop()).resolves.toBeUndefined();
  });

  it("GET /api/status returns model and session count", async () => {
    const res = await httpRequest(port, "GET", "/api/status");
    expect(res.status).toBe(200);
    expect(typeof res.body["model"]).toBe("string");
    expect(typeof res.body["sessionCount"]).toBe("number");
    expect(res.body["features"]).toBeDefined();
  });

  it("POST /api/sessions creates a session and GET /api/sessions/:id retrieves it", async () => {
    const createRes = await httpRequest(
      port,
      "POST",
      "/api/sessions",
      JSON.stringify({ name: "integration-test" }),
    );
    expect(createRes.status).toBe(200);
    const id = createRes.body["id"] as string;
    expect(typeof id).toBe("string");

    const getRes = await httpRequest(port, "GET", `/api/sessions/${id}`);
    expect(getRes.status).toBe(200);
    expect(getRes.body["id"]).toBe(id);
    expect(getRes.body["name"]).toBe("integration-test");
  });
});

// ---------------------------------------------------------------------------
// Auth tests
// ---------------------------------------------------------------------------

describe("DanteCode HTTP Server — with password auth", () => {
  let server: DanteCodeServer;
  let port: number;
  const projectRoot = join(tmpdir(), `dante-serve-auth-test-${Date.now()}`);
  const password = "supersecret";

  beforeAll(async () => {
    mkdirSync(projectRoot, { recursive: true });
    server = await startServer({ port: 0, projectRoot, password });
    port = server.port;
  });

  afterAll(async () => {
    await server.stop();
  });

  it("rejects unauthenticated requests with 401", async () => {
    const res = await httpRequest(port, "GET", "/api/health");
    expect(res.status).toBe(401);
  });

  it("accepts requests with valid Basic credentials", async () => {
    const encoded = Buffer.from(`dantecode:${password}`).toString("base64");
    const res = await httpRequest(port, "GET", "/api/health", undefined, {
      Authorization: `Basic ${encoded}`,
    });
    expect(res.status).toBe(200);
    expect(res.body["status"]).toBe("ok");
  });

  it("rejects requests with wrong password", async () => {
    const encoded = Buffer.from("dantecode:wrongpassword").toString("base64");
    const res = await httpRequest(port, "GET", "/api/health", undefined, {
      Authorization: `Basic ${encoded}`,
    });
    expect(res.status).toBe(401);
  });
});
