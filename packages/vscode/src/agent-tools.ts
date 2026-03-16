// ============================================================================
// DanteCode VS Code Extension — Agent Tool Execution
// Adapted from @dantecode/cli tools for the VS Code extension host.
// Provides file reading, writing, editing, searching, and command execution
// that the LLM can invoke via <tool_use> blocks in its response.
// ============================================================================

import { readFile, writeFile, mkdir, readdir, stat } from "node:fs/promises";
import { execSync } from "node:child_process";
import { join, dirname, resolve, relative, isAbsolute, extname } from "node:path";

// ----------------------------------------------------------------------------
// Types
// ----------------------------------------------------------------------------

export interface ToolResult {
  content: string;
  isError: boolean;
}

export interface ExtractedToolCall {
  id: string;
  name: string;
  input: Record<string, unknown>;
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
  if (content === undefined) return { content: "Error: content parameter is required", isError: true };

  const resolved = resolvePath(filePath, projectRoot);
  try {
    await mkdir(dirname(resolved), { recursive: true });
    await writeFile(resolved, content, "utf-8");
    const lineCount = content.split("\n").length;
    return { content: `Successfully wrote ${lineCount} lines to ${resolved}`, isError: false };
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
  if (oldString === undefined) return { content: "Error: old_string parameter is required", isError: true };
  if (newString === undefined) return { content: "Error: new_string parameter is required", isError: true };

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
        return { content: `Error: old_string appears multiple times. Use replace_all: true or provide more context.`, isError: true };
      }
    }
    const updated = replaceAll ? existing.split(oldString).join(newString) : existing.replace(oldString, newString);
    await writeFile(resolved, updated, "utf-8");
    const count = replaceAll ? existing.split(oldString).length - 1 : 1;
    return { content: `Successfully edited ${resolved} (${count} replacement${count !== 1 ? "s" : ""})`, isError: false };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return { content: `Error editing file: ${message}`, isError: true };
  }
}

async function toolListDir(input: Record<string, unknown>, projectRoot: string): Promise<ToolResult> {
  const dirPath = input["path"] as string | undefined || ".";
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

async function toolBash(input: Record<string, unknown>, projectRoot: string): Promise<ToolResult> {
  const command = input["command"] as string | undefined;
  if (!command) return { content: "Error: command parameter is required", isError: true };

  const timeoutMs = typeof input["timeout"] === "number" ? input["timeout"] : 30000;

  try {
    const result = execSync(command, {
      cwd: projectRoot,
      encoding: "utf-8",
      timeout: timeoutMs,
      maxBuffer: 5 * 1024 * 1024,
      stdio: ["pipe", "pipe", "pipe"],
      shell: process.platform === "win32" ? "bash" : "/bin/bash",
    });
    return { content: result || "(no output)", isError: false };
  } catch (err: unknown) {
    const error = err as { stdout?: string; stderr?: string; status?: number };
    const stdout = typeof error.stdout === "string" ? error.stdout : "";
    const stderr = typeof error.stderr === "string" ? error.stderr : "";
    const exitCode = typeof error.status === "number" ? error.status : 1;
    return {
      content: [stdout ? `stdout:\n${stdout}` : "", stderr ? `stderr:\n${stderr}` : "", `Exit code: ${exitCode}`].filter(Boolean).join("\n"),
      isError: exitCode !== 0,
    };
  }
}

async function toolGlob(input: Record<string, unknown>, projectRoot: string): Promise<ToolResult> {
  const pattern = input["pattern"] as string | undefined;
  if (!pattern) return { content: "Error: pattern parameter is required", isError: true };

  const searchPath = typeof input["path"] === "string" ? resolvePath(input["path"], projectRoot) : projectRoot;

  try {
    const matches: string[] = [];
    await walkForGlob(searchPath, projectRoot, globToRegex(pattern), matches, 0, 500);
    if (matches.length === 0) return { content: `No files matching: ${pattern}`, isError: false };
    return { content: matches.map((m) => relative(projectRoot, m).replace(/\\/g, "/")).join("\n"), isError: false };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return { content: `Error: ${message}`, isError: true };
  }
}

async function toolGrep(input: Record<string, unknown>, projectRoot: string): Promise<ToolResult> {
  const pattern = input["pattern"] as string | undefined;
  if (!pattern) return { content: "Error: pattern parameter is required", isError: true };

  const searchPath = typeof input["path"] === "string" ? resolvePath(input["path"], projectRoot) : projectRoot;
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
    } else if (c === "*") { r += "[^/]*"; i++; }
    else if (c === "?") { r += "[^/]"; i++; }
    else { r += c.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); i++; }
  }
  return new RegExp(`^${r}$`);
}

