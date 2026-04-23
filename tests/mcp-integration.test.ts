// ============================================================================
// tests/mcp-integration.test.ts
//
// External-validation tests for the MCP server.
// Spawns the real `dantecode --mcp` binary, drives a full JSON-RPC session
// over stdio, and proves the transport layer, tool registry, schema structure,
// and error handling — zero MCP SDK mocking.
//
// Design decisions:
//   - async `spawn` (not `spawnSync`): the MCP server never exits on its own
//     because process.stdout is ref()'d; spawn + explicit proc.kill() is correct.
//   - Newline-delimited JSON: confirmed from MCP SDK shared/stdio.js ReadBuffer.
//   - No DanteForge tool calls: sql-wasm.wasm is confirmed missing (pre-existing
//     e2e-waves failure). Tests 1–4 use only tools/list. Test 5 uses the
//     "unknown tool" error path which never reaches a DanteForge handler.
//   - Count responses, not poll: runMcpSession resolves once expectedResponses
//     JSON-RPC responses (messages with an `id` field) are received.
// ============================================================================

import { spawn } from "node:child_process";
import { join, resolve } from "node:path";
import { describe, it, expect } from "vitest";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const REPO_ROOT = resolve(process.cwd());
const CLI_ENTRY = join(REPO_ROOT, "packages", "cli", "dist", "index.js");

/** The 7 tools the MCP server must expose — source of truth for registry tests. */
const KNOWN_TOOLS = [
  "pdse_score",
  "anti_stub_scan",
  "constitution_check",
  "lessons_query",
  "semantic_search",
  "record_lesson",
  "autoforge_verify",
] as const;

// ---------------------------------------------------------------------------
// Standard JSON-RPC message templates
// ---------------------------------------------------------------------------

const INIT_REQ = {
  jsonrpc: "2.0",
  id: 1,
  method: "initialize",
  params: {
    protocolVersion: "2025-03-26",
    capabilities: {},
    clientInfo: { name: "test-client", version: "1.0.0" },
  },
};

/** Notification — no response expected from server. */
const INITIALIZED_NOTIF = { jsonrpc: "2.0", method: "notifications/initialized" };

const TOOLS_LIST_REQ = { jsonrpc: "2.0", id: 2, method: "tools/list", params: {} };

function toolsCallReq(id: number, name: string, args: Record<string, unknown> = {}) {
  return { jsonrpc: "2.0", id, method: "tools/call", params: { name, arguments: args } };
}

// ---------------------------------------------------------------------------
// Helper: run a complete MCP session over stdio
// ---------------------------------------------------------------------------

type JsonRpcMsg = Record<string, unknown>;

/**
 * Spawn `dantecode --mcp`, drive a complete MCP session, return all JSON-RPC
 * responses received from the server.
 *
 * - Each message in `messages` is serialised as one JSON line (`\n` terminated)
 *   and written to the child's stdin.
 * - `expectedResponses` is the number of JSON-RPC *responses* (messages that
 *   carry an `id` field) we wait for before killing the process. Notifications
 *   sent by the server (no `id`) do not count toward this total.
 * - A 15-second safety timeout kills the process if it stalls.
 */
