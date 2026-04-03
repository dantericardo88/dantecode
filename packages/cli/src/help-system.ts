// ============================================================================
// @dantecode/cli — Help System
// Groups commands by category, detects first-run state, and provides
// contextual suggestions for a progressive disclosure help experience.
// ============================================================================

import { existsSync } from "node:fs";
import { join } from "node:path";

// ────────────────────────────────────────────────────────────────────────────
// Types
// ────────────────────────────────────────────────────────────────────────────

/** A slash command definition (minimal fields needed by the help system). */
export interface HelpSlashCommand {
  name: string;
  description: string;
  usage: string;
  /** Disclosure tier: 1 = always shown, 2 = shown in expanded help. */
  tier?: number;
}

/** Commands grouped by category label. */
export type GroupedCommands = Record<
  string,
  Array<{ name: string; description: string; tier: number }>
>;

// ────────────────────────────────────────────────────────────────────────────
// ANSI Colors (local to avoid import coupling)
// ────────────────────────────────────────────────────────────────────────────

const CYAN = "\x1b[36m";
const YELLOW = "\x1b[33m";
const GREEN = "\x1b[32m";
const DIM = "\x1b[2m";
const BOLD = "\x1b[1m";
const RESET = "\x1b[0m";

// ────────────────────────────────────────────────────────────────────────────
// Category Mapping
// ────────────────────────────────────────────────────────────────────────────

/** Maps command names to their category. */
const COMMAND_CATEGORIES: Record<string, string> = {
  // Core
  help: "Core",
  model: "Core",
  clear: "Core",
  tokens: "Core",
  compact: "Core",
  silent: "Core",

  // Development
  add: "Development",
  drop: "Development",
  files: "Development",
  diff: "Development",
  commit: "Development",
  revert: "Development",
  undo: "Development",
  autoforge: "Development",
  architect: "Development",
  party: "Development",
  oss: "Development",

  // Search & Index
  web: "Search",
  search: "Search",
  index: "Search",

  // Security & Quality
  pdse: "Security",
  qa: "Security",
  sandbox: "Security",

  // Config & Memory
  lessons: "Config",
  remember: "Config",
  audit: "Config",
  history: "Config",
  "read-only": "Config",

  // Git & Automation
  worktree: "Git",
  listen: "Git",
  bg: "Git",

  // Agents & Skills
  skill: "Agents",
  agents: "Agents",
  mcp: "Agents",
};

/** Ordered categories for display. */
const CATEGORY_ORDER = ["Core", "Development", "Search", "Security", "Config", "Git", "Agents"];

// ────────────────────────────────────────────────────────────────────────────
// HelpSystem
// ────────────────────────────────────────────────────────────────────────────

/**
 * Progressive disclosure help system for the DanteCode CLI.
 *
 * Groups commands by category, detects first-run state, and provides
 * contextual suggestions based on the current REPL state.
 */
export class HelpSystem {
  /**
   * Groups slash commands by category.
   *
   * Commands without a known category mapping go into "Other".
   */
  getGroupedCommands(commands: HelpSlashCommand[]): GroupedCommands {
    const groups: GroupedCommands = {};

    for (const cmd of commands) {
      const category = COMMAND_CATEGORIES[cmd.name] ?? "Other";
      if (!groups[category]) {
        groups[category] = [];
      }
      groups[category]!.push({
        name: cmd.name,
        description: cmd.description,
        tier: cmd.tier ?? 1,
      });
    }

    return groups;
  }

  /**
   * Detects whether this is the first run in a project directory.
   *
   * Returns true if `.dantecode/` directory does not exist.
   */
  detectFirstRun(projectRoot: string): boolean {
    const danteDir = join(projectRoot, ".dantecode");
    return !existsSync(danteDir);
  }

  /**
   * Returns suggested commands for first-time users.
   */
  getFirstRunSuggestions(): string[] {
    return [
      "/help - See all available commands",
      "/model - Configure your AI model",
      "/add <file> - Add a file to the conversation",
    ];
  }

  /**
   * Returns context-aware command suggestions based on current state.
   */
  getContextualSuggestions(state: {
    messageCount: number;
    hasGitRepo: boolean;
    hasDantecodeDir: boolean;
  }): string[] {
    const suggestions: string[] = [];

    if (!state.hasDantecodeDir) {
      suggestions.push("/remember - Save a note to project memory");
    }

    if (state.hasGitRepo && state.messageCount > 0) {
      suggestions.push("/diff - Review your pending changes");
      suggestions.push("/commit - Commit your changes");
    }

    if (state.messageCount === 0) {
      suggestions.push("/add <file> - Start by adding a file to work on");
      suggestions.push("/skill - Explore available skills");
    }

    if (state.messageCount > 10) {
      suggestions.push("/compact - Free up context space");
      suggestions.push("/tokens - Check token usage");
    }

    return suggestions;
  }

  /**
   * Renders grouped help output with ANSI colors.
   *
   * @param groups - The grouped commands.
   * @param tier - Maximum tier to show (1 = essential only, 2 = all).
   * @returns Formatted multi-line string with ANSI colors.
   */
  formatGroupedHelp(groups: GroupedCommands, tier?: 1 | 2): string {
    const maxTier = tier ?? 2;
    const lines: string[] = ["", `${BOLD}DanteCode Commands${RESET}`, ""];

    // Ordered display
    const orderedCategories = CATEGORY_ORDER.filter((c) => groups[c]);
    // Add any categories not in the ordered list
    for (const cat of Object.keys(groups)) {
      if (!orderedCategories.includes(cat)) {
        orderedCategories.push(cat);
      }
    }

    for (const category of orderedCategories) {
      const commands = groups[category];
      if (!commands) continue;

      const filtered = commands.filter((c) => c.tier <= maxTier);
      if (filtered.length === 0) continue;

      lines.push(`  ${CYAN}${BOLD}${category}${RESET}`);

      for (const cmd of filtered) {
        const name = `/${cmd.name}`.padEnd(20);
        lines.push(`    ${YELLOW}${name}${RESET} ${DIM}${cmd.description}${RESET}`);
      }

      lines.push("");
    }

    if (maxTier === 1) {
      lines.push(`${DIM}Type /help --all to see all commands.${RESET}`);
    }

    lines.push(
      `${GREEN}Tip:${RESET} ${DIM}Type naturally to chat, or use / commands for actions.${RESET}`,
    );
    lines.push("");

    return lines.join("\n");
  }
}
