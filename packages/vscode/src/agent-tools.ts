// ============================================================================
// DanteCode VS Code Extension — Agent Tool Execution
// Adapted from @dantecode/cli tools for the VS Code extension host.
// Provides file reading, writing, editing, searching, and command execution
// that the LLM can invoke via <tool_use> blocks in its response.
// ============================================================================

import { readFile, writeFile, mkdir, readdir, stat } from "node:fs/promises";
import { accessSync } from "node:fs";
import { execSync } from "node:child_process";
import { join, dirname, resolve, relative, isAbsolute, extname, sep } from "node:path";
import type { ColoredDiffHunk } from "@dantecode/config-types";
import { generateColoredHunk } from "@dantecode/git-engine";

// ----------------------------------------------------------------------------
// Types
// ----------------------------------------------------------------------------

export interface ToolResult {
  content: string;
  isError: boolean;
}

export interface DiffReviewPayload {
  filePath: string;
  hunk: ColoredDiffHunk;
  newContent: string;
  oldContent: string;
}

export interface ExtractedToolCall {
  id: string;
  name: string;
  input: Record<string, unknown>;
}

/** Extended tool execution context for Blade v1.2. */
export interface ToolExecutionContext {
  projectRoot: string;
  silentMode: boolean;
  currentModelId: string;
  roundId: string;
  sandboxEnabled?: boolean;
  onDiffHunk?: (payload: DiffReviewPayload) => void;
  onSelfModificationAttempt?: (filePath: string) => void;
  awaitSelfModConfirmation?: () => Promise<boolean>;
  runReleaseCheck?: () => Promise<boolean>;
}

// ----------------------------------------------------------------------------
// Sandbox Guard
// ----------------------------------------------------------------------------

/** Dangerous command patterns blocked when sandbox mode is active. */
const SANDBOX_BLOCKED_PATTERNS = [
  /\brm\s+-rf\s+\//,
  /\bsudo\b/,
  /\bchmod\b.*\b777\b/,
  /\bcurl\b.*\|\s*(?:bash|sh)\b/,
  /\bwget\b.*\|\s*(?:bash|sh)\b/,
  /\bdd\s+if=/,
  /\bmkfs\b/,
  /\b:>\s*\//,
  /\bnpm\s+publish\b/,
  /\bgit\s+push\b/,
];

// ----------------------------------------------------------------------------
// Self-Modification Guard (Blade v1.2 — D5)
// ----------------------------------------------------------------------------

/**
 * Returns true if the given file path targets DanteCode's own source files,
 * configuration, or constitutional documents.
 *
 * This guard is ALWAYS active regardless of agent mode (plan/build/yolo).
 * It fires before ANY Write or Edit tool dispatch.
 *
 * @param filePath - The file path the agent wants to write (relative or absolute)
 * @param projectRoot - The project root from STATE.yaml
 */
export function isSelfModificationTarget(filePath: string, projectRoot: string): boolean {
  const resolved = resolve(projectRoot, filePath);
  const selfPaths: string[] = [
    resolve(projectRoot, "packages", "vscode"),
    resolve(projectRoot, "packages", "cli"),
    resolve(projectRoot, "packages", "danteforge"),
    resolve(projectRoot, "packages", "core"),
    resolve(projectRoot, ".dantecode"),
    resolve(projectRoot, "CONSTITUTION.md"),
  ];
  return selfPaths.some((sp) => resolved === sp || resolved.startsWith(sp + sep));
}

/** Bash command patterns that could write to self-owned paths. */
const SELF_MOD_BASH_PATTERNS = [
  />\s*packages\/(vscode|cli|danteforge|core)\//,
  />\s*\.dantecode\//,
  />\s*CONSTITUTION\.md/,
  /echo\s+.*>\s*packages\//,
  /tee\s+packages\//,
];

/**
 * Returns true if a bash command appears to write to a self-owned path.
 */
export function isSelfModificationBashCommand(command: string): boolean {
  return SELF_MOD_BASH_PATTERNS.some((p) => p.test(command));
}

// ----------------------------------------------------------------------------
// Path Resolution
// ----------------------------------------------------------------------------

function resolvePath(filePath: string, projectRoot: string): string {
  if (isAbsolute(filePath)) return filePath;
  return resolve(projectRoot, filePath);
}

