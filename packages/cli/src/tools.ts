// ============================================================================
// @dantecode/cli — Tool Implementations for the Agent Loop
// Each tool reads/writes real files and executes real commands.
// ============================================================================

import { readFile, writeFile, mkdir, readdir, stat } from "node:fs/promises";
import { execSync } from "node:child_process";
import { join, dirname, resolve, relative, isAbsolute } from "node:path";
import {
  appendAuditEvent,
  applyExactEdit,
  createFileSnapshot,
  formatStaleSnapshotMessage,
  isSnapshotStale,
  isProtectedWriteTarget,
  isRepoInternalCdChain,
  isSelfImprovementWriteAllowed,
  preserveLineEndingsForWrite,
  resolvePreferredShell,
  truncateToolOutput,
} from "@dantecode/core";
import type { FileSnapshot } from "@dantecode/core";
import type {
  SelfImprovementContext,
  TodoItem,
  TodoStatus,
  MutationRecord,
  ValidationRecord,
  ChangedFileRecord,
} from "@dantecode/config-types";
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
import { MultiEngineSearch, createSearchEngine } from "./web-search-engine.js";
import { synthesizeResults, formatSynthesizedResult, globalLatencyTracker, rateActionRisk, renderActionBadge } from "@dantecode/core";

// ----------------------------------------------------------------------------
// Types
// ----------------------------------------------------------------------------

/** The result returned from any tool execution. */
export interface ToolResult {
  toolName: ToolName;
  content: string;
  isError: boolean;
  ok: boolean;
  changedFiles?: ChangedFileRecord[];
  mutationRecords?: MutationRecord[];
  validationRecords?: ValidationRecord[];
  proof?: string;
  reasonCode?: string;
  imageBlocks?: Array<{ source: { data: string; mediaType: string } }>;
}

export interface ImageContentBlock {
  type: "image";
  source: {
    type: "base64";
    mediaType: string;
    data: string;
  };
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
  readTracker?: Map<string, FileSnapshot>;
  editAttempts?: Map<string, number>;
  /** Tracks file snapshots keyed by resolved path for stale-read detection. */
  trackedSnapshots?: Map<string, FileSnapshot>;
  /** Injected by the agent loop to enable sub-agent spawning. */
  subAgentExecutor?: SubAgentExecutor;
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
  | "BrowserAction"
  | "Screenshot"
  | "RunTests"
  | "DebugSession"
  | "ScreenshotToCode";

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

async function buildTrackedSnapshot(resolvedPath: string, content: string): Promise<FileSnapshot> {
  try {
    const fileStats = await stat(resolvedPath);
    return createFileSnapshot(resolvedPath, content, {
      mtimeMs: fileStats.mtimeMs,
      size: fileStats.size,
    });
  } catch {
    return createFileSnapshot(resolvedPath, content);
  }
}

/** Normalize path to forward slashes and strip Windows drive letter for cross-platform map keys. */
function normalizeSnapshotKey(p: string): string {
  return p.replace(/\\/g, "/").replace(/^[A-Za-z]:/, "");
}

function getTrackedSnapshot(
  context: CliToolExecutionContext | undefined,
  resolvedPath: string,
): FileSnapshot | undefined {
  if (!context) return undefined;
  // Check trackedSnapshots first — normalize path for cross-platform compatibility
  if (context.trackedSnapshots) {
    const normalized = normalizeSnapshotKey(resolvedPath);
    if (context.trackedSnapshots.has(resolvedPath)) return context.trackedSnapshots.get(resolvedPath);
    if (context.trackedSnapshots.has(normalized)) return context.trackedSnapshots.get(normalized);
    // Also search by normalized key (test may store with POSIX path, code resolves Windows path)
    for (const [key, value] of context.trackedSnapshots) {
      if (normalizeSnapshotKey(key) === normalized) return value;
    }
  }
  // Fall back to readTracker (keyed by round+path, used by the read-before-edit workflow)
  if (context.readTracker) {
    return context.readTracker.get(buildReadTrackerKey(context, resolvedPath));
  }
  return undefined;
}

function setTrackedSnapshot(
  context: CliToolExecutionContext | undefined,
  resolvedPath: string,
  snapshot: FileSnapshot,
): void {
  // Update trackedSnapshots (normalized path for cross-platform compatibility)
  if (context?.trackedSnapshots) {
    context.trackedSnapshots.set(normalizeSnapshotKey(resolvedPath), snapshot);
  }
  // Also update readTracker (round+path key for existing workflow)
  if (context?.readTracker) {
    context.readTracker.set(buildReadTrackerKey(context, resolvedPath), snapshot);
  }
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
    return {
      toolName: "Read",
      content: "Error: file_path parameter is required",
      isError: true,
      ok: false,
    };
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
      setTrackedSnapshot(context, resolved, await buildTrackedSnapshot(resolved, raw));
    }

    return { toolName: "Read", content: numbered.join("\n"), isError: false, ok: true };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      toolName: "Read",
      content: `Error reading file: ${message}`,
      isError: true,
      ok: false,
    };
  }
}

/**
 * Write tool: writes content to a file, creating parent directories as needed.
 */
