// ============================================================================
// @dantecode/cli — Tool Implementations for the Agent Loop
// Each tool reads/writes real files and executes real commands.
// ============================================================================

import { readFile, writeFile, mkdir, readdir, stat } from "node:fs/promises";
import { execSync } from "node:child_process";
import { join, dirname, resolve, relative, isAbsolute } from "node:path";
import {
  appendAuditEvent,
  isProtectedWriteTarget,
  isRepoInternalCdChain,
  isSelfImprovementWriteAllowed,
  resolvePreferredShell,
  acquireUrl,
  acquireArchive,
} from "@dantecode/core";
import type { SelfImprovementContext, TodoItem, TodoStatus } from "@dantecode/config-types";
import {
  sandboxCheckCommand,
  sandboxCheckPath,
  checkWriteSafety,
  checkContentForSecrets,
} from "./safety.js";
import {
  extractReadableArticle,
  extractByCSS,
  extractPageMetadata as extractPageMeta,
} from "./html-parser.js";
import {
  MultiEngineSearch,
  createSearchEngine,
} from "./web-search-engine.js";
import {
  synthesizeResults,
  formatSynthesizedResult,
} from "@dantecode/core";
import type { SandboxBridge } from "./sandbox-bridge.js";

// ----------------------------------------------------------------------------
// Types
// ----------------------------------------------------------------------------

/** The result returned from any tool execution. */
export interface ToolResult {
  content: string;
  isError: boolean;
}

/** Result from a sub-agent execution. */
export interface SubAgentResult {
  output: string;
  touchedFiles: string[];
  durationMs: number;
  success: boolean;
  error?: string;
}

/** Options for sub-agent spawning. */
export interface SubAgentOptions {
  /** Maximum rounds the sub-agent can execute (default: 30). */
  maxRounds?: number;
  /** Whether to run in background and return a task ID instead of waiting. */
  background?: boolean;
  /** Whether to isolate the sub-agent in a git worktree (default: false). */
  worktreeIsolation?: boolean;
}

/** Executor function type for sub-agent dispatch. Set by the agent loop. */
export type SubAgentExecutor = (
  prompt: string,
  options?: SubAgentOptions,
) => Promise<SubAgentResult>;

export interface CliToolExecutionContext {
  sessionId?: string;
  roundId?: string;
  sandboxEnabled?: boolean;
  selfImprovement?: SelfImprovementContext;
  readTracker?: Map<string, string>;
  editAttempts?: Map<string, number>;
  /** Injected by the agent loop to enable sub-agent spawning. */
  subAgentExecutor?: SubAgentExecutor;
  /**
   * When set, Bash tool commands are routed through this bridge instead of
   * using execSync directly. Routes to Docker when available, falls back to
   * LocalExecutor when Docker is not present.
   */
  sandboxBridge?: SandboxBridge;
}

/** Supported tool names. */
export type ToolName =
  | "Read"
  | "Write"
  | "Edit"
  | "Bash"
  | "Glob"
  | "Grep"
  | "GitCommit"
  | "GitPush"
  | "TodoWrite"
  | "WebSearch"
  | "WebFetch"
  | "SubAgent"
  | "GitHubSearch"
  | "GitHubOps"
  | "AcquireUrl"
  | "AcquireArchive";

// ----------------------------------------------------------------------------
// Path Resolution
// ----------------------------------------------------------------------------

/**
 * Resolves a file path relative to the project root.
 * If the path is already absolute, it is returned as-is.
 */
function resolvePath(filePath: string, projectRoot: string): string {
  if (isAbsolute(filePath)) {
    return filePath;
  }
  return resolve(projectRoot, filePath);
}

// ----------------------------------------------------------------------------
// Individual Tool Handlers
// ----------------------------------------------------------------------------

/**
 * Read tool: reads a file from disk and returns its content with line numbers.
 */
async function toolRead(
  input: Record<string, unknown>,
  projectRoot: string,
  context?: CliToolExecutionContext,
): Promise<ToolResult> {
  const filePath = input["file_path"] as string | undefined;
  if (!filePath) {
    return { content: "Error: file_path parameter is required", isError: true };
  }

  const resolved = resolvePath(filePath, projectRoot);
  const offset = typeof input["offset"] === "number" ? input["offset"] : 0;
  const limit = typeof input["limit"] === "number" ? input["limit"] : 2000;

  try {
    const raw = await readFile(resolved, "utf-8");
    const lines = raw.split("\n");
    const startLine = Math.max(0, offset);
    const endLine = Math.min(lines.length, startLine + limit);
    const selected = lines.slice(startLine, endLine);

    const numbered = selected.map((line, i) => {
      const lineNum = startLine + i + 1;
      return `${String(lineNum).padStart(6)}  ${line}`;
    });

    if (context?.readTracker && startLine === 0 && endLine >= lines.length) {
      context.readTracker.set(buildReadTrackerKey(context, resolved), new Date().toISOString());
    }

    return { content: numbered.join("\n"), isError: false };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return { content: `Error reading file: ${message}`, isError: true };
  }
}

/**
 * Write tool: writes content to a file, creating parent directories as needed.
 */
async function toolWrite(input: Record<string, unknown>, projectRoot: string): Promise<ToolResult> {
  const filePath = input["file_path"] as string | undefined;
  const content = input["content"] as string | undefined;

  if (!filePath) {
    return { content: "Error: file_path parameter is required", isError: true };
  }
  if (content === undefined) {
    return { content: "Error: content parameter is required", isError: true };
  }

  const resolved = resolvePath(filePath, projectRoot);

  try {
    await mkdir(dirname(resolved), { recursive: true });
    await writeFile(resolved, content, "utf-8");
    const lineCount = content.split("\n").length;

    // Always-on debug trail logging (non-blocking, fire-and-forget)
    try {
      const { getGlobalLogger } = await import("@dantecode/debug-trail");
      const logger = getGlobalLogger();
      if (logger) {
        void logger.logFileWrite(resolved, undefined, undefined, undefined, undefined);
      }
    } catch {
      // debug-trail is optional — never fail the tool
    }

    return {
      content: `Successfully wrote ${lineCount} lines to ${resolved}`,
      isError: false,
    };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return { content: `Error writing file: ${message}`, isError: true };
  }
}

/**
 * Edit tool: performs exact string replacement within a file.
 */
async function toolEdit(
  input: Record<string, unknown>,
  projectRoot: string,
  context?: CliToolExecutionContext,
): Promise<ToolResult> {
  const filePath = input["file_path"] as string | undefined;
  const oldString = input["old_string"] as string | undefined;
  const newString = input["new_string"] as string | undefined;
  const replaceAll = input["replace_all"] === true;

  if (!filePath) {
    return { content: "Error: file_path parameter is required", isError: true };
  }
  if (oldString === undefined) {
    return { content: "Error: old_string parameter is required", isError: true };
  }
  if (newString === undefined) {
    return { content: "Error: new_string parameter is required", isError: true };
  }

  const resolved = resolvePath(filePath, projectRoot);
  if (context?.readTracker && !context.readTracker.has(buildReadTrackerKey(context, resolved))) {
    return {
      content: `Error: Read the full current file before Edit. Re-run Read on ${resolved} with no offset/limit so the latest contents are in context.`,
      isError: true,
    };
  }

  try {
    const attemptKey = buildEditAttemptKey(context, resolved, oldString, newString);
    const attemptCount = context?.editAttempts?.get(attemptKey) ?? 0;
    if (attemptCount >= 2) {
      return {
        content: `Error: Third identical Edit attempt blocked for ${resolved} in this round. Re-read the file and switch to a smaller section rewrite or use Write with the full updated file.`,
        isError: true,
      };
    }

    const existing = await readFile(resolved, "utf-8");

    if (!existing.includes(oldString)) {
      return buildEditRecoveryResult(
        context,
        attemptKey,
        resolved,
        `Error: old_string not found in ${resolved}. The string to replace must exist exactly in the file.`,
        existing,
      );
    }

    // Check for uniqueness if not replaceAll
    if (!replaceAll) {
      const firstIndex = existing.indexOf(oldString);
      const secondIndex = existing.indexOf(oldString, firstIndex + 1);
      if (secondIndex !== -1) {
        return buildEditRecoveryResult(
          context,
          attemptKey,
          resolved,
          `Error: old_string appears multiple times in ${resolved}. Use replace_all: true to replace all occurrences, or provide a more specific string with surrounding context.`,
          existing,
        );
      }
    }

    let updated: string;
    if (replaceAll) {
      updated = existing.split(oldString).join(newString);
    } else {
      updated = existing.replace(oldString, newString);
    }

    await writeFile(resolved, updated, "utf-8");
    context?.editAttempts?.delete(attemptKey);

    const replacementCount = replaceAll ? existing.split(oldString).length - 1 : 1;

    // Always-on debug trail logging (non-blocking, fire-and-forget)
    try {
      const { getGlobalLogger } = await import("@dantecode/debug-trail");
      const logger = getGlobalLogger();
      if (logger) {
        void logger.logFileWrite(resolved, undefined, undefined, undefined, undefined);
      }
    } catch {
      // debug-trail is optional — never fail the tool
    }

    return {
      content: `Successfully edited ${resolved} (${replacementCount} replacement${replacementCount !== 1 ? "s" : ""})`,
      isError: false,
    };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return { content: `Error editing file: ${message}`, isError: true };
  }
}

