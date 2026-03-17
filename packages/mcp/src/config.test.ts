// ============================================================================
// @dantecode/mcp — MCP Config Tests
// ============================================================================

import { describe, it, expect, vi, beforeEach } from "vitest";
import { loadMCPConfig, validateServerConfig, getEnabledServers, defaultMCPConfig } from "./config.js";
import type { MCPConfig } from "@dantecode/config-types";

// Mock fs/promises
vi.mock("node:fs/promises", () => ({
  readFile: vi.fn(),
}));

import { readFile } from "node:fs/promises";
const mockReadFile = vi.mocked(readFile);

describe("MCP Config", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("defaultMCPConfig", () => {
    it("returns empty servers array", () => {
      const config = defaultMCPConfig();
      expect(config.servers).toEqual([]);
    });
  });

  describe("validateServerConfig", () => {
    it("accepts valid stdio config", () => {
      expect(
        validateServerConfig({
          name: "test-server",
          transport: "stdio",
          command: "node",
          args: ["server.js"],
          enabled: true,
        }),
      ).toBe(true);
    });

    it("accepts valid sse config", () => {
      expect(
        validateServerConfig({
          name: "test-sse",
          transport: "sse",
          url: "http://localhost:3000",
          enabled: true,
        }),
      ).toBe(true);
    });

    it("rejects null/undefined", () => {
      expect(validateServerConfig(null)).toBe(false);
      expect(validateServerConfig(undefined)).toBe(false);
    });

    it("rejects missing name", () => {
      expect(
        validateServerConfig({ transport: "stdio", command: "node", enabled: true }),
      ).toBe(false);
    });

    it("rejects empty name", () => {
      expect(
        validateServerConfig({ name: "", transport: "stdio", command: "node", enabled: true }),
      ).toBe(false);
    });

    it("rejects invalid transport", () => {
      expect(
        validateServerConfig({ name: "test", transport: "ws", command: "node", enabled: true }),
      ).toBe(false);
    });

    it("rejects stdio without command", () => {
      expect(
        validateServerConfig({ name: "test", transport: "stdio", enabled: true }),
      ).toBe(false);
    });

    it("rejects sse without url", () => {
      expect(
        validateServerConfig({ name: "test", transport: "sse", enabled: true }),
      ).toBe(false);
    });

    it("rejects missing enabled field", () => {
      expect(
        validateServerConfig({ name: "test", transport: "stdio", command: "node" }),
      ).toBe(false);
    });
  });

  describe("loadMCPConfig", () => {
    it("returns default config when file does not exist", async () => {
      mockReadFile.mockRejectedValue(new Error("ENOENT"));
      const config = await loadMCPConfig("/project");
      expect(config.servers).toEqual([]);
    });

    it("parses valid config", async () => {
      mockReadFile.mockResolvedValue(
        JSON.stringify({
          servers: [
            { name: "fs", transport: "stdio", command: "mcp-fs", args: ["/tmp"], enabled: true },
            { name: "api", transport: "sse", url: "http://localhost:8080", enabled: false },
          ],
        }),
      );
      const config = await loadMCPConfig("/project");
      expect(config.servers).toHaveLength(2);
      expect(config.servers[0]!.name).toBe("fs");
      expect(config.servers[1]!.enabled).toBe(false);
    });

    it("throws on invalid JSON", async () => {
      mockReadFile.mockResolvedValue("not json {{{");
      await expect(loadMCPConfig("/project")).rejects.toThrow("Invalid JSON");
    });

    it("throws on missing servers array", async () => {
      mockReadFile.mockResolvedValue(JSON.stringify({ notServers: [] }));
      await expect(loadMCPConfig("/project")).rejects.toThrow("Invalid MCP config");
    });

    it("throws on invalid server entry", async () => {
      mockReadFile.mockResolvedValue(
        JSON.stringify({ servers: [{ name: "test" }] }),
      );
      await expect(loadMCPConfig("/project")).rejects.toThrow("Invalid MCP server config at index 0");
    });
  });

  describe("getEnabledServers", () => {
    it("filters to only enabled servers", () => {
      const config: MCPConfig = {
        servers: [
          { name: "a", transport: "stdio", command: "cmd", enabled: true },
          { name: "b", transport: "sse", url: "http://x", enabled: false },
          { name: "c", transport: "stdio", command: "cmd2", enabled: true },
        ],
      };
      const enabled = getEnabledServers(config);
      expect(enabled).toHaveLength(2);
      expect(enabled.map((s) => s.name)).toEqual(["a", "c"]);
    });

    it("returns empty for no enabled servers", () => {
      const config: MCPConfig = {
        servers: [{ name: "a", transport: "stdio", command: "cmd", enabled: false }],
      };
      expect(getEnabledServers(config)).toHaveLength(0);
    });
  });
});
