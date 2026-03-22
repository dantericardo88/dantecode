/**
 * help-engine.ts — @dantecode/ux-polish
 *
 * Contextual help and command documentation engine.
 * Provides command help cards, fuzzy search, and PDSE-aware guidance.
 */

import type { UXSuggestion, SuggestionContext } from "./types.js";
import { ThemeEngine } from "./theme-engine.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface HelpEntry {
  command: string;
  shortDesc: string;
  longDesc?: string;
  usage?: string;
  examples?: string[];
  tags?: string[];
  pdseNote?: string;
}

export interface HelpSearchResult {
  entry: HelpEntry;
  score: number;
}

// ---------------------------------------------------------------------------
// Built-in command registry
// ---------------------------------------------------------------------------

const BUILT_IN_HELP: HelpEntry[] = [
  {
    command: "/magic",
    shortDesc: "Balanced default pipeline — daily development work",
    longDesc: "Runs the balanced /magic preset: OSS discovery, forge, verify, lessons.",
    usage: "/magic [goal]",
    examples: ["/magic", "/magic add authentication"],
    tags: ["pipeline", "forge", "daily"],
    pdseNote: "Targets PDSE ≥ 8.5 on each wave.",
  },
  {
    command: "/autoforge",
    shortDesc: "Autonomous multi-wave improvement loop",
    usage: "/autoforge [--self-improve] [--resume]",
    tags: ["pipeline", "autonomous"],
    pdseNote: "Runs until PDSE gates pass or budget exhausted.",
  },
  {
    command: "/verify",
    shortDesc: "Run full PDSE quality gate (typecheck → lint → test)",
    usage: "/verify",
    tags: ["quality", "pdse"],
    pdseNote: "Runs all four PDSE gates. Required before /ship.",
  },
  {
    command: "/debug",
    shortDesc: "Systematic 4-phase root-cause analysis",
    usage: "/debug [description]",
    tags: ["debug", "fix"],
  },
  {
    command: "/ship",
    shortDesc: "Paranoid release check — version bump, changelog, tests",
    usage: "/ship",
    tags: ["release", "deploy"],
  },
  {
    command: "/party",
    shortDesc: "Multi-agent parallel collaboration",
    usage: "/party [--worktree] [task]",
    tags: ["multi-agent", "parallel"],
  },
  {
    command: "/inferno",
    shortDesc: "Maximum-power preset — full OSS discovery + implementation",
    usage: "/inferno [goal]",
    tags: ["pipeline", "maximum"],
  },
  {
    command: "/review",
    shortDesc: "Scan repo and generate CURRENT_STATE.md",
    usage: "/review",
    tags: ["audit", "review"],
  },
  {
    command: "/compact",
    shortDesc: "Compact the conversation to free context window",
    usage: "/compact",
    tags: ["context", "memory"],
  },
  {
    command: "/pdse",
    shortDesc: "Show PDSE confidence scores for the current codebase",
    usage: "/pdse [file]",
    tags: ["quality", "pdse"],
  },
];

// ---------------------------------------------------------------------------
// HelpEngine
// ---------------------------------------------------------------------------

export interface HelpEngineOptions {
  theme?: ThemeEngine;
  /** Extra help entries to register. */
  extraEntries?: HelpEntry[];
}

export class HelpEngine {
  private readonly _entries: HelpEntry[];
  private readonly _engine: ThemeEngine;

  constructor(options: HelpEngineOptions = {}) {
    this._engine = options.theme ?? new ThemeEngine();
    this._entries = [...BUILT_IN_HELP, ...(options.extraEntries ?? [])];
  }

  // -------------------------------------------------------------------------
  // Search
  // -------------------------------------------------------------------------

  /** Search help entries by query string. Returns ranked results. */
  search(query: string, limit = 5): HelpSearchResult[] {
    const q = query.toLowerCase().trim();
    if (!q) return this._entries.slice(0, limit).map((e) => ({ entry: e, score: 1 }));

    const scored = this._entries
      .map((entry) => ({ entry, score: this._score(q, entry) }))
      .filter((r) => r.score > 0)
      .sort((a, b) => b.score - a.score);

    return scored.slice(0, limit);
  }

  /** Get exact help entry for a command. */
  get(command: string): HelpEntry | undefined {
    return this._entries.find((e) => e.command === command);
  }

  /** List all registered commands. */
  list(): string[] {
    return this._entries.map((e) => e.command);
  }

  // -------------------------------------------------------------------------
  // Rendering
  // -------------------------------------------------------------------------

  /** Format a help entry as a rich CLI card. */
  formatEntry(entry: HelpEntry): string {
    const e = this._engine;
    const lines: string[] = [`${e.boldText(entry.command)}  ${e.muted(entry.shortDesc)}`];

    if (entry.longDesc) lines.push(`  ${entry.longDesc}`);
    if (entry.usage) lines.push(`  ${e.muted("Usage:")} ${entry.usage}`);

    if (entry.examples?.length) {
      lines.push(`  ${e.muted("Examples:")}`);
      for (const ex of entry.examples) lines.push(`    ${e.info(ex)}`);
    }

    if (entry.pdseNote) {
      lines.push(`  ${e.warning("PDSE:")} ${entry.pdseNote}`);
    }

    return lines.join("\n");
  }