// ----------------------------------------------------------------------------
// Tool Implementations
// ----------------------------------------------------------------------------

async function toolRead(input: Record<string, unknown>, projectRoot: string): Promise<ToolResult> {
  const filePath = input["file_path"] as string | undefined;
  if (!filePath) return { content: "Error: file_path parameter is required", isError: true };

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
    return { content: numbered.join("\n"), isError: false };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return { content: `Error reading file: ${message}`, isError: true };
  }
}

async function toolWrite(input: Record<string, unknown>, projectRoot: string): Promise<ToolResult> {
  const filePath = input["file_path"] as string | undefined;
  const content = input["content"] as string | undefined;
  if (!filePath) return { content: "Error: file_path parameter is required", isError: true };
  if (content === undefined)
    return { content: "Error: content parameter is required", isError: true };

  const resolved = resolvePath(filePath, projectRoot);
  try {
    const existed = await readFile(resolved, "utf-8").catch(() => null);
    await mkdir(dirname(resolved), { recursive: true });
    await writeFile(resolved, content, "utf-8");
    const lineCount = content.split("\n").length;
    const action = existed !== null ? "Overwrote" : "Created";
    const preview = content.split("\n").slice(0, 10).join("\n");
    return {
      content: `${action} ${resolved} (${lineCount} lines)\n\n${preview}${lineCount > 10 ? "\n..." : ""}`,
      isError: false,
    };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return { content: `Error writing file: ${message}`, isError: true };
  }
}

async function toolEdit(input: Record<string, unknown>, projectRoot: string): Promise<ToolResult> {
  const filePath = input["file_path"] as string | undefined;
  const oldString = input["old_string"] as string | undefined;
  const newString = input["new_string"] as string | undefined;
  const replaceAll = input["replace_all"] === true;

  if (!filePath) return { content: "Error: file_path parameter is required", isError: true };
  if (oldString === undefined)
    return { content: "Error: old_string parameter is required", isError: true };
  if (newString === undefined)
    return { content: "Error: new_string parameter is required", isError: true };

  const resolved = resolvePath(filePath, projectRoot);
  try {
    const existing = await readFile(resolved, "utf-8");
    if (!existing.includes(oldString)) {
      return { content: `Error: old_string not found in ${resolved}`, isError: true };
    }
    if (!replaceAll) {
      const firstIdx = existing.indexOf(oldString);
      const secondIdx = existing.indexOf(oldString, firstIdx + 1);
      if (secondIdx !== -1) {
        return {
          content: `Error: old_string appears multiple times. Use replace_all: true or provide more context.`,
          isError: true,
        };
      }
    }
    const updated = replaceAll
      ? existing.split(oldString).join(newString)
      : existing.replace(oldString, newString);
    await writeFile(resolved, updated, "utf-8");
    const count = replaceAll ? existing.split(oldString).length - 1 : 1;
    // Build a compact diff summary
    const oldLines = oldString.split("\n");
    const newLines = newString.split("\n");
    const diffPreview =
      `--- ${filePath}\n+++ ${filePath}\n` +
      oldLines
        .slice(0, 8)
        .map((l) => `- ${l}`)
        .join("\n") +
      (oldLines.length > 8 ? `\n... (${oldLines.length - 8} more lines removed)` : "") +
      "\n" +
      newLines
        .slice(0, 8)
        .map((l) => `+ ${l}`)
        .join("\n") +
      (newLines.length > 8 ? `\n... (${newLines.length - 8} more lines added)` : "");
    return {
      content: `Successfully edited ${resolved} (${count} replacement${count !== 1 ? "s" : ""})\n\n${diffPreview}`,
      isError: false,
    };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return { content: `Error editing file: ${message}`, isError: true };
  }
}

async function toolListDir(
  input: Record<string, unknown>,
  projectRoot: string,
): Promise<ToolResult> {
  const dirPath = (input["path"] as string | undefined) || ".";
  const resolved = resolvePath(dirPath, projectRoot);

  try {
    const entries = await readdir(resolved);
    const results: string[] = [];
    for (const entry of entries.slice(0, 200)) {
      try {
        const entryStat = await stat(join(resolved, entry));
        const type = entryStat.isDirectory() ? "dir" : "file";
        const size = entryStat.isFile() ? ` (${formatBytes(entryStat.size)})` : "";
        results.push(`${type === "dir" ? "📁" : "📄"} ${entry}${size}`);
      } catch {
        results.push(`❓ ${entry}`);
      }
    }
    return { content: results.join("\n"), isError: false };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return { content: `Error listing directory: ${message}`, isError: true };
  }
}

