// ============================================================================
// @dantecode/mcp — MCP Configuration Parser
// Reads .dantecode/mcp.json and validates server configurations.
// ============================================================================

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { MCPConfig, MCPServerConfig } from "@dantecode/config-types";

/** Default empty MCP configuration. */
export function defaultMCPConfig(): MCPConfig {
  return { servers: [] };
}

/** Validates a single MCP server config entry. */
export function validateServerConfig(server: unknown): server is MCPServerConfig {
  if (!server || typeof server !== "object") return false;
  const s = server as Record<string, unknown>;
  if (typeof s.name !== "string" || s.name.length === 0) return false;
  if (s.transport !== "stdio" && s.transport !== "sse") return false;
  if (s.transport === "stdio" && typeof s.command !== "string") return false;
  if (s.transport === "sse" && typeof s.url !== "string") return false;
  if (typeof s.enabled !== "boolean") return false;
  return true;
}

/**
 * Loads MCP configuration from .dantecode/mcp.json.
 * Returns default empty config if file does not exist.
 * Throws on invalid JSON or schema violations.
 */
export async function loadMCPConfig(projectRoot: string): Promise<MCPConfig> {
  const configPath = join(projectRoot, ".dantecode", "mcp.json");
  let raw: string;
  try {
    raw = await readFile(configPath, "utf-8");
  } catch {
    return defaultMCPConfig();
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(`Invalid JSON in ${configPath}`);
  }

  if (!parsed || typeof parsed !== "object" || !Array.isArray((parsed as { servers?: unknown }).servers)) {
    throw new Error(`Invalid MCP config: expected { servers: [...] } in ${configPath}`);
  }

  const config = parsed as { servers: unknown[] };
  const servers: MCPServerConfig[] = [];

  for (let i = 0; i < config.servers.length; i++) {
    const entry = config.servers[i];
    if (!validateServerConfig(entry)) {
      throw new Error(`Invalid MCP server config at index ${i} in ${configPath}`);
    }
    servers.push(entry);
  }

  return { servers };
}

/**
 * Returns only enabled servers from the configuration.
 */
export function getEnabledServers(config: MCPConfig): MCPServerConfig[] {
  return config.servers.filter((s) => s.enabled);
}
