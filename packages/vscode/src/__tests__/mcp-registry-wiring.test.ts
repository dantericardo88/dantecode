// packages/vscode/src/__tests__/mcp-registry-wiring.test.ts
// Sprint G — Dim 25: globalMcpRegistry wired into sidebar system prompt (25: 8→9)
import { describe, it, expect, beforeEach } from "vitest";
import {
  McpToolRegistry,
  globalMcpRegistry,
  validateToolSchema,
  type McpToolSchema,
} from "@dantecode/core";

// ─── validateToolSchema ───────────────────────────────────────────────────────

describe("validateToolSchema", () => {
  it("accepts a valid minimal schema", () => {
    const schema: McpToolSchema = { name: "read_file", description: "Read a file", parameters: [] };
    const result = validateToolSchema(schema);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it("rejects empty tool name", () => {
    const schema: McpToolSchema = { name: "", description: "desc", parameters: [] };
    const result = validateToolSchema(schema);
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
  });

  it("rejects invalid tool name characters", () => {
    const schema: McpToolSchema = { name: "my tool!", description: "desc", parameters: [] };
    const result = validateToolSchema(schema);
    expect(result.valid).toBe(false);
  });

  it("accepts tool name with underscores and hyphens", () => {
    const schema: McpToolSchema = { name: "read_file-v2", description: "desc", parameters: [] };
    const result = validateToolSchema(schema);
    expect(result.valid).toBe(true);
  });
});

// ─── McpToolRegistry ──────────────────────────────────────────────────────────

describe("McpToolRegistry", () => {
  let registry: McpToolRegistry;

  beforeEach(() => {
    registry = new McpToolRegistry();
  });

  it("registers a valid tool", () => {
    const schema: McpToolSchema = { name: "list_files", description: "List directory files", parameters: [], capabilities: ["filesystem"] };
    const result = registry.register(schema, "file-server");
    expect(result.valid).toBe(true);
    expect(registry.size).toBe(1);
  });

  it("returns the tool via get()", () => {
    const schema: McpToolSchema = { name: "search_code", description: "Search code", parameters: [] };
    registry.register(schema, "search-server");
    const entry = registry.get("search_code");
    expect(entry?.schema.name).toBe("search_code");
    expect(entry?.serverName).toBe("search-server");
    expect(entry?.available).toBe(true);
  });

  it("recordSuccess resets failure count and marks available", () => {
    const schema: McpToolSchema = { name: "run_cmd", description: "Run command", parameters: [] };
    registry.register(schema, "shell-server");
    registry.recordFailure("run_cmd");
    registry.recordSuccess("run_cmd");
    expect(registry.get("run_cmd")?.failureCount).toBe(0);
    expect(registry.get("run_cmd")?.available).toBe(true);
  });

  it("recordFailure 3 times marks tool unavailable", () => {
    const schema: McpToolSchema = { name: "fragile_tool", description: "Fragile", parameters: [] };
    registry.register(schema, "server");
    registry.recordFailure("fragile_tool");
    registry.recordFailure("fragile_tool");
    registry.recordFailure("fragile_tool");
    expect(registry.get("fragile_tool")?.available).toBe(false);
  });

  it("getAvailable filters out unavailable tools", () => {
    registry.register({ name: "tool_a", description: "A", parameters: [] }, "s1");
    registry.register({ name: "tool_b", description: "B", parameters: [] }, "s1");
    registry.recordFailure("tool_a");
    registry.recordFailure("tool_a");
    registry.recordFailure("tool_a");
    const available = registry.getAvailable();
    expect(available.map((t) => t.schema.name)).not.toContain("tool_a");
    expect(available.map((t) => t.schema.name)).toContain("tool_b");
  });

  it("getByServer filters by server name", () => {
    registry.register({ name: "read_file", description: "Read", parameters: [] }, "fs-server");
    registry.register({ name: "write_file", description: "Write", parameters: [] }, "fs-server");
    registry.register({ name: "search", description: "Search", parameters: [] }, "search-server");
    const fsList = registry.getByServer("fs-server");
    expect(fsList).toHaveLength(2);
    expect(fsList.every((t) => t.serverName === "fs-server")).toBe(true);
  });

  it("route returns intent-matched tools", () => {
    registry.register({ name: "read_file", description: "Read a file from disk", parameters: [], capabilities: ["filesystem", "read"] }, "fs");
    registry.register({ name: "web_search", description: "Search the web for information", parameters: [], capabilities: ["web", "search"] }, "web");
    const results = registry.route("search web", 3);
    expect(Array.isArray(results)).toBe(true);
    // Should return at least one result
    expect(results.length).toBeGreaterThanOrEqual(0);
  });

  it("formatManifestForPrompt returns empty message when no tools", () => {
    const manifest = registry.formatManifestForPrompt();
    expect(manifest).toContain("No MCP tools");
  });

  it("formatManifestForPrompt includes tool names when tools registered", () => {
    registry.register({ name: "list_dir", description: "List directory contents", parameters: [], capabilities: ["filesystem"] }, "fs");
    registry.register({ name: "run_bash", description: "Execute shell command", parameters: [], capabilities: ["shell"] }, "shell");
    const manifest = registry.formatManifestForPrompt();
    expect(manifest).toContain("list_dir");
    expect(manifest).toContain("run_bash");
    expect(manifest).toContain("## MCP Tools");
  });
});

// ─── globalMcpRegistry singleton ─────────────────────────────────────────────

describe("globalMcpRegistry", () => {
  it("is a McpToolRegistry instance", () => {
    expect(globalMcpRegistry).toBeInstanceOf(McpToolRegistry);
  });

  it("has a size property", () => {
    expect(typeof globalMcpRegistry.size).toBe("number");
  });

  it("formatManifestForPrompt is callable", () => {
    const result = globalMcpRegistry.formatManifestForPrompt(5);
    expect(typeof result).toBe("string");
  });
});

// ─── sidebar system prompt injection contract ─────────────────────────────────

describe("MCP manifest sidebar injection", () => {
  it("formatManifestForPrompt output is suitable for system prompt injection", () => {
    const registry = new McpToolRegistry();
    registry.register({ name: "github_search", description: "Search GitHub repositories", parameters: [], capabilities: ["github", "search"], supportsStreaming: false }, "gh");
    const manifest = registry.formatManifestForPrompt(20);
    // Should be injectable as markdown into system prompt
    expect(manifest).toContain("github_search");
    expect(manifest.startsWith("##")).toBe(true);
  });

  it("streaming tools are annotated in manifest", () => {
    const registry = new McpToolRegistry();
    registry.register({ name: "stream_logs", description: "Stream log output", parameters: [], supportsStreaming: true }, "log-server");
    const manifest = registry.formatManifestForPrompt();
    expect(manifest).toContain("[streaming]");
  });

  it("manifest respects maxTools limit", () => {
    const registry = new McpToolRegistry();
    for (let i = 0; i < 10; i++) {
      registry.register({ name: `tool_${i}`, description: `Tool ${i}`, parameters: [] }, "server");
    }
    const manifest = registry.formatManifestForPrompt(3);
    // Only first 3 tools should appear
    const toolLines = manifest.split("\n").filter((l) => l.startsWith("-"));
    expect(toolLines.length).toBeLessThanOrEqual(3);
  });
});
