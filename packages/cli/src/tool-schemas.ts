// ============================================================================
// @dantecode/cli — AI SDK Tool Schemas (Zod)
// Defines tool schemas for native AI SDK tool calling via streamText({ tools }).
// Schemas only — no execute handlers. Tool execution is managed by the agent
// loop with safety checks and audit logging.
// ============================================================================

import { z } from "zod";

/**
 * A tool schema compatible with the AI SDK's streamText({ tools }) parameter.
 * Tools are defined without `execute` handlers — the agent loop dispatches
 * tool calls through the existing executeTool() pipeline.
 */
export interface ToolSchema {
  description: string;
  parameters: z.ZodTypeAny;
}

/**
 * Returns AI SDK-compatible tool schemas for all available tools.
 * These are Zod-schema versions of the JSON Schema definitions in tools.ts.
 * When mcpTools are provided, they are merged with native tools.
 */
export function getAISDKTools(mcpTools?: Record<string, ToolSchema>): Record<string, ToolSchema> {
  const nativeTools: Record<string, ToolSchema> = {
    Read: {
      description: "Read a file from disk. Returns content with line numbers.",
      parameters: z.object({
        file_path: z.string().describe("Absolute or relative file path to read"),
        offset: z.number().optional().describe("Line offset to start reading from (0-indexed)"),
        limit: z.number().optional().describe("Maximum number of lines to read (default: 2000)"),
      }),
    },

    Write: {
      description: "Write content to a file, creating parent directories as needed.",
      parameters: z.object({
        file_path: z.string().describe("Absolute or relative file path to write"),
        content: z.string().describe("The content to write to the file"),
      }),
    },

    Edit: {
      description:
        "Perform an exact string replacement in a file. The old_string must appear exactly once (unless replace_all is true).",
      parameters: z.object({
        file_path: z.string().describe("Absolute or relative file path to edit"),
        old_string: z.string().describe("The exact string to find and replace"),
        new_string: z.string().describe("The replacement string"),
        replace_all: z.boolean().optional().describe("Replace all occurrences (default: false)"),
      }),
    },

    Bash: {
      description: "Execute a shell command and return stdout/stderr.",
      parameters: z.object({
        command: z.string().describe("The shell command to execute"),
        timeout: z.number().optional().describe("Timeout in milliseconds (default: 120000)"),
      }),
    },

    Glob: {
      description: "Find files matching a glob pattern. Supports ** for recursive matching.",
      parameters: z.object({
        pattern: z.string().describe("Glob pattern (e.g., '**/*.ts', 'src/**/*.tsx')"),
        path: z.string().optional().describe("Base directory to search in"),
      }),
    },

    Grep: {
      description: "Search file contents for a regex pattern. Returns matching files or content.",
      parameters: z.object({
        pattern: z.string().describe("Regular expression pattern to search for"),
        path: z.string().optional().describe("File or directory to search in"),
        output_mode: z
          .enum(["files_with_matches", "content", "count"])
          .optional()
          .describe("Output mode: files_with_matches, content, or count"),
        context: z.number().optional().describe("Lines of context around matches"),
        "-i": z.boolean().optional().describe("Case-insensitive search"),
        head_limit: z.number().optional().describe("Limit number of results"),
      }),
    },

    GitCommit: {
      description: "Stage files and create a git commit with a message.",
      parameters: z.object({
        message: z.string().describe("The commit message"),
        files: z.array(z.string()).optional().describe("Files to stage and commit"),
      }),
    },

    GitPush: {
      description: "Push a branch to a remote and verify that the remote ref updated.",
      parameters: z.object({
        remote: z.string().optional().describe("The remote name (default: origin)"),
        branch: z.string().optional().describe("The branch to push (default: current branch)"),
        set_upstream: z
          .boolean()
          .optional()
          .describe("Whether to pass -u and set upstream tracking for the branch"),
      }),
    },

    TodoWrite: {
      description: "Update the session's to-do list with a complete replacement.",
      parameters: z.object({
        todos: z
          .array(
            z.object({
              content: z.string(),
              status: z.enum(["pending", "in_progress", "completed"]),
            }),
          )
          .describe("The updated to-do list"),
      }),
    },

    WebSearch: {
      description:
        "Search the web using DuckDuckGo and return structured results with titles, URLs, and snippets. Results are cached for 15 minutes.",
      parameters: z.object({
        query: z.string().describe("The search query"),
        max_results: z
          .number()
          .optional()
          .describe("Maximum number of results to return (default: 10, max: 20)"),
      }),
    },

    WebFetch: {
      description:
        "Fetch content from a URL. HTML is converted to readable text. JSON and plain text are returned as-is. Results are cached for 15 minutes.",
      parameters: z.object({
        url: z.string().describe("The URL to fetch (must be HTTP or HTTPS)"),
        max_chars: z
          .number()
          .optional()
          .describe("Maximum characters to return (default: 20000)"),
        selector: z
          .string()
          .optional()
          .describe("CSS selector (#id, .class, or tag) to extract specific content"),
        raw: z
          .boolean()
          .optional()
          .describe("Return raw content without HTML-to-text conversion (default: false)"),
      }),
    },
    GitHubSearch: {
      description:
        "Search GitHub for repositories, code, issues, or pull requests using the gh CLI.",
      parameters: z.object({
        query: z.string().describe("The search query"),
        type: z
          .enum(["repos", "code", "issues", "prs"])
          .optional()
          .describe("What to search: repos, code, issues, or prs (default: repos)"),
        limit: z
          .number()
          .optional()
          .describe("Maximum number of results (default: 10, max: 50)"),
      }),
    },

    SubAgent: {
      description:
        "Spawn a sub-agent to handle a specific task. The sub-agent runs the same agent loop with its own context and returns the result.",
      parameters: z.object({
        prompt: z.string().describe("The task description for the sub-agent to execute"),
        max_rounds: z
          .number()
          .optional()
          .describe("Maximum tool-calling rounds for the sub-agent (default: 30, max: 100)"),
        background: z
          .boolean()
          .optional()
          .describe("Run in background and return task ID instead of waiting (default: false)"),
      }),
    },
  };

  // Merge MCP tools when available
  if (mcpTools && Object.keys(mcpTools).length > 0) {
    return { ...nativeTools, ...mcpTools };
  }
  return nativeTools;
}
