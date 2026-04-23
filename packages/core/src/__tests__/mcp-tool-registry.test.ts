// packages/core/src/__tests__/mcp-tool-registry.test.ts
import { describe, it, expect, beforeEach } from "vitest";
import {
  validateToolSchema,
  buildCapabilityGraph,
  scoreTool,
  routeByIntent,
  McpToolRegistry,
  type McpToolSchema,
  type McpToolEntry,
} from "../mcp-tool-registry.js";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeSchema(overrides: Partial<McpToolSchema> = {}): McpToolSchema {
  return {
    name: "read_file",
    description: "Read the contents of a file from the filesystem",
    parameters: [{ name: "path", type: "string", required: true, description: "File path to read" }],
    capabilities: ["read", "file"],
    supportsStreaming: false,
    ...overrides,
  };
}

function makeEntry(overrides: Partial<McpToolEntry> = {}): McpToolEntry {
  return {
    schema: makeSchema(),
    failureCount: 0,
    available: true,
    serverName: "filesystem",
    ...overrides,
  };
}

// ─── validateToolSchema ───────────────────────────────────────────────────────

describe("validateToolSchema", () => {
  it("accepts valid schema", () => {
    const result = validateToolSchema(makeSchema());
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it("rejects empty name", () => {
    const result = validateToolSchema(makeSchema({ name: "" }));
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("name"))).toBe(true);
  });

  it("rejects invalid name characters", () => {
    const result = validateToolSchema(makeSchema({ name: "my tool!" }));
    expect(result.valid).toBe(false);
  });

  it("rejects empty description", () => {
    const result = validateToolSchema(makeSchema({ description: "" }));
    expect(result.valid).toBe(false);
  });

  it("rejects invalid parameter type", () => {
    const schema = makeSchema({
      parameters: [{ name: "x", type: "invalid" as never }],
    });
    const result = validateToolSchema(schema);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("type"))).toBe(true);
  });

  it("accepts schema with no parameters", () => {
    const result = validateToolSchema(makeSchema({ parameters: [] }));
    expect(result.valid).toBe(true);
  });

  it("name starting with underscore is valid", () => {
    const result = validateToolSchema(makeSchema({ name: "_my_tool" }));
    expect(result.valid).toBe(true);
  });
});

// ─── buildCapabilityGraph ─────────────────────────────────────────────────────

describe("buildCapabilityGraph", () => {
  it("maps capabilities to tool names", () => {
    const tools = [
      makeEntry({ schema: makeSchema({ name: "t1", capabilities: ["read", "file"] }) }),
      makeEntry({ schema: makeSchema({ name: "t2", capabilities: ["write", "file"] }) }),
    ];
    const graph = buildCapabilityGraph(tools);
    expect(graph.get("read")?.has("t1")).toBe(true);
    expect(graph.get("write")?.has("t2")).toBe(true);
    expect(graph.get("file")?.has("t1")).toBe(true);
    expect(graph.get("file")?.has("t2")).toBe(true);
  });

  it("excludes unavailable tools", () => {
    const tools = [
      makeEntry({ schema: makeSchema({ name: "t1" }), available: false }),
    ];
    const graph = buildCapabilityGraph(tools);
    expect([...graph.values()].every((s) => !s.has("t1"))).toBe(true);
  });

  it("auto-infers capabilities from tool name/description", () => {
    const tools = [
      makeEntry({ schema: makeSchema({ name: "git_commit", description: "Run a git commit", capabilities: [] }) }),
    ];
    const graph = buildCapabilityGraph(tools);
    expect(graph.has("git") || graph.has("execute")).toBe(true);
  });
});

// ─── scoreTool ────────────────────────────────────────────────────────────────

describe("scoreTool", () => {
  it("scores 0 for unavailable tool", () => {
    const entry = makeEntry({ available: false });
    expect(scoreTool(entry, "read file").score).toBe(0);
  });

  it("scores higher when intent tokens match tool text", () => {
    const entry = makeEntry({ schema: makeSchema({ name: "read_file", description: "Read a file" }) });
    const score = scoreTool(entry, "read file").score;
    expect(score).toBeGreaterThan(0);
  });

  it("penalizes failures", () => {
    const clean = makeEntry({ failureCount: 0 });
    const failed = makeEntry({ failureCount: 4 });
    const score1 = scoreTool(clean, "read file").score;
    const score2 = scoreTool(failed, "read file").score;
    expect(score1).toBeGreaterThan(score2);
  });

  it("boosts recently-used tools", () => {
    const recent = makeEntry({ lastSuccessMs: Date.now() - 1000 });
    const old = makeEntry({ lastSuccessMs: Date.now() - 120_000 });
    const r1 = scoreTool(recent, "read file").score;
    const r2 = scoreTool(old, "read file").score;
    expect(r1).toBeGreaterThanOrEqual(r2);
  });
});