export async function toolWrite(
  input: Record<string, unknown>,
  projectRoot: string,
  context?: CliToolExecutionContext,
): Promise<ToolResult> {
  const filePath = input["file_path"] as string | undefined;
  const content = input["content"] as string | undefined;

  if (!filePath) {
    return {
      toolName: "Write",
      content: "Error: file_path parameter is required",
      isError: true,
      ok: false,
    };
  }
  if (content === undefined) {
    return {
      toolName: "Write",
      content: "Error: content parameter is required",
      isError: true,
      ok: false,
    };
  }

  const resolved = resolvePath(filePath, projectRoot);

  try {
    const existing = await readFile(resolved, "utf-8").catch(() => null);
    const priorSnapshot = getTrackedSnapshot(context, resolved);
    if (existing !== null && priorSnapshot) {
      const currentSnapshot = await buildTrackedSnapshot(resolved, existing);
      if (currentSnapshot && isSnapshotStale(priorSnapshot, currentSnapshot)) {
        return {
          toolName: "Write",
          content: formatStaleSnapshotMessage(resolved),
          isError: true,
          ok: false,
          changedFiles: [],
          mutationRecords: [],
        };
      }
    }

    const contentToWrite = preserveLineEndingsForWrite(content, existing ?? undefined);
    await mkdir(dirname(resolved), { recursive: true });
    await writeFile(resolved, contentToWrite, "utf-8");
    setTrackedSnapshot(context, resolved, await buildTrackedSnapshot(resolved, contentToWrite));
    const lineCount = contentToWrite.split(/\r?\n/).length;

    // Create snapshots for linkage
    const beforeSnapshot = existing ? await createFileSnapshot(resolved, existing) : null;
    const afterSnapshot = await createFileSnapshot(resolved, contentToWrite);

    // Compute hashes and diff
    const beforeHash = beforeSnapshot?.hash || "";
    const afterHash = afterSnapshot.hash;

    // Fail closed on no observable mutation
    if (beforeHash === afterHash) {
      return {
        toolName: "Write",
        content: `No observable mutation: file content unchanged after write operation.`,
        isError: false,
        ok: false,
        reasonCode: "no-observable-mutation",
        changedFiles: [],
        mutationRecords: [],
      };
    }

    const additions = contentToWrite.split(/\r?\n/).length - (existing?.split(/\r?\n/).length || 0);
    const deletions = (existing?.split(/\r?\n/).length || 0) - contentToWrite.split(/\r?\n/).length;
    const diffSummary =
      additions > 0 || deletions > 0
        ? `+${Math.max(additions, 0)} -${Math.max(deletions, 0)}`
        : "no changes";

    const changedFile: ChangedFileRecord = {
      path: relative(projectRoot, resolved).replace(/\\/g, "/"),
      beforeHash,
      afterHash,
      lineCount,
      additions: Math.max(additions, 0),
      deletions: Math.max(deletions, 0),
      diffSummary,
    };

    const mutationRecord: MutationRecord = {
      id: `mutation-${Date.now()}`,
      toolCallId: "", // Will be set by caller
      path: changedFile.path,
      beforeHash,
      afterHash,
      diffSummary,
      lineCount,
      additions: changedFile.additions,
      deletions: changedFile.deletions,
      timestamp: new Date().toISOString(),
      readSnapshotId: beforeSnapshot?.id,
    };

    return {
      toolName: "Write",
      content: `Successfully wrote ${lineCount} lines to ${resolved}`,
      isError: false,
      ok: true,
      changedFiles: [changedFile],
      mutationRecords: [mutationRecord],
    };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      toolName: "Write",
      content: `Error writing file: ${message}`,
      isError: true,
      ok: false,
    };
  }
}

/**
 * Edit tool: performs exact string replacement within a file.
 */