/**
 * Bash tool: executes a shell command and returns stdout/stderr.
 * When context.sandboxBridge is set, routes the command through the sandbox
 * (Docker container when available, LocalExecutor fallback otherwise) instead
 * of calling execSync directly on the host. The non-sandbox execSync path is
 * preserved as the fallback when sandboxBridge is NOT present.
 */
async function toolBash(
  input: Record<string, unknown>,
  projectRoot: string,
  context?: CliToolExecutionContext,
): Promise<ToolResult> {
  const command = input["command"] as string | undefined;
  if (!command) {
    return { content: "Error: command parameter is required", isError: true };
  }

  const timeoutMs = typeof input["timeout"] === "number" ? input["timeout"] : 120000;

  // Route through sandbox bridge when enabled — real isolation via Docker or LocalExecutor.
  // This is the critical fix: when enableSandbox=true, commands are no longer executed
  // directly on the host via execSync; they go through the sandboxed executor.
  if (context?.sandboxBridge) {
    return context.sandboxBridge.runInSandbox(command, timeoutMs);
  }

  // Non-sandbox fallback: direct host execution via execSync.
  try {
    const result = execSync(command, {
      cwd: projectRoot,
      encoding: "utf-8",
      timeout: timeoutMs,
      maxBuffer: 10 * 1024 * 1024,
      stdio: ["pipe", "pipe", "pipe"],
      shell: resolvePreferredShell(),
    });
    return { content: result || "(no output)", isError: false };
  } catch (err: unknown) {
    const error = err as {
      stdout?: string;
      stderr?: string;
      status?: number;
      message?: string;
    };
    const stdout = typeof error.stdout === "string" ? error.stdout : "";
    const stderr = typeof error.stderr === "string" ? error.stderr : "";
    const exitCode = typeof error.status === "number" ? error.status : 1;
    const output = [
      stdout ? `stdout:\n${stdout}` : "",
      stderr ? `stderr:\n${stderr}` : "",
      `Exit code: ${exitCode}`,
    ]
      .filter(Boolean)
      .join("\n");
    return { content: output, isError: exitCode !== 0 };
  }
}

/**
 * Glob tool: finds files matching a glob pattern using a recursive directory walk.
 */
async function toolGlob(input: Record<string, unknown>, projectRoot: string): Promise<ToolResult> {
  const pattern = input["pattern"] as string | undefined;
  if (!pattern) {
    return { content: "Error: pattern parameter is required", isError: true };
  }

  const searchPath =
    typeof input["path"] === "string" ? resolvePath(input["path"], projectRoot) : projectRoot;

  try {
    // Convert glob pattern to regex for matching
    const regexPattern = globToRegex(pattern);
    const matches: string[] = [];
    await walkDir(searchPath, projectRoot, regexPattern, matches, 0, 10000);

    if (matches.length === 0) {
      return { content: `No files matching pattern: ${pattern}`, isError: false };
    }

    return { content: matches.join("\n"), isError: false };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return { content: `Error searching files: ${message}`, isError: true };
  }
}

/**
 * Converts a glob pattern to a regular expression.
 */
function globToRegex(pattern: string): RegExp {
  let regexStr = "";
  let i = 0;

  while (i < pattern.length) {
    const char = pattern[i]!;

    if (char === "*") {
      if (pattern[i + 1] === "*") {
        if (pattern[i + 2] === "/") {
          // **/ matches any directory depth
          regexStr += "(?:.+/)?";
          i += 3;
          continue;
        }
        // ** at end matches everything
        regexStr += ".*";
        i += 2;
        continue;
      }
      // * matches anything except /
      regexStr += "[^/]*";
      i += 1;
      continue;
    }

    if (char === "?") {
      regexStr += "[^/]";
      i += 1;
      continue;
    }

    if (char === "{") {
      const closeIdx = pattern.indexOf("}", i);
      if (closeIdx !== -1) {
        const options = pattern.slice(i + 1, closeIdx).split(",");
        regexStr += `(?:${options.map(escapeRegExp).join("|")})`;
        i = closeIdx + 1;
        continue;
      }
    }

    if (char === "[") {
      const closeIdx = pattern.indexOf("]", i);
      if (closeIdx !== -1) {
        regexStr += pattern.slice(i, closeIdx + 1);
        i = closeIdx + 1;
        continue;
      }
    }

    // Escape special regex characters
    regexStr += escapeRegExp(char);
    i += 1;
  }

  return new RegExp(`^${regexStr}$`);
}

