// ============================================================================
// @dantecode/mcp — Public API
// MCP protocol support: client for connecting to external tool servers,
// server for exposing DanteForge as MCP, tool bridge for AI SDK integration.
// ============================================================================

// ─── Config ──────────────────────────────────────────────────────────────────

export {
  loadMCPConfig,
  defaultMCPConfig,
  getEnabledServers,
  validateServerConfig,
} from "./config.js";

// ─── Client ──────────────────────────────────────────────────────────────────

export { MCPClientManager } from "./client.js";

// ─── Tool Bridge ─────────────────────────────────────────────────────────────

export { mcpToolToZodSchema, mcpToolsToAISDKTools, parseMCPToolName } from "./tool-bridge.js";
export type { BridgedToolSchema } from "./tool-bridge.js";

// ─── Server ──────────────────────────────────────────────────────────────────

export {
  createMCPServer,
  startMCPServerStdio,
  setToolHandlers,
  EXPOSED_TOOL_NAMES,
} from "./server.js";
export type { ToolHandler } from "./server.js";