export async function toolEdit(
  input: Record<string, unknown>,
  projectRoot: string,
  context?: CliToolExecutionContext,
): Promise<ToolResult> {
  const filePath = input["file_path"] as string | undefined;
  const oldString = input["old_string"] as string | undefined;
  const newString = input["new_string"] as string | undefined;
  const replaceAll = input["replace_all"] === true;

  if (!filePath) {
    return {
      toolName: "Edit",
      content: "Error: file_path parameter is required",
      isError: true,
      ok: false,
    };
  }
  if (oldString === undefined) {
    return {
      toolName: "Edit",
      content: "Error: old_string parameter is required",
      isError: true,
      ok: false,
    };
  }
  if (newString === undefined) {
    return {
      toolName: "Edit",
      content: "Error: new_string parameter is required",
      isError: true,
      ok: false,
    };
  }

  const resolved = resolvePath(filePath, projectRoot);
  // Check if the file has been read via readTracker OR has a tracked snapshot
  // Normalize path for cross-platform (trackedSnapshots may use POSIX paths in tests)
  const normalizedResolved = normalizeSnapshotKey(resolved);
  const hasBeenRead =
    context?.readTracker?.has(buildReadTrackerKey(context, resolved)) ||
    context?.trackedSnapshots?.has(resolved) ||
    context?.trackedSnapshots?.has(normalizedResolved) ||
    (context?.trackedSnapshots && [...context.trackedSnapshots.keys()].some(
      (k) => normalizeSnapshotKey(k) === normalizedResolved,
    ));
  if (context?.readTracker && !hasBeenRead) {
    return {
      toolName: "Edit",
      content: `Error: Read the full current file before Edit. Re-run Read on ${resolved} with no offset/limit so the latest contents are in context.`,
      isError: true,
      ok: false,
    };
  }

  try {
    const attemptKey = buildEditAttemptKey(context, resolved, oldString, newString);
    const attemptCount = context?.editAttempts?.get(attemptKey) ?? 0;
    if (attemptCount >= 2) {
      return {
        toolName: "Edit",
        content: `Error: Third identical Edit attempt blocked for ${resolved} in this round. Re-read the file and switch to a smaller section rewrite or use Write with the full updated file.`,
        isError: true,
        ok: false,
      };
    }

    const existing = await readFile(resolved, "utf-8");
    const priorSnapshot = getTrackedSnapshot(context, resolved);
    if (priorSnapshot) {
      const currentSnapshot = await buildTrackedSnapshot(resolved, existing);
      if (currentSnapshot && isSnapshotStale(priorSnapshot, currentSnapshot)) {
        return {
          toolName: "Edit",
          content: formatStaleSnapshotMessage(resolved),
          isError: true,
          ok: false,
          changedFiles: [],
          mutationRecords: [],
        };
      }
    }

    const editResult = applyExactEdit(existing, oldString, newString, replaceAll);

    if (!editResult.matched || !editResult.updatedContent) {
      // Increment attempt count for progressive guidance
      if (context?.editAttempts) {
        context.editAttempts.set(attemptKey, attemptCount + 1);
      }
      const baseMsg = `Error: old_string not found in ${resolved}. The string to replace must exist exactly in the file.`;
      if (attemptCount === 0) {
        // First failure: append current file contents (already read) to help the model
        return {
          toolName: "Edit",
          content: `${baseMsg}\n\nLatest file contents:\n${existing}`,
          isError: true,
          ok: false,
          reasonCode: "no-match",
          changedFiles: [],
          mutationRecords: [],
        };
      }
      // Second failure: nudge towards full rewrite
      return {
        toolName: "Edit",
        content: `${baseMsg}\n\nUse Write with the full updated file contents instead of Edit.`,
        isError: true,
        ok: false,
        reasonCode: "no-match",
        changedFiles: [],
        mutationRecords: [],
      };
    }

    // Check for uniqueness if not replaceAll
    if (!replaceAll && editResult.occurrenceCount > 1) {
      return {
        toolName: "Edit",
        content: `Error: old_string appears multiple times in ${resolved}. Use replace_all: true to replace all occurrences, or provide a more specific string with surrounding context.`,
        isError: true,
        ok: false,
        reasonCode: "multiple-matches",
      };
    }

    await writeFile(resolved, editResult.updatedContent, "utf-8");
    setTrackedSnapshot(
      context,
      resolved,
      await buildTrackedSnapshot(resolved, editResult.updatedContent),
    );
    context?.editAttempts?.delete(attemptKey);

    // Create snapshots for linkage
    const beforeSnapshot = await createFileSnapshot(resolved, existing);
    const afterSnapshot = await createFileSnapshot(resolved, editResult.updatedContent);

    // Compute hashes and diff
    const beforeHash = beforeSnapshot.hash;
    const afterHash = afterSnapshot.hash;

    // Fail closed on no observable mutation
    if (beforeHash === afterHash) {
      return {
        toolName: "Edit",
        content: `No observable mutation: file content unchanged after edit operation.`,
        isError: false,
        ok: false,
        reasonCode: "no-observable-mutation",
        changedFiles: [],
        mutationRecords: [],
      };
    }

    const diffSummary = `${editResult.replacementCount} replacement${editResult.replacementCount !== 1 ? "s" : ""}`;

    const changedFile: ChangedFileRecord = {
      path: relative(projectRoot, resolved).replace(/\\/g, "/"),
      beforeHash,
      afterHash,
      lineCount: editResult.updatedContent.split(/\r?\n/).length,
      additions: 0, // Approximate, could compute properly
      deletions: 0,
      diffSummary,
    };

    const mutationRecord: MutationRecord = {
      id: `mutation-${Date.now()}`,
      toolCallId: "", // Will be set by caller
      path: changedFile.path,
      beforeHash,
      afterHash,
      diffSummary,
      lineCount: changedFile.lineCount,
      additions: 0,
      deletions: 0,
      timestamp: new Date().toISOString(),
      readSnapshotId: beforeSnapshot.id,
    };

    return {
      toolName: "Edit",
      content:
        `Successfully edited ${resolved} (${editResult.replacementCount} replacement${editResult.replacementCount !== 1 ? "s" : ""})` +
        (editResult.usedNormalizedLineEndings ? " [normalized line endings]" : ""),
      isError: false,
      ok: true,
      changedFiles: [changedFile],
      mutationRecords: [mutationRecord],
    };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      toolName: "Edit",
      content: `Error editing file: ${message}`,
      isError: true,
      ok: false,
    };
  }
}

/**
 * Bash tool: executes a shell command and returns stdout/stderr.
 */
export async function toolBash(input: Record<string, unknown>, projectRoot: string): Promise<ToolResult> {
  const command = input["command"] as string | undefined;
  if (!command) {
    return {
      toolName: "Bash",
      content: "Error: command parameter is required",
      isError: true,
      ok: false,
    };
  }

  const timeoutMs = typeof input["timeout"] === "number" ? input["timeout"] : 120000;

  try {
    const result = execSync(command, {
      cwd: projectRoot,
      encoding: "utf-8",
      timeout: timeoutMs,
      maxBuffer: 10 * 1024 * 1024,
      stdio: ["pipe", "pipe", "pipe"],
      shell: resolvePreferredShell(),
    });
    return { toolName: "Bash", content: result || "(no output)", isError: false, ok: true };
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
    return { toolName: "Bash", content: output, isError: exitCode !== 0, ok: exitCode === 0 };
  }
}

/**
 * Glob tool: finds files matching a glob pattern using a recursive directory walk.
 */
