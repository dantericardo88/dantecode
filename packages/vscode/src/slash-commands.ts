// ============================================================================
// packages/vscode/src/slash-commands.ts
//
// Slash command palette for DanteCode chat UI.
// Pure TypeScript — no VS Code API dependencies.
// Registered in sidebar HTML via Discord-style '/' prefix detection.
// ============================================================================

import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

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
  execute?: (args: string, projectRoot: string) => Promise<string>;
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
    async execute(args, projectRoot) {
      const level = args.trim() || "light";
      try {
        const { stdout, stderr } = await execFileAsync("danteforge", ["score", "--level", level], {
          cwd: projectRoot,
          timeout: 60_000,
          windowsHide: true,
        });
        const out = (stdout + stderr).trim();
        return out.length > 0 ? `\`\`\`\n${out}\n\`\`\`` : "_No output from danteforge score._";
      } catch (err: unknown) {
        const stderr = (err as { stderr?: string }).stderr ?? "";
        const msg = err instanceof Error ? err.message : String(err);
        const detail = (stderr || msg).trim();
        return `**danteforge score failed**\n\n\`\`\`\n${detail}\n\`\`\``;
      }
    },
  },
  {
    name: "ascend",
    description: "Run danteforge ascend — autonomous quality improvement loop",
    icon: "🚀",
    buildPrompt(_selection, _filePath, extra) {
      const target = extra?.trim() || "9.0";
      return `Run the DanteForge ascend loop targeting ${target}/10. First run \`danteforge score --level light\` to get the live baseline, then execute \`danteforge ascend\` and report the verified before/after score delta.`;
    },
    // prepare() runs before the model loop — injects live baseline so Grok cannot invent
    // a before-score from the stale .danteforge/ASCEND_REPORT.md.
    async prepare(_args, projectRoot) {
      try {
        const { stdout, stderr } = await execFileAsync(
          "danteforge",
          ["score", "--level", "light"],
          { cwd: projectRoot, timeout: 30_000, windowsHide: true },
        );
        const baseline = (stdout + stderr).trim();
        if (!baseline) return "";
        return `**[Live baseline — captured by runtime before ascend loop]**\n\`\`\`\n${baseline}\n\`\`\`\n\n`;
      } catch {
        return "";
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
