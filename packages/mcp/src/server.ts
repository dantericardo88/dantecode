// ============================================================================
// @dantecode/mcp — DanteCode MCP Server
// Exposes DanteForge verification tools as an MCP server so external agents
// (Claude Code, Cursor, etc.) can use our quality gates.
// ============================================================================

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { createDefaultToolHandlers } from "./default-tool-handlers.js";

/** The tools exposed by the DanteCode MCP server. */
const DANTEFORGE_TOOLS = [
  {
    name: "pdse_score",
    description:
      "Run PDSE quality scoring on a code string. Returns completeness, correctness, clarity, consistency scores and violations.",
    inputSchema: {
      type: "object" as const,
      properties: {
        code: { type: "string", description: "The source code to score" },
        filePath: { type: "string", description: "File path for context" },
      },
      required: ["code"],
    },
  },
  {
    name: "anti_stub_scan",
    description:
      "Scan code for stubs, placeholders, TODOs, FIXMEs, empty functions, and type:any violations.",
    inputSchema: {
      type: "object" as const,
      properties: {
        code: { type: "string", description: "The source code to scan" },
        filePath: { type: "string", description: "File path for context" },
      },
      required: ["code"],
    },
  },
  {
    name: "constitution_check",
    description:
      "Check code for constitutional violations: credential exposure, background processes, dangerous operations.",
    inputSchema: {
      type: "object" as const,
      properties: {
        code: { type: "string", description: "The source code to check" },
        filePath: { type: "string", description: "File path for context" },
      },
      required: ["code"],
    },
  },
  {
    name: "lessons_query",
    description:
      "Query the lessons database for recorded patterns and corrections relevant to a file or language.",
    inputSchema: {
      type: "object" as const,
      properties: {
        projectRoot: { type: "string", description: "Project root directory" },
        filePattern: { type: "string", description: "File glob pattern to filter lessons" },
        language: { type: "string", description: "Language to filter lessons" },
        limit: { type: "number", description: "Maximum number of lessons to return" },
      },
      required: ["projectRoot"],
    },
  },
  {
    name: "semantic_search",
    description:
      "Search the project code index using TF-IDF or hybrid semantic search when embeddings are available.",
    inputSchema: {
      type: "object" as const,
      properties: {
        projectRoot: { type: "string", description: "Project root directory" },
        query: { type: "string", description: "Search query" },
        limit: { type: "number", description: "Maximum number of chunks to return" },
      },
      required: ["projectRoot", "query"],
    },
  },
  {
    name: "record_lesson",
    description:
      "Record a success, failure, or preference lesson so future runs can learn from the pattern.",
    inputSchema: {
      type: "object" as const,
      properties: {
        projectRoot: { type: "string", description: "Project root directory" },
        pattern: { type: "string", description: "Pattern that was observed" },
        correction: { type: "string", description: "Preferred fix or guidance" },
        type: {
          type: "string",
          enum: ["failure", "success", "preference"],
          description: "Lesson type to record",
        },
        severity: { type: "string", description: "Lesson severity" },
      },
      required: ["projectRoot", "pattern", "correction"],
    },
  },
  {
    name: "autoforge_verify",
    description:
      "Run the DanteForge verification pipeline across a task or project and return a compact result summary.",
    inputSchema: {
      type: "object" as const,
      properties: {
        projectRoot: { type: "string", description: "Project root directory" },
        taskDescription: { type: "string", description: "Task or change description" },
        filePaths: {
          type: "array",
          items: { type: "string" },
          description: "Optional list of files to verify",
        },
      },
      required: ["projectRoot"],
    },
  },
];

/** The tool names exposed by the server (for testing/validation). */
export const EXPOSED_TOOL_NAMES = DANTEFORGE_TOOLS.map((t) => t.name);

/**
 * Tool handler functions. These are thin wrappers that call into
 * the actual DanteForge implementations. They are dynamically bound
 * via setToolHandlers() to avoid a hard dependency on the danteforge package
 * at module load time (enabling lighter imports and testing).
 */
export type ToolHandler = (args: Record<string, unknown>) => Promise<string>;

let toolHandlers: Record<string, ToolHandler> = {};

/** Register actual DanteForge tool handlers. */
export function setToolHandlers(handlers: Record<string, ToolHandler>): void {
  toolHandlers = handlers;
}

/**
 * Creates and returns a configured MCP server instance.
 * Call server.connect(transport) to start serving.
 */
export function createMCPServer(): Server {
  const server = new Server(
    { name: "dantecode", version: "1.0.0" },
    { capabilities: { tools: {} } },
  );

  // Register tool listing handler
  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: DANTEFORGE_TOOLS,
  }));

  // Register tool call handler
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    const handler = toolHandlers[name];

    if (!handler) {
      return {
        content: [{ type: "text" as const, text: `Unknown tool: ${name}` }],
        isError: true,
      };
    }

    try {
      const result = await handler(args ?? {});
      return {
        content: [{ type: "text" as const, text: result }],
      };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        content: [{ type: "text" as const, text: `Error: ${message}` }],
        isError: true,
      };
    }
  });

  return server;
}

/**
 * Starts the DanteCode MCP server on stdio transport.
 * This is the entry point for `dantecode mcp-server`.
 */
export async function startMCPServerStdio(): Promise<void> {
  if (Object.keys(toolHandlers).length === 0) {
    setToolHandlers(createDefaultToolHandlers());
  }
  const server = createMCPServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
}