function escapeRegExp(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Recursively walks a directory tree, collecting files that match the pattern.
 */
async function walkDir(
  dir: string,
  baseDir: string,
  pattern: RegExp,
  matches: string[],
  depth: number,
  maxFiles: number,
): Promise<void> {
  if (depth > 20 || matches.length >= maxFiles) return;

  const skipDirs = new Set([
    "node_modules",
    ".git",
    "dist",
    ".next",
    "__pycache__",
    ".dantecode/worktrees",
    ".cache",
    ".turbo",
    "coverage",
  ]);

  let entries: string[];
  try {
    entries = await readdir(dir);
  } catch {
    return;
  }

  for (const entry of entries) {
    if (matches.length >= maxFiles) return;
    if (skipDirs.has(entry)) continue;

    const fullPath = join(dir, entry);
    let entryStat;
    try {
      entryStat = await stat(fullPath);
    } catch {
      continue;
    }

    const relativePath = relative(baseDir, fullPath).replace(/\\/g, "/");

    if (entryStat.isDirectory()) {
      await walkDir(fullPath, baseDir, pattern, matches, depth + 1, maxFiles);
    } else if (entryStat.isFile()) {
      if (pattern.test(relativePath) || pattern.test(entry)) {
        matches.push(fullPath);
      }
    }
  }
}

/**
 * Grep tool: searches file contents for a regex pattern.
 */
async function toolGrep(input: Record<string, unknown>, projectRoot: string): Promise<ToolResult> {
  const pattern = input["pattern"] as string | undefined;
  if (!pattern) {
    return { content: "Error: pattern parameter is required", isError: true };
  }

  const searchPath =
    typeof input["path"] === "string" ? resolvePath(input["path"], projectRoot) : projectRoot;

  const caseInsensitive = input["-i"] === true;
  const contextLines = typeof input["context"] === "number" ? input["context"] : 0;
  const outputMode = (input["output_mode"] as string) || "files_with_matches";
  const headLimit = typeof input["head_limit"] === "number" ? input["head_limit"] : 50;

  try {
    const flags = caseInsensitive ? "gi" : "g";
    const regex = new RegExp(pattern, flags);
    const results: string[] = [];

    // Check if searchPath is a file or directory
    const pathStat = await stat(searchPath);
    if (pathStat.isFile()) {
      const content = await readFile(searchPath, "utf-8");
      const fileResults = searchFileContent(searchPath, content, regex, outputMode, contextLines);
      results.push(...fileResults);
    } else {
      // Search directory recursively
      await grepDir(
        searchPath,
        projectRoot,
        regex,
        outputMode,
        contextLines,
        results,
        0,
        headLimit,
      );
    }

    if (results.length === 0) {
      return { content: `No matches found for pattern: ${pattern}`, isError: false };
    }

    const limited = headLimit > 0 ? results.slice(0, headLimit) : results;
    return { content: limited.join("\n"), isError: false };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return { content: `Error searching: ${message}`, isError: true };
  }
}

/**
 * Searches the content of a single file for regex matches.
 */
function searchFileContent(
  filePath: string,
  content: string,
  regex: RegExp,
  outputMode: string,
  contextLines: number,
): string[] {
  const lines = content.split("\n");
  const matchingLineNums: number[] = [];

  for (let i = 0; i < lines.length; i++) {
    // Reset regex lastIndex for global regex
    regex.lastIndex = 0;
    if (regex.test(lines[i]!)) {
      matchingLineNums.push(i);
    }
  }

  if (matchingLineNums.length === 0) return [];

  if (outputMode === "files_with_matches") {
    return [filePath];
  }

  if (outputMode === "count") {
    return [`${filePath}:${matchingLineNums.length}`];
  }

  // content mode
  const results: string[] = [];
  for (const lineNum of matchingLineNums) {
    const startLine = Math.max(0, lineNum - contextLines);
    const endLine = Math.min(lines.length - 1, lineNum + contextLines);

    for (let i = startLine; i <= endLine; i++) {
      const prefix = i === lineNum ? ">" : " ";
      results.push(`${filePath}:${i + 1}:${prefix} ${lines[i]}`);
    }

    if (contextLines > 0) {
      results.push("--");
    }
  }

  return results;
}

/**
 * Recursively searches a directory for file contents matching a regex.
 */
async function grepDir(
  dir: string,
  baseDir: string,
  regex: RegExp,
  outputMode: string,
  contextLines: number,
  results: string[],
  depth: number,
  maxResults: number,
): Promise<void> {
  if (depth > 20 || results.length >= maxResults) return;

  const skipDirs = new Set([
    "node_modules",
    ".git",
    "dist",
    ".next",
    "__pycache__",
    ".dantecode/worktrees",
    ".cache",
    ".turbo",
    "coverage",
  ]);

  const textExtensions = new Set([
    ".ts",
    ".tsx",
    ".js",
    ".jsx",
    ".mjs",
    ".cjs",
    ".json",
    ".yaml",
    ".yml",
    ".toml",
    ".md",
    ".mdx",
    ".css",
    ".scss",
    ".html",
    ".xml",
    ".svg",
    ".py",
    ".rb",
    ".rs",
    ".go",
    ".java",
    ".c",
    ".cpp",
    ".h",
    ".sh",
    ".bash",
    ".zsh",
    ".fish",
    ".env",
    ".gitignore",
    ".dockerignore",
    ".txt",
    ".csv",
    ".sql",
    ".graphql",
  ]);

  let entries: string[];
  try {
    entries = await readdir(dir);
  } catch {
    return;
  }

  for (const entry of entries) {
    if (results.length >= maxResults) return;
    if (skipDirs.has(entry)) continue;

    const fullPath = join(dir, entry);
    let entryStat;
    try {
      entryStat = await stat(fullPath);
    } catch {
      continue;
    }

    if (entryStat.isDirectory()) {
      await grepDir(
        fullPath,
        baseDir,
        regex,
        outputMode,
        contextLines,
        results,
        depth + 1,
        maxResults,
      );
    } else if (entryStat.isFile()) {
      // Only search text files
      const ext = fullPath.slice(fullPath.lastIndexOf(".")).toLowerCase();
      if (!textExtensions.has(ext) && entry !== "Makefile" && entry !== "Dockerfile") {
        continue;
      }

      // Skip large files (> 1MB)
      if (entryStat.size > 1024 * 1024) continue;

      try {
        const content = await readFile(fullPath, "utf-8");
        const fileResults = searchFileContent(fullPath, content, regex, outputMode, contextLines);
        results.push(...fileResults);
      } catch {
        // Skip files that can't be read
      }
    }
  }
}

/**
 * GitCommit tool: stages files and creates a commit using the git-engine.
 */
async function toolGitCommit(
  input: Record<string, unknown>,
  projectRoot: string,
): Promise<ToolResult> {
  const message = input["message"] as string | undefined;
  if (!message) {
    return { content: "Error: message parameter is required", isError: true };
  }

  const files = Array.isArray(input["files"]) ? (input["files"] as string[]) : [];

  try {
    // Dynamic import to avoid circular dependency issues at startup
    const { autoCommit } = await import("@dantecode/git-engine");

    const result = autoCommit(
      {
        message,
        footer:
          "Generated with DanteCode (https://dantecode.dev)\n\nCo-Authored-By: DanteCode <noreply@dantecode.dev>",
        files,
        allowEmpty: false,
      },
      projectRoot,
    );

    return {
      content: `Commit created: ${result.commitHash}\nMessage: ${result.message}\nFiles: ${result.filesCommitted.join(", ")}`,
      isError: false,
    };
  } catch (err: unknown) {
    const message_ = err instanceof Error ? err.message : String(err);
    return { content: `Error committing: ${message_}`, isError: true };
  }
}

/**
 * GitPush tool: pushes a branch and verifies the remote ref matches local HEAD.
 */
async function toolGitPush(
  input: Record<string, unknown>,
  projectRoot: string,
): Promise<ToolResult> {
  const remote = typeof input["remote"] === "string" ? input["remote"] : undefined;
  const branch = typeof input["branch"] === "string" ? input["branch"] : undefined;
  const setUpstream = input["set_upstream"] === true || input["setUpstream"] === true;

  try {
    const { pushBranch } = await import("@dantecode/git-engine");

    const result = pushBranch({ remote, branch, setUpstream }, projectRoot);

    return {
      content:
        `Push verified: ${result.remote}/${result.branch}\n` +
        `Local HEAD: ${result.localCommit}\n` +
        `Remote ref: ${result.remoteCommit}` +
        (result.output ? `\nOutput: ${result.output}` : ""),
      isError: false,
    };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return { content: `Error pushing: ${message}`, isError: true };
  }
}

/**
 * TodoWrite tool: manages the session's to-do list.
 * Accepts a full replacement of the todo list.
 */
async function toolTodoWrite(
  input: Record<string, unknown>,
  _projectRoot: string,
): Promise<ToolResult> {
  const todos = input["todos"] as Array<Record<string, unknown>> | undefined;
  if (!todos || !Array.isArray(todos)) {
    return { content: "Error: todos array parameter is required", isError: true };
  }

  const formattedTodos: TodoItem[] = todos.map((t, i) => ({
    id: String(t["id"] || `todo-${i + 1}`),
    text: String(t["content"] || t["text"] || ""),
    status: (t["status"] as TodoStatus) || "pending",
    createdAt: new Date().toISOString(),
    completedAt: t["status"] === "completed" ? new Date().toISOString() : undefined,
  }));

  const display = formattedTodos
    .map((t) => {
      const statusIcon =
        t.status === "completed" ? "[x]" : t.status === "in_progress" ? "[~]" : "[ ]";
      return `${statusIcon} ${t.text}`;
    })
    .join("\n");

  return {
    content: `Updated ${formattedTodos.length} to-do items:\n${display}`,
    isError: false,
  };
}

// ----------------------------------------------------------------------------
// WebSearch + WebFetch
// ----------------------------------------------------------------------------

/** Shared search engine instance (lazy init). */
let _searchEngine: MultiEngineSearch | null = null;
function getSearchEngine(): MultiEngineSearch {
  if (!_searchEngine) _searchEngine = createSearchEngine();
  return _searchEngine;
}

/** Simple in-memory cache for web fetch results. */
const webFetchCache = new Map<string, { content: string; timestamp: number }>();
const WEB_CACHE_TTL_MS = 15 * 60 * 1000; // 15 minutes

function getCachedFetchResult(key: string): string | null {
  const entry = webFetchCache.get(key);
  if (entry && Date.now() - entry.timestamp < WEB_CACHE_TTL_MS) {
    return entry.content;
  }
  webFetchCache.delete(key);
  return null;
}

function setCachedFetchResult(key: string, content: string): void {
  webFetchCache.set(key, { content, timestamp: Date.now() });
}

/**
 * WebSearch tool: multi-provider search with RRF ranking, semantic reranking,
 * citation synthesis, and cost-aware provider selection.
 * Providers: Tavily (primary), Exa, Serper, Google CSE, Brave, DuckDuckGo.
 */
async function toolWebSearch(
  input: Record<string, unknown>,
  _projectRoot: string,
): Promise<ToolResult> {
  const query = input["query"] as string | undefined;
  if (!query) {
    return { content: "Error: query parameter is required", isError: true };
  }

  const maxResults = typeof input["max_results"] === "number" ? Math.min(input["max_results"], 20) : 15;
  const provider = (input["provider"] as string | undefined) ?? undefined;
  const searchDepth = (input["search_depth"] as "basic" | "advanced" | undefined) ?? "basic";
  const followUp = input["follow_up"] === true;
  const includeCitations = input["include_citations"] !== false; // default true
  const includeRawContent = input["include_raw_content"] === true;
  const topic = (input["topic"] as "general" | "news" | undefined) ?? undefined;

  try {
    const searcher = getSearchEngine();

    // Use the orchestrated search for full metadata
    const orchestrated = await searcher.orchestratedSearch(query, {
      maxResults,
      preferredProvider: provider,
      searchDepth,
      followUp,
      includeRawContent,
      topic,
    });

    if (orchestrated.results.length === 0) {
      return { content: `No search results found for: "${query}"`, isError: false };
    }

    const results = orchestrated.results;

    // Build formatted results
    const formatted = results
      .map((r, i) => {
        const parts = [`${i + 1}. **${r.title}**`, `   URL: ${r.url}`];
        if (r.snippet) parts.push(`   ${r.snippet}`);
        if (r.source && r.source.includes("+")) parts.push(`   Sources: ${r.source}`);
        if (r.relevanceScore !== undefined) parts.push(`   Relevance: ${(r.relevanceScore * 100).toFixed(0)}%`);
        return parts.join("\n");
      })
      .join("\n\n");

    // Build provider info
    const providerInfo = orchestrated.providersUsed.length > 1
      ? ` (providers: ${orchestrated.providersUsed.join(", ")})`
      : orchestrated.providersUsed.length === 1
        ? ` (${orchestrated.providersUsed[0]})`
        : "";

    const costInfo = orchestrated.totalCost > 0 ? ` | cost: $${orchestrated.totalCost.toFixed(4)}` : "";

    let output = `Search results for "${query}"${providerInfo} (${results.length} results${costInfo}):\n\n${formatted}`;

    // Add citation synthesis if enabled
    if (includeCitations) {
      const synthesis = synthesizeResults(results, query, { useRawContent: includeRawContent });
      if (synthesis.confidence > 0) {
        const citationBlock = formatSynthesizedResult(synthesis);
        output += `\n\n---\n**Synthesis** (confidence: ${(synthesis.confidence * 100).toFixed(0)}%):\n${citationBlock}`;
      }
    }

    return { content: output, isError: false };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return { content: `WebSearch error: ${message}`, isError: true };
  }
}

/**
 * WebFetch tool: fetches a URL with proper HTML parsing, readability extraction,
 * CSS selector support, and page metadata extraction.
 */
async function toolWebFetch(
  input: Record<string, unknown>,
  _projectRoot: string,
): Promise<ToolResult> {
  const url = input["url"] as string | undefined;
  if (!url) {
    return { content: "Error: url parameter is required", isError: true };
  }

  // Validate URL
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(url);
  } catch {
    return { content: `Error: invalid URL: ${url}`, isError: true };
  }

  // Block non-HTTP(S) protocols
  if (!parsedUrl.protocol.startsWith("http")) {
    return { content: `Error: only HTTP/HTTPS URLs are supported, got ${parsedUrl.protocol}`, isError: true };
  }

  const maxChars = typeof input["max_chars"] === "number" ? input["max_chars"] : 20000;
  const selector = input["selector"] as string | undefined;
  const raw = input["raw"] === true;

  const cacheKey = `fetch:${url}:${maxChars}:${selector ?? ""}:${raw}`;
  const cached = getCachedFetchResult(cacheKey);
  if (cached) {
    return { content: cached, isError: false };
  }

  try {
    const response = await fetch(url, {
      headers: {
        "User-Agent": "DanteCode/1.0 (CLI agent tool)",
        Accept: "text/html, application/json, text/plain, */*",
      },
      redirect: "follow",
      signal: AbortSignal.timeout(15000),
    });

    if (!response.ok) {
      return {
        content: `WebFetch failed: HTTP ${response.status} ${response.statusText} for ${url}`,
        isError: true,
      };
    }

    const contentType = response.headers.get("content-type") ?? "";
    const body = await response.text();

    let content: string;

    if (raw || contentType.includes("application/json") || contentType.includes("text/plain")) {
      // Return raw content (JSON, plain text)
      content = body;
    } else {
      // Apply CSS selector extraction if requested
      if (selector) {
        const selectorContent = extractByCSS(body, selector);
        content = selectorContent ?? extractReadableArticle(body);
      } else {
        // Smart content extraction via readability algorithm
        content = extractReadableArticle(body);
      }
    }

    // Truncate to max_chars
    if (content.length > maxChars) {
      content = content.slice(0, maxChars) + `\n\n... (truncated at ${maxChars} chars, total: ${content.length})`;
    }

    // Extract page metadata for context
    let metaHeader = "";
    if (contentType.includes("html")) {
      const meta = extractPageMeta(body);
      const parts: string[] = [];
      if (meta.title) parts.push(`Title: ${meta.title}`);
      if (meta.description) parts.push(`Description: ${meta.description}`);
      if (meta.author) parts.push(`Author: ${meta.author}`);
      if (parts.length > 0) metaHeader = parts.join("\n") + "\n\n";
    }

    const output = `Fetched ${url} (${contentType || "unknown type"}, ${body.length} bytes):\n\n${metaHeader}${content}`;
    setCachedFetchResult(cacheKey, output);
    return { content: output, isError: false };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return { content: `WebFetch error: ${message}`, isError: true };
  }
}

