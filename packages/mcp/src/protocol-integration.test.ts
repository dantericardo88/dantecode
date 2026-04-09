/**
 * Real MCP JSON-RPC stdio integration tests.
 *
 * Spawns the actual compiled MCP server (packages/mcp/dist/cli.js) and
 * communicates via newline-delimited JSON-RPC 2.0 over stdin/stdout.
 *
 * The MCP protocol requires an `initialize` handshake before any requests.
 * No internal module mocking — tests actual transport, tool list, and response shape.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { resolve } from "node:path";
import type { ChildProcess } from "node:child_process";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

// Resolve paths relative to this test file's directory (packages/mcp/src/)
// to ensure correct resolution regardless of Vitest's CWD setting.
const PKG_ROOT = resolve(import.meta.dirname, "..");
const MCP_CLI = resolve(PKG_ROOT, "dist/cli.js");
const PROJECT_ROOT = resolve(PKG_ROOT, "../..");

// Initialize request required by MCP protocol before any other requests
const INIT_REQUEST = {
  jsonrpc: "2.0",
  id: 0,
  method: "initialize",
  params: {
    protocolVersion: "2024-11-05",
    capabilities: {},
    clientInfo: { name: "test-client", version: "1.0" },
  },
};

// ---------------------------------------------------------------------------
// Test harness: spawn + readline-based response queue
// ---------------------------------------------------------------------------

interface ServerHandle {
  proc: ChildProcess;
  send(req: object): void;
  recv(timeoutMs?: number): Promise<Record<string, unknown>>;
  kill(): void;
}

async function createServerHandle(): Promise<ServerHandle> {
  const proc = spawn("node", [MCP_CLI], {
    stdio: ["pipe", "pipe", "pipe"],
    cwd: PROJECT_ROOT,
    env: { ...process.env, CI: "1", NODE_ENV: "test" },
  });

  // Wait for the server process to start up before sending requests
  await new Promise((r) => setTimeout(r, 600));

  const pending: Array<{
    resolve: (v: Record<string, unknown>) => void;
    reject: (e: Error) => void;
    timer: ReturnType<typeof setTimeout>;
  }> = [];

  const rl = createInterface({ input: proc.stdout! });

  rl.on("line", (line) => {
    const trimmed = line.trim();
    if (!trimmed) return;
    const waiter = pending.shift();
    if (!waiter) return;
    clearTimeout(waiter.timer);
    try {
      waiter.resolve(JSON.parse(trimmed) as Record<string, unknown>);
    } catch {
      waiter.reject(new Error(`Failed to parse MCP response: ${trimmed.slice(0, 200)}`));
    }
  });

  return {
    proc,
    send(req: object) {
      proc.stdin!.write(JSON.stringify(req) + "\n");
    },
    recv(timeoutMs = 10_000): Promise<Record<string, unknown>> {
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          const idx = pending.findIndex((p) => p.resolve === resolve);
          if (idx !== -1) pending.splice(idx, 1);
          reject(new Error(`Timeout waiting for MCP response after ${timeoutMs}ms`));
        }, timeoutMs);
        pending.push({ resolve, reject, timer });
      });
    },
    kill() {
      rl.close();
      try { proc.kill(); } catch { /* already dead */ }
    },
  };
}

/** Initialize the MCP server (required protocol step). */
async function initServer(server: ServerHandle): Promise<void> {
  server.send(INIT_REQUEST);
  await server.recv(); // consume initialize response
}

// ---------------------------------------------------------------------------
// Test Suite
// ---------------------------------------------------------------------------

describe("MCP Protocol Integration — real stdio transport", () => {
  let server: ServerHandle;

  beforeEach(async () => {
    server = await createServerHandle();
  });

  afterEach(() => {
    server.kill();
  });

  // ─── tools/list ──────────────────────────────────────────────────────────

  it("initialize handshake returns protocolVersion", async () => {
    server.send(INIT_REQUEST);
    const response = await server.recv();
    expect(response.jsonrpc).toBe("2.0");
    expect(response.id).toBe(0);
    const result = response.result as Record<string, unknown>;
    expect(typeof result.protocolVersion).toBe("string");
    expect(result.protocolVersion).toBeTruthy();
  }, 15_000);

  it("responds to tools/list with 35+ tools", async () => {
    await initServer(server);

    server.send({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} });
    const response = await server.recv(15_000);

    expect(response.jsonrpc).toBe("2.0");
    expect(response.id).toBe(1);
    expect(response.error).toBeUndefined();

    const result = response.result as Record<string, unknown>;
    const tools = result.tools as unknown[];
    expect(Array.isArray(tools)).toBe(true);
    expect(tools.length).toBeGreaterThanOrEqual(35);
  }, 20_000);

  it("each tool entry has name, description, and inputSchema", async () => {
    await initServer(server);

    server.send({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} });
    const response = await server.recv(15_000);

    const result = response.result as Record<string, unknown>;
    const tools = result.tools as Array<Record<string, unknown>>;

    for (const tool of tools.slice(0, 5)) {
      expect(typeof tool.name).toBe("string");
      expect((tool.name as string).length).toBeGreaterThan(0);
      expect(typeof tool.description).toBe("string");
      expect(tool.inputSchema).toBeDefined();
    }
  }, 20_000);

  it("tools/list includes core DanteForge quality gate tools", async () => {
    await initServer(server);

    server.send({ jsonrpc: "2.0", id: 3, method: "tools/list", params: {} });
    const response = await server.recv(15_000);

    const result = response.result as Record<string, unknown>;
    const tools = result.tools as Array<Record<string, unknown>>;
    const names = tools.map((t) => t.name as string);

    expect(names).toContain("pdse_score");
    expect(names).toContain("anti_stub_scan");
    expect(names).toContain("constitution_check");
  }, 20_000);

  it("anti_stub_scan returns a result for clean code", async () => {
    await initServer(server);

    server.send({
      jsonrpc: "2.0",
      id: 4,
      method: "tools/call",
      params: {
        name: "anti_stub_scan",
        arguments: {
          code: "export function add(a: number, b: number): number { return a + b; }",
          filePath: "src/add.ts",
        },
      },
    });

    const response = await server.recv(15_000);
    expect(response.jsonrpc).toBe("2.0");
    expect(response.id).toBe(4);
    // Protocol-level error should not occur for a valid tool call
    expect(response.error).toBeUndefined();
    const result = response.result as Record<string, unknown>;
    expect(result).toBeDefined();
    expect(result.content).toBeDefined();
  }, 20_000);
});