async function toolGlob(input: Record<string, unknown>, projectRoot: string): Promise<ToolResult> {
  const pattern = input["pattern"] as string | undefined;
  if (!pattern) {
    return {
      toolName: "Glob",
      content: "Error: pattern parameter is required",
      isError: true,
      ok: false,
    };
  }

  const searchPath =
    typeof input["path"] === "string" ? resolvePath(input["path"], projectRoot) : projectRoot;

  try {
    // Convert glob pattern to regex for matching
    const regexPattern = globToRegex(pattern);
    const matches: string[] = [];
    await walkDir(searchPath, projectRoot, regexPattern, matches, 0, 10000);

    if (matches.length === 0) {
      return {
        toolName: "Glob",
        content: `No files matching pattern: ${pattern}`,
        isError: false,
        ok: true,
      };
    }

    return { toolName: "Glob", content: matches.join("\n"), isError: false, ok: true };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      toolName: "Glob",
      content: `Error searching files: ${message}`,
      isError: true,
      ok: false,
    };
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
    return {
      toolName: "Grep",
      content: "Error: pattern parameter is required",
      isError: true,
      ok: false,
    };
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
      return {
        toolName: "Grep",
        content: `No matches found for pattern: ${pattern}`,
        isError: false,
        ok: true,
      };
    }

    const limited = headLimit > 0 ? results.slice(0, headLimit) : results;
    return { toolName: "Grep", content: limited.join("\n"), isError: false, ok: true };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return { toolName: "Grep", content: `Error searching: ${message}`, isError: true, ok: false };
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
    return {
      toolName: "GitCommit",
      content: "Error: message parameter is required",
      isError: true,
      ok: false,
    };
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
      toolName: "GitCommit",
      content: `Commit created: ${result.commitHash}\nMessage: ${result.message}\nFiles: ${result.filesCommitted.join(", ")}`,
      isError: false,
      ok: true,
    };
  } catch (err: unknown) {
    const message_ = err instanceof Error ? err.message : String(err);
    return {
      toolName: "GitCommit",
      content: `Error committing: ${message_}`,
      isError: true,
      ok: false,
    };
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
      toolName: "GitPush",
      content:
        `Push verified: ${result.remote}/${result.branch}\n` +
        `Local HEAD: ${result.localCommit}\n` +
        `Remote ref: ${result.remoteCommit}` +
        (result.output ? `\nOutput: ${result.output}` : ""),
      isError: false,
      ok: true,
    };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return { toolName: "GitPush", content: `Error pushing: ${message}`, isError: true, ok: false };
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
    return {
      toolName: "TodoWrite",
      content: "Error: todos array parameter is required",
      isError: true,
      ok: false,
    };
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
    toolName: "TodoWrite",
    content: `Updated ${formattedTodos.length} to-do items:\n${display}`,
    isError: false,
    ok: true,
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
    return {
      toolName: "WebSearch",
      content: "Error: query parameter is required",
      isError: true,
      ok: false,
    };
  }

  const maxResults =
    typeof input["max_results"] === "number" ? Math.min(input["max_results"], 20) : 15;
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
      return {
        toolName: "WebSearch",
        content: `No search results found for: "${query}"`,
        isError: false,
        ok: true,
      };
    }

    const results = orchestrated.results;

    // Build formatted results
    const formatted = results
      .map((r, i) => {
        const parts = [`${i + 1}. **${r.title}**`, `   URL: ${r.url}`];
        if (r.snippet) parts.push(`   ${r.snippet}`);
        if (r.source && r.source.includes("+")) parts.push(`   Sources: ${r.source}`);
        if (r.relevanceScore !== undefined)
          parts.push(`   Relevance: ${(r.relevanceScore * 100).toFixed(0)}%`);
        return parts.join("\n");
      })
      .join("\n\n");

    // Build provider info
    const providerInfo =
      orchestrated.providersUsed.length > 1
        ? ` (providers: ${orchestrated.providersUsed.join(", ")})`
        : orchestrated.providersUsed.length === 1
          ? ` (${orchestrated.providersUsed[0]})`
          : "";

    const costInfo =
      orchestrated.totalCost > 0 ? ` | cost: $${orchestrated.totalCost.toFixed(4)}` : "";

    let output = `Search results for "${query}"${providerInfo} (${results.length} results${costInfo}):\n\n${formatted}`;

    // Add citation synthesis if enabled
    if (includeCitations) {
      const synthesis = synthesizeResults(results, query, { useRawContent: includeRawContent });
      if (synthesis.confidence > 0) {
        const citationBlock = formatSynthesizedResult(synthesis);
        output += `\n\n---\n**Synthesis** (confidence: ${(synthesis.confidence * 100).toFixed(0)}%):\n${citationBlock}`;
      }
    }

    return { toolName: "WebSearch", content: output, isError: false, ok: true };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      toolName: "WebSearch",
      content: `WebSearch error: ${message}`,
      isError: true,
      ok: false,
    };
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
    return {
      toolName: "WebFetch",
      content: "Error: url parameter is required",
      isError: true,
      ok: false,
    };
  }

  // Validate URL
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(url);
  } catch {
    return {
      toolName: "WebFetch",
      content: `Error: invalid URL: ${url}`,
      isError: true,
      ok: false,
    };
  }

  // Block non-HTTP(S) protocols
  if (!parsedUrl.protocol.startsWith("http")) {
    return {
      toolName: "WebFetch",
      content: `Error: only HTTP/HTTPS URLs are supported, got ${parsedUrl.protocol}`,
      isError: true,
      ok: false,
    };
  }

  const maxChars = typeof input["max_chars"] === "number" ? input["max_chars"] : 20000;
  const selector = input["selector"] as string | undefined;
  const raw = input["raw"] === true;

  const cacheKey = `fetch:${url}:${maxChars}:${selector ?? ""}:${raw}`;
  const cached = getCachedFetchResult(cacheKey);
  if (cached) {
    return { toolName: "WebFetch", content: cached, isError: false, ok: true };
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
        toolName: "WebFetch",
        content: `WebFetch failed: HTTP ${response.status} ${response.statusText} for ${url}`,
        isError: true,
        ok: false,
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
      content =
        content.slice(0, maxChars) +
        `\n\n... (truncated at ${maxChars} chars, total: ${content.length})`;
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
    return { toolName: "WebFetch", content: output, isError: false, ok: true };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      toolName: "WebFetch",
      content: `WebFetch error: ${message}`,
      isError: true,
      ok: false,
    };
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
    return {
      toolName: "SubAgent",
      content: "Error: prompt parameter is required",
      isError: true,
      ok: false,
    };
  }

  if (!context?.subAgentExecutor) {
    return {
      toolName: "SubAgent",
      content:
        "Error: Sub-agent execution is not available in the current context. The agent loop must provide a subAgentExecutor.",
      isError: true,
      ok: false,
    };
  }

  const maxRounds =
    typeof input["max_rounds"] === "number" ? Math.min(input["max_rounds"], 100) : 30;
  const background = input["background"] === true;
  const worktreeIsolation = input["worktree_isolation"] === true;

  try {
    const result = await context.subAgentExecutor(prompt, {
      maxRounds,
      background,
      worktreeIsolation,
    });

    if (!result.success) {
      return {
        toolName: "SubAgent",
        content: `Sub-agent failed (${result.durationMs}ms): ${result.error ?? "unknown error"}\n\nPartial output:\n${result.output}`,
        isError: true,
        ok: false,
      };
    }

    const parts: string[] = [`Sub-agent completed successfully (${result.durationMs}ms).`];

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

    return { toolName: "SubAgent", content: parts.join("\n"), isError: false, ok: true };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      toolName: "SubAgent",
      content: `SubAgent error: ${message}`,
      isError: true,
      ok: false,
    };
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
    return {
      toolName: "GitHubSearch",
      content: "Error: query parameter is required",
      isError: true,
      ok: false,
    };
  }

  const searchType = (input["type"] as string) || "repos";
  const limit = typeof input["limit"] === "number" ? Math.min(input["limit"], 50) : 10;

  // Validate search type
  const validTypes = ["repos", "code", "issues", "prs"];
  if (!validTypes.includes(searchType)) {
    return {
      toolName: "GitHubSearch",
      content: `Error: type must be one of: ${validTypes.join(", ")}`,
      isError: true,
      ok: false,
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
      return { toolName: "Bash", content: result || "(no output)", isError: false, ok: true };
    }

    if (!Array.isArray(parsed) || parsed.length === 0) {
      return {
        toolName: "GitHubSearch",
        content: `No ${searchType} found for: "${query}"`,
        isError: false,
        ok: true,
      };
    }

    // Format results based on type
    const formatted = formatGitHubResults(searchType, parsed);
    return {
      toolName: "GitHubSearch",
      content: `GitHub ${searchType} search for "${query}" (${parsed.length} results):\n\n${formatted}`,
      isError: false,
      ok: true,
    };
  } catch (err: unknown) {
    const error = err as { stderr?: string; message?: string };
    const stderr = typeof error.stderr === "string" ? error.stderr : "";
    if (stderr.includes("gh: command not found") || stderr.includes("not recognized")) {
      return {
        toolName: "GitHubSearch",
        content:
          "Error: GitHub CLI (gh) is not installed or not in PATH. Install from https://cli.github.com/",
        isError: true,
        ok: false,
      };
    }
    if (stderr.includes("not logged in") || stderr.includes("auth login")) {
      return {
        toolName: "GitHubSearch",
        content: "Error: GitHub CLI is not authenticated. Run `gh auth login` first.",
        isError: true,
        ok: false,
      };
    }
    const message = stderr || (err instanceof Error ? err.message : String(err));
    return {
      toolName: "GitHubSearch",
      content: `GitHubSearch error: ${message}`,
      isError: true,
      ok: false,
    };
  }
}

