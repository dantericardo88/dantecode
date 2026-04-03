/**
 * command-completion.ts — VSCode Slash Command Autocomplete
 *
 * Provides fuzzy matching autocomplete for slash commands in the chat sidebar.
 * Integrates HelpEngine and CommandPalette from @dantecode/ux-polish.
 * Based on qwen-code's useSlashCompletion pattern.
 */

import { CommandPalette, type PaletteCommand } from "@dantecode/core";
import { listSkills } from "@dantecode/skill-adapter";

// ──────────────────────────────────────────────────────────────────────────────
// Types
// ──────────────────────────────────────────────────────────────────────────────

export interface CommandCompletionItem {
  /** The full command string (e.g., "/plan"). */
  command: string;
  /** Short description for display. */
  description: string;
  /** Category for grouping. */
  category: string;
  /** Usage example. */
  usage?: string;
  /** Fuzzy match score (0-1). */
  score?: number;
}

export interface CompletionResult {
  /** Matching commands sorted by relevance. */
  completions: CommandCompletionItem[];
  /** Query that generated these completions. */
  query: string;
  /** Whether results are still loading. */
  isLoading: boolean;
}

// ──────────────────────────────────────────────────────────────────────────────
// Command Definitions (synced with CLI slash-commands.ts)
// ──────────────────────────────────────────────────────────────────────────────

const CORE_COMMANDS: PaletteCommand[] = [
  {
    name: "plan",
    description: "Generate implementation plan with review/approve workflow",
    keywords: ["plan", "planning", "review", "approve", "architecture"],
    category: "workflow",
  },
  {
    name: "magic",
    description: "Balanced autoforge preset",
    keywords: ["magic", "auto", "forge", "build", "implement"],
    category: "workflow",
  },
  {
    name: "inferno",
    description: "Maximum-power preset with OSS discovery",
    keywords: ["inferno", "max", "oss", "power", "discover"],
    category: "workflow",
  },
  {
    name: "commit",
    description: "Create a git commit",
    keywords: ["commit", "git", "save", "snapshot"],
    category: "git",
  },
  {
    name: "diff",
    description: "Show git diff",
    keywords: ["diff", "changes", "git", "compare"],
    category: "git",
  },
  {
    name: "pdse",
    description: "Run PDSE quality scorer",
    keywords: ["pdse", "score", "quality", "verify"],
    category: "system",
  },
  {
    name: "verify-output",
    description: "Verify output against expectations",
    keywords: ["verify", "check", "validate", "test"],
    category: "system",
  },
  {
    name: "qa",
    description: "Run quality assurance suite",
    keywords: ["qa", "quality", "test", "check"],
    category: "system",
  },
  {
    name: "memory",
    description: "Memory operations (list/search/stats)",
    keywords: ["memory", "remember", "recall", "search"],
    category: "system",
  },
  {
    name: "search",
    description: "Semantic code search",
    keywords: ["search", "find", "lookup", "grep"],
    category: "search",
  },
  {
    name: "index",
    description: "Build semantic code index",
    keywords: ["index", "build", "semantic", "search"],
    category: "search",
  },
  {
    name: "bg",
    description: "Run task in background",
    keywords: ["bg", "background", "async", "parallel"],
    category: "agent",
  },
  {
    name: "party",
    description: "Multi-agent collaboration",
    keywords: ["party", "multi", "agent", "parallel", "worktree"],
    category: "agent",
  },
  {
    name: "automate",
    description: "Automation dashboard (webhooks/schedules/watchers)",
    keywords: ["automate", "webhook", "schedule", "watch"],
    category: "system",
  },
  {
    name: "help",
    description: "Show available commands",
    keywords: ["help", "commands", "usage", "guide"],
    category: "system",
  },
  {
    name: "model",
    description: "Switch AI model",
    keywords: ["model", "switch", "provider", "llm"],
    category: "system",
  },
  {
    name: "status",
    description: "System status dashboard",
    keywords: ["status", "health", "metrics", "info"],
    category: "system",
  },
  {
    name: "history",
    description: "Chat history",
    keywords: ["history", "past", "sessions", "log"],
    category: "system",
  },
  {
    name: "session",
    description: "Session management",
    keywords: ["session", "manage", "save", "load"],
    category: "system",
  },
  {
    name: "export",
    description: "Export session",
    keywords: ["export", "save", "download", "backup"],
    category: "system",
  },
  {
    name: "import",
    description: "Import session",
    keywords: ["import", "load", "restore", "upload"],
    category: "system",
  },
  {
    name: "skill",
    description: "Execute or manage skills",
    keywords: ["skill", "run", "execute", "manage"],
    category: "system",
  },
  {
    name: "skills",
    description: "List available skills",
    keywords: ["skills", "list", "available", "catalog"],
    category: "system",
  },
  {
    name: "revert",
    description: "Revert last commit",
    keywords: ["revert", "undo", "rollback", "git"],
    category: "git",
  },
  {
    name: "undo",
    description: "Undo last edit",
    keywords: ["undo", "restore", "revert", "rollback"],
    category: "git",
  },
  {
    name: "fork",
    description: "Fork current session",
    keywords: ["fork", "branch", "split", "session"],
    category: "system",
  },
  {
    name: "lessons",
    description: "View learned lessons",
    keywords: ["lessons", "learn", "improve", "knowledge"],
    category: "system",
  },
  {
    name: "gaslight",
    description: "Toggle gaslight mode",
    keywords: ["gaslight", "adversarial", "critique", "review"],
    category: "system",
  },
  {
    name: "research",
    description: "Research mode with web search",
    keywords: ["research", "web", "search", "investigate"],
    category: "search",
  },
  {
    name: "review",
    description: "GitHub PR review",
    keywords: ["review", "pr", "github", "code"],
    category: "git",
  },
  {
    name: "forge",
    description: "Execute GSD waves for a feature",
    keywords: ["forge", "gsd", "feature", "implement"],
    category: "workflow",
  },
  {
    name: "autoforge",
    description: "Deterministic auto-orchestration",
    keywords: ["autoforge", "auto", "orchestrate", "wave"],
    category: "workflow",
  },
  {
    name: "fleet",
    description: "Fleet management",
    keywords: ["fleet", "agents", "manage", "orchestrate"],
    category: "agent",
  },
  {
    name: "theme",
    description: "Change UI theme",
    keywords: ["theme", "colors", "appearance", "ui"],
    category: "system",
  },
  {
    name: "cost",
    description: "Show cost tracking",
    keywords: ["cost", "price", "budget", "usage"],
    category: "system",
  },
  {
    name: "sandbox",
    description: "Toggle sandbox mode",
    keywords: ["sandbox", "docker", "isolation", "security"],
    category: "system",
  },
  {
    name: "mcp",
    description: "MCP server management",
    keywords: ["mcp", "server", "tools", "extension"],
    category: "system",
  },
];