// ----------------------------------------------------------------------------
// Sub-Agent Spawning
// ----------------------------------------------------------------------------

/**
 * SubAgent tool: spawns a sub-agent to handle a specific task and returns
 * the result. Requires a subAgentExecutor to be set in the execution context
 * (wired up by the agent loop).
 */
async function toolSubAgent(
  input: Record<string, unknown>,
  _projectRoot: string,
  context?: CliToolExecutionContext,
): Promise<ToolResult> {
  const prompt = input["prompt"] as string | undefined;
  if (!prompt) {
    return { content: "Error: prompt parameter is required", isError: true };
  }

  if (!context?.subAgentExecutor) {
    return {
      content: "Error: Sub-agent execution is not available in the current context. The agent loop must provide a subAgentExecutor.",
      isError: true,
    };
  }

  const maxRounds = typeof input["max_rounds"] === "number" ? Math.min(input["max_rounds"], 100) : 30;
  const background = input["background"] === true;
  const worktreeIsolation = input["worktree_isolation"] === true;

  try {
    const result = await context.subAgentExecutor(prompt, { maxRounds, background, worktreeIsolation });

    if (!result.success) {
      return {
        content: `Sub-agent failed (${result.durationMs}ms): ${result.error ?? "unknown error"}\n\nPartial output:\n${result.output}`,
        isError: true,
      };
    }

    if (background) {
      return { content: result.output, isError: false };
    }

    const parts: string[] = [
      `Sub-agent completed successfully (${result.durationMs}ms).`,
    ];

    if (result.touchedFiles.length > 0) {
      parts.push(`\nFiles modified (${result.touchedFiles.length}):`);
      for (const f of result.touchedFiles.slice(0, 20)) {
        parts.push(`  - ${f}`);
      }
      if (result.touchedFiles.length > 20) {
        parts.push(`  ... and ${result.touchedFiles.length - 20} more`);
      }
    }

    parts.push(`\nOutput:\n${result.output}`);

    return { content: parts.join("\n"), isError: false };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return { content: `SubAgent error: ${message}`, isError: true };
  }
}

// ----------------------------------------------------------------------------
// GitHub Search
// ----------------------------------------------------------------------------

/**
 * GitHubSearch tool: searches GitHub repos, code, issues, or PRs using the `gh` CLI.
 * Wraps common `gh search` and `gh api` patterns into a structured tool.
 */