const SKIP_DIRS = new Set(["node_modules", ".git", "dist", ".next", "__pycache__", ".cache", ".turbo", "coverage", ".dantecode"]);
const TEXT_EXTS = new Set([".ts", ".tsx", ".js", ".jsx", ".json", ".yaml", ".yml", ".md", ".css", ".html", ".py", ".rs", ".go", ".java", ".c", ".cpp", ".h", ".sh", ".sql", ".toml", ".xml", ".svg", ".txt", ".env", ".graphql"]);

async function walkForGlob(dir: string, base: string, pattern: RegExp, matches: string[], depth: number, max: number): Promise<void> {
  if (depth > 15 || matches.length >= max) return;
  let entries: string[];
  try { entries = await readdir(dir); } catch { return; }
  for (const entry of entries) {
    if (matches.length >= max) return;
    if (SKIP_DIRS.has(entry)) continue;
    const full = join(dir, entry);
    let s;
    try { s = await stat(full); } catch { continue; }
    const rel = relative(base, full).replace(/\\/g, "/");
    if (s.isDirectory()) await walkForGlob(full, base, pattern, matches, depth + 1, max);
    else if (s.isFile() && (pattern.test(rel) || pattern.test(entry))) matches.push(full);
  }
}

async function grepDir(dir: string, base: string, regex: RegExp, results: string[], depth: number, max: number): Promise<void> {
  if (depth > 15 || results.length >= max) return;
  let entries: string[];
  try { entries = await readdir(dir); } catch { return; }
  for (const entry of entries) {
    if (results.length >= max) return;
    if (SKIP_DIRS.has(entry)) continue;
    const full = join(dir, entry);
    let s;
    try { s = await stat(full); } catch { continue; }
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
      } catch { /* skip unreadable files */ }
    }
  }
}

// ----------------------------------------------------------------------------
// Main Dispatcher
// ----------------------------------------------------------------------------

export async function executeTool(
  name: string,
  input: Record<string, unknown>,
  projectRoot: string,
): Promise<ToolResult> {
  switch (name) {
    case "Read": return toolRead(input, projectRoot);
    case "Write": return toolWrite(input, projectRoot);
    case "Edit": return toolEdit(input, projectRoot);
    case "ListDir": return toolListDir(input, projectRoot);
    case "Bash": return toolBash(input, projectRoot);
    case "Glob": return toolGlob(input, projectRoot);
    case "Grep": return toolGrep(input, projectRoot);
    default: return { content: `Unknown tool: ${name}`, isError: true };
  }
}

// ----------------------------------------------------------------------------
// Tool Call Extraction
// ----------------------------------------------------------------------------

/**
 * Extracts <tool_use> blocks from the model's response text.
 * Returns the cleaned text (with tool blocks removed) and parsed tool calls.
 */
export function extractToolCalls(text: string): { cleanText: string; toolCalls: ExtractedToolCall[] } {
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
        toolCalls.push({ id: `tc-${Date.now()}-${idCounter++}`, name: parsed.name, input: parsed.input });
      }
    } catch { /* skip malformed */ }
    cleanText = cleanText.replace(match[0], "");
  }

  // Pattern 2: ```json blocks with tool structure
  const jsonPattern = /```(?:json)?\s*\n(\{[\s\S]*?"name"\s*:\s*"(?:Read|Write|Edit|ListDir|Bash|Glob|Grep)"[\s\S]*?\})\s*\n```/g;
  while ((match = jsonPattern.exec(text)) !== null) {
    try {
      const parsed = JSON.parse(match[1]!) as { name?: string; input?: Record<string, unknown> };
      if (parsed.name && parsed.input) {
        toolCalls.push({ id: `tc-${Date.now()}-${idCounter++}`, name: parsed.name, input: parsed.input });
        cleanText = cleanText.replace(match[0], "");
      }
    } catch { /* skip malformed */ }
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

## Tool Use Guidelines
- Read files BEFORE editing them. Understand context first.
- Use Edit for small changes, Write for new files or complete rewrites.
- Use Glob or ListDir to explore the project structure.
- Use Grep to search for specific code patterns.
- Use Bash to run tests, type-checks, or build commands to verify changes.
- You can chain multiple tool calls in one response.
- After tool results come back, analyze them and continue your task.
`;
}

/**
 * Checks if a tool call writes to a code file (for DanteForge gating).
 */
export function getWrittenFilePath(toolName: string, toolInput: Record<string, unknown>): string | null {
  if (toolName === "Write" || toolName === "Edit") {
    const filePath = toolInput["file_path"] as string | undefined;
    if (filePath) {
      const codeExts = [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".py", ".rb", ".rs", ".go", ".java", ".c", ".cpp", ".h"];
      const ext = filePath.slice(filePath.lastIndexOf(".")).toLowerCase();
      if (codeExts.includes(ext)) return filePath;
    }
  }
  return null;
}