function resolveShell(): string | true {
  if (process.platform !== "win32") return "/bin/bash";
  // On Windows, try Git Bash first, then fall back to cmd.exe
  const gitBashPaths = [
    "C:\\Program Files\\Git\\bin\\bash.exe",
    "C:\\Program Files (x86)\\Git\\bin\\bash.exe",
  ];
  for (const p of gitBashPaths) {
    try {
      accessSync(p);
      return p;
    } catch {
      /* next */
    }
  }
  // cmd.exe is always available on Windows
  return true; // `true` = use OS default shell (cmd.exe on Windows)
}

async function toolBash(input: Record<string, unknown>, projectRoot: string): Promise<ToolResult> {
  const command = input["command"] as string | undefined;
  if (!command) return { content: "Error: command parameter is required", isError: true };

  const timeoutMs = typeof input["timeout"] === "number" ? input["timeout"] : 30000;
  const shell = resolveShell();

  try {
    const result = execSync(command, {
      cwd: projectRoot,
      encoding: "utf-8",
      timeout: timeoutMs,
      maxBuffer: 5 * 1024 * 1024,
      stdio: ["pipe", "pipe", "pipe"],
      shell: typeof shell === "string" ? shell : undefined,
    });
    return { content: result || "(no output)", isError: false };
  } catch (err: unknown) {
    const error = err as { stdout?: string; stderr?: string; status?: number };
    const stdout = typeof error.stdout === "string" ? error.stdout : "";
    const stderr = typeof error.stderr === "string" ? error.stderr : "";
    const exitCode = typeof error.status === "number" ? error.status : 1;
    return {
      content: [
        stdout ? `stdout:\n${stdout}` : "",
        stderr ? `stderr:\n${stderr}` : "",
        `Exit code: ${exitCode}`,
      ]
        .filter(Boolean)
        .join("\n"),
      isError: exitCode !== 0,
    };
  }
}

async function toolGlob(input: Record<string, unknown>, projectRoot: string): Promise<ToolResult> {
  const pattern = input["pattern"] as string | undefined;
  if (!pattern) return { content: "Error: pattern parameter is required", isError: true };

  const searchPath =
    typeof input["path"] === "string" ? resolvePath(input["path"], projectRoot) : projectRoot;

  try {
    const matches: string[] = [];
    await walkForGlob(searchPath, projectRoot, globToRegex(pattern), matches, 0, 500);
    if (matches.length === 0) return { content: `No files matching: ${pattern}`, isError: false };
    return {
      content: matches.map((m) => relative(projectRoot, m).replace(/\\/g, "/")).join("\n"),
      isError: false,
    };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return { content: `Error: ${message}`, isError: true };
  }
}

async function toolGrep(input: Record<string, unknown>, projectRoot: string): Promise<ToolResult> {
  const pattern = input["pattern"] as string | undefined;
  if (!pattern) return { content: "Error: pattern parameter is required", isError: true };

  const searchPath =
    typeof input["path"] === "string" ? resolvePath(input["path"], projectRoot) : projectRoot;
  const caseInsensitive = input["-i"] === true;
  const headLimit = typeof input["head_limit"] === "number" ? input["head_limit"] : 30;

  try {
    const flags = caseInsensitive ? "gi" : "g";
    const regex = new RegExp(pattern, flags);
    const results: string[] = [];
    await grepDir(searchPath, projectRoot, regex, results, 0, headLimit);
    if (results.length === 0) return { content: `No matches for: ${pattern}`, isError: false };
    return { content: results.join("\n"), isError: false };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return { content: `Error: ${message}`, isError: true };
  }
}

// ----------------------------------------------------------------------------
// Helpers
// ----------------------------------------------------------------------------

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function globToRegex(pattern: string): RegExp {
  let r = "";
  let i = 0;
  while (i < pattern.length) {
    const c = pattern[i]!;
    if (c === "*" && pattern[i + 1] === "*") {
      r += pattern[i + 2] === "/" ? "(?:.+/)?" : ".*";
      i += pattern[i + 2] === "/" ? 3 : 2;
    } else if (c === "*") {
      r += "[^/]*";
      i++;
    } else if (c === "?") {
      r += "[^/]";
      i++;
    } else {
      r += c.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      i++;
    }
  }
  return new RegExp(`^${r}$`);
}