async function toolGitHubSearch(
  input: Record<string, unknown>,
  projectRoot: string,
): Promise<ToolResult> {
  const query = input["query"] as string | undefined;
  if (!query) {
    return { content: "Error: query parameter is required", isError: true };
  }

  const searchType = (input["type"] as string) || "repos";
  const limit = typeof input["limit"] === "number" ? Math.min(input["limit"], 50) : 10;

  // Validate search type
  const validTypes = ["repos", "code", "issues", "prs"];
  if (!validTypes.includes(searchType)) {
    return {
      content: `Error: type must be one of: ${validTypes.join(", ")}`,
      isError: true,
    };
  }

  // Build gh command based on search type
  let command: string;
  switch (searchType) {
    case "repos":
      command = `gh search repos ${JSON.stringify(query)} --limit ${limit} --json name,url,description,stargazersCount,language,updatedAt`;
      break;
    case "code":
      command = `gh search code ${JSON.stringify(query)} --limit ${limit} --json repository,path,textMatches`;
      break;
    case "issues":
      command = `gh search issues ${JSON.stringify(query)} --limit ${limit} --json title,url,state,repository,createdAt,labels`;
      break;
    case "prs":
      command = `gh search prs ${JSON.stringify(query)} --limit ${limit} --json title,url,state,repository,createdAt,labels`;
      break;
    default:
      command = `gh search repos ${JSON.stringify(query)} --limit ${limit} --json name,url,description,stargazersCount`;
  }

  try {
    const result = execSync(command, {
      cwd: projectRoot,
      encoding: "utf-8",
      timeout: 30000,
      maxBuffer: 5 * 1024 * 1024,
      stdio: ["pipe", "pipe", "pipe"],
      shell: resolvePreferredShell(),
    });

    // Parse JSON output from gh
    let parsed: unknown[];
    try {
      parsed = JSON.parse(result);
    } catch {
      return { content: result || "(no output)", isError: false };
    }

    if (!Array.isArray(parsed) || parsed.length === 0) {
      return { content: `No ${searchType} found for: "${query}"`, isError: false };
    }

    // Format results based on type
    const formatted = formatGitHubResults(searchType, parsed);
    return {
      content: `GitHub ${searchType} search for "${query}" (${parsed.length} results):\n\n${formatted}`,
      isError: false,
    };
  } catch (err: unknown) {
    const error = err as { stderr?: string; message?: string };
    const stderr = typeof error.stderr === "string" ? error.stderr : "";
    if (stderr.includes("gh: command not found") || stderr.includes("not recognized")) {
      return {
        content: "Error: GitHub CLI (gh) is not installed or not in PATH. Install from https://cli.github.com/",
        isError: true,
      };
    }
    if (stderr.includes("not logged in") || stderr.includes("auth login")) {
      return {
        content: "Error: GitHub CLI is not authenticated. Run `gh auth login` first.",
        isError: true,
      };
    }
    const message = stderr || (err instanceof Error ? err.message : String(err));
    return { content: `GitHubSearch error: ${message}`, isError: true };
  }
}

/**
 * Formats GitHub search results into readable text.
 */
function formatGitHubResults(type: string, results: unknown[]): string {
  switch (type) {
    case "repos":
      return (results as Array<{
        name?: string;
        url?: string;
        description?: string;
        stargazersCount?: number;
        language?: string;
        updatedAt?: string;
      }>)
        .map((r, i) => {
          const parts = [`${i + 1}. **${r.name ?? "unknown"}**`];
          if (r.description) parts.push(`   ${r.description}`);
          parts.push(`   URL: ${r.url ?? "N/A"}`);
          const meta: string[] = [];
          if (r.stargazersCount !== undefined) meta.push(`${r.stargazersCount} stars`);
          if (r.language) meta.push(r.language);
          if (r.updatedAt) meta.push(`updated ${r.updatedAt.slice(0, 10)}`);
          if (meta.length > 0) parts.push(`   ${meta.join(" | ")}`);
          return parts.join("\n");
        })
        .join("\n\n");

    case "code":
      return (results as Array<{
        repository?: { nameWithOwner?: string };
        path?: string;
        textMatches?: Array<{ fragment?: string }>;
      }>)
        .map((r, i) => {
          const repo = r.repository?.nameWithOwner ?? "unknown";
          const path = r.path ?? "unknown";
          const parts = [`${i + 1}. ${repo}/${path}`];
          if (r.textMatches?.[0]?.fragment) {
            parts.push(`   ${r.textMatches[0].fragment.slice(0, 200)}`);
          }
          return parts.join("\n");
        })
        .join("\n\n");

    case "issues":
    case "prs":
      return (results as Array<{
        title?: string;
        url?: string;
        state?: string;
        repository?: { nameWithOwner?: string };
        createdAt?: string;
        labels?: Array<{ name?: string }>;
      }>)
        .map((r, i) => {
          const parts = [`${i + 1}. **${r.title ?? "untitled"}** [${r.state ?? "unknown"}]`];
          parts.push(`   ${r.repository?.nameWithOwner ?? "unknown"}`);
          parts.push(`   URL: ${r.url ?? "N/A"}`);
          const labels = r.labels?.map((l) => l.name).filter(Boolean).join(", ");
          if (labels) parts.push(`   Labels: ${labels}`);
          return parts.join("\n");
        })
        .join("\n\n");

    default:
      return JSON.stringify(results, null, 2);
  }
}

// ----------------------------------------------------------------------------
// GitHubOps — full GitHub operations via `gh` CLI
// ----------------------------------------------------------------------------

/** Valid GitHubOps actions */
type GitHubOpsAction =
  | "search_repos" | "search_code" | "search_issues" | "search_prs"
  | "create_pr" | "view_pr" | "review_pr" | "merge_pr" | "list_prs"
  | "create_issue" | "comment_issue" | "close_issue" | "list_issues"
  | "trigger_workflow" | "view_run";

const VALID_ACTIONS = new Set<string>([
  "search_repos", "search_code", "search_issues", "search_prs",
  "create_pr", "view_pr", "review_pr", "merge_pr", "list_prs",
  "create_issue", "comment_issue", "close_issue", "list_issues",
  "trigger_workflow", "view_run",
]);

/**
 * Execute a `gh` command and return stdout. Throws on failure.
 */
function execGh(command: string, projectRoot: string): string {
  return execSync(command, {
    cwd: projectRoot,
    encoding: "utf-8",
    timeout: 30000,
    maxBuffer: 5 * 1024 * 1024,
    stdio: ["pipe", "pipe", "pipe"],
    shell: resolvePreferredShell(),
  });
}

/**
 * GitHubOps tool: comprehensive GitHub operations via the `gh` CLI.
 * Superset of GitHubSearch — adds PR, issue, review, and workflow ops.
 */