// ──────────────────────────────────────────────────────────────────────────────
// CommandCompletionEngine
// ──────────────────────────────────────────────────────────────────────────────

export class CommandCompletionEngine {
  private palette: CommandPalette;
  private skillsCache: PaletteCommand[] = [];
  private lastSkillsRefresh = 0;
  private readonly SKILLS_CACHE_TTL = 60_000; // 1 minute

  constructor() {
    this.palette = new CommandPalette({ commands: CORE_COMMANDS });
  }

  /**
   * Get completions for a given query.
   * Returns up to `limit` commands sorted by relevance.
   */
  async getCompletions(query: string, limit = 10): Promise<CompletionResult> {
    // Refresh skills if needed
    await this.refreshSkillsIfNeeded();

    // Empty query → show all commands
    if (!query || query === "/") {
      const all = this.palette.list();
      const completions = all.slice(0, limit).map((cmd) => this.toCompletionItem(cmd, 1.0));
      return { completions, query, isLoading: false };
    }

    // Remove leading "/" if present
    const cleanQuery = query.startsWith("/") ? query.slice(1) : query;

    // Fuzzy search via CommandPalette
    const matches = this.palette.search(cleanQuery, limit);
    const completions = matches.map((m) => this.toCompletionItem(m.command, m.score));

    return { completions, query, isLoading: false };
  }

  /**
   * Get command details by exact name.
   */
  getCommandDetails(commandName: string): CommandCompletionItem | null {
    const cmd = this.palette.get(commandName);
    if (!cmd) return null;
    return this.toCompletionItem(cmd, 1.0);
  }

  /**
   * Get all commands grouped by category.
   */
  getAllCommandsByCategory(): Record<string, CommandCompletionItem[]> {
    const grouped: Record<string, CommandCompletionItem[]> = {};
    const all = this.palette.list();

    for (const cmd of all) {
      const cat = cmd.category || "other";
      if (!grouped[cat]) grouped[cat] = [];
      grouped[cat]!.push(this.toCompletionItem(cmd, 1.0));
    }

    return grouped;
  }

  // ────────────────────────────────────────────────────────────────────────────
  // Private helpers
  // ────────────────────────────────────────────────────────────────────────────

  private async refreshSkillsIfNeeded(): Promise<void> {
    const now = Date.now();
    if (now - this.lastSkillsRefresh < this.SKILLS_CACHE_TTL) {
      return; // Cache still valid
    }

    try {
      const skills = await listSkills(process.cwd());
      const skillCommands: PaletteCommand[] = skills.map((skill) => ({
        name: skill.name,
        description: skill.description || `Execute skill: ${skill.name}`,
        keywords: [skill.name, "skill", ...(skill.tags || [])],
        category: "system" as const,
      }));

      // Remove old skills and add new ones
      for (const oldSkill of this.skillsCache) {
        this.palette.unregister(oldSkill.name);
      }
      for (const newSkill of skillCommands) {
        this.palette.register(newSkill);
      }

      this.skillsCache = skillCommands;
      this.lastSkillsRefresh = now;
    } catch (err) {
      // Non-fatal - skills just won't be autocompleted
      console.warn("Failed to refresh skills for autocomplete:", err);
    }
  }

  private toCompletionItem(cmd: PaletteCommand, score: number): CommandCompletionItem {
    return {
      command: `/${cmd.name}`,
      description: cmd.description,
      category: cmd.category || "other",
      usage: this.generateUsage(cmd.name),
      score,
    };
  }

  private generateUsage(commandName: string): string {
    // Usage hints for common commands
    const usageMap: Record<string, string> = {
      plan: "/plan <goal>",
      magic: "/magic <task>",
      commit: "/commit [message]",
      diff: "/diff [file]",
      pdse: "/pdse <file>",
      search: "/search <query>",
      memory: "/memory list|search|stats",
      session: "/session list|save|load",
      skill: "/skill <name> [args]",
      bg: "/bg <task>",
      party: "/party <goal>",
      automate: "/automate dashboard|list|create",
      model: "/model <provider/model>",
      export: "/export <path>",
      import: "/import <path>",
    };

    return usageMap[commandName] || `/${commandName}`;
  }
}

// ──────────────────────────────────────────────────────────────────────────────
// Singleton instance
// ──────────────────────────────────────────────────────────────────────────────

let globalEngine: CommandCompletionEngine | null = null;

export function getCommandCompletionEngine(): CommandCompletionEngine {
  if (!globalEngine) {
    globalEngine = new CommandCompletionEngine();
  }
  return globalEngine;
}
