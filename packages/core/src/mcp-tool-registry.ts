// packages/core/src/mcp-tool-registry.ts
// MCP tool registry with capability graph and intent routing — closes dim 25 (MCP: 8→9).
//
// Harvested from: Claude Code MCP integration, Continue.dev tool registry patterns.
//
// Provides:
//   - Tool schema validation (JSON Schema subset)
//   - Capability graph (tool → capabilities → intents)
//   - Intent-based routing (natural language → best matching tool)
//   - Tool health/availability tracking
//   - Streaming-capable tool detection
//   - Tool manifest generation for prompt injection

// ─── Types ────────────────────────────────────────────────────────────────────

export type McpToolParameterType = "string" | "number" | "boolean" | "object" | "array" | "null";

export interface McpToolParameter {
  name: string;
  type: McpToolParameterType;
  description?: string;
  required?: boolean;
  enum?: string[];
  /** For array type: the item schema */
  items?: { type: McpToolParameterType };
  /** For object type: nested properties */
  properties?: Record<string, McpToolParameter>;
}

export interface McpToolSchema {
  name: string;
  description: string;
  parameters: McpToolParameter[];
  /** Whether this tool streams its results */
  supportsStreaming?: boolean;
  /** Categories/tags for intent matching */
  capabilities?: string[];
  /** Example invocations for prompt injection */
  examples?: string[];
}

export interface McpToolEntry {
  schema: McpToolSchema;
  /** When the tool was last successfully called (ms) */
  lastSuccessMs?: number;
  /** Consecutive failure count */
  failureCount: number;
  /** Whether the tool is currently available */
  available: boolean;
  /** Source server/provider name */
  serverName: string;
  /** Version string if known */
  version?: string;
}

export type ToolMatchScore = {
  toolName: string;
  score: number;
  reason: string;
};

// ─── Schema Validator ─────────────────────────────────────────────────────────

export interface SchemaValidationResult {
  valid: boolean;
  errors: string[];
}

/**
 * Validate a tool schema for basic correctness.
 */
export function validateToolSchema(schema: McpToolSchema): SchemaValidationResult {
  const errors: string[] = [];

  if (!schema.name || schema.name.trim().length === 0) {
    errors.push("Tool name is required and must be non-empty");
  }
  if (schema.name && !/^[a-zA-Z_][a-zA-Z0-9_-]*$/.test(schema.name)) {
    errors.push(`Tool name "${schema.name}" must start with a letter/underscore and contain only alphanumeric, underscore, or hyphen`);
  }
  if (!schema.description || schema.description.trim().length === 0) {
    errors.push("Tool description is required");
  }
  if (!Array.isArray(schema.parameters)) {
    errors.push("Parameters must be an array");
  }

  for (const param of schema.parameters ?? []) {
    if (!param.name) errors.push(`Parameter missing name`);
    if (!["string", "number", "boolean", "object", "array", "null"].includes(param.type)) {
      errors.push(`Parameter "${param.name}" has invalid type "${param.type}"`);
    }
  }

  return { valid: errors.length === 0, errors };
}

// ─── Capability Graph ─────────────────────────────────────────────────────────

/** Map from capability keyword → tools that provide it */
export type CapabilityGraph = Map<string, Set<string>>;

/**
 * Build a capability graph from all registered tools.
 */
export function buildCapabilityGraph(tools: McpToolEntry[]): CapabilityGraph {
  const graph: CapabilityGraph = new Map();

  for (const tool of tools) {
    if (!tool.available) continue;
    const caps = tool.schema.capabilities ?? [];

    // Also auto-infer capabilities from tool name and description
    const inferred = inferCapabilities(tool.schema.name, tool.schema.description);
    const allCaps = [...new Set([...caps, ...inferred])];

    for (const cap of allCaps) {
      const normalized = cap.toLowerCase().trim();
      if (!graph.has(normalized)) graph.set(normalized, new Set());
      graph.get(normalized)!.add(tool.schema.name);
    }
  }

  return graph;
}

const CAPABILITY_KEYWORDS: Record<string, string[]> = {
  read: ["file", "read", "get", "fetch", "load", "retrieve", "list"],
  write: ["write", "create", "save", "store", "put", "update", "set"],
  search: ["search", "find", "query", "lookup", "grep", "scan"],
  execute: ["run", "execute", "shell", "command", "bash", "cmd"],
  git: ["git", "commit", "branch", "diff", "blame", "log", "merge"],
  web: ["http", "fetch", "url", "web", "api", "request", "browse"],
  database: ["db", "database", "sql", "query", "insert", "select"],
  code: ["code", "parse", "ast", "lint", "format", "compile"],
};

function inferCapabilities(name: string, description: string): string[] {
  const text = `${name} ${description}`.toLowerCase();
  const caps: string[] = [];
  for (const [cap, keywords] of Object.entries(CAPABILITY_KEYWORDS)) {
    if (keywords.some((kw) => text.includes(kw))) caps.push(cap);
  }
  return caps;
}

