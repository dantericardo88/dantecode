// ============================================================================
// @dantecode/mcp — MCP Client Manager
// Connects to MCP servers (stdio/sse), discovers tools, dispatches calls.
// ============================================================================

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import type { MCPConfig, MCPServerConfig, MCPToolDefinition } from "@dantecode/config-types";
import { getEnabledServers } from "./config.js";
import { retryWithBackoff, RetryableErrors } from "@dantecode/core";

/** Internal state per connected server. */
interface ConnectedServer {
  config: MCPServerConfig;
  client: Client;
  tools: MCPToolDefinition[];
}

/**
 * Manages connections to multiple MCP servers.
 * Discovers available tools and dispatches tool calls to the correct server.
 */
export class MCPClientManager {
  private servers: Map<string, ConnectedServer> = new Map();

  /** Connect to all enabled servers in the config. */
  async connectAll(config: MCPConfig): Promise<void> {
    const enabled = getEnabledServers(config);
    const results = await Promise.allSettled(enabled.map((s) => this.connectOne(s)));

    for (let i = 0; i < results.length; i++) {
      const result = results[i]!;
      if (result.status === "rejected") {
        const serverName = enabled[i]?.name ?? `server-${i}`;
        console.error(`[mcp] Failed to connect to "${serverName}": ${result.reason}`);
      }
    }
  }

  /** Connect to a single MCP server. */
  private async connectOne(serverConfig: MCPServerConfig): Promise<void> {
    const client = new Client({ name: "dantecode", version: "1.0.0" }, { capabilities: {} });

    let transport;
    if (serverConfig.transport === "stdio") {
      transport = new StdioClientTransport({
        command: serverConfig.command!,
        args: serverConfig.args ?? [],
        env: { ...process.env, ...(serverConfig.env ?? {}) } as Record<string, string>,
      });
    } else {
      transport = new SSEClientTransport(new URL(serverConfig.url!));
    }

    await retryWithBackoff(async () => client.connect(transport), {
      maxRetries: 3,
      baseDelayMs: 1000,
      retryableErrors: RetryableErrors.networkOnly,
    });

    // Discover tools from this server
    const toolsResult = await retryWithBackoff(async () => client.listTools(), {
      maxRetries: 2,
      baseDelayMs: 500,
      retryableErrors: RetryableErrors.serverAndRateLimit,
    });
    const tools: MCPToolDefinition[] = (toolsResult.tools ?? []).map((t) => ({
      name: t.name,
      description: t.description ?? "",
      inputSchema: (t.inputSchema ?? {}) as Record<string, unknown>,
      serverName: serverConfig.name,
    }));

    this.servers.set(serverConfig.name, {
      config: serverConfig,
      client,
      tools,
    });
  }

  /** List all tools from all connected servers. */
  listTools(): MCPToolDefinition[] {
    const allTools: MCPToolDefinition[] = [];
    for (const server of this.servers.values()) {
      allTools.push(...server.tools);
    }
    return allTools;
  }

  /** Find which server provides a given tool. */
  findToolServer(toolName: string): string | null {
    for (const [serverName, server] of this.servers) {
      if (server.tools.some((t) => t.name === toolName)) {
        return serverName;
      }
    }
    return null;
  }

  /** Call a tool on a specific server. */
  async callTool(
    serverName: string,
    toolName: string,
    args: Record<string, unknown>,
  ): Promise<string> {
    const server = this.servers.get(serverName);
    if (!server) {
      throw new Error(`MCP server "${serverName}" not connected`);
    }

    const result = await retryWithBackoff(
      async () => server.client.callTool({ name: toolName, arguments: args }),
      {
        maxRetries: 3,
        baseDelayMs: 1000,
        retryableErrors: RetryableErrors.serverAndRateLimit,
      },
    );

    // Extract text content from the MCP response
    const contents = result.content as Array<{ type: string; text?: string }>;
    return contents
      .filter((c) => c.type === "text" && c.text)
      .map((c) => c.text!)
      .join("\n");
  }

  /** Call a tool by name, auto-routing to the correct server. */
  async callToolByName(toolName: string, args: Record<string, unknown>): Promise<string> {
    const serverName = this.findToolServer(toolName);
    if (!serverName) {
      throw new Error(`No MCP server provides tool "${toolName}"`);
    }
    return this.callTool(serverName, toolName, args);
  }

  /** Get the names of all connected servers. */
  getConnectedServers(): string[] {
    return Array.from(this.servers.keys());
  }

  /** Check if any servers are connected. */
  isConnected(): boolean {
    return this.servers.size > 0;
  }

  /** Disconnect from all servers. */
  async disconnectAll(): Promise<void> {
    const closePromises = Array.from(this.servers.values()).map(async (s) => {
      try {
        await s.client.close();
      } catch {
        // Ignore close errors
      }
    });
    await Promise.allSettled(closePromises);
    this.servers.clear();
  }
}
