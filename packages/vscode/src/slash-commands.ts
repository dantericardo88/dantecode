// ============================================================================
// packages/vscode/src/slash-commands.ts
//
// Slash command palette for DanteCode chat UI.
// Pure TypeScript — no VS Code API dependencies.
// Registered in sidebar HTML via Discord-style '/' prefix detection.
// ============================================================================

import { exec, spawn } from "node:child_process";
import { promisify } from "node:util";

// CRITICAL: use exec/spawn with shell mode (NOT execFile). VS Code/Antigravity
// extensions spawn child processes without the npm global bin dir on PATH, so
// `execFile("danteforge", ...)` throws ENOENT. The shell-mode variants run
// through cmd.exe / sh which inherits the user's full PATH. This fix has
// regressed multiple times — keep it.
const execAsync = promisify(exec);

/**
 * Run a shell command with live stdout/stderr streaming via onChunk.
 * Resolves with the full combined output on exit. Used by `/score` and `/ascend`
 * so the user sees output as it's produced, not a 30-second silent wait
 * followed by a wall of text dumped at the end.
 */
function runStreaming(
  command: string,
  options: { cwd: string; timeoutMs: number },
  onChunk?: (text: string) => void,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, { cwd: options.cwd, shell: true, windowsHide: true });
    let combined = "";
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(`Command timed out after ${options.timeoutMs}ms: ${command}`));
    }, options.timeoutMs);
    const handle = (buf: Buffer): void => {
      const text = buf.toString();
      combined += text;
      onChunk?.(text);
    };
    child.stdout?.on("data", handle);
    child.stderr?.on("data", handle);
    child.on("error", (err) => { clearTimeout(timer); reject(err); });
    child.on("close", () => { clearTimeout(timer); resolve(combined); });
  });
}

// ── Types ──────────────────────────────────────────────────────────────────

export interface SlashCommand {
  /** Command name without the leading slash, e.g. "fix" */
  name: string;
  /** Human-readable description shown in the palette */
  description: string;
  /** Emoji icon for the palette UI */
  icon: string;
  /**
   * Builds the final prompt text to send to the model.
   * @param selection - Currently selected text in the editor (may be empty)
   * @param filePath - Active file path (may be empty string)
   * @param extraArg - Any additional text typed after the command name
   */
  buildPrompt(selection: string, filePath: string, extraArg?: string): string;
  /**
   * If defined, executes the command directly (no LLM involvement).
   * The sidebar calls this instead of sending the prompt to the model.
   * Return the markdown string to display as the assistant response.
   */
  execute?: (
    args: string,
    projectRoot: string,
    onChunk?: (text: string) => void,
  ) => Promise<string>;
  /**
   * If defined, runs before the model loop and prepends its output to the user message.
   * Unlike execute(), the model loop still runs — prepare() injects live context first.
   */
  prepare?: (args: string, projectRoot: string) => Promise<string>;
}

// ── Built-in commands ───────────────────────────────────────────────────────