const SKIP_DIRS = new Set([
  "node_modules",
  ".git",
  "dist",
  ".next",
  "__pycache__",
  ".cache",
  ".turbo",
  "coverage",
  ".dantecode",
]);
const TEXT_EXTS = new Set([
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".json",
  ".yaml",
  ".yml",
  ".md",
  ".css",
  ".html",
  ".py",
  ".rs",
  ".go",
  ".java",
  ".c",
  ".cpp",
  ".h",
  ".sh",
  ".sql",
  ".toml",
  ".xml",
  ".svg",
  ".txt",
  ".env",
  ".graphql",
]);

async function walkForGlob(
  dir: string,
  base: string,
  pattern: RegExp,
  matches: string[],
  depth: number,
  max: number,
): Promise<void> {
  if (depth > 15 || matches.length >= max) return;
  let entries: string[];
  try {
    entries = await readdir(dir);
  } catch {
    return;
  }
  for (const entry of entries) {
    if (matches.length >= max) return;
    if (SKIP_DIRS.has(entry)) continue;
    const full = join(dir, entry);
    let s;
    try {
      s = await stat(full);
    } catch {
      continue;
    }
    const rel = relative(base, full).replace(/\\/g, "/");
    if (s.isDirectory()) await walkForGlob(full, base, pattern, matches, depth + 1, max);
    else if (s.isFile() && (pattern.test(rel) || pattern.test(entry))) matches.push(full);
  }
}

async function grepDir(
  dir: string,
  base: string,
  regex: RegExp,
  results: string[],
  depth: number,
  max: number,
): Promise<void> {
  if (depth > 15 || results.length >= max) return;
  let entries: string[];
  try {
    entries = await readdir(dir);
  } catch {
    return;
  }
  for (const entry of entries) {
    if (results.length >= max) return;
    if (SKIP_DIRS.has(entry)) continue;
    const full = join(dir, entry);
    let s;
    try {
      s = await stat(full);
    } catch {
      continue;
    }
    if (s.isDirectory()) await grepDir(full, base, regex, results, depth + 1, max);
    else if (s.isFile() && s.size < 1024 * 1024) {
      const ext = extname(full).toLowerCase();
      if (!TEXT_EXTS.has(ext)) continue;
      try {
        const content = await readFile(full, "utf-8");
        const lines = content.split("\n");
        for (let i = 0; i < lines.length; i++) {
          regex.lastIndex = 0;
          if (regex.test(lines[i]!)) {
            const rel = relative(base, full).replace(/\\/g, "/");
            results.push(`${rel}:${i + 1}: ${lines[i]!.trim().slice(0, 200)}`);
            if (results.length >= max) return;
          }
        }
      } catch {
        /* skip unreadable files */
      }
    }
  }
}

// ----------------------------------------------------------------------------
// Main Dispatcher
// ----------------------------------------------------------------------------

async function toolSelfUpdate(
  input: Record<string, unknown>,
  projectRoot: string,
): Promise<ToolResult> {
  try {
    // PDSE gate first
    const gate = await toolBash({ command: "npm run release:check" }, projectRoot);
    if (gate.isError) {
      return { content: `SelfUpdate blocked: gates failed\n${gate.content}`, isError: true };
    }

    const dryRun = input["dryRun"] === true;
    const cmd = dryRun
      ? 'echo "[dry-run] Would: git pull && npm ci && npm run build && vsce package && code --install-extension *.vsix"'
      : 'git pull origin main && npm ci && npm run build && cd packages/vscode && npx @vscode/vsce package && code --install-extension *.vsix --force && echo "Reload VS Code window!"';

    const result = await toolBash({ command: cmd, timeout: 600000 }, projectRoot);
    return {
      content: `SelfUpdate ${dryRun ? "dry-run" : "complete"}:\n${result.content}`,
      isError: result.isError,
    };
  } catch (err: unknown) {
    return { content: `SelfUpdate error: ${String(err)}`, isError: true };
  }
}