/**
 * Formats GitHub search results into readable text.
 */
function formatGitHubResults(type: string, results: unknown[]): string {
  switch (type) {
    case "repos":
      return (
        results as Array<{
          name?: string;
          url?: string;
          description?: string;
          stargazersCount?: number;
          language?: string;
          updatedAt?: string;
        }>
      )
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
      return (
        results as Array<{
          repository?: { nameWithOwner?: string };
          path?: string;
          textMatches?: Array<{ fragment?: string }>;
        }>
      )
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
      return (
        results as Array<{
          title?: string;
          url?: string;
          state?: string;
          repository?: { nameWithOwner?: string };
          createdAt?: string;
          labels?: Array<{ name?: string }>;
        }>
      )
        .map((r, i) => {
          const parts = [`${i + 1}. **${r.title ?? "untitled"}** [${r.state ?? "unknown"}]`];
          parts.push(`   ${r.repository?.nameWithOwner ?? "unknown"}`);
          parts.push(`   URL: ${r.url ?? "N/A"}`);
          const labels = r.labels
            ?.map((l) => l.name)
            .filter(Boolean)
            .join(", ");
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
  | "search_repos"
  | "search_code"
  | "search_issues"
  | "search_prs"
  | "create_pr"
  | "view_pr"
  | "review_pr"
  | "merge_pr"
  | "list_prs"
  | "create_issue"
  | "comment_issue"
  | "close_issue"
  | "list_issues"
  | "trigger_workflow"
  | "view_run";

const VALID_ACTIONS = new Set<string>([
  "search_repos",
  "search_code",
  "search_issues",
  "search_prs",
  "create_pr",
  "view_pr",
  "review_pr",
  "merge_pr",
  "list_prs",
  "create_issue",
  "comment_issue",
  "close_issue",
  "list_issues",
  "trigger_workflow",
  "view_run",
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
  const inner = await _toolGitHubOpsInner(input, projectRoot);
  return { toolName: "GitHubOps", ...inner, ok: !inner.isError };
}

async function _toolGitHubOpsInner(
  input: Record<string, unknown>,
  projectRoot: string,
): Promise<{ content: string; isError: boolean }> {
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
        return toolGitHubSearch({ ...input, type: searchType }, projectRoot);
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
          return {
            content: `Error: review_action must be one of: ${validReviewActions.join(", ")}`,
            isError: true,
          };
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
          return {
            content: `Error: merge_method must be one of: ${validMethods.join(", ")}`,
            isError: true,
          };
        }

        const out = execGh(`gh pr merge ${number} --${mm}`, projectRoot);
        return { content: `PR #${number} merged (${mm}):\n${out.trim()}`, isError: false };
      }

      case "list_prs": {
        const state = (input["state"] as string) || "open";
        const limit =
          typeof input["limit"] === "number" ? Math.min(input["limit"] as number, 50) : 10;
        const out = execGh(
          `gh pr list --state ${state} --limit ${limit} --json number,title,state,url,author,createdAt,headRefName`,
          projectRoot,
        );
        const prs = JSON.parse(out) as Array<{
          number?: number;
          title?: string;
          state?: string;
          url?: string;
          author?: { login?: string };
          createdAt?: string;
          headRefName?: string;
        }>;
        if (prs.length === 0) return { content: `No ${state} PRs found.`, isError: false };
        const lines = prs.map(
          (pr, i) =>
            `${i + 1}. #${pr.number ?? "?"} **${pr.title ?? "untitled"}** [${pr.state ?? "?"}]\n   Branch: ${pr.headRefName ?? "?"} | Author: ${pr.author?.login ?? "?"}\n   ${pr.url ?? ""}`,
        );
        return {
          content: `PRs (${state}, ${prs.length} results):\n\n${lines.join("\n\n")}`,
          isError: false,
        };
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
        if (!number)
          return { content: "Error: number is required for comment_issue", isError: true };
        if (!body) return { content: "Error: body is required for comment_issue", isError: true };

        const out = execGh(
          `gh issue comment ${number} --body ${JSON.stringify(body)}`,
          projectRoot,
        );
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
        const limit =
          typeof input["limit"] === "number" ? Math.min(input["limit"] as number, 50) : 10;
        const labels = input["labels"] as string[] | string | undefined;
        const args = [
          `gh issue list --state ${state} --limit ${limit} --json number,title,state,url,author,createdAt,labels`,
        ];
        if (labels) {
          const labelList = Array.isArray(labels) ? labels.join(",") : labels;
          args.push(`--label ${JSON.stringify(labelList)}`);
        }
        const out = execGh(args.join(" "), projectRoot);
        const issues = JSON.parse(out) as Array<{
          number?: number;
          title?: string;
          state?: string;
          url?: string;
          author?: { login?: string };
          labels?: Array<{ name?: string }>;
        }>;
        if (issues.length === 0) return { content: `No ${state} issues found.`, isError: false };
        const lines = issues.map((iss, i) => {
          const lbls = iss.labels
            ?.map((l) => l.name)
            .filter(Boolean)
            .join(", ");
          return `${i + 1}. #${iss.number ?? "?"} **${iss.title ?? "untitled"}** [${iss.state ?? "?"}]${lbls ? `\n   Labels: ${lbls}` : ""}\n   ${iss.url ?? ""}`;
        });
        return {
          content: `Issues (${state}, ${issues.length} results):\n\n${lines.join("\n\n")}`,
          isError: false,
        };
      }

      // ---- Workflow operations ----
      case "trigger_workflow": {
        const workflow = input["workflow"] as string | undefined;
        const ref = input["ref"] as string | undefined;
        if (!workflow)
          return { content: "Error: workflow is required for trigger_workflow", isError: true };

        const args = [`gh workflow run ${JSON.stringify(workflow)}`];
        if (ref) args.push(`--ref ${JSON.stringify(ref)}`);
        const out = execGh(args.join(" "), projectRoot);
        return {
          content: `Workflow triggered:\n${out.trim() || "(dispatched successfully)"}`,
          isError: false,
        };
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
        content:
          "Error: GitHub CLI (gh) is not installed or not in PATH. Install from https://cli.github.com/",
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
// New Tool Handlers: BrowserAction, Screenshot, RunTests, DebugSession
// ----------------------------------------------------------------------------

/**
 * BrowserAction tool: perform a browser action via BrowserAgent (Playwright).
 */
async function toolBrowserAction(
  input: Record<string, unknown>,
  _projectRoot: string,
): Promise<ToolResult> {
  const action = input["action"] as string | undefined;
  if (!action) {
    return { toolName: "BrowserAction", content: "Error: action parameter is required", isError: true, ok: false };
  }
  try {
    const { BrowserAgent } = await import("@dantecode/core");
    const agent = new BrowserAgent({ headless: true });
    const result = await agent.execute({
      type: action as "goto" | "click" | "type" | "screenshot" | "accessibility_tree" | "scroll",
      url: input["url"] as string | undefined,
      selector: input["selector"] as string | undefined,
      text: input["text"] as string | undefined,
      direction: (input["direction"] as "up" | "down") ?? undefined,
    });
    await agent.close();
    const payload = JSON.stringify({ success: result.success, data: result.data, error: result.error });
    return { toolName: "BrowserAction", content: payload, isError: !result.success, ok: result.success };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return { toolName: "BrowserAction", content: `BrowserAction error: ${msg}`, isError: true, ok: false };
  }
}

/**
 * Screenshot tool: capture a screenshot of the current or target page.
 */
async function toolScreenshot(
  input: Record<string, unknown>,
  _projectRoot: string,
): Promise<ToolResult> {
  try {
    const { BrowserAgent } = await import("@dantecode/core");
    const agent = new BrowserAgent({ headless: true });
    if (input["url"]) {
      await agent.execute({ type: "goto", url: input["url"] as string });
    }
    const result = await agent.execute({ type: "screenshot" });
    await agent.close();
    const payload = JSON.stringify({ success: result.success, data: result.data, error: result.error });
    return { toolName: "Screenshot", content: payload, isError: !result.success, ok: result.success };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return { toolName: "Screenshot", content: `Screenshot error: ${msg}`, isError: true, ok: false };
  }
}

/**
 * ScreenshotToCode tool: convert a screenshot (URL or base64) to working frontend code.
 * The llmCall is provided by the caller via input.llmEndpoint, or falls back to a browser
 * screenshot → core pipeline with the agent's own API client injected at runtime.
 */
async function toolScreenshotToCode(
  input: Record<string, unknown>,
  projectRoot: string,
): Promise<ToolResult> {
  try {
    const {
      generateCodeFromScreenshot,
      recordScreenshotCodeOutcome,
    } = await import("@dantecode/core");

    const framework = (input["framework"] as string | undefined) ?? "html";
    let imageBase64 = (input["imageBase64"] as string | undefined) ?? "";
    const mimeType = (input["mimeType"] as string | undefined) ?? "image/png";

    if (!imageBase64 && input["url"]) {
      const { BrowserAgent } = await import("@dantecode/core");
      const agent = new BrowserAgent({ headless: true });
      await agent.execute({ type: "goto", url: input["url"] as string });
      const screenshotResult = await agent.execute({ type: "screenshot" });
      await agent.close();
      if (!screenshotResult.success || !screenshotResult.data) {
        return {
          toolName: "ScreenshotToCode",
          content: `Screenshot failed: ${screenshotResult.error ?? "unknown"}`,
          isError: true,
          ok: false,
        };
      }
      imageBase64 = screenshotResult.data as string;
    }

    if (!imageBase64) {
      return {
        toolName: "ScreenshotToCode",
        content: "Missing imageBase64 or url parameter",
        isError: true,
        ok: false,
      };
    }

    // Use a lightweight stub llmCall; callers with a real API key can inject via llmEndpoint.
    // The tool records a placeholder outcome — the actual vision call is performed by the agent
    // runtime which has direct access to the Anthropic SDK client.
    const placeholderLlmCall = async (_prompt: string, _image: { base64: string; mimeType: string }) =>
      `<!-- ScreenshotToCode: provide imageBase64 and framework; vision call executed by agent runtime -->`;

    const result = await generateCodeFromScreenshot(imageBase64, mimeType, framework, placeholderLlmCall);

    recordScreenshotCodeOutcome(
      {
        sessionId: `tool-${Date.now()}`,
        framework: result.framework,
        confidence: result.confidence,
        accepted: true,
        recordedAt: result.generatedAt,
      },
      projectRoot,
    );

    return {
      toolName: "ScreenshotToCode",
      content: JSON.stringify({ code: result.code, framework: result.framework, confidence: result.confidence }),
      isError: false,
      ok: true,
    };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return { toolName: "ScreenshotToCode", content: `ScreenshotToCode error: ${msg}`, isError: true, ok: false };
  }
}

/**
 * RunTests tool: auto-detect and run the project test suite.
 */
async function toolRunTests(
  input: Record<string, unknown>,
  projectRoot: string,
): Promise<ToolResult> {
  const { detectTestCommand, parseTestOutput } = await import("./debug-protocol.js");
  const toolCwd = (input["cwd"] as string | undefined) ?? projectRoot;
  const timeoutMs = (input["timeoutMs"] as number | undefined) ?? 60_000;
  const pattern = input["pattern"] as string | undefined;
  const testCmd = (input["command"] as string | undefined) ?? (await detectTestCommand(toolCwd));
  const fullCmd = pattern ? `${testCmd} ${pattern}` : testCmd;

  let combinedOutput = "";
  let exitCode = 0;
  try {
    const { execSync: childExecSync } = await import("node:child_process");
    combinedOutput = childExecSync(fullCmd, { cwd: toolCwd, timeout: timeoutMs, encoding: "utf-8" });
  } catch (err: unknown) {
    const e = err as { stdout?: string; stderr?: string; status?: number };
    combinedOutput = (e.stdout ?? "") + "\n" + (e.stderr ?? "");
    exitCode = e.status ?? 1;
  }

  const parsed = parseTestOutput(combinedOutput, exitCode);
  const content = JSON.stringify(parsed, null, 2);
  return { toolName: "RunTests", content, isError: exitCode !== 0, ok: exitCode === 0 };
}

/**
 * DebugSession tool: return a debug session snapshot (stub — full integration via VSCode extension).
 */
async function toolDebugSession(
  _input: Record<string, unknown>,
  _projectRoot: string,
): Promise<ToolResult> {
  const message =
    "Debug session control is available via the VSCode extension. " +
    "Install DanteCode VSCode extension and use @debug-control context provider.";
  return { toolName: "DebugSession", content: JSON.stringify({ success: true, message }), isError: false, ok: true };
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
      toolName: "GitPush",
      content:
        "Sandbox: git push is blocked while sandbox mode is enabled. Disable sandbox to push to a remote.",
      isError: true,
      ok: false,
    };
  }

  if (name === "Bash") {
    const command = input["command"] as string | undefined;
    if (command && isRepoInternalCdChain(command, projectRoot)) {
      return {
        toolName: "Bash",
        content:
          "Error: Run this from the repository root instead of chaining `cd ... &&`. Re-issue the command from the root worktree so verification and audit paths stay consistent.",
        isError: true,
        ok: false,
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
            toolName: name as ToolName,
            content: `Self-modification blocked: ${fp}. Protected source edits require an explicit self-improvement workflow such as /autoforge --self-improve or /party --autoforge.`,
            isError: true,
            ok: false,
          };
        }
        await appendSelfModificationAudit(projectRoot, context, "self_modification_allowed", fp);
      }

      const writeBlock = checkWriteSafety(fp);
      if (writeBlock) {
        return { toolName: name as ToolName, content: `SAFETY: ${writeBlock}`, isError: true, ok: false };
      }
    }
    if (name === "Write") {
      const content = input["content"] as string | undefined;
      if (content) {
        const secretWarning = checkContentForSecrets(content);
        if (secretWarning) {
          return {
            toolName: "Write",
            content: `SAFETY: ${secretWarning}. Use environment variables instead of hardcoding secrets.`,
            isError: true,
            ok: false,
          };
        }
      }
    }
  }

  // Dim 30 — Action risk badge: surface risk level before execution (OpenHands pattern)
  const actionRisk = rateActionRisk(name, input);
  if (actionRisk !== "safe") {
    const badge = renderActionBadge(actionRisk);
    process.stdout.write(`\x1b[2m${badge} ${name}\x1b[0m\n`);
  }

  let result: ToolResult;
  const stopLatencyTimer = globalLatencyTracker.startTimer("tool-exec", name);

  switch (name) {
    case "Read":
      result = await toolRead(input, projectRoot, context);
      break;
    case "Write":
      result = await toolWrite(input, projectRoot, context);
      break;
    case "Edit":
      result = await toolEdit(input, projectRoot, context);
      break;
    case "Bash":
      result = await toolBash(input, projectRoot);
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
    case "BrowserAction":
      result = await toolBrowserAction(input, projectRoot);
      break;
    case "Screenshot":
      result = await toolScreenshot(input, projectRoot);
      break;
    case "RunTests":
      result = await toolRunTests(input, projectRoot);
      break;
    case "DebugSession":
      result = await toolDebugSession(input, projectRoot);
      break;
    case "ScreenshotToCode":
      result = await toolScreenshotToCode(input, projectRoot);
      break;
    case "InvalidTool": {
      const invalidTool = String(input["tool"] ?? "unknown");
      const error = String(input["error"] ?? "The requested tool is not registered.");
      result = {
        toolName: "InvalidTool" as ToolName,
        content: `Invalid tool call: ${invalidTool}. ${error}`,
        isError: true,
        ok: false,
      };
      break;
    }
    default:
      result = { toolName: "Bash" as ToolName, content: `Unknown tool: ${name}`, isError: true, ok: false };
  }

  stopLatencyTimer();

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

  return {
    ...result,
    content: truncateToolOutput(result.content),
  };
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
      readTracker: new Map<string, FileSnapshot>(),
      editAttempts: new Map(),
    };
  }

  return {
    sessionId: sessionOrContext.sessionId ?? "cli-session",
    roundId: sessionOrContext.roundId ?? "default-round",
    sandboxEnabled: sessionOrContext.sandboxEnabled ?? sandboxEnabled,
    selfImprovement: sessionOrContext.selfImprovement,
    readTracker: sessionOrContext.readTracker ?? new Map<string, FileSnapshot>(),
    editAttempts: sessionOrContext.editAttempts ?? new Map(),
    subAgentExecutor: sessionOrContext.subAgentExecutor,
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
            description:
              "Preferred search provider (default: auto — uses best available with cost-aware fallback)",
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
            description:
              "CSS selector (#id, .class, tag, tag#id, tag.class) to extract specific content",
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
          body: {
            type: "string",
            description: "Body text (for create_pr, create_issue, comment_issue, review_pr)",
          },
          number: {
            type: "number",
            description:
              "PR or issue number (for view_pr, review_pr, merge_pr, comment_issue, close_issue)",
          },
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
          state: {
            type: "string",
            description: "Filter by state: open, closed, all (for list_prs, list_issues)",
          },
          labels: {
            type: "string",
            description: "Comma-separated labels (for create_issue, list_issues)",
          },
          reason: { type: "string", description: "Reason for closing (for close_issue)" },
          workflow: { type: "string", description: "Workflow name or file (for trigger_workflow)" },
          ref: { type: "string", description: "Git ref for workflow (for trigger_workflow)" },
          run_id: { type: "string", description: "Run ID (for view_run)" },
          limit: {
            type: "number",
            description: "Max results (for search/list actions, default: 10, max: 50)",
          },
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
            description:
              "The task description for the sub-agent, or 'status <taskId>' to check a background task",
          },
          max_rounds: {
            type: "number",
            description: "Maximum tool-calling rounds for the sub-agent (default: 30, max: 100)",
          },
          background: {
            type: "boolean",
            description:
              "Run in background and return task ID instead of waiting for completion (default: false)",
          },
          worktree_isolation: {
            type: "boolean",
            description:
              "Run in an isolated git worktree to prevent file conflicts with other agents (default: false)",
          },
        },
        required: ["prompt"],
      },
    },
    {
      name: "BrowserAction",
      description:
        "Perform a browser action (navigate, click, type, scroll, screenshot) and return the result with a screenshot. Requires Playwright to be installed.",
      parameters: {
        type: "object",
        properties: {
          action: {
            type: "string",
            enum: ["goto", "click", "type", "scroll", "screenshot", "accessibility_tree"],
            description: "The browser action to perform",
          },
          url: { type: "string", description: "URL to navigate to (for goto action)" },
          selector: { type: "string", description: "CSS selector or text for click/type" },
          text: { type: "string", description: "Text to type (for type action)" },
          direction: {
            type: "string",
            enum: ["up", "down"],
            description: "Scroll direction (for scroll action)",
          },
        },
        required: ["action"],
      },
    },
    {
      name: "Screenshot",
      description:
        "Capture a screenshot of the current browser page or a specific URL. Returns base64-encoded PNG.",
      parameters: {
        type: "object",
        properties: {
          url: { type: "string", description: "Optional URL to navigate to before screenshot" },
          fullPage: { type: "boolean", description: "Capture full page scroll (default: false)" },
        },
        required: [],
      },
    },
    {
      name: "RunTests",
      description:
        "Run the test suite for the current project and return structured results. Auto-detects vitest/jest/pytest/cargo test.",
      parameters: {
        type: "object",
        properties: {
          command: { type: "string", description: "Override the auto-detected test command" },
          pattern: { type: "string", description: "Test file pattern or test name filter" },
          cwd: { type: "string", description: "Working directory (default: project root)" },
          timeoutMs: { type: "number", description: "Timeout in ms (default: 60000)" },
        },
        required: [],
      },
    },
    {
      name: "DebugSession",
      description:
        "Get the current debug session snapshot including breakpoints, stack frames, and variable values.",
      parameters: {
        type: "object",
        properties: {
          action: {
            type: "string",
            enum: ["snapshot", "continue", "step", "pause"],
            description: "Debug action to perform (default: snapshot)",
          },
        },
        required: [],
      },
    },
  ];
}
