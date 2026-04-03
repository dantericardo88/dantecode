// ============================================================================
// @dantecode/mcp — Tool Bridge Tests
// ============================================================================

import { describe, it, expect } from "vitest";
import { mcpToolToZodSchema, mcpToolsToAISDKTools, parseMCPToolName } from "./tool-bridge.js";
import type { MCPToolDefinition } from "@dantecode/config-types";

describe("Tool Bridge", () => {
  describe("mcpToolToZodSchema", () => {
    it("converts a simple string-param tool", () => {
      const tool: MCPToolDefinition = {
        name: "readFile",
        description: "Read a file",
        inputSchema: {
          type: "object",
          properties: {
            path: { type: "string", description: "File path" },
          },
          required: ["path"],
        },
        serverName: "fs",
      };
      const schema = mcpToolToZodSchema(tool);
      expect(schema.description).toBe("Read a file");
      // Verify the Zod schema can parse valid input
      const result = schema.parameters.safeParse({ path: "/tmp/test.txt" });
      expect(result.success).toBe(true);
    });

    it("converts a tool with number and boolean params", () => {
      const tool: MCPToolDefinition = {
        name: "search",
        description: "Search for text",
        inputSchema: {
          type: "object",
          properties: {
            query: { type: "string" },
            limit: { type: "integer" },
            caseSensitive: { type: "boolean" },
          },
          required: ["query"],
        },
        serverName: "search-server",
      };
      const schema = mcpToolToZodSchema(tool);
      const result = schema.parameters.safeParse({
        query: "hello",
        limit: 10,
        caseSensitive: true,
      });
      expect(result.success).toBe(true);
    });

    it("converts a tool with array param", () => {
      const tool: MCPToolDefinition = {
        name: "batch",
        description: "Batch operation",
        inputSchema: {
          type: "object",
          properties: {
            files: { type: "array", items: { type: "string" } },
          },
          required: ["files"],
        },
        serverName: "batch-server",
      };
      const schema = mcpToolToZodSchema(tool);
      const result = schema.parameters.safeParse({ files: ["a.txt", "b.txt"] });
      expect(result.success).toBe(true);
    });

    it("converts a tool with enum param", () => {
      const tool: MCPToolDefinition = {
        name: "format",
        description: "Format code",
        inputSchema: {
          type: "object",
          properties: {
            style: { type: "string", enum: ["prettier", "eslint", "biome"] },
          },
          required: ["style"],
        },
        serverName: "fmt",
      };
      const schema = mcpToolToZodSchema(tool);
      const result = schema.parameters.safeParse({ style: "prettier" });
      expect(result.success).toBe(true);
      const invalid = schema.parameters.safeParse({ style: "unknown" });
      expect(invalid.success).toBe(false);
    });

    it("handles empty inputSchema gracefully", () => {
      const tool: MCPToolDefinition = {
        name: "ping",
        description: "Ping",
        inputSchema: {},
        serverName: "test",
      };
      const schema = mcpToolToZodSchema(tool);
      expect(schema.description).toBe("Ping");
    });

    it("uses fallback description for empty description", () => {
      const tool: MCPToolDefinition = {
        name: "noDesc",
        description: "",
        inputSchema: { type: "object", properties: {} },
        serverName: "srv",
      };
      const schema = mcpToolToZodSchema(tool);
      expect(schema.description).toContain("MCP tool");
    });
  });

  describe("mcpToolsToAISDKTools", () => {
    it("converts multiple tools with mcp_ prefix", () => {
      const tools: MCPToolDefinition[] = [
        {
          name: "readFile",
          description: "Read",
          inputSchema: { type: "object", properties: { path: { type: "string" } } },
          serverName: "fs",
        },
        {
          name: "writeFile",
          description: "Write",
          inputSchema: { type: "object", properties: { path: { type: "string" } } },
          serverName: "fs",
        },
      ];
      const result = mcpToolsToAISDKTools(tools);
      expect(Object.keys(result)).toEqual(["mcp_fs_readFile", "mcp_fs_writeFile"]);
    });

    it("returns empty object for empty input", () => {
      expect(mcpToolsToAISDKTools([])).toEqual({});
    });
  });

  describe("parseMCPToolName", () => {
    it("parses valid MCP tool name", () => {
      expect(parseMCPToolName("mcp_fs_readFile")).toEqual({
        serverName: "fs",
        toolName: "readFile",
      });
    });

    it("handles server name with no underscores", () => {
      expect(parseMCPToolName("mcp_myserver_myTool")).toEqual({
        serverName: "myserver",
        toolName: "myTool",
      });
    });

    it("handles tool name with underscores", () => {
      expect(parseMCPToolName("mcp_srv_my_complex_tool")).toEqual({
        serverName: "srv",
        toolName: "my_complex_tool",
      });
    });

    it("returns null for non-MCP name", () => {
      expect(parseMCPToolName("Read")).toBeNull();
      expect(parseMCPToolName("Bash")).toBeNull();
    });

    it("returns null for malformed MCP name", () => {
      expect(parseMCPToolName("mcp_")).toBeNull();
      expect(parseMCPToolName("mcp_nounderscore")).toBeNull();
    });
  });
});