async function toolGitHubOps(
  input: Record<string, unknown>,
  projectRoot: string,
): Promise<ToolResult> {
  const action = (input["action"] as string) || "search_repos";

  if (!VALID_ACTIONS.has(action)) {
    return {
      content: `Error: action must be one of: ${[...VALID_ACTIONS].join(", ")}`,
      isError: true,
    };
  }

  try {
    switch (action as GitHubOpsAction) {
      // ---- Search operations (delegate to existing logic) ----
      case "search_repos":
      case "search_code":
      case "search_issues":
      case "search_prs": {
        const searchType = action.replace("search_", "");
        return toolGitHubSearch(
          { ...input, type: searchType },
          projectRoot,
        );
      }

      // ---- PR operations ----
      case "create_pr": {
        const title = input["title"] as string;
        const body = input["body"] as string | undefined;
        const base = input["base"] as string | undefined;
        const draft = input["draft"] as boolean | undefined;
        if (!title) return { content: "Error: title is required for create_pr", isError: true };

        const args = [`gh pr create --title ${JSON.stringify(title)}`];
        if (body) args.push(`--body ${JSON.stringify(body)}`);
        if (base) args.push(`--base ${JSON.stringify(base)}`);
        if (draft) args.push("--draft");
        const out = execGh(args.join(" "), projectRoot);
        return { content: `PR created:\n${out.trim()}`, isError: false };
      }

      case "view_pr": {
        const number = input["number"] as number | undefined;
        if (!number) return { content: "Error: number is required for view_pr", isError: true };
        const out = execGh(
          `gh pr view ${number} --json title,state,url,body,author,reviewDecision,mergeable,additions,deletions,changedFiles`,
          projectRoot,
        );
        const pr = JSON.parse(out);
        const lines = [
          `**#${number}: ${pr.title}** [${pr.state}]`,
          `Author: ${pr.author?.login ?? "unknown"} | Review: ${pr.reviewDecision ?? "NONE"}`,
          `Mergeable: ${pr.mergeable ?? "unknown"} | +${pr.additions ?? 0} -${pr.deletions ?? 0} (${pr.changedFiles ?? 0} files)`,
          `URL: ${pr.url}`,
        ];
        if (pr.body) lines.push("", pr.body.slice(0, 1000));
        return { content: lines.join("\n"), isError: false };
      }

      case "review_pr": {
        const number = input["number"] as number | undefined;
        const reviewAction = input["review_action"] as string | undefined;
        const body = input["body"] as string | undefined;
        if (!number) return { content: "Error: number is required for review_pr", isError: true };

        const validReviewActions = ["approve", "request-changes", "comment"];
        const ra = reviewAction || "comment";
        if (!validReviewActions.includes(ra)) {
          return { content: `Error: review_action must be one of: ${validReviewActions.join(", ")}`, isError: true };
        }

        const args = [`gh pr review ${number} --${ra}`];
        if (body) args.push(`--body ${JSON.stringify(body)}`);
        const out = execGh(args.join(" "), projectRoot);
        return { content: `PR #${number} reviewed (${ra}):\n${out.trim()}`, isError: false };
      }

      case "merge_pr": {
        const number = input["number"] as number | undefined;
        const method = input["merge_method"] as string | undefined;
        if (!number) return { content: "Error: number is required for merge_pr", isError: true };

        const validMethods = ["merge", "squash", "rebase"];
        const mm = method || "merge";
        if (!validMethods.includes(mm)) {
          return { content: `Error: merge_method must be one of: ${validMethods.join(", ")}`, isError: true };
        }

        const out = execGh(`gh pr merge ${number} --${mm}`, projectRoot);
        return { content: `PR #${number} merged (${mm}):\n${out.trim()}`, isError: false };
      }

      case "list_prs": {
        const state = (input["state"] as string) || "open";
        const limit = typeof input["limit"] === "number" ? Math.min(input["limit"] as number, 50) : 10;
        const out = execGh(
          `gh pr list --state ${state} --limit ${limit} --json number,title,state,url,author,createdAt,headRefName`,
          projectRoot,
        );
        const prs = JSON.parse(out) as Array<{
          number?: number; title?: string; state?: string; url?: string;
          author?: { login?: string }; createdAt?: string; headRefName?: string;
        }>;
        if (prs.length === 0) return { content: `No ${state} PRs found.`, isError: false };
        const lines = prs.map((pr, i) =>
          `${i + 1}. #${pr.number ?? "?"} **${pr.title ?? "untitled"}** [${pr.state ?? "?"}]\n   Branch: ${pr.headRefName ?? "?"} | Author: ${pr.author?.login ?? "?"}\n   ${pr.url ?? ""}`
        );
        return { content: `PRs (${state}, ${prs.length} results):\n\n${lines.join("\n\n")}`, isError: false };
      }

      // ---- Issue operations ----
      case "create_issue": {
        const title = input["title"] as string;
        const body = input["body"] as string | undefined;
        const labels = input["labels"] as string[] | string | undefined;
        if (!title) return { content: "Error: title is required for create_issue", isError: true };

        const args = [`gh issue create --title ${JSON.stringify(title)}`];
        if (body) args.push(`--body ${JSON.stringify(body)}`);
        if (labels) {
          const labelList = Array.isArray(labels) ? labels.join(",") : labels;
          args.push(`--label ${JSON.stringify(labelList)}`);
        }
        const out = execGh(args.join(" "), projectRoot);
        return { content: `Issue created:\n${out.trim()}`, isError: false };
      }

      case "comment_issue": {
        const number = input["number"] as number | undefined;
        const body = input["body"] as string | undefined;
        if (!number) return { content: "Error: number is required for comment_issue", isError: true };
        if (!body) return { content: "Error: body is required for comment_issue", isError: true };

        const out = execGh(`gh issue comment ${number} --body ${JSON.stringify(body)}`, projectRoot);
        return { content: `Comment added to #${number}:\n${out.trim()}`, isError: false };
      }

      case "close_issue": {
        const number = input["number"] as number | undefined;
        const reason = input["reason"] as string | undefined;
        if (!number) return { content: "Error: number is required for close_issue", isError: true };

        const args = [`gh issue close ${number}`];
        if (reason) args.push(`--reason ${JSON.stringify(reason)}`);
        const out = execGh(args.join(" "), projectRoot);
        return { content: `Issue #${number} closed:\n${out.trim()}`, isError: false };
      }

      case "list_issues": {
        const state = (input["state"] as string) || "open";
        const limit = typeof input["limit"] === "number" ? Math.min(input["limit"] as number, 50) : 10;
        const labels = input["labels"] as string[] | string | undefined;
        const args = [`gh issue list --state ${state} --limit ${limit} --json number,title,state,url,author,createdAt,labels`];
        if (labels) {
          const labelList = Array.isArray(labels) ? labels.join(",") : labels;
          args.push(`--label ${JSON.stringify(labelList)}`);
        }
        const out = execGh(args.join(" "), projectRoot);
        const issues = JSON.parse(out) as Array<{
          number?: number; title?: string; state?: string; url?: string;
          author?: { login?: string }; labels?: Array<{ name?: string }>;
        }>;
        if (issues.length === 0) return { content: `No ${state} issues found.`, isError: false };
        const lines = issues.map((iss, i) => {
          const lbls = iss.labels?.map(l => l.name).filter(Boolean).join(", ");
          return `${i + 1}. #${iss.number ?? "?"} **${iss.title ?? "untitled"}** [${iss.state ?? "?"}]${lbls ? `\n   Labels: ${lbls}` : ""}\n   ${iss.url ?? ""}`;
        });
        return { content: `Issues (${state}, ${issues.length} results):\n\n${lines.join("\n\n")}`, isError: false };
      }

      // ---- Workflow operations ----
      case "trigger_workflow": {
        const workflow = input["workflow"] as string | undefined;
        const ref = input["ref"] as string | undefined;
        if (!workflow) return { content: "Error: workflow is required for trigger_workflow", isError: true };

        const args = [`gh workflow run ${JSON.stringify(workflow)}`];
        if (ref) args.push(`--ref ${JSON.stringify(ref)}`);
        const out = execGh(args.join(" "), projectRoot);
        return { content: `Workflow triggered:\n${out.trim() || "(dispatched successfully)"}`, isError: false };
      }

      case "view_run": {
        const runId = input["run_id"] as string | number | undefined;
        if (!runId) return { content: "Error: run_id is required for view_run", isError: true };

        const out = execGh(
          `gh run view ${runId} --json status,conclusion,name,url,createdAt,updatedAt,headBranch,event`,
          projectRoot,
        );
        const run = JSON.parse(out);
        const lines = [
          `**${run.name ?? "Run"}** [${run.status}${run.conclusion ? ` — ${run.conclusion}` : ""}]`,
          `Branch: ${run.headBranch ?? "?"} | Event: ${run.event ?? "?"}`,
          `Created: ${run.createdAt ?? "?"} | Updated: ${run.updatedAt ?? "?"}`,
          `URL: ${run.url ?? "N/A"}`,
        ];
        return { content: lines.join("\n"), isError: false };
      }

      default:
        return { content: `Unknown action: ${action}`, isError: true };
    }
  } catch (err: unknown) {
    const error = err as { stderr?: string; message?: string };
    const stderr = typeof error.stderr === "string" ? error.stderr : "";
    if (stderr.includes("gh: command not found") || stderr.includes("not recognized")) {
      return {
        content: "Error: GitHub CLI (gh) is not installed or not in PATH. Install from https://cli.github.com/",
        isError: true,
      };
    }
    if (stderr.includes("not logged in") || stderr.includes("auth login")) {
      return {
        content: "Error: GitHub CLI is not authenticated. Run `gh auth login` first.",
        isError: true,
      };
    }
    const message = stderr || (err instanceof Error ? err.message : String(err));
    return { content: `GitHubOps error: ${message}`, isError: true };
  }
}

// ----------------------------------------------------------------------------
// Main Dispatcher
// ----------------------------------------------------------------------------

/**
 * Dispatches a tool call to the appropriate handler, executes it, and returns
 * the result string. Also records the action in the audit log when possible.
 *
 * @param name - The name of the tool to execute.
 * @param input - The input parameters for the tool.
 * @param projectRoot - Absolute path to the project root directory.
 * @param sessionId - The current session ID for audit logging.
 * @param sandboxEnabled - When true, dangerous commands and out-of-root writes are blocked.
 * @returns The tool execution result.
 */
