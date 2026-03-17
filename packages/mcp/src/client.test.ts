// ============================================================================
// @dantecode/mcp — MCP Client Tests
// ============================================================================

import { describe, it, expect, vi, beforeEach } from "vitest";
import { MCPClientManager } from "./client.js";
import type { MCPConfig } from "@dantecode/config-types";

// Mock the MCP SDK transports and client
const mockConnect = vi.fn();
const mockClose = vi.fn();
const mockListTools = vi.fn();
const mockCallTool = vi.fn();

vi.mock("@modelcontextprotocol/sdk/client/index.js", () => ({
  Client: vi.fn().mockImplementation(() => ({
    connect: mockConnect,
    close: mockClose,
    listTools: mockListTools,
    callTool: mockCallTool,
  })),
}));

vi.mock("@modelcontextprotocol/sdk/client/stdio.js", () => ({
  StdioClientTransport: vi.fn(),
}));

vi.mock("@modelcontextprotocol/sdk/client/sse.js", () => ({
  SSEClientTransport: vi.fn(),
}));

describe("MCPClientManager", () => {
  let manager: MCPClientManager;

  beforeEach(() => {
    vi.clearAllMocks();
    manager = new MCPClientManager();
    mockListTools.mockResolvedValue({
      tools: [
        {
          name: "readFile",
          description: "Read a file",
          inputSchema: { type: "object", properties: { path: { type: "string" } } },
        },
      ],
    });
  });

  describe("connectAll", () => {
    it("connects to enabled servers", async () => {
      const config: MCPConfig = {
        servers: [
          { name: "fs", transport: "stdio", command: "mcp-fs", enabled: true },
          { name: "disabled", transport: "stdio", command: "other", enabled: false },
        ],
      };
      await manager.connectAll(config);
      expect(mockConnect).toHaveBeenCalledTimes(1);
      expect(manager.getConnectedServers()).toEqual(["fs"]);
    });

    it("handles connection failures gracefully", async () => {
      mockConnect.mockRejectedValueOnce(new Error("connection refused"));
      const config: MCPConfig = {
        servers: [{ name: "bad", transport: "stdio", command: "bad", enabled: true }],
      };
      // Should not throw
      await manager.connectAll(config);
      expect(manager.getConnectedServers()).toEqual([]);
    });

    it("skips disabled servers", async () => {
      const config: MCPConfig = {
        servers: [
          { name: "off", transport: "stdio", command: "cmd", enabled: false },
        ],
      };
      await manager.connectAll(config);
      expect(mockConnect).not.toHaveBeenCalled();
    });
  });

  describe("listTools", () => {
    it("lists tools from all connected servers", async () => {
      const config: MCPConfig = {
        servers: [{ name: "fs", transport: "stdio", command: "cmd", enabled: true }],
      };
      await manager.connectAll(config);
      const tools = manager.listTools();
      expect(tools).toHaveLength(1);
      expect(tools[0]!.name).toBe("readFile");
      expect(tools[0]!.serverName).toBe("fs");
    });

    it("returns empty when no servers connected", () => {
      expect(manager.listTools()).toEqual([]);
    });
  });

  describe("findToolServer", () => {
    it("finds the server providing a tool", async () => {
      const config: MCPConfig = {
        servers: [{ name: "fs", transport: "stdio", command: "cmd", enabled: true }],
      };
      await manager.connectAll(config);
      expect(manager.findToolServer("readFile")).toBe("fs");
    });

    it("returns null for unknown tool", async () => {
      const config: MCPConfig = {
        servers: [{ name: "fs", transport: "stdio", command: "cmd", enabled: true }],
      };
      await manager.connectAll(config);
      expect(manager.findToolServer("unknown")).toBeNull();
    });
  });

  describe("callTool", () => {
    it("calls tool on the specified server", async () => {
      mockCallTool.mockResolvedValue({
        content: [{ type: "text", text: "file content here" }],
      });
      const config: MCPConfig = {
        servers: [{ name: "fs", transport: "stdio", command: "cmd", enabled: true }],
      };
      await manager.connectAll(config);
      const result = await manager.callTool("fs", "readFile", { path: "/tmp/test" });
      expect(result).toBe("file content here");
      expect(mockCallTool).toHaveBeenCalledWith({ name: "readFile", arguments: { path: "/tmp/test" } });
    });

    it("throws for disconnected server", async () => {
      await expect(manager.callTool("unknown", "tool", {})).rejects.toThrow(
        'MCP server "unknown" not connected',
      );
    });
  });

  describe("callToolByName", () => {
    it("auto-routes to correct server", async () => {
      mockCallTool.mockResolvedValue({
        content: [{ type: "text", text: "ok" }],
      });
      const config: MCPConfig = {
        servers: [{ name: "fs", transport: "stdio", command: "cmd", enabled: true }],
      };
      await manager.connectAll(config);
      const result = await manager.callToolByName("readFile", { path: "/test" });
      expect(result).toBe("ok");
    });

    it("throws when no server provides the tool", async () => {
      await expect(manager.callToolByName("noSuchTool", {})).rejects.toThrow(
        'No MCP server provides tool "noSuchTool"',
      );
    });
  });

  describe("disconnectAll", () => {
    it("closes all connections and clears state", async () => {
      const config: MCPConfig = {
        servers: [{ name: "fs", transport: "stdio", command: "cmd", enabled: true }],
      };
      await manager.connectAll(config);
      expect(manager.isConnected()).toBe(true);
      await manager.disconnectAll();
      expect(manager.isConnected()).toBe(false);
      expect(manager.getConnectedServers()).toEqual([]);
    });

    it("handles close errors gracefully", async () => {
      mockClose.mockRejectedValue(new Error("close failed"));
      const config: MCPConfig = {
        servers: [{ name: "fs", transport: "stdio", command: "cmd", enabled: true }],
      };
      await manager.connectAll(config);
      await manager.disconnectAll(); // Should not throw
      expect(manager.isConnected()).toBe(false);
    });
  });

  describe("isConnected", () => {
    it("returns false when no servers connected", () => {
      expect(manager.isConnected()).toBe(false);
    });
  });
});
