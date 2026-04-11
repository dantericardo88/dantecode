// ============================================================================
// @dantecode/mcp — Enhanced MCP Integration
// Real-world interoperability with Claude Code, Cursor, Windsurf
// ============================================================================

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { createDefaultToolHandlers, EXPOSED_TOOL_NAMES } from "./default-tool-handlers.js";
import { MCPClientManager } from "./client.js";

export class DanteCodeMCPServer {
  private server: Server;
  private clientManager: MCPClientManager;

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
          type: "object",
          properties: {
            // Dynamic schema based on tool
          },
        },
      }));

      const externalTools = await this.clientManager.getAllTools();
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
          const result = await handler(args);
          return { content: [{ type: "text", text: result }] };
        }
      }

      // Otherwise, route to external MCP client
      const externalResult = await this.clientManager.callTool(name, args);
      return { content: [{ type: "text", text: externalResult }] };
    });
  }

  async start() {
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
    console.error("DanteCode MCP Server started");
  }

  // Bridge to external MCP servers
  async connectToExternalServer(serverConfig: any) {
    await this.clientManager.addServer(serverConfig);
  }
}

// CLI to run MCP server with external connections
export async function runMCPIntegration() {
  const server = new DanteCodeMCPServer();

  // Connect to Claude Code MCP server (example)
  await server.connectToExternalServer({
    name: "claude-code",
    command: "claude", // Assume Claude Code exposes MCP
    args: ["mcp"],
  });

  // Connect to Cursor MCP server
  await server.connectToExternalServer({
    name: "cursor",
    command: "cursor",
    args: ["--mcp-server"],
  });

  await server.start();
}

// Test MCP integration with mock external server
export async function testMCPIntegration(): Promise<boolean> {
  try {
    const server = new DanteCodeMCPServer();

    // Create a mock external MCP server for testing
    const mockServer = {
      name: "mock-claude",
      command: "node",
      args: [
        "-e",
        `
        const { Server } = require('@modelcontextprotocol/sdk/server/index.js');
        const { StdioServerTransport } = require('@modelcontextprotocol/sdk/server/stdio.js');
        const server = new Server({name: 'mock-claude', version: '1.0.0'}, {capabilities: {tools: {}}});
        server.setRequestHandler('tools/list', async () => ({tools: [{name: 'mock-tool', description: 'Mock tool'}]}));
        server.setRequestHandler('tools/call', async (req) => {
          if (req.params.name === 'mock-tool') return {content: [{type: 'text', text: 'Mock response'}]};
          throw new Error('Unknown tool');
        });
        const transport = new StdioServerTransport();
        server.connect(transport);
      `,
      ],
    };

    await server.connectToExternalServer(mockServer);

    // Test tool listing
    const tools = await server.clientManager.getAllTools();
    if (!tools.some((t) => t.name === "mock-tool")) {
      return false;
    }

    // Test tool calling
    const result = await server.clientManager.callTool("mock-tool", {});
    return result === "Mock response";
  } catch (error) {
    console.error("MCP integration test failed:", error);
    return false;
  }
}