export async function executeTool(
  name: string,
  input: Record<string, unknown>,
  projectRoot: string,
  sessionOrContext: string | CliToolExecutionContext = "cli-session",
  sandboxEnabled: boolean = false,
): Promise<ToolResult> {
  const context = normalizeExecutionContext(sessionOrContext, sandboxEnabled);

  // Sandbox: check file path for Write/Edit
  if (context.sandboxEnabled && (name === "Write" || name === "Edit")) {
    const fp = input["file_path"] as string | undefined;
    if (fp) {
      const blocked = sandboxCheckPath(fp, projectRoot, true);
      if (blocked) return blocked;
    }
  }

  // Sandbox: check command for Bash
  if (context.sandboxEnabled && name === "Bash") {
    const cmd = input["command"] as string | undefined;
    if (cmd) {
      const blocked = sandboxCheckCommand(cmd, true);
      if (blocked) return blocked;
    }
  }

  if (context.sandboxEnabled && name === "GitPush") {
    return {
      content:
        "Sandbox: git push is blocked while sandbox mode is enabled. Disable sandbox to push to a remote.",
      isError: true,
    };
  }

  if (name === "Bash") {
    const command = input["command"] as string | undefined;
    if (command && isRepoInternalCdChain(command, projectRoot)) {
      return {
        content:
          "Error: Run this from the repository root instead of chaining `cd ... &&`. Re-issue the command from the root worktree so verification and audit paths stay consistent.",
        isError: true,
      };
    }
  }

  // Write/Edit safety hooks (always active, not just sandbox mode)
  if (name === "Write" || name === "Edit") {
    const fp = input["file_path"] as string | undefined;
    if (fp) {
      if (isProtectedWriteTarget(fp, projectRoot)) {
        await appendSelfModificationAudit(projectRoot, context, "self_modification_attempt", fp);
        if (!isSelfImprovementWriteAllowed(fp, projectRoot, context.selfImprovement)) {
          await appendSelfModificationAudit(projectRoot, context, "self_modification_denied", fp);
          return {
            content: `Self-modification blocked: ${fp}. Protected source edits require an explicit self-improvement workflow such as /autoforge --self-improve or /party --autoforge.`,
            isError: true,
          };
        }
        await appendSelfModificationAudit(projectRoot, context, "self_modification_allowed", fp);
      }

      const writeBlock = checkWriteSafety(fp);
      if (writeBlock) {
        return { content: `SAFETY: ${writeBlock}`, isError: true };
      }
    }
    if (name === "Write") {
      const content = input["content"] as string | undefined;
      if (content) {
        const secretWarning = checkContentForSecrets(content);
        if (secretWarning) {
          return {
            content: `SAFETY: ${secretWarning}. Use environment variables instead of hardcoding secrets.`,
            isError: true,
          };
        }
      }
    }
  }

  let result: ToolResult;

  switch (name) {
    case "Read":
      result = await toolRead(input, projectRoot, context);
      break;
    case "Write":
      result = await toolWrite(input, projectRoot);
      break;
    case "Edit":
      result = await toolEdit(input, projectRoot, context);
      break;
    case "Bash":
      result = await toolBash(input, projectRoot, context);
      break;
    case "Glob":
      result = await toolGlob(input, projectRoot);
      break;
    case "Grep":
      result = await toolGrep(input, projectRoot);
      break;
    case "GitCommit":
      result = await toolGitCommit(input, projectRoot);
      break;
    case "GitPush":
      result = await toolGitPush(input, projectRoot);
      break;
    case "TodoWrite":
      result = await toolTodoWrite(input, projectRoot);
      break;
    case "WebSearch":
      result = await toolWebSearch(input, projectRoot);
      break;
    case "WebFetch":
      result = await toolWebFetch(input, projectRoot);
      break;
    case "SubAgent":
      result = await toolSubAgent(input, projectRoot, context);
      break;
    case "GitHubSearch":
      result = await toolGitHubSearch(input, projectRoot);
      break;
    case "GitHubOps":
      result = await toolGitHubOps(input, projectRoot);
      break;
    case "AcquireUrl": {
      const acquireResult = await acquireUrl({
        url: input["url"] as string,
        dest: input["dest"] as string,
        projectRoot,
        minSizeBytes: typeof input["min_size_bytes"] === "number" ? input["min_size_bytes"] : undefined,
        overwrite: input["overwrite"] === true,
        timeoutMs: typeof input["timeout_ms"] === "number" ? input["timeout_ms"] : undefined,
      });
      result = { content: acquireResult.content, isError: acquireResult.isError };
      break;
    }
    case "AcquireArchive": {
      const archiveResult = await acquireArchive({
        url: input["url"] as string,
        extractTo: input["extract_to"] as string,
        projectRoot,
        stripComponents: typeof input["strip_components"] === "number" ? input["strip_components"] : undefined,
        overwrite: input["overwrite"] === true,
        timeoutMs: typeof input["timeout_ms"] === "number" ? input["timeout_ms"] : undefined,
      });
      result = { content: archiveResult.content, isError: archiveResult.isError };
      break;
    }
    default:
      result = { content: `Unknown tool: ${name}`, isError: true };
  }

  // Record audit event for file-modifying tools
  const auditableTools = new Set(["Write", "Edit", "Bash", "GitCommit", "GitPush"]);
  if (auditableTools.has(name)) {
    const auditTypeMap: Record<string, string> = {
      Write: "file_write",
      Edit: "file_edit",
      Bash: "bash_execute",
      GitCommit: "git_commit",
      GitPush: "git_push",
    };
    try {
      await appendAuditEvent(projectRoot, {
        sessionId: context.sessionId ?? "cli-session",
        timestamp: new Date().toISOString(),
        type: auditTypeMap[name]! as
          | "file_write"
          | "file_edit"
          | "bash_execute"
          | "git_commit"
          | "git_push",
        payload: {
          tool: name,
          input: sanitizeForAudit(input),
          success: !result.isError,
        },
        modelId: "cli",
        projectRoot,
      });
    } catch {
      // Audit logging failures should not break tool execution
    }
  }

  return result;
}

function normalizeExecutionContext(
  sessionOrContext: string | CliToolExecutionContext,
  sandboxEnabled: boolean,
): CliToolExecutionContext {
  if (typeof sessionOrContext === "string") {
    return {
      sessionId: sessionOrContext,
      roundId: "default-round",
      sandboxEnabled,
      readTracker: new Map(),
      editAttempts: new Map(),
    };
  }

  return {
    sessionId: sessionOrContext.sessionId ?? "cli-session",
    roundId: sessionOrContext.roundId ?? "default-round",
    sandboxEnabled: sessionOrContext.sandboxEnabled ?? sandboxEnabled,
    selfImprovement: sessionOrContext.selfImprovement,
    readTracker: sessionOrContext.readTracker ?? new Map(),
    editAttempts: sessionOrContext.editAttempts ?? new Map(),
    subAgentExecutor: sessionOrContext.subAgentExecutor,
    sandboxBridge: sessionOrContext.sandboxBridge,
  };
}

function buildReadTrackerKey(context: CliToolExecutionContext, resolvedPath: string): string {
  return `${context.roundId ?? "default-round"}:${resolvedPath}`;
}

function buildEditAttemptKey(
  context: CliToolExecutionContext | undefined,
  resolvedPath: string,
  oldString: string,
  newString: string,
): string {
  return `${context?.roundId ?? "default-round"}:${resolvedPath}:${oldString}:${newString}`;
}

function buildEditRecoveryResult(
  context: CliToolExecutionContext | undefined,
  attemptKey: string,
  _resolvedPath: string,
  message: string,
  latestContent: string,
): ToolResult {
  const attemptCount = (context?.editAttempts?.get(attemptKey) ?? 0) + 1;
  context?.editAttempts?.set(attemptKey, attemptCount);

  const guidance =
    attemptCount >= 2
      ? "Use Write with the full updated file contents or retry Edit with a smaller, uniquely identifiable section."
      : "Re-read the current file contents and retry with more specific surrounding context.";

  return {
    content: `${message}\n\nLatest file contents:\n${latestContent}\n\n${guidance}`,
    isError: true,
  };
}

async function appendSelfModificationAudit(
  projectRoot: string,
  context: CliToolExecutionContext,
  type: "self_modification_attempt" | "self_modification_allowed" | "self_modification_denied",
  filePath: string,
): Promise<void> {
  try {
    await appendAuditEvent(projectRoot, {
      sessionId: context.sessionId ?? "cli-session",
      timestamp: new Date().toISOString(),
      type,
      payload: {
        filePath,
        workflowId: context.selfImprovement?.workflowId ?? null,
        triggerCommand: context.selfImprovement?.triggerCommand ?? null,
        ...(context.selfImprovement?.auditMetadata ?? {}),
      },
      modelId: "cli",
      projectRoot,
    });
  } catch {
    // Audit failures should not block tool execution.
  }
}

/**
 * Removes sensitive fields from tool input before writing to the audit log.
 */
function sanitizeForAudit(input: Record<string, unknown>): Record<string, unknown> {
  const sanitized: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input)) {
    if (key === "content" && typeof value === "string" && value.length > 500) {
      sanitized[key] = `${value.slice(0, 500)}... (${value.length} chars total)`;
    } else {
      sanitized[key] = value;
    }
  }
  return sanitized;
}

/**
 * Returns the list of tool definitions for use in the model's system prompt.
 * These descriptions tell the LLM what tools are available and how to use them.
 */
