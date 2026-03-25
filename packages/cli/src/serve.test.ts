// ============================================================================
// @dantecode/cli — DanteServe OpenAI-compatible handler tests
// Tests the handleHealth, handleModels, and handleChatCompletions exports
// directly, without starting a real HTTP server.
// ============================================================================

import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock @dantecode/core before importing the module under test
vi.mock("@dantecode/core", () => ({
  readOrInitializeState: vi.fn().mockResolvedValue({
    model: {
      default: {
        provider: "grok",
        modelId: "grok-3",
        maxTokens: 4096,
        temperature: 0.1,
        contextWindow: 131072,
        supportsVision: false,
        supportsToolCalls: false,
      },
      fallback: [],
      taskOverrides: {},
    },
  }),
  ModelRouterImpl: vi.fn().mockImplementation(() => ({
    generate: vi.fn().mockResolvedValue("Hello from DanteCode!"),
    stream: vi.fn(),
    getUsage: vi.fn().mockReturnValue({ promptTokens: 0, completionTokens: 0 }),
  })),
}));

import { handleHealth, handleModels, handleChatCompletions } from "./commands/serve.js";
import http from "node:http";
import { Readable } from "node:stream";

// ---------------------------------------------------------------------------
// Mock helpers
// ---------------------------------------------------------------------------

/**
 * Create a minimal mock ServerResponse that captures write/end calls.
 */
function mockRes(): http.ServerResponse & { chunks: string[]; getBody(): string } {
  const chunks: string[] = [];
  const res = {
    writeHead: vi.fn(),
    write: vi.fn((data: string) => {
      chunks.push(data);
    }),
    end: vi.fn((data?: string) => {
      if (data) chunks.push(data);
    }),
    setHeader: vi.fn(),
    chunks,
    getBody(): string {
      return chunks.join("");
    },
  };
  return res as unknown as http.ServerResponse & { chunks: string[]; getBody(): string };
}

/**
 * Create a minimal mock IncomingMessage that emits body data.
 */
function mockReq(method = "GET", body = ""): http.IncomingMessage {
  const req = new Readable({ read() {} }) as unknown as http.IncomingMessage;
  req.method = method;
  req.headers = {};
  // Emit body data on the next tick so listeners are attached first
  if (body) {
    setTimeout(() => {
      req.emit("data", Buffer.from(body));
      req.emit("end");
    }, 0);
  } else {
    setTimeout(() => {
      req.emit("end");
    }, 0);
  }
  return req;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("DanteServe handlers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("handleHealth returns ok:true with version and uptime", () => {
    const req = mockReq();
    const res = mockRes();
    handleHealth(req, res);
    expect(res.writeHead).toHaveBeenCalledWith(
      200,
      expect.objectContaining({ "Content-Type": "application/json" }),
    );
    const body = JSON.parse(res.getBody()) as Record<string, unknown>;
    expect(body["ok"]).toBe(true);
    expect(typeof body["version"]).toBe("string");
    expect(typeof body["uptime"]).toBe("number");
  });

  it("handleModels returns model list with correct structure", () => {
    const req = mockReq();
    const res = mockRes();
    handleModels(req, res, "grok-3");
    const body = JSON.parse(res.getBody()) as Record<string, unknown>;
    expect(body["object"]).toBe("list");
    const data = body["data"] as unknown[];
    expect(data).toHaveLength(1);
    expect((data[0] as Record<string, unknown>)["id"]).toBe("grok-3");
  });

  it("handleChatCompletions returns JSON completion for stream:false", async () => {
    const { ModelRouterImpl } = await import("@dantecode/core");
    const router = new (ModelRouterImpl as ReturnType<typeof vi.fn>)() as {
      generate: ReturnType<typeof vi.fn>;
    };
    const req = mockReq(
      "POST",
      JSON.stringify({
        messages: [{ role: "user", content: "hello" }],
        stream: false,
      }),
    );
    const res = mockRes();
    await handleChatCompletions(
      req,
      res,
      router as unknown as InstanceType<typeof import("@dantecode/core").ModelRouterImpl>,
      "grok-3",
    );
    const body = JSON.parse(res.getBody()) as Record<string, unknown>;
    expect(body["object"]).toBe("chat.completion");
    const choices = body["choices"] as Array<Record<string, unknown>>;
    expect((choices[0]!["message"] as Record<string, unknown>)["content"]).toBe(
      "Hello from DanteCode!",
    );
  });

  it("handleChatCompletions returns 400 for missing messages", async () => {
    const { ModelRouterImpl } = await import("@dantecode/core");
    const router = new (ModelRouterImpl as ReturnType<typeof vi.fn>)() as {
      generate: ReturnType<typeof vi.fn>;
    };
    const req = mockReq("POST", JSON.stringify({ messages: [] }));
    const res = mockRes();
    await handleChatCompletions(
      req,
      res,
      router as unknown as InstanceType<typeof import("@dantecode/core").ModelRouterImpl>,
      "grok-3",
    );
    expect(res.writeHead).toHaveBeenCalledWith(400, expect.anything());
  });

  it("handleChatCompletions sends SSE events for stream:true", async () => {
    const { ModelRouterImpl } = await import("@dantecode/core");
    const router = new (ModelRouterImpl as ReturnType<typeof vi.fn>)() as {
      generate: ReturnType<typeof vi.fn>;
    };
    const req = mockReq(
      "POST",
      JSON.stringify({
        messages: [{ role: "user", content: "hello" }],
        stream: true,
      }),
    );
    const res = mockRes();
    await handleChatCompletions(
      req,
      res,
      router as unknown as InstanceType<typeof import("@dantecode/core").ModelRouterImpl>,
      "grok-3",
    );
    expect(res.writeHead).toHaveBeenCalledWith(
      200,
      expect.objectContaining({ "Content-Type": "text/event-stream" }),
    );
    expect(res.chunks.some((c) => c.includes("data: [DONE]"))).toBe(true);
  });
});