export async function executeTool(
  name: string,
  input: Record<string, unknown>,
  projectRoot: string,
  context?: ToolExecutionContext,
): Promise<ToolResult> {
  const filePath = input["file_path"] as string | undefined;
  const isFileOp = name === "Write" || name === "Edit";

  // Sandbox guard: block out-of-root writes
  if (context?.sandboxEnabled && isFileOp && filePath) {
    const resolved = resolvePath(filePath, projectRoot);
    if (!resolved.startsWith(projectRoot)) {
      return {
        content: `Sandbox: write blocked — path escapes project root: ${resolved}`,
        isError: true,
      };
    }
  }

  // Sandbox guard: block dangerous bash commands
  if (context?.sandboxEnabled && name === "Bash") {
    const command = input["command"] as string | undefined;
    if (command && SANDBOX_BLOCKED_PATTERNS.some((p) => p.test(command))) {
      return {
        content: `Sandbox: command blocked (matches restricted pattern)`,
        isError: true,
      };
    }
  }

  // D5: Self-modification guard for Write/Edit
  if (context && isFileOp && filePath && isSelfModificationTarget(filePath, projectRoot)) {
    context.onSelfModificationAttempt?.(filePath);
    if (context.awaitSelfModConfirmation) {
      const confirmed = await context.awaitSelfModConfirmation();
      if (!confirmed) {
        return { content: `Self-modification blocked: ${filePath}`, isError: true };
      }
    } else {
      return { content: `Self-modification blocked: ${filePath}`, isError: true };
    }
  }

  // D5: Self-modification guard for Bash
  if (context && name === "Bash") {
    const command = input["command"] as string | undefined;
    if (command && isSelfModificationBashCommand(command)) {
      return {
        content: "Self-modification blocked: bash command targets protected paths",
        isError: true,
      };
    }
  }

  // D3: Capture old content for colored diff
  let oldContent: string | null = null;
  if (context?.onDiffHunk && isFileOp && filePath) {
    try {
      oldContent = await readFile(resolvePath(filePath, projectRoot), "utf-8");
    } catch {
      oldContent = null;
    }
  }

  // Dispatch to tool implementation
  let result: ToolResult;
  switch (name) {
    case "Read":
      result = await toolRead(input, projectRoot);
      break;
    case "Write":
      result = await toolWrite(input, projectRoot);
      break;
    case "Edit":
      result = await toolEdit(input, projectRoot);
      break;
    case "ListDir":
      result = await toolListDir(input, projectRoot);
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
    case "SelfUpdate":
      result = await toolSelfUpdate(input, projectRoot);
      break;
    default:
      result = { content: `Unknown tool: ${name}`, isError: true };
  }

  // D3: Emit colored diff hunk after successful file operations
  if (context?.onDiffHunk && isFileOp && filePath && !result.isError) {
    try {
      const newContent = await readFile(resolvePath(filePath, projectRoot), "utf-8");
      const hunk = generateColoredHunk(oldContent ?? "", newContent, filePath);

      // Truncate large diffs to keep the webview responsive
      const MAX_HUNK_LINES = 80;
      if (hunk.lines && hunk.lines.length > MAX_HUNK_LINES) {
        const omitted = hunk.lines.length - MAX_HUNK_LINES;
        hunk.fullLineCount = hunk.lines.length;
        hunk.truncated = true;
        hunk.lines = [
          ...hunk.lines.slice(0, MAX_HUNK_LINES),
          {
            type: "context",
            content: `... ${omitted} more lines omitted ...`,
            oldLineNo: null,
            newLineNo: null,
          },
        ];
      }

      context.onDiffHunk({
        filePath,
        hunk,
        newContent,
        oldContent: oldContent ?? "",
      });
    } catch {
      /* non-critical: diff generation */
    }
  }

  return result;
}

// ----------------------------------------------------------------------------
// Tool Call Extraction
// ----------------------------------------------------------------------------

/**
 * Extracts <tool_use> blocks from the model's response text.
 * Returns the cleaned text (with tool blocks removed) and parsed tool calls.
 */
