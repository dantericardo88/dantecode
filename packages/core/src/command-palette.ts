/**
 * command-palette.ts
 *
 * /command registry with fuzzy search and PDSE-driven suggestions.
 */

export interface PaletteCommand {
  name: string; // e.g. "magic"
  description: string;
  keywords: string[];
  category: "workflow" | "git" | "search" | "agent" | "system";
  pdseMinScore?: number; // only suggest if PDSE score >= this
}

export interface CommandMatch {
  command: PaletteCommand;
  score: number; // 0-1
}

export interface CommandPaletteOptions {
  /** Initial commands to seed (merged with built-ins). */
  commands?: PaletteCommand[];
}

const BUILT_IN_COMMANDS: PaletteCommand[] = [
  {
    name: "magic",
    description: "Balanced autoforge preset",
    keywords: ["forge", "build", "auto", "task"],
    category: "workflow",
  },
  {
    name: "inferno",
    description: "Maximum-power preset with OSS discovery",
    keywords: ["full", "max", "oss", "discover", "power"],
    category: "workflow",
  },
  {
    name: "autoforge",
    description: "Deterministic auto-orchestration",
    keywords: ["auto", "orchestrate", "wave", "score"],
    category: "workflow",
  },
  {
    name: "party",
    description: "Multi-agent collaboration",
    keywords: ["parallel", "multi", "agent", "party", "worktree"],
    category: "agent",
  },
  {
    name: "commit",
    description: "Create a git commit",
    keywords: ["git", "commit", "save", "snapshot"],
    category: "git",
  },
  {
    name: "search",
    description: "Search the web or codebase",
    keywords: ["search", "find", "web", "grep", "query"],
    category: "search",
  },
  {
    name: "verify",
    description: "Run verification checks",
    keywords: ["check", "test", "verify", "validate", "qa"],
    category: "system",
  },
  {
    name: "forge",
    description: "Execute GSD waves for a feature",
    keywords: ["build", "feature", "implement", "gsd"],
    category: "workflow",
  },
];

export class CommandPalette {
  private commands: Map<string, PaletteCommand> = new Map();

  constructor(options: CommandPaletteOptions = {}) {
    // Seed with built-ins
    for (const cmd of BUILT_IN_COMMANDS) {
      this.commands.set(cmd.name, { ...cmd });
    }
    // Merge user-provided commands
    for (const cmd of options.commands ?? []) {
      this.commands.set(cmd.name, { ...cmd });
    }
  }

  /** Register a new command (or overwrite existing). */
  register(command: PaletteCommand): void {
    this.commands.set(command.name, { ...command });
  }

  /** Remove a command by name. Returns true if removed. */
  unregister(name: string): boolean {
    return this.commands.delete(name);
  }

  /** Get a command by exact name. */
  get(name: string): PaletteCommand | undefined {
    return this.commands.get(name);
  }

  /** List all commands, optionally filtered by category. */
  list(category?: PaletteCommand["category"]): PaletteCommand[] {
    const all = [...this.commands.values()];
    return category ? all.filter((c) => c.category === category) : all;
  }

  /**
   * Fuzzy search commands by query.
   * Scores: exact name match (1.0), name startsWith (0.8),
   * keyword overlap (Jaccard x 0.6), description word overlap (x 0.4).
   * Returns matches sorted by score desc, limited to `limit` (default 5).
   */
  search(query: string, limit = 5): CommandMatch[] {
    if (!query.trim()) return [];
    const q = query.toLowerCase().trim();
    const qTokens = this.tokenize(q);

    const scored = [...this.commands.values()].map((cmd) => {
      let score = 0;

      if (cmd.name === q) {
        score = 1.0;
      } else if (cmd.name.startsWith(q)) {
        score = 0.8;
      } else {
        // Keyword jaccard
        const kwTokens = new Set(cmd.keywords.map((k) => k.toLowerCase()));
        const kwScore = this.jaccard(qTokens, kwTokens) * 0.6;

        // Description word overlap
        const descTokens = this.tokenize(cmd.description);
        const descScore = this.jaccard(qTokens, descTokens) * 0.4;

        score = kwScore + descScore;
      }

      return { command: cmd, score };
    });

    return scored
      .filter((m) => m.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);
  }

  /**
   * PDSE context-aware suggestions.
   * Returns commands whose pdseMinScore <= currentPdseScore (or no requirement),
   * sorted by category relevance and alphabetically.
   */
  suggest(currentPdseScore: number, context?: string): PaletteCommand[] {
    const eligible = [...this.commands.values()].filter(
      (c) => c.pdseMinScore === undefined || currentPdseScore >= c.pdseMinScore,
    );

    // If context given, prefer commands whose keywords overlap with context
    if (context) {
      const ctxTokens = this.tokenize(context);
      return eligible
        .map((c) => ({
          cmd: c,
          score: this.jaccard(ctxTokens, new Set(c.keywords)),
        }))
        .sort((a, b) => b.score - a.score || a.cmd.name.localeCompare(b.cmd.name))
        .map((x) => x.cmd);
    }

    return eligible.sort((a, b) => a.name.localeCompare(b.name));
  }

  private tokenize(text: string): Set<string> {
    return new Set(
      text
        .toLowerCase()
        .split(/[\s\-_/,.]+/)
        .filter((t) => t.length > 1),
    );
  }

  private jaccard(a: Set<string>, b: Set<string>): number {
    if (a.size === 0 && b.size === 0) return 0;
    let intersection = 0;
    for (const t of a) {
      if (b.has(t)) intersection++;
    }
    const union = a.size + b.size - intersection;
    return union === 0 ? 0 : intersection / union;
  }
}