// ─── Intent Router ────────────────────────────────────────────────────────────

/**
 * Score a tool against a natural language intent query.
 * Higher score = better match.
 */
export function scoreTool(tool: McpToolEntry, intent: string): ToolMatchScore {
  if (!tool.available) return { toolName: tool.schema.name, score: 0, reason: "unavailable" };

  const intentTokens = intent.toLowerCase().split(/\W+/).filter((t) => t.length > 2);
  const toolText = `${tool.schema.name} ${tool.schema.description} ${(tool.schema.capabilities ?? []).join(" ")}`.toLowerCase();

  let score = 0;
  const matchedTokens: string[] = [];

  for (const token of intentTokens) {
    if (toolText.includes(token)) {
      score += 1;
      matchedTokens.push(token);
    }
  }

  // Boost for exact name match
  if (tool.schema.name.toLowerCase().includes(intent.toLowerCase().split(" ")[0]!)) {
    score += 2;
  }

  // Recency boost — recently-used tools get a small preference
  if (tool.lastSuccessMs && Date.now() - tool.lastSuccessMs < 60_000) {
    score += 0.5;
  }

  // Health penalty
  score -= tool.failureCount * 0.5;

  const reason = matchedTokens.length > 0
    ? `matched: ${matchedTokens.slice(0, 3).join(", ")}`
    : "no keyword match";

  return { toolName: tool.schema.name, score: Math.max(0, score), reason };
}

/**
 * Find the best matching tools for an intent, sorted by score descending.
 */
export function routeByIntent(
  tools: McpToolEntry[],
  intent: string,
  maxResults = 3,
): ToolMatchScore[] {
  return tools
    .map((t) => scoreTool(t, intent))
    .filter((r) => r.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, maxResults);
}

// ─── Registry ─────────────────────────────────────────────────────────────────

export class McpToolRegistry {
  private _tools = new Map<string, McpToolEntry>();

  /**
   * Register a tool. Returns validation errors if schema is invalid.
   */
  register(schema: McpToolSchema, serverName: string, version?: string): SchemaValidationResult {
    const validation = validateToolSchema(schema);
    if (!validation.valid) return validation;

    this._tools.set(schema.name, {
      schema,
      failureCount: 0,
      available: true,
      serverName,
      version,
    });
    return { valid: true, errors: [] };
  }

  /**
   * Mark a tool call as succeeded.
   */
  recordSuccess(toolName: string): void {
    const entry = this._tools.get(toolName);
    if (!entry) return;
    entry.lastSuccessMs = Date.now();
    entry.failureCount = 0;
    entry.available = true;
  }

  /**
   * Mark a tool call as failed. After 3 consecutive failures, mark as unavailable.
   */
  recordFailure(toolName: string): void {
    const entry = this._tools.get(toolName);
    if (!entry) return;
    entry.failureCount++;
    if (entry.failureCount >= 3) entry.available = false;
  }

  /**
   * Get a tool by name.
   */
  get(toolName: string): McpToolEntry | undefined {
    return this._tools.get(toolName);
  }

  /**
   * Get all available tools.
   */
  getAvailable(): McpToolEntry[] {
    return [...this._tools.values()].filter((t) => t.available);
  }

  /**
   * Get all tools from a specific server.
   */
  getByServer(serverName: string): McpToolEntry[] {
    return [...this._tools.values()].filter((t) => t.serverName === serverName);
  }

  /**
   * Route an intent to the best matching tools.
   */
  route(intent: string, maxResults = 3): ToolMatchScore[] {
    return routeByIntent([...this._tools.values()], intent, maxResults);
  }

  /**
   * Build the capability graph for all available tools.
   */
  buildCapabilityGraph(): CapabilityGraph {
    return buildCapabilityGraph([...this._tools.values()]);
  }

  /**
   * Generate a tool manifest block for prompt injection.
   */
  formatManifestForPrompt(maxTools = 20): string {
    const available = this.getAvailable().slice(0, maxTools);
    if (available.length === 0) return "No MCP tools available.";

    const lines = [`## MCP Tools (${available.length})`];
    for (const tool of available) {
      const caps = tool.schema.capabilities?.join(", ") ?? "general";
      const streaming = tool.schema.supportsStreaming ? " [streaming]" : "";
      lines.push(`- **${tool.schema.name}**${streaming} (${tool.serverName}): ${tool.schema.description} [${caps}]`);
    }
    return lines.join("\n");
  }

  get size(): number {
    return this._tools.size;
  }

  clear(): void {
    this._tools.clear();
  }

  has(toolName: string): boolean {
    return this._tools.has(toolName);
  }
}

/** Global singleton registry */
export const globalMcpRegistry = new McpToolRegistry();
