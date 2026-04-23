// ============================================================================
// @dantecode/mcp — Enhanced MCP Integration
// Real-world interoperability with Claude Code, Cursor, Windsurf
// ============================================================================

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { createDefaultToolHandlers } from "./default-tool-handlers.js";
import { EXPOSED_TOOL_NAMES } from "./server.js";
import { MCPClientManager } from "./client.js";
import type { MCPConfig } from "@dantecode/config-types";

export class DanteCodeMCPServer {
  private server: Server;
  private readonly clientManager: MCPClientManager;

  constructor() {
    this.server = new Server(
      {
        name: "dantecode-mcp",
        version: "1.0.0",
      },
      {
        capabilities: {
          tools: {},
        },
      },
    );

    this.clientManager = new MCPClientManager();
    this.setupHandlers();
  }

  private setupHandlers() {
    // List available tools (DanteCode's tools + bridged external tools)
    this.server.setRequestHandler(ListToolsRequestSchema, async () => {
      const localTools = EXPOSED_TOOL_NAMES.map((name) => ({
        name,
        description: `DanteCode tool: ${name}`,
        inputSchema: {
          type: "object" as const,
          properties: {},
        },
      }));

      const externalTools = this.clientManager.listTools().map((t) => ({
        name: t.name,
        description: t.description ?? "",
        inputSchema: t.inputSchema,
      }));

      return { tools: [...localTools, ...externalTools] };
    });

    // Handle tool calls
    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: args } = request.params;

      // Check if it's a local DanteCode tool
      if (EXPOSED_TOOL_NAMES.includes(name)) {
        const handlers = createDefaultToolHandlers();
        const handler = handlers[name];
        if (handler) {
          const result = await handler(args ?? {});
          return { content: [{ type: "text" as const, text: result }] };
        }
      }

      // Otherwise, route to external MCP client (format: "serverName/toolName")
      const slashIndex = name.indexOf("/");
      if (slashIndex !== -1) {
        const serverName = name.slice(0, slashIndex);
        const toolName = name.slice(slashIndex + 1);
        const externalResult = await this.clientManager.callTool(serverName, toolName, args ?? {});
        return { content: [{ type: "text" as const, text: externalResult }] };
      }

      throw new Error(`Unknown tool: ${name}`);
    });
  }

  async connectExternal(config: MCPConfig): Promise<void> {
    await this.clientManager.connectAll(config);
  }

  async start() {
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
    process.stderr.write("DanteCode MCP Server started\n");
  }

  async stop() {
    await this.clientManager.disconnectAll();
  }
}

/**
 * Test MCP integration by verifying local tool listing works.
 * Returns true if the MCP server can list DanteCode's own tools.
 */
export async function testMCPIntegration(): Promise<boolean> {
  try {
    // Verify that DanteCode's exposed tools are accessible via the MCP interface
    if (EXPOSED_TOOL_NAMES.length === 0) {
      return false;
    }

    // Verify that the default tool handlers can be constructed
    const handlers = createDefaultToolHandlers();
    const allHandlersPresent = EXPOSED_TOOL_NAMES.every((name) => name in handlers);

    return allHandlersPresent;
  } catch {
    return false;
  }
}