// ─── routeByIntent ────────────────────────────────────────────────────────────

describe("routeByIntent", () => {
  it("returns top matches sorted by score descending", () => {
    const tools = [
      makeEntry({ schema: makeSchema({ name: "read_file", description: "Read a file", capabilities: ["read"] }) }),
      makeEntry({ schema: makeSchema({ name: "write_file", description: "Write data to file", capabilities: ["write"] }) }),
      makeEntry({ schema: makeSchema({ name: "git_log", description: "Show git history", capabilities: ["git"] }) }),
    ];
    const results = routeByIntent(tools, "read a file from disk", 2);
    expect(results.length).toBeLessThanOrEqual(2);
    if (results.length >= 2) {
      expect(results[0]!.score).toBeGreaterThanOrEqual(results[1]!.score);
    }
  });

  it("returns empty when no tools match", () => {
    const tools = [makeEntry({ schema: makeSchema({ name: "git_log", description: "Git log", capabilities: ["git"] }) })];
    const results = routeByIntent(tools, "xyz irrelevant zzz query", 3);
    expect(results).toHaveLength(0);
  });
});

// ─── McpToolRegistry ──────────────────────────────────────────────────────────

describe("McpToolRegistry", () => {
  let registry: McpToolRegistry;

  beforeEach(() => {
    registry = new McpToolRegistry();
  });

  it("registers a valid tool", () => {
    const result = registry.register(makeSchema(), "fs-server");
    expect(result.valid).toBe(true);
    expect(registry.has("read_file")).toBe(true);
  });

  it("rejects invalid tool schema", () => {
    const result = registry.register(makeSchema({ name: "" }), "server");
    expect(result.valid).toBe(false);
    expect(registry.has("")).toBe(false);
  });

  it("get returns registered tool", () => {
    registry.register(makeSchema(), "server");
    expect(registry.get("read_file")).toBeDefined();
  });

  it("getAvailable returns only available tools", () => {
    registry.register(makeSchema({ name: "t1" }), "s1");
    registry.register(makeSchema({ name: "t2" }), "s1");
    // Make t1 unavailable
    for (let i = 0; i < 3; i++) registry.recordFailure("t1");
    const available = registry.getAvailable();
    expect(available.some((t) => t.schema.name === "t2")).toBe(true);
    expect(available.some((t) => t.schema.name === "t1")).toBe(false);
  });

  it("recordSuccess resets failure count", () => {
    registry.register(makeSchema(), "s");
    registry.recordFailure("read_file");
    registry.recordFailure("read_file");
    registry.recordSuccess("read_file");
    expect(registry.get("read_file")!.failureCount).toBe(0);
    expect(registry.get("read_file")!.available).toBe(true);
  });

  it("marks unavailable after 3 consecutive failures", () => {
    registry.register(makeSchema(), "s");
    for (let i = 0; i < 3; i++) registry.recordFailure("read_file");
    expect(registry.get("read_file")!.available).toBe(false);
  });

  it("route finds best match by intent", () => {
    registry.register(makeSchema({ name: "read_file", description: "Read file contents" }), "s");
    registry.register(makeSchema({ name: "git_log", description: "Show git commit history", capabilities: ["git"] }), "s");
    const results = registry.route("read file", 2);
    expect(results[0]!.toolName).toBe("read_file");
  });

  it("getByServer filters by serverName", () => {
    registry.register(makeSchema({ name: "t1" }), "server-a");
    registry.register(makeSchema({ name: "t2" }), "server-b");
    const fromA = registry.getByServer("server-a");
    expect(fromA.every((t) => t.serverName === "server-a")).toBe(true);
    expect(fromA.some((t) => t.schema.name === "t2")).toBe(false);
  });

  it("formatManifestForPrompt includes tool names and descriptions", () => {
    registry.register(makeSchema(), "server");
    const manifest = registry.formatManifestForPrompt();
    expect(manifest).toContain("read_file");
    expect(manifest).toContain("Read the contents");
  });

  it("formatManifestForPrompt shows streaming badge", () => {
    registry.register(makeSchema({ name: "stream_tool", description: "Streams output", supportsStreaming: true }), "s");
    expect(registry.formatManifestForPrompt()).toContain("[streaming]");
  });

  it("size returns total count", () => {
    registry.register(makeSchema({ name: "t1" }), "s");
    registry.register(makeSchema({ name: "t2" }), "s");
    expect(registry.size).toBe(2);
  });

  it("clear empties the registry", () => {
    registry.register(makeSchema(), "s");
    registry.clear();
    expect(registry.size).toBe(0);
  });

  it("buildCapabilityGraph delegates correctly", () => {
    registry.register(makeSchema({ name: "t1", capabilities: ["read"] }), "s");
    const graph = registry.buildCapabilityGraph();
    expect(graph.has("read")).toBe(true);
  });
});
