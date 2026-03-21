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

    GitHooksInstall: {
      description:
        "Install DanteCode git hooks (post-commit and pre-push by default) into the project's " +
        ".git/hooks/ directory so that git events are forwarded to the DanteCode event engine.",
      parameters: z.object({
        hooks: z
          .array(z.string())
          .optional()
          .describe(
            "Hook types to install. Valid values: pre-commit, post-commit, pre-push, " +
              "post-merge, pre-rebase. Defaults to ['post-commit', 'pre-push'].",
          ),
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
        "Search the web using multiple providers (Tavily, Exa, Serper, Google, Brave, DuckDuckGo) with reciprocal rank fusion, semantic reranking, and citation synthesis. Results are cached semantically for 7 days.",
      parameters: z.object({
        query: z.string().describe("The search query"),
        max_results: z
          .number()
          .optional()
          .describe("Maximum number of results to return (default: 15, max: 20)"),
        provider: z
          .enum(["auto", "tavily", "exa", "serper", "google", "brave", "duckduckgo"])
          .optional()
          .describe("Preferred search provider (default: auto — uses best available with cost-aware fallback)"),
        search_depth: z
          .enum(["basic", "advanced"])
          .optional()
          .describe("Search depth: basic (fast, <2s) or advanced (thorough). Default: basic"),
        follow_up: z
          .boolean()
          .optional()
          .describe("Chain follow-up searches to refine results (default: false)"),
        include_citations: z
          .boolean()
          .optional()
          .describe("Include synthesized summary with inline [N] citations (default: true)"),
        include_raw_content: z
          .boolean()
          .optional()
          .describe("Include raw page content from supported providers like Tavily/Exa (default: false)"),
        topic: z
          .enum(["general", "news"])
          .optional()
          .describe("Topic filter (default: general)"),
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

    GitHubOps: {
      description:
        "Perform GitHub operations via the gh CLI. Supports PR creation/review/merge, issue management, workflow triggers, and search. Superset of GitHubSearch.",
      parameters: z.object({
        action: z
          .enum([
            "search_repos", "search_code", "search_issues", "search_prs",
            "create_pr", "view_pr", "review_pr", "merge_pr", "list_prs",
            "create_issue", "comment_issue", "close_issue", "list_issues",
            "trigger_workflow", "view_run",
          ])
          .describe("The operation to perform"),
        query: z.string().optional().describe("Search query (for search_* actions)"),
        title: z.string().optional().describe("Title (for create_pr, create_issue)"),
        body: z.string().optional().describe("Body text (for create_pr, create_issue, comment_issue, review_pr)"),
        number: z.number().optional().describe("PR or issue number"),
        base: z.string().optional().describe("Base branch for PR (for create_pr)"),
        draft: z.boolean().optional().describe("Create as draft PR (for create_pr)"),
        review_action: z
          .enum(["approve", "request-changes", "comment"])
          .optional()
          .describe("Review action (for review_pr)"),
        merge_method: z
          .enum(["merge", "squash", "rebase"])
          .optional()
          .describe("Merge method (for merge_pr)"),
        state: z.string().optional().describe("Filter by state: open, closed, all"),
        labels: z.string().optional().describe("Comma-separated labels"),
        reason: z.string().optional().describe("Reason for closing (for close_issue)"),
        workflow: z.string().optional().describe("Workflow name or file (for trigger_workflow)"),
        ref: z.string().optional().describe("Git ref for workflow (for trigger_workflow)"),
        run_id: z.string().optional().describe("Run ID (for view_run)"),
        limit: z.number().optional().describe("Max results (default: 10, max: 50)"),
      }),
    },

    SubAgent: {
      description:
        "Spawn a sub-agent to handle a specific task. The sub-agent runs the same agent loop with its own context and returns the result. Supports worktree isolation for parallel agents and background execution.",
      parameters: z.object({
        prompt: z.string().describe("The task description for the sub-agent to execute, or 'status <taskId>' to check a background task"),
        max_rounds: z
          .number()
          .optional()
          .describe("Maximum tool-calling rounds for the sub-agent (default: 30, max: 100)"),
        background: z
          .boolean()
          .optional()
          .describe("Run in background and return task ID instead of waiting (default: false)"),
        worktree_isolation: z
          .boolean()
          .optional()
          .describe("Run in an isolated git worktree to prevent file conflicts with other agents (default: false)"),
      }),
    },

    AcquireUrl: {
      description:
        "Download a file from a URL to a local path. Verifies the download (size check, SHA-256 hash), registers it as a tracked artifact, and returns the local path. Use instead of `curl` or `wget` in Bash for reliable, verified downloads.",
      parameters: z.object({
        url: z.string().describe("The URL to download (must be HTTP or HTTPS)"),
        dest: z
          .string()
          .describe("Destination file path (absolute or relative to project root)"),
        min_size_bytes: z
          .number()
          .optional()
          .describe("Minimum expected size in bytes — rejects error/empty responses (default: 64)"),
        overwrite: z
          .boolean()
          .optional()
          .describe("Overwrite dest if it already exists (default: false)"),
        timeout_ms: z
          .number()
          .optional()
          .describe("Download timeout in milliseconds (default: 120000)"),
      }),
    },

    AcquireArchive: {
      description:
        "Download an archive (.tar.gz, .tgz, .zip, .tar.bz2) from a URL and extract it to a local directory. Verifies extraction produced files. Registers both the archive and extracted directory as tracked artifacts. Use for cloning OSS repositories without git when a tarball/zip is available.",
      parameters: z.object({
        url: z.string().describe("The URL of the archive to download (must be HTTP or HTTPS)"),
        extract_to: z
          .string()
          .describe("Directory to extract the archive into (absolute or relative to project root)"),
        strip_components: z
          .number()
          .optional()
          .describe("Number of leading path components to strip during extraction (default: 0). Use 1 to skip the top-level folder inside the archive."),
        overwrite: z
          .boolean()
          .optional()
          .describe("Overwrite extract_to if it already exists (default: false)"),
        timeout_ms: z
          .number()
          .optional()
          .describe("Download timeout in milliseconds (default: 120000)"),
      }),
    },
  };

  // Merge MCP tools when available
  if (mcpTools && Object.keys(mcpTools).length > 0) {
    return { ...nativeTools, ...mcpTools };
  }
  return nativeTools;
}
