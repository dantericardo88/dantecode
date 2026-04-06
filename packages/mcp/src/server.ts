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
  {
    name: "verify_output",
    description:
      "Run the multi-stage QA harness against a task output and return PDSE-style metrics, critique trace, and rail findings.",
    inputSchema: {
      type: "object" as const,
      properties: {
        task: { type: "string", description: "Task or requirement being verified" },
        output: { type: "string", description: "Output text to verify" },
        criteria: {
          type: "object",
          description: "Optional verification criteria and metric overrides",
        },
        rails: {
          type: "array",
          items: { type: "object" as const },
          description: "Optional output verification rails applied for this call",
        },
      },
      required: ["task", "output"],
    },
  },
  {
    name: "run_qa_suite",
    description:
      "Run the QA harness across multiple outputs for a plan or batch and return an aggregate pass/fail report.",
    inputSchema: {
      type: "object" as const,
      properties: {
        planId: {
          type: "string",
          description: "Identifier for the plan or batch under evaluation",
        },
        outputs: {
          type: "array",
          items: { type: "object" as const },
          description: "Outputs to verify, each with id, task, output, and optional criteria/rails",
        },
      },
      required: ["planId", "outputs"],
    },
  },
  {
    name: "critic_debate",
    description:
      "Aggregate critic or sub-agent verdicts into a consensus decision with blocking findings.",
    inputSchema: {
      type: "object" as const,
      properties: {
        subagents: {
          type: "array",
          items: { type: "object" as const },
          description: "Critic verdicts with agentId, verdict, confidence, and findings",
        },
        output: { type: "string", description: "Optional output being debated" },
      },
      required: ["subagents"],
    },
  },
  {
    name: "add_verification_rail",
    description:
      "Register a runtime output verification rail so subsequent verification calls apply the guard automatically.",
    inputSchema: {
      type: "object" as const,
      properties: {
        rule: { type: "object", description: "Verification rail definition to register" },
      },
      required: ["rule"],
    },
  },
  {
    name: "web_search",
    description:
      "Search the web using DanteCode's intelligent multi-provider orchestrator with persistent caching.",
    inputSchema: {
      type: "object" as const,
      properties: {
        query: { type: "string", description: "The search query" },
      },
      required: ["query"],
    },
  },
  {
    name: "web_fetch",
    description:
      "Fetch a URL and extract clean markdown or structured JSON using the DanteCode Smart Extractor pipeline.",
    inputSchema: {
      type: "object" as const,
      properties: {
        url: { type: "string", description: "The URL to fetch and extract" },
        instructions: { type: "string", description: "Optional extraction instructions" },
        schema: { type: "string", description: "Optional Zod schema string for structured output" },
        options: { type: "object", description: "Optional fetch options/configuration" },
      },
      required: ["url"],
    },
  },
  {
    name: "smart_extract",
    description: "Intelligently extract specific information from a webpage based on a goal.",
    inputSchema: {
      type: "object" as const,
      properties: {
        url: { type: "string", description: "The URL to extract from" },
        goal: { type: "string", description: "The extraction goal or task description" },
      },
      required: ["url", "goal"],
    },
  },
  {
    name: "batch_fetch",
    description: "Fetch multiple URLs concurrently with common extraction instructions.",
    inputSchema: {
      type: "object" as const,
      properties: {
        urls: {
          type: "array",
          items: { type: "string" },
          description: "List of URLs to fetch",
        },
        commonInstructions: {
          type: "string",
          description: "Common extraction instructions for all URLs",
        },
      },
      required: ["urls"],
    },
  },
  {
    name: "spawn_subagent",
    description:
      "Spawn a dynamic, role-specialized sub-agent for parallel or isolated task execution with worktree support.",
    inputSchema: {
      type: "object" as const,
      properties: {
        role: { type: "string", description: "The dynamic role/specialty of the agent" },
        task: { type: "string", description: "The specific sub-task to execute" },
      },
      required: ["role", "task"],
    },
  },
  {
    name: "git_watch",
    description:
      "Start, list, or stop durable Git event watchers for post-commit, pre-push, branch-update, and file-change events.",
    inputSchema: {
      type: "object" as const,
      properties: {
        action: { type: "string", description: "start, list, or stop" },
        projectRoot: {
          type: "string",
          description: "Project root used for persistence and relative paths",
        },
        eventType: {
          type: "string",
          description: "Event type to watch (post-commit, pre-push, file-change, branch-update)",
        },
        path: { type: "string", description: "Optional specific file or folder path to watch" },
        workflowPath: {
          type: "string",
          description: "Optional workflow file to queue when a matching event fires",
        },
        eventPayload: {
          type: "object",
          description: "Optional base payload merged into queued workflow runs",
        },
        options: { type: "object", description: "Optional options such as debounceMs or cwd" },
        watchId: { type: "string", description: "Watcher ID to stop when action=stop" },
      },
      required: [],
    },
  },
  {
    name: "run_github_workflow",
    description:
      "Executes a local GitHub-style workflow file with event payload injection, matrix expansion, and persisted run metadata.",
    inputSchema: {
      type: "object" as const,
      properties: {
        projectRoot: {
          type: "string",
          description: "Project root used as the default workflow cwd",
        },
        workflowPath: { type: "string", description: "Path to the workflow file" },
        eventPayload: {
          type: "object",
          description: "Optional payload simulating Github event injection",
        },
        background: {
          type: "boolean",
          description: "When true, queues the workflow as a durable background automation run",
        },
        options: {
          type: "object",
          description: "Optional execution options like working directory",
        },
      },
      required: ["workflowPath"],
    },
  },
  {
    name: "auto_pr_create",
    description:
      "Automatically creates a Pull Request with optional changeset generation and persisted run metadata.",
    inputSchema: {
      type: "object" as const,
      properties: {
        projectRoot: {
          type: "string",
          description: "Project root where gh and optional changeset generation should run",
        },
        title: { type: "string", description: "Title of the PR" },
        body: { type: "string", description: "Body of the PR" },
        base: { type: "string", description: "Base branch for the PR" },
        draft: { type: "boolean", description: "Whether to create a draft PR" },
        background: {
          type: "boolean",
          description: "When true, queues PR creation as a durable background automation run",
        },
        generateChangeset: { type: "boolean", description: "Whether to generate a changeset" },
        bumpType: {
          type: "string",
          enum: ["patch", "minor", "major"],
          description: "Type of version bump if changeset generated",
        },
        packages: {
          type: "array",
          items: { type: "string" },
          description: "Packages to include in the changeset",
        },
      },
      required: ["title"],
    },
  },
  {
    name: "webhook_listen",
    description:
      "Start, list, or stop local webhook listeners for GitHub, GitLab, or custom providers with persisted listener metadata.",
    inputSchema: {
      type: "object" as const,
      properties: {
        action: { type: "string", description: "start, list, or stop" },
        projectRoot: {
          type: "string",
          description: "Project root used for persistence and relative paths",
        },
        provider: { type: "string", description: "github, gitlab, or custom" },
        port: { type: "number", description: "Port to listen on (default 3000)" },
        path: { type: "string", description: "HTTP path to bind, defaults to /webhook" },
        secret: { type: "string", description: "Optional webhook secret for signature validation" },
        workflowPath: {
          type: "string",
          description: "Optional workflow file to queue for each received webhook event",
        },
        listenerId: { type: "string", description: "Listener ID to stop when action=stop" },
      },
      required: [],
    },
  },
  {
    name: "schedule_git_task",
    description:
      "Start, list, or stop durable scheduled git tasks using either a cron expression or interval milliseconds.",
    inputSchema: {
      type: "object" as const,
      properties: {
        action: { type: "string", description: "start, list, or stop" },
        projectRoot: {
          type: "string",
          description: "Project root used for persistence and relative paths",
        },
        taskName: { type: "string", description: "Description or name of the task" },
        intervalMs: { type: "number", description: "Interval in milliseconds" },
        cron: {
          type: "string",
          description: "Optional cron expression in minute/hour/day/month/weekday form",
        },
        workflowPath: {
          type: "string",
          description: "Optional workflow file to run on each schedule",
        },
        eventPayload: {
          type: "object",
          description: "Optional workflow event payload passed on each run",
        },
        taskId: { type: "string", description: "Task ID to stop when action=stop" },
      },
      required: [],
    },
  },
  {
    name: "memory_store",
    description: "Store a new memory entry across sessions.",
    inputSchema: {
      type: "object" as const,
      properties: {
        projectRoot: { type: "string", description: "Project root directory" },
        key: { type: "string", description: "Summary key or tag for the memory" },
        value: { type: "string", description: "The content to store" },
        scope: { type: "string", description: "Optional session ID scope" },
        category: {
          type: "string",
          description: "Optional category (fact, decision, error, strategy, context)",
        },
      },
      required: ["projectRoot", "key", "value"],
    },
  },
  {
    name: "memory_recall",
    description: "Recall memory entries by semantic query.",
    inputSchema: {
      type: "object" as const,
      properties: {
        projectRoot: { type: "string", description: "Project root directory" },
        query: { type: "string", description: "Search query" },
        limit: { type: "number", description: "Max results" },
        scope: { type: "string", description: "Optional session ID scope" },
      },
      required: ["projectRoot", "query"],
    },
  },
  {
    name: "memory_summarize",
    description: "Generate a summary of a specific session.",
    inputSchema: {
      type: "object" as const,
      properties: {
        projectRoot: { type: "string", description: "Project root directory" },
        sessionId: { type: "string", description: "Session ID to summarize" },
      },
      required: ["projectRoot", "sessionId"],
    },
  },
  {
    name: "memory_prune",
    description: "Prune or compress the persistent memory store.",
    inputSchema: {
      type: "object" as const,
      properties: {
        projectRoot: { type: "string", description: "Project root directory" },
        threshold: { type: "number", description: "Target number of max entries" },
      },
      required: ["projectRoot"],
    },
  },
  {
    name: "cross_session_recall",
    description: "Retrieve semantic long-term memory across sessions using a user goal or prompt.",
    inputSchema: {
      type: "object" as const,
      properties: {
        projectRoot: { type: "string", description: "Project root directory" },
        userGoal: { type: "string", description: "User goal or complex query" },
      },
      required: ["projectRoot", "userGoal"],
    },
  },
  {
    name: "memory_visualize",
    description: "Visualize the trace and entity map of the persistent memory.",
    inputSchema: {
      type: "object" as const,
      properties: {
        projectRoot: { type: "string", description: "Project root directory" },
      },
      required: ["projectRoot"],
    },
  },
  {
    name: "run_tests",
    description:
      "Run the project test suite using the configured test runner (Vitest, Jest, etc.) and return a pass/fail summary with failure details.",
    inputSchema: {
      type: "object" as const,
      properties: {
        projectRoot: { type: "string", description: "Project root directory" },
        pattern: { type: "string", description: "Optional test file pattern or test name filter" },
        workspace: { type: "string", description: "Optional workspace/package to test (e.g. packages/cli)" },
      },
      required: ["projectRoot"],
    },
  },
  {
    name: "get_coverage",
    description:
      "Return test coverage metrics (statements, branches, functions, lines) for a project or specific package.",
    inputSchema: {
      type: "object" as const,
      properties: {
        projectRoot: { type: "string", description: "Project root directory" },
        workspace: { type: "string", description: "Optional workspace/package to measure" },
        threshold: { type: "number", description: "Optional minimum coverage % threshold (default 80)" },
      },
      required: ["projectRoot"],
    },
  },
  {
    name: "analyze_error",
    description:
      "Analyze a TypeScript/JavaScript error message or stack trace to identify root cause, affected files, and suggest targeted fixes.",
    inputSchema: {
      type: "object" as const,
      properties: {
        error: { type: "string", description: "Error message, stack trace, or compiler error text" },
        projectRoot: { type: "string", description: "Project root directory for context" },
        filePath: { type: "string", description: "Optional file path where the error occurred" },
      },
      required: ["error"],
    },
  },
  {
    name: "suggest_fix",
    description:
      "Given a failing test output or error, suggest a concrete code fix with the minimal change required to resolve the issue.",
    inputSchema: {
      type: "object" as const,
      properties: {
        error: { type: "string", description: "Error or test failure to fix" },
        code: { type: "string", description: "Optional current code context" },
        filePath: { type: "string", description: "Optional file path for context" },
        projectRoot: { type: "string", description: "Project root directory" },
      },
      required: ["error"],
    },
  },
  {
    name: "list_skills",
    description:
      "List all available DanteCode skills with their names, descriptions, and activation status.",
    inputSchema: {
      type: "object" as const,
      properties: {
        projectRoot: { type: "string", description: "Project root directory" },
        filter: { type: "string", description: "Optional keyword to filter skills by name or description" },
      },
      required: [],
    },
  },
  {
    name: "get_session_history",
    description:
      "Retrieve recent session history including tasks completed, files modified, and PDSE scores.",
    inputSchema: {
      type: "object" as const,
      properties: {
        projectRoot: { type: "string", description: "Project root directory" },
        limit: { type: "number", description: "Maximum number of sessions to return (default 10)" },
        sessionId: { type: "string", description: "Optional specific session ID to retrieve" },
      },
      required: [],
    },
  },
  {
    name: "run_benchmark",
    description:
      "Run a DanteForge competitive benchmark against a task and return a score report with dimension-level ratings.",
    inputSchema: {
      type: "object" as const,
      properties: {
        projectRoot: { type: "string", description: "Project root directory" },
        task: { type: "string", description: "Task description to benchmark" },
        dimensions: {
          type: "array",
          items: { type: "string" },
          description: "Optional list of dimensions to score (default: all 18)",
        },
      },
      required: ["projectRoot", "task"],
    },
  },
  {
    name: "get_token_usage",
    description:
      "Return current session token usage, context window utilization percentage, and budget tier.",
    inputSchema: {
      type: "object" as const,
      properties: {
        sessionId: { type: "string", description: "Optional session ID to query (defaults to current)" },
      },
      required: [],
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
