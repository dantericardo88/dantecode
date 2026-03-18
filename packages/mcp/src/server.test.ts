// ============================================================================
// @dantecode/mcp — MCP Server Tests
// ============================================================================

import { describe, it, expect, vi, beforeEach } from "vitest";
import { createMCPServer, setToolHandlers, EXPOSED_TOOL_NAMES } from "./server.js";

// Mock the MCP SDK
vi.mock("@modelcontextprotocol/sdk/server/index.js", () => {
  const handlers = new Map<string, (...args: unknown[]) => unknown>();
  return {
    Server: vi.fn().mockImplementation(() => ({
      setRequestHandler: vi.fn(
        (schema: { method: string }, handler: (...args: unknown[]) => unknown) => {
          handlers.set(schema.method, handler);
        },
      ),
      connect: vi.fn(),
      close: vi.fn(),
      _handlers: handlers,
    })),
  };
});

vi.mock("@modelcontextprotocol/sdk/server/stdio.js", () => ({
  StdioServerTransport: vi.fn(),
}));

vi.mock("@modelcontextprotocol/sdk/types.js", () => ({
  CallToolRequestSchema: { method: "tools/call" },
  ListToolsRequestSchema: { method: "tools/list" },
}));

describe("MCP Server", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setToolHandlers({});
  });

  describe("EXPOSED_TOOL_NAMES", () => {
    it("exposes the correct DanteForge tools", () => {
      expect(EXPOSED_TOOL_NAMES).toContain("pdse_score");
      expect(EXPOSED_TOOL_NAMES).toContain("anti_stub_scan");
      expect(EXPOSED_TOOL_NAMES).toContain("constitution_check");
      expect(EXPOSED_TOOL_NAMES).toContain("lessons_query");
      expect(EXPOSED_TOOL_NAMES).toContain("semantic_search");
      expect(EXPOSED_TOOL_NAMES).toContain("record_lesson");
      expect(EXPOSED_TOOL_NAMES).toContain("autoforge_verify");
      expect(EXPOSED_TOOL_NAMES).toHaveLength(7);
    });
  });

  describe("createMCPServer", () => {
    it("creates a server with tools/list and tools/call handlers", () => {
      const server = createMCPServer();
      expect(server.setRequestHandler).toHaveBeenCalledTimes(2);
    });

    it("tools/list returns all DanteForge tools", async () => {
      const server = createMCPServer();
      const handlers = (
        server as unknown as { _handlers: Map<string, (...args: unknown[]) => unknown> }
      )._handlers;
      const listHandler = handlers.get("tools/list")!;
      const result = (await listHandler()) as { tools: Array<{ name: string }> };
      const toolNames = result.tools.map((t) => t.name);
      expect(toolNames).toEqual(EXPOSED_TOOL_NAMES);
    });

    it("tools/call dispatches to registered handler", async () => {
      const mockHandler = vi.fn().mockResolvedValue("score: 85");
      setToolHandlers({ pdse_score: mockHandler });

      const server = createMCPServer();
      const handlers = (
        server as unknown as { _handlers: Map<string, (...args: unknown[]) => unknown> }
      )._handlers;
      const callHandler = handlers.get("tools/call")!;

      const result = (await callHandler({
        params: { name: "pdse_score", arguments: { code: "const x = 1;" } },
      })) as { content: Array<{ text: string }> };

      expect(mockHandler).toHaveBeenCalledWith({ code: "const x = 1;" });
      expect(result.content[0]!.text).toBe("score: 85");
    });

    it("dispatches newly exposed tools through the same handler registry", async () => {
      const mockHandler = vi.fn().mockResolvedValue("verification passed");
      setToolHandlers({ autoforge_verify: mockHandler });

      const server = createMCPServer();
      const handlers = (
        server as unknown as { _handlers: Map<string, (...args: unknown[]) => unknown> }
      )._handlers;
      const callHandler = handlers.get("tools/call")!;

      const result = (await callHandler({
        params: { name: "autoforge_verify", arguments: { projectRoot: "/repo" } },
      })) as { content: Array<{ text: string }> };

      expect(mockHandler).toHaveBeenCalledWith({ projectRoot: "/repo" });
      expect(result.content[0]!.text).toBe("verification passed");
    });

    it("tools/call returns error for unknown tool", async () => {
      const server = createMCPServer();
      const handlers = (
        server as unknown as { _handlers: Map<string, (...args: unknown[]) => unknown> }
      )._handlers;
      const callHandler = handlers.get("tools/call")!;

      const result = (await callHandler({
        params: { name: "unknown_tool", arguments: {} },
      })) as { content: Array<{ text: string }>; isError: boolean };

      expect(result.isError).toBe(true);
      expect(result.content[0]!.text).toContain("Unknown tool");
    });

    it("tools/call handles handler errors gracefully", async () => {
      setToolHandlers({
        pdse_score: vi.fn().mockRejectedValue(new Error("scoring failed")),
      });

      const server = createMCPServer();
      const handlers = (
        server as unknown as { _handlers: Map<string, (...args: unknown[]) => unknown> }
      )._handlers;
      const callHandler = handlers.get("tools/call")!;

      const result = (await callHandler({
        params: { name: "pdse_score", arguments: {} },
      })) as { content: Array<{ text: string }>; isError: boolean };

      expect(result.isError).toBe(true);
      expect(result.content[0]!.text).toContain("scoring failed");
    });
  });
});