export const SLASH_COMMANDS: SlashCommand[] = [
  {
    name: "fix",
    description: "Fix bugs and type errors in the selected code",
    icon: "🔧",
    buildPrompt(selection, filePath, _extra) {
      const ctx = buildCodeContext(selection, filePath);
      return `Fix the bugs and type errors in the selected code. Explain what was wrong.${ctx}`;
    },
  },
  {
    name: "test",
    description: "Write comprehensive tests for the selected code",
    icon: "🧪",
    buildPrompt(selection, filePath, _extra) {
      const ctx = buildCodeContext(selection, filePath);
      return `Write comprehensive tests for the selected code. Use the existing test framework in this project.${ctx}`;
    },
  },
  {
    name: "explain",
    description: "Explain what this code does in plain English",
    icon: "💡",
    buildPrompt(selection, filePath, _extra) {
      const ctx = buildCodeContext(selection, filePath);
      return `Explain what this code does in plain English. Be concise.${ctx}`;
    },
  },
  {
    name: "comment",
    description: "Add JSDoc/docstring comments without changing logic",
    icon: "📝",
    buildPrompt(selection, filePath, _extra) {
      const ctx = buildCodeContext(selection, filePath);
      return `Add JSDoc/docstring comments to the selected code. Do not change any logic.${ctx}`;
    },
  },
  {
    name: "optimize",
    description: "Optimize this code for performance",
    icon: "⚡",
    buildPrompt(selection, filePath, _extra) {
      const ctx = buildCodeContext(selection, filePath);
      return `Optimize this code for performance. Explain the trade-offs.${ctx}`;
    },
  },
  {
    name: "review",
    description: "Review code for bugs, security issues, and quality",
    icon: "🔍",
    buildPrompt(selection, filePath, _extra) {
      const ctx = buildCodeContext(selection, filePath);
      return `Review this code for bugs, security issues, and code quality. Be thorough and critical.${ctx}`;
    },
  },
  {
    name: "refactor",
    description: "Refactor this code to be cleaner with same behavior",
    icon: "♻️",
    buildPrompt(selection, filePath, _extra) {
      const ctx = buildCodeContext(selection, filePath);
      return `Refactor this code to be cleaner while keeping the same behavior.${ctx}`;
    },
  },
  {
    name: "score",
    description: "Run danteforge score to get the PDSE quality score",
    icon: "📊",
    buildPrompt(_selection, _filePath, extra) {
      // Fallback prompt — only used if execute() is unavailable.
      const level = extra?.trim() || "light";
      return `Run \`danteforge score --level ${level}\` in the project root and print the raw output verbatim.`;
    },
    async execute(args, projectRoot, onChunk) {
      const level = args.trim() || "light";
      try {
        if (onChunk) onChunk("```\n");
        const out = await runStreaming(
          `danteforge score --level ${level}`,
          { cwd: projectRoot, timeoutMs: 60_000 },
          (text) => onChunk?.(text),
        );
        if (onChunk) onChunk("\n```");
        const trimmed = out.trim();
        return trimmed.length > 0 ? `\`\`\`\n${trimmed}\n\`\`\`` : "_No output from danteforge score._";
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        return `**danteforge score failed**\n\n\`\`\`\n${msg}\n\`\`\``;
      }
    },
  },
  {
    name: "ascend",
    description: "Run danteforge ascend — autonomous quality improvement loop",
    icon: "🚀",
    buildPrompt(_selection, _filePath, extra) {
      const target = extra?.trim() || "9.0";
      return `Run \`danteforge ascend${target !== "9.0" ? ` --target ${target}` : ""}\` in the project root and print the raw output verbatim.`;
    },
    // execute() bypasses the model entirely — danteforge ascend handles the autonomous loop.
    // Using prepare() + model proved unreliable: Grok substitutes its own workflow instead
    // of calling the CLI, fabricating improvement tables and running unauthorized commands.
    async execute(args, projectRoot, onChunk) {
      const targetFlag = args.trim() ? ` --target ${args.trim()}` : "";
      try {
        if (onChunk) onChunk("```\n");
        const out = await runStreaming(
          `danteforge ascend${targetFlag}`,
          { cwd: projectRoot, timeoutMs: 600_000 }, // 10 min — ascend runs 60 cycles
          (text) => onChunk?.(text),
        );
        if (onChunk) onChunk("\n```");
        const trimmed = out.trim();
        return trimmed.length > 0 ? `\`\`\`\n${trimmed}\n\`\`\`` : "_No output from danteforge ascend._";
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        return `**danteforge ascend failed**\n\n\`\`\`\n${msg}\n\`\`\``;
      }
    },
  },
];

/** Map for O(1) lookup by name */
const COMMANDS_BY_NAME = new Map(SLASH_COMMANDS.map((c) => [c.name, c]));

// ── Helpers ─────────────────────────────────────────────────────────────────

function buildCodeContext(selection: string, filePath: string): string {
  if (!selection.trim()) return "";
  const label = filePath ? `from ${filePath}` : "selected";
  return `\n\nCode ${label}:\n\`\`\`\n${selection}\n\`\`\``;
}

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * Parses a slash command from user input.
 * Returns null if the input does not start with a recognised slash command.
 * The '/' must be the very first character (no leading whitespace).
 */
export function parseSlashCommand(input: string): { command: SlashCommand; args: string } | null {
  const trimmed = input.trim();
  if (!trimmed.startsWith("/")) return null;

  const spaceIdx = trimmed.indexOf(" ");
  const rawName = spaceIdx === -1 ? trimmed.slice(1) : trimmed.slice(1, spaceIdx);
  const commandName = rawName.toLowerCase();
  const args = spaceIdx === -1 ? "" : trimmed.slice(spaceIdx + 1).trim();

  const command = COMMANDS_BY_NAME.get(commandName);
  return command ? { command, args } : null;
}

/**
 * Builds the final prompt to send for a slash command.
 * Accepts editor state as plain strings for VS Code independence.
 *
 * @param command - The resolved slash command
 * @param selection - Currently selected text in the editor (may be empty)
 * @param filePath - Active file path (may be empty string)
 * @param extraArg - Optional argument typed after the command name
 */
export function buildSlashPrompt(
  command: SlashCommand,
  selection: string,
  filePath: string,
  extraArg?: string,
): string {
  return command.buildPrompt(selection, filePath, extraArg);
}

/** Returns the full list of slash commands for UI display. */
export function listSlashCommands(): SlashCommand[] {
  return SLASH_COMMANDS;
}
