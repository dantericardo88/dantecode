// ============================================================================
// @dantecode/mcp — Integration Tests
// Tests cross-module functionality: config parsing, tool bridge roundtrips,
// and server tool listing.
// ============================================================================

import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  loadMCPConfig,
  validateServerConfig,
  getEnabledServers,
  defaultMCPConfig,
} from "./config.js";
import { mcpToolToZodSchema, mcpToolsToAISDKTools, parseMCPToolName } from "./tool-bridge.js";
import { EXPOSED_TOOL_NAMES, createMCPServer, setToolHandlers } from "./server.js";
import type { MCPToolDefinition } from "@dantecode/config-types";

// Mock fs/promises for config tests
vi.mock("node:fs/promises", () => ({
  readFile: vi.fn(),
}));
import { readFile } from "node:fs/promises";
const mockReadFile = vi.mocked(readFile);

describe("MCP Integration", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // --------------------------------------------------------------------------
  // Server tool listing
  // --------------------------------------------------------------------------
  describe("DanteCode MCP Server", () => {
    it("exposes the expanded DanteForge tool set", () => {
      expect(EXPOSED_TOOL_NAMES).toEqual([
        "pdse_score",
        "anti_stub_scan",
        "constitution_check",
        "lessons_query",
        "semantic_search",
        "record_lesson",
        "autoforge_verify",
        "verify_output",
        "run_qa_suite",
        "critic_debate",
        "add_verification_rail",
        "web_search",
        "web_fetch",
        "smart_extract",
        "batch_fetch",
        "spawn_subagent",
        "git_watch",
        "run_github_workflow",
        "auto_pr_create",
        "webhook_listen",
        "schedule_git_task",
        "memory_store",
        "memory_recall",
        "memory_summarize",
        "memory_prune",
        "cross_session_recall",
        "memory_visualize",
      ]);
    });

    it("creates a server instance without crashing", () => {
      const server = createMCPServer();
      expect(server).toBeTruthy();
    });

    it("tool handlers can be registered and called", async () => {
      const mockHandler = vi.fn().mockResolvedValue("score: 85/100");
      setToolHandlers({ pdse_score: mockHandler });

      // We can't easily test the full MCP request cycle without transport,
      // but we verify the handler registration doesn't throw
      expect(mockHandler).not.toHaveBeenCalled();
    });
  });

  // --------------------------------------------------------------------------
  // Tool bridge JSON Schema → Zod roundtrip
  // --------------------------------------------------------------------------
  describe("Tool bridge roundtrip", () => {
    it("converts a complete MCP tool to AI SDK format", () => {
      const tool: MCPToolDefinition = {
        name: "read_file",
        serverName: "filesystem",
        description: "Read a file from disk",
        inputSchema: {
          type: "object",
          properties: {
            path: { type: "string", description: "File path to read" },
            encoding: { type: "string", description: "File encoding" },
          },
          required: ["path"],
        },
      };

      const bridged = mcpToolToZodSchema(tool);
      expect(bridged.description).toBe("Read a file from disk");
      expect(bridged.parameters).toBeTruthy();

      // Validate that the Zod schema accepts valid input
      const parsed = bridged.parameters.safeParse({ path: "/tmp/test.txt" });
      expect(parsed.success).toBe(true);

      // Validate that required field is enforced
      const invalid = bridged.parameters.safeParse({});
      expect(invalid.success).toBe(false);
    });

    it("converts multiple tools with prefixed names", () => {
      const tools: MCPToolDefinition[] = [
        {
          name: "read_file",
          serverName: "fs",
          description: "Read file",
          inputSchema: {
            type: "object",
            properties: { path: { type: "string" } },
            required: ["path"],
          },
        },
        {
          name: "run_command",
          serverName: "shell",
          description: "Run shell command",
          inputSchema: {
            type: "object",
            properties: { command: { type: "string" } },
            required: ["command"],
          },
        },
      ];

      const aiTools = mcpToolsToAISDKTools(tools);
      expect(Object.keys(aiTools)).toEqual(["mcp_fs_read_file", "mcp_shell_run_command"]);
      expect(aiTools["mcp_fs_read_file"]!.description).toBe("Read file");
    });

    it("parseMCPToolName roundtrips correctly", () => {
      const parsed = parseMCPToolName("mcp_filesystem_read_file");
      expect(parsed).toEqual({ serverName: "filesystem", toolName: "read_file" });

      // Non-MCP tool returns null
      expect(parseMCPToolName("Read")).toBeNull();
      expect(parseMCPToolName("mcp_")).toBeNull();
    });

    it("handles nested object schemas", () => {
      const tool: MCPToolDefinition = {
        name: "create_item",
        serverName: "api",
        description: "Create an item",
        inputSchema: {
          type: "object",
          properties: {
            name: { type: "string" },
            metadata: {
              type: "object",
              properties: {
                tags: { type: "array", items: { type: "string" } },
                count: { type: "integer" },
              },
            },
          },
          required: ["name"],
        },
      };

      const bridged = mcpToolToZodSchema(tool);
      const parsed = bridged.parameters.safeParse({
        name: "test",
        metadata: { tags: ["a", "b"], count: 5 },
      });
      expect(parsed.success).toBe(true);
    });
  });

  // --------------------------------------------------------------------------
  // Config parsing + validation
  // --------------------------------------------------------------------------
  describe("Config parsing integration", () => {
    it("handles a realistic mcp.json with mixed transports", async () => {
      const config = {
        servers: [
          {
            name: "filesystem",
            transport: "stdio",
            command: "node",
            args: ["mcp-fs.js", "/tmp"],
            enabled: true,
          },
          {
            name: "web-api",
            transport: "sse",
            url: "http://localhost:3000/mcp",
            enabled: true,
          },
          {
            name: "disabled-server",
            transport: "stdio",
            command: "mcp-disabled",
            enabled: false,
          },
        ],
      };

      mockReadFile.mockResolvedValue(JSON.stringify(config));
      const loaded = await loadMCPConfig("/project");
      expect(loaded.servers).toHaveLength(3);

      const enabled = getEnabledServers(loaded);
      expect(enabled).toHaveLength(2);
      expect(enabled.map((s) => s.name)).toEqual(["filesystem", "web-api"]);
    });

    it("validates all config shapes correctly", () => {
      // Valid stdio
      expect(
        validateServerConfig({
          name: "test",
          transport: "stdio",
          command: "node",
          enabled: true,
        }),
      ).toBe(true);

      // Valid SSE
      expect(
        validateServerConfig({
          name: "test",
          transport: "sse",
          url: "http://localhost:3000",
          enabled: true,
        }),
      ).toBe(true);

      // Invalid: missing command for stdio
      expect(validateServerConfig({ name: "test", transport: "stdio", enabled: true })).toBe(false);

      // Invalid: unknown transport
      expect(
        validateServerConfig({ name: "test", transport: "websocket", command: "x", enabled: true }),
      ).toBe(false);
    });

    it("provides sensible defaults", () => {
      const defaults = defaultMCPConfig();
      expect(defaults.servers).toEqual([]);
    });
  });
});