export function extractToolCalls(text: string): {
  cleanText: string;
  toolCalls: ExtractedToolCall[];
} {
  const toolCalls: ExtractedToolCall[] = [];
  let cleanText = text;
  let idCounter = 0;

  // Pattern 1: <tool_use>JSON</tool_use>
  const xmlPattern = /<tool_use>\s*([\s\S]*?)\s*<\/tool_use>/g;
  let match: RegExpExecArray | null;

  while ((match = xmlPattern.exec(text)) !== null) {
    try {
      const parsed = JSON.parse(match[1]!) as { name?: string; input?: Record<string, unknown> };
      if (parsed.name && parsed.input) {
        toolCalls.push({
          id: `tc-${Date.now()}-${idCounter++}`,
          name: parsed.name,
          input: parsed.input,
        });
      }
    } catch {
      /* skip malformed */
    }
    cleanText = cleanText.replace(match[0], "");
  }

  // Pattern 2: ```json blocks with tool structure
  const jsonPattern =
    /```(?:json)?\s*\n(\{[\s\S]*?"name"\s*:\s*"(?:Read|Write|Edit|ListDir|Bash|Glob|Grep)"[\s\S]*?\})\s*\n```/g;
  while ((match = jsonPattern.exec(text)) !== null) {
    try {
      const parsed = JSON.parse(match[1]!) as { name?: string; input?: Record<string, unknown> };
      if (parsed.name && parsed.input) {
        toolCalls.push({
          id: `tc-${Date.now()}-${idCounter++}`,
          name: parsed.name,
          input: parsed.input,
        });
        cleanText = cleanText.replace(match[0], "");
      }
    } catch {
      /* skip malformed */
    }
  }

  return { cleanText: cleanText.trim(), toolCalls };
}

// ----------------------------------------------------------------------------
// Tool Definitions for System Prompt
// ----------------------------------------------------------------------------

export function getToolDefinitionsPrompt(): string {
  return `## Available Tools

You can use the following tools by including <tool_use> blocks in your response.
Format: <tool_use>{"name": "ToolName", "input": {...}}</tool_use>

### Read — Read a file from disk with line numbers
  Input: { "file_path": "path/to/file", "offset": 0, "limit": 2000 }

### Write — Write content to a file (creates directories)
  Input: { "file_path": "path/to/file", "content": "file content here" }

### Edit — Replace a string in a file
  Input: { "file_path": "path/to/file", "old_string": "text to find", "new_string": "replacement" }

### ListDir — List directory contents
  Input: { "path": "path/to/dir" }

### Bash — Execute a shell command
  Input: { "command": "npm test", "timeout": 30000 }

### Glob — Find files matching a glob pattern
  Input: { "pattern": "**/*.ts", "path": "src/" }

### Grep — Search file contents with regex
  Input: { "pattern": "function.*export", "path": "src/", "-i": true, "head_limit": 30 }

### SelfUpdate — PDSE-gated self-update (git pull, build, reinstall VSIX)
  Input: { "dryRun": true/false }

## CRITICAL: Tool Execution Rules
- You MUST use tools to complete tasks. Do NOT just describe what you would do — actually DO it.
- When asked to implement, build, fix, or change code: immediately use Read, Edit, Write, Bash tools.
- When asked to analyze or review: use Read, Grep, Glob to examine the actual code.
- Read files BEFORE editing them. Understand context first.
- Use Edit for small changes, Write for new files or complete rewrites.
- Use Glob or ListDir to explore the project structure.
- Use Grep to search for specific code patterns.
- Use Bash to run tests, type-checks, or build commands to verify changes.
- You can chain multiple tool calls in one response.
- After tool results come back, analyze them and continue your task.
- NEVER respond with only a plan or description when the user asks you to build something. Take action immediately.

Example of correct behavior:
User: "Add a logger to the app"
You: "I'll add a logger. Let me read the existing code first."
<tool_use>{"name": "Read", "input": {"file_path": "src/index.ts"}}</tool_use>
`;
}

/**
 * Checks if a tool call writes to a code file (for DanteForge gating).
 */
export function getWrittenFilePath(
  toolName: string,
  toolInput: Record<string, unknown>,
): string | null {
  if (toolName === "Write" || toolName === "Edit") {
    const filePath = toolInput["file_path"] as string | undefined;
    if (filePath) {
      const codeExts = [
        ".ts",
        ".tsx",
        ".js",
        ".jsx",
        ".mjs",
        ".cjs",
        ".py",
        ".rb",
        ".rs",
        ".go",
        ".java",
        ".c",
        ".cpp",
        ".h",
      ];
      const ext = filePath.slice(filePath.lastIndexOf(".")).toLowerCase();
      if (codeExts.includes(ext)) return filePath;
    }
  }
  return null;
}