export function getToolDefinitions(): Array<{
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}> {
  return [
    {
      name: "Read",
      description: "Read a file from disk. Returns content with line numbers.",
      parameters: {
        type: "object",
        properties: {
          file_path: { type: "string", description: "Absolute or relative file path to read" },
          offset: { type: "number", description: "Line offset to start reading from (0-indexed)" },
          limit: { type: "number", description: "Maximum number of lines to read (default: 2000)" },
        },
        required: ["file_path"],
      },
    },
    {
      name: "Write",
      description: "Write content to a file, creating parent directories as needed.",
      parameters: {
        type: "object",
        properties: {
          file_path: { type: "string", description: "Absolute or relative file path to write" },
          content: { type: "string", description: "The content to write to the file" },
        },
        required: ["file_path", "content"],
      },
    },
    {
      name: "Edit",
      description:
        "Perform an exact string replacement in a file. The old_string must appear exactly once (unless replace_all is true).",
      parameters: {
        type: "object",
        properties: {
          file_path: { type: "string", description: "Absolute or relative file path to edit" },
          old_string: { type: "string", description: "The exact string to find and replace" },
          new_string: { type: "string", description: "The replacement string" },
          replace_all: { type: "boolean", description: "Replace all occurrences (default: false)" },
        },
        required: ["file_path", "old_string", "new_string"],
      },
    },
    {
      name: "Bash",
      description: "Execute a shell command and return stdout/stderr.",
      parameters: {
        type: "object",
        properties: {
          command: { type: "string", description: "The shell command to execute" },
          timeout: { type: "number", description: "Timeout in milliseconds (default: 120000)" },
        },
        required: ["command"],
      },
    },
    {
      name: "Glob",
      description: "Find files matching a glob pattern. Supports ** for recursive matching.",
      parameters: {
        type: "object",
        properties: {
          pattern: {
            type: "string",
            description: "Glob pattern (e.g., '**/*.ts', 'src/**/*.tsx')",
          },
          path: { type: "string", description: "Base directory to search in" },
        },
        required: ["pattern"],
      },
    },
    {
      name: "Grep",
      description: "Search file contents for a regex pattern. Returns matching files or content.",
      parameters: {
        type: "object",
        properties: {
          pattern: { type: "string", description: "Regular expression pattern to search for" },
          path: { type: "string", description: "File or directory to search in" },
          output_mode: {
            type: "string",
            description: "Output mode: files_with_matches, content, or count",
          },
          context: { type: "number", description: "Lines of context around matches" },
          "-i": { type: "boolean", description: "Case-insensitive search" },
          head_limit: { type: "number", description: "Limit number of results" },
        },
        required: ["pattern"],
      },
    },
    {
      name: "GitCommit",
      description: "Stage files and create a git commit with a message.",
      parameters: {
        type: "object",
        properties: {
          message: { type: "string", description: "The commit message" },
          files: {
            type: "array",
            items: { type: "string" },
            description: "Files to stage and commit",
          },
        },
        required: ["message"],
      },
    },
    {
      name: "GitPush",
      description: "Push a branch to a remote and verify the remote ref matches local HEAD.",
      parameters: {
        type: "object",
        properties: {
          remote: { type: "string", description: "Remote name (default: origin)" },
          branch: { type: "string", description: "Branch name (default: current branch)" },
          set_upstream: {
            type: "boolean",
            description: "Set upstream tracking for the branch with git push -u",
          },
        },
        required: [],
      },
    },
    {
      name: "TodoWrite",
      description: "Update the session's to-do list with a complete replacement.",
      parameters: {
        type: "object",
        properties: {
          todos: {
            type: "array",
            items: {
              type: "object",
              properties: {
                content: { type: "string" },
                status: { type: "string", enum: ["pending", "in_progress", "completed"] },
              },
            },
            description: "The updated to-do list",
          },
        },
        required: ["todos"],
      },
    },
    {
      name: "WebSearch",
      description:
        "Search the web using multiple providers (Tavily, Exa, Serper, Google, Brave, DuckDuckGo) with reciprocal rank fusion, semantic reranking, and citation synthesis. Results cached semantically for 7 days.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "The search query" },
          max_results: {
            type: "number",
            description: "Maximum number of results to return (default: 15, max: 20)",
          },
          provider: {
            type: "string",
            enum: ["auto", "tavily", "exa", "serper", "google", "brave", "duckduckgo"],
            description: "Preferred search provider (default: auto — uses best available with cost-aware fallback)",
          },
          search_depth: {
            type: "string",
            enum: ["basic", "advanced"],
            description: "Search depth: basic (fast) or advanced (thorough). Default: basic",
          },
          follow_up: {
            type: "boolean",
            description: "Chain follow-up searches to refine results (default: false)",
          },
          include_citations: {
            type: "boolean",
            description: "Include synthesized summary with inline [N] citations (default: true)",
          },
          include_raw_content: {
            type: "boolean",
            description: "Include raw page content from supported providers (default: false)",
          },
          topic: {
            type: "string",
            enum: ["general", "news"],
            description: "Topic filter (default: general)",
          },
        },
        required: ["query"],
      },
    },
    {
      name: "WebFetch",
      description:
        "Fetch content from a URL with readability extraction. HTML is parsed into clean readable text using content density scoring. JSON and plain text returned as-is. Results are cached for 15 minutes.",
      parameters: {
        type: "object",
        properties: {
          url: { type: "string", description: "The URL to fetch (must be HTTP or HTTPS)" },
          max_chars: {
            type: "number",
            description: "Maximum characters to return (default: 20000)",
          },
          selector: {
            type: "string",
            description: "CSS selector (#id, .class, tag, tag#id, tag.class) to extract specific content",
          },
          raw: {
            type: "boolean",
            description: "Return raw content without HTML-to-text conversion (default: false)",
          },
        },
        required: ["url"],
      },
    },
    {
      name: "GitHubSearch",
      description:
        "Search GitHub for repositories, code, issues, or pull requests using the gh CLI. Requires gh to be installed and authenticated.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "The search query" },
          type: {
            type: "string",
            description: "What to search: repos, code, issues, or prs (default: repos)",
          },
          limit: {
            type: "number",
            description: "Maximum number of results (default: 10, max: 50)",
          },
        },
        required: ["query"],
      },
    },
    {
      name: "GitHubOps",
      description:
        "Perform GitHub operations via the gh CLI. Supports PR creation/review/merge, issue management, workflow triggers, and search. Superset of GitHubSearch.",
      parameters: {
        type: "object",
        properties: {
          action: {
            type: "string",
            description:
              "The operation to perform: search_repos, search_code, search_issues, search_prs, create_pr, view_pr, review_pr, merge_pr, list_prs, create_issue, comment_issue, close_issue, list_issues, trigger_workflow, view_run",
          },
          query: { type: "string", description: "Search query (for search_* actions)" },
          title: { type: "string", description: "Title (for create_pr, create_issue)" },
          body: { type: "string", description: "Body text (for create_pr, create_issue, comment_issue, review_pr)" },
          number: { type: "number", description: "PR or issue number (for view_pr, review_pr, merge_pr, comment_issue, close_issue)" },
          base: { type: "string", description: "Base branch for PR (for create_pr)" },
          draft: { type: "boolean", description: "Create as draft PR (for create_pr)" },
          review_action: {
            type: "string",
            description: "Review action: approve, request-changes, or comment (for review_pr)",
          },
          merge_method: {
            type: "string",
            description: "Merge method: merge, squash, or rebase (for merge_pr)",
          },
          state: { type: "string", description: "Filter by state: open, closed, all (for list_prs, list_issues)" },
          labels: {
            type: "string",
            description: "Comma-separated labels (for create_issue, list_issues)",
          },
          reason: { type: "string", description: "Reason for closing (for close_issue)" },
          workflow: { type: "string", description: "Workflow name or file (for trigger_workflow)" },
          ref: { type: "string", description: "Git ref for workflow (for trigger_workflow)" },
          run_id: { type: "string", description: "Run ID (for view_run)" },
          limit: { type: "number", description: "Max results (for search/list actions, default: 10, max: 50)" },
        },
        required: ["action"],
      },
    },
    {
      name: "SubAgent",
      description:
        "Spawn a sub-agent to handle a specific task. Supports worktree isolation for parallel agents and background execution. Use 'status <taskId>' prompt to check background tasks.",
      parameters: {
        type: "object",
        properties: {
          prompt: {
            type: "string",
            description: "The task description for the sub-agent, or 'status <taskId>' to check a background task",
          },
          max_rounds: {
            type: "number",
            description: "Maximum tool-calling rounds for the sub-agent (default: 30, max: 100)",
          },
          background: {
            type: "boolean",
            description: "Run in background and return task ID instead of waiting for completion (default: false)",
          },
          worktree_isolation: {
            type: "boolean",
            description: "Run in an isolated git worktree to prevent file conflicts with other agents (default: false)",
          },
        },
        required: ["prompt"],
      },
    },
  ];
}