  /** Format search results as a compact list. */
  formatResults(results: HelpSearchResult[]): string {
    if (!results.length) return this._engine.muted("No matching commands found.");
    const e = this._engine;
    const lines = results.map(
      (r) => `  ${e.info(r.entry.command.padEnd(16))} ${e.muted(r.entry.shortDesc)}`,
    );
    return lines.join("\n");
  }

  /** Format a contextual hint block from suggestions. */
  formatSuggestionsHint(suggestions: UXSuggestion[]): string {
    if (!suggestions.length) return "";
    const e = this._engine;
    const lines: string[] = [`${e.boldText("Suggested next steps:")}`];
    for (const s of suggestions) {
      const badge =
        s.priority === "high"
          ? e.warning("!")
          : s.priority === "medium"
            ? e.info("›")
            : e.muted("·");
      lines.push(`  ${badge} ${e.info(s.command)}  ${e.muted(s.reason)}`);
    }
    return lines.join("\n");
  }

  // -------------------------------------------------------------------------
  // Private
  // -------------------------------------------------------------------------

  private _score(query: string, entry: HelpEntry): number {
    const targets = [
      entry.command,
      entry.shortDesc,
      ...(entry.tags ?? []),
      entry.longDesc ?? "",
    ].map((t) => t.toLowerCase());

    let score = 0;
    for (const target of targets) {
      if (target === query) {
        score += 10;
        continue;
      }
      if (target.startsWith(query)) {
        score += 5;
        continue;
      }
      if (target.includes(query)) {
        score += 3;
        continue;
      }
      const qTokens = query.split(/\s+/);
      const matches = qTokens.filter((tok) => target.includes(tok));
      score += matches.length;
    }
    return score;
  }
}

// ---------------------------------------------------------------------------
// Suggestion engine
// ---------------------------------------------------------------------------

/**
 * Derive contextual next-step suggestions from session state.
 * This is a standalone function (not a class) to keep it lightweight.
 */
export function getContextualSuggestions(ctx: SuggestionContext, maxResults = 5): UXSuggestion[] {
  const rules: Array<{ applies: (c: SuggestionContext) => boolean; suggestion: UXSuggestion }> = [
    {
      applies: (c) => (c.pdseScore ?? 1) < 0.7,
      suggestion: {
        command: "/autoforge",
        label: "Run autoforge",
        reason: "PDSE score below 0.7",
        priority: "high",
      },
    },
    {
      applies: (c) => !!c.activeErrors?.some((e) => /TS\d{4}|tsc|typecheck/i.test(e)),
      suggestion: {
        command: "/verify",
        label: "Run verification",
        reason: "TypeScript errors detected",
        priority: "high",
      },
    },
    {
      applies: (c) => !!c.activeErrors?.some((e) => /AssertionError|vitest|test.*fail/i.test(e)),
      suggestion: {
        command: "/debug",
        label: "Start systematic debug",
        reason: "Test failures present",
        priority: "high",
      },
    },
    {
      applies: (c) => c.pipelineState === "complete",
      suggestion: {
        command: "/verify",
        label: "Verify pipeline output",
        reason: "Pipeline just completed",
        priority: "high",
      },
    },
    {
      applies: (c) => (c.contextPercent ?? 0) > 75,
      suggestion: {
        command: "/compact",
        label: "Compact conversation",
        reason: "Context window > 75%",
        priority: "high",
      },
    },
    {
      applies: (c) => !!c.hasUncommittedChanges && c.pipelineState !== "running",
      suggestion: {
        command: "/commit",
        label: "Commit changes",
        reason: "Uncommitted changes detected",
        priority: "medium",
      },
    },
    {
      applies: (c) => c.pipelineState === "complete",
      suggestion: {
        command: "/ship",
        label: "Review for release",
        reason: "Pipeline complete",
        priority: "medium",
      },
    },
    {
      applies: (c) => c.pipelineState === "idle" && !c.isFirstMessage,
      suggestion: {
        command: "/magic",
        label: "Run balanced forge pipeline",
        reason: "No active pipeline",
        priority: "medium",
      },
    },
    {
      applies: (c) => !!c.isFirstMessage,
      suggestion: {
        command: "/review",
        label: "Review project state",
        reason: "Start with a project review",
        priority: "medium",
      },
    },
    {
      applies: (c) => !!c.editedFilePaths?.length && c.pipelineState !== "running",
      suggestion: {
        command: "/verify",
        label: "Verify after edit",
        reason: "Files recently edited",
        priority: "medium",
      },
    },
    {
      applies: (c) => !!c.isFirstMessage,
      suggestion: {
        command: "/verify",
        label: "Check quality gate",
        reason: "Verify clean state before changes",
        priority: "low",
      },
    },
  ];

  const seen = new Set<string>();
  const results: UXSuggestion[] = [];

  for (const rule of rules) {
    if (results.length >= maxResults) break;
    if (!rule.applies(ctx)) continue;
    if (seen.has(rule.suggestion.command)) continue;
    seen.add(rule.suggestion.command);
    results.push(rule.suggestion);
  }

  return results;
}