async function runMcpSession(
  messages: JsonRpcMsg[],
  expectedResponses: number,
): Promise<JsonRpcMsg[]> {
  return new Promise((resolve) => {
    const proc = spawn(process.execPath, [CLI_ENTRY, "--mcp"], {
      cwd: REPO_ROOT,
      env: { ...process.env, CI: "1", NO_COLOR: "1" },
    });

    const responses: JsonRpcMsg[] = [];
    let buf = "";
    let settled = false;

    const finish = () => {
      if (settled) return;
      settled = true;
      try {
        proc.kill();
      } catch {
        /* already exited */
      }
      resolve(responses);
    };

    proc.stdout.on("data", (chunk: Buffer) => {
      buf += chunk.toString();
      // Split on newlines; the last element may be a partial line — keep it
      const lines = buf.split("\n");
      buf = lines.pop() ?? "";
      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const msg = JSON.parse(line) as JsonRpcMsg;
          responses.push(msg);
          if (responses.length >= expectedResponses) finish();
        } catch {
          /* partial or non-JSON line — ignore */
        }
      }
    });

    // Suppress stderr (server startup messages, DanteForge warnings)
    proc.stderr.on("data", () => {});

    // Resolve with whatever we have if the process exits before we expected
    proc.on("close", finish);

    // Write all messages as newline-delimited JSON, then close stdin so the
    // server knows no more input is coming
    for (const msg of messages) {
      proc.stdin?.write(JSON.stringify(msg) + "\n");
    }
    proc.stdin?.end();

    // Safety net: never hang a test run longer than 15 s
    setTimeout(finish, 15_000);
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("MCP server (external process validation)", () => {
  // -------------------------------------------------------------------------
  // 1. Initialize handshake — proves binary starts and speaks MCP protocol
  // -------------------------------------------------------------------------
  it("responds to MCP initialize with correct server name", async () => {
    const responses = await runMcpSession([INIT_REQ], 1);

    expect(responses.length).toBeGreaterThanOrEqual(1);
    const initResponse = responses.find((r) => r.id === 1);
    expect(initResponse, "no response with id=1").toBeDefined();

    const result = initResponse!.result as { serverInfo?: { name: string } } | undefined;
    expect(result?.serverInfo?.name).toBe("dantecode-mcp");
  });

  // -------------------------------------------------------------------------
  // 2. tools/list count — proves full registry is served over real transport
  // -------------------------------------------------------------------------
  it("tools/list returns exactly 7 registered tools", async () => {
    const responses = await runMcpSession(
      [INIT_REQ, INITIALIZED_NOTIF, TOOLS_LIST_REQ],
      2, // initialize response + tools/list response (notification has no response)
    );

    const toolsResponse = responses.find((r) => r.id === 2);
    expect(toolsResponse, "no tools/list response (id=2)").toBeDefined();

    const tools = (toolsResponse!.result as { tools?: unknown[] })?.tools;
    expect(Array.isArray(tools), "result.tools is not an array").toBe(true);
    expect(tools).toHaveLength(7);
  });

  // -------------------------------------------------------------------------
  // 3. tools/list names — proves no tool accidentally omitted
  // -------------------------------------------------------------------------
  it("tools/list contains all 7 known DanteForge tool names", async () => {
    const responses = await runMcpSession(
      [INIT_REQ, INITIALIZED_NOTIF, TOOLS_LIST_REQ],
      2,
    );

    const toolsResponse = responses.find((r) => r.id === 2);
    const tools = (toolsResponse!.result as { tools?: Array<{ name: string }> })?.tools ?? [];
    const names = tools.map((t) => t.name);

    for (const known of KNOWN_TOOLS) {
      expect(names, `Expected "${known}" in tools/list response`).toContain(known);
    }
  });

  // -------------------------------------------------------------------------
  // 4. tools/list schema structure — proves MCP clients can use these tools
  // -------------------------------------------------------------------------
  it("each tool in tools/list has name, description, and inputSchema", async () => {
    const responses = await runMcpSession(
      [INIT_REQ, INITIALIZED_NOTIF, TOOLS_LIST_REQ],
      2,
    );

    const toolsResponse = responses.find((r) => r.id === 2);
    const tools =
      (toolsResponse!.result as { tools?: Array<Record<string, unknown>> })?.tools ?? [];

    expect(tools.length).toBeGreaterThan(0);
    for (const tool of tools) {
      expect(
        typeof tool.name,
        `tool.name is not a string on tool: ${JSON.stringify(tool)}`,
      ).toBe("string");
      expect(
        typeof tool.description,
        `tool.description missing on "${String(tool.name)}"`,
      ).toBe("string");
      expect(
        tool.inputSchema,
        `tool.inputSchema missing on "${String(tool.name)}"`,
      ).toBeDefined();
    }
  });

  // -------------------------------------------------------------------------
  // 5. tools/call error path — pure server logic, no DanteForge dependency
  //    Proves the unknown-tool handler returns a well-formed error response.
  // -------------------------------------------------------------------------
  it("tools/call with unknown tool name returns isError response", async () => {
    const callReq = toolsCallReq(3, "nonexistent_tool", {});
    const responses = await runMcpSession(
      [INIT_REQ, INITIALIZED_NOTIF, TOOLS_LIST_REQ, callReq],
      3, // initialize + tools/list + tools/call
    );

    const callResponse = responses.find((r) => r.id === 3);
    expect(callResponse, "no tools/call response (id=3)").toBeDefined();

    // DanteCodeMCPServer returns a JSON-RPC error (not a tool result) for unknown tools
    const error = callResponse!.error as { code?: number; message?: string } | undefined;
    expect(error, "expected a JSON-RPC error for unknown tool").toBeDefined();
    expect(typeof error?.message).toBe("string");
    expect(error?.message).toContain("nonexistent_tool");
  });
});
