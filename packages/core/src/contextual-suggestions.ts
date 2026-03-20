/**
 * contextual-suggestions.ts
 *
 * Context-aware slash-command and workflow suggestions for DanteCode.
 * Inspired by Mastra's intelligent CLI defaults and Cline's command palette UX.
 *
 * Analyzes the current session state (PDSE score, error patterns, pipeline state,
 * recent commands, file context) to surface the most relevant next actions.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type SuggestionTrigger =
  | "low_pdse"          // PDSE score < 0.7
  | "test_failure"      // test suite failing
  | "typecheck_error"   // TypeScript errors present
  | "pipeline_idle"     // no active pipeline, user is typing
  | "pipeline_complete" // a forge/magic run just finished
  | "high_context"      // context window > 75%
  | "first_message"     // user's first message in session
  | "file_edited"       // user just saved a file
  | "git_dirty";        // uncommitted changes detected

export interface SuggestionContext {
  pdseScore?: number;
  activeErrors?: string[];
  pipelineState?: "idle" | "running" | "complete" | "failed";
  recentCommands?: string[];
  contextPercent?: number;
  hasUncommittedChanges?: boolean;
  isFirstMessage?: boolean;
  editedFilePaths?: string[];
  currentQuery?: string;
}

export interface Suggestion {
  command: string;
  label: string;
  reason: string;
  priority: "high" | "medium" | "low";
  trigger: SuggestionTrigger;
}

export interface ContextualSuggestionsOptions {
  /** Max suggestions to return. Default: 5. */
  maxSuggestions?: number;
}

// ---------------------------------------------------------------------------
// Suggestion rules
// ---------------------------------------------------------------------------

interface SuggestionRule {
  trigger: SuggestionTrigger;
  command: string;
  label: string;
  reason: string;
  priority: "high" | "medium" | "low";
  /** Return true if this rule applies to the given context. */
  applies(ctx: SuggestionContext): boolean;
}

const SUGGESTION_RULES: SuggestionRule[] = [
  // ── Quality gate failures ────────────────────────────────────────────────
  {
    trigger: "typecheck_error",
    command: "/verify",
    label: "Run verification",
    reason: "TypeScript errors detected — verify the full error set before fixing.",
    priority: "high",
    applies: (ctx) =>
      !!ctx.activeErrors?.some((e) => /TS\d{4}|tsc|typecheck/i.test(e)),
  },
  {
    trigger: "test_failure",
    command: "/debug",
    label: "Start systematic debug",
    reason: "Test failures present — use /debug to root-cause before patching.",
    priority: "high",
    applies: (ctx) =>
      !!ctx.activeErrors?.some((e) => /AssertionError|vitest|test.*fail/i.test(e)),
  },
  {
    trigger: "low_pdse",
    command: "/autoforge",
    label: "Run autoforge to improve score",
    reason: `PDSE score below 0.7 — autoforge can close the gap automatically.`,
    priority: "high",
    applies: (ctx) => ctx.pdseScore !== undefined && ctx.pdseScore < 0.7,
  },

  // ── Pipeline state ────────────────────────────────────────────────────────
  {
    trigger: "pipeline_complete",
    command: "/verify",
    label: "Verify pipeline output",
    reason: "Pipeline just completed — run /verify to check PDSE gate and test coverage.",
    priority: "high",
    applies: (ctx) => ctx.pipelineState === "complete",
  },
  {
    trigger: "pipeline_complete",
    command: "/ship",
    label: "Review for release",
    reason: "Pipeline complete — review and bump version with /ship.",
    priority: "medium",
    applies: (ctx) => ctx.pipelineState === "complete",
  },
  {
    trigger: "pipeline_idle",
    command: "/magic",
    label: "Run balanced forge pipeline",
    reason: "Start a balanced /magic run for daily development work.",
    priority: "medium",
    applies: (ctx) => ctx.pipelineState === "idle" && !ctx.isFirstMessage,
  },

  // ── Context window ────────────────────────────────────────────────────────
  {
    trigger: "high_context",
    command: "/compact",
    label: "Compact conversation",
    reason: "Context window is over 75% — compact now to avoid truncation.",
    priority: "high",
    applies: (ctx) => (ctx.contextPercent ?? 0) > 75,
  },

  // ── Git state ────────────────────────────────────────────────────────────
  {
    trigger: "git_dirty",
    command: "/commit",
    label: "Commit changes",
    reason: "Uncommitted changes detected — checkpoint your work before continuing.",
    priority: "medium",
    applies: (ctx) => !!ctx.hasUncommittedChanges && ctx.pipelineState !== "running",
  },

  // ── First message ────────────────────────────────────────────────────────
  {
    trigger: "first_message",
    command: "/review",
    label: "Review project state",
    reason: "Start with a project review to understand the current state.",
    priority: "medium",
    applies: (ctx) => !!ctx.isFirstMessage && !ctx.recentCommands?.length,
  },
  {
    trigger: "first_message",
    command: "/verify",
    label: "Check quality gate",
    reason: "Verify the codebase is in a clean state before making changes.",
    priority: "low",
    applies: (ctx) => !!ctx.isFirstMessage,
  },

  // ── File editing ────────────────────────────────────────────────────────
  {
    trigger: "file_edited",
    command: "/verify",
    label: "Verify after edit",
    reason: "Files were recently edited — run /verify to confirm no regressions.",
    priority: "medium",
    applies: (ctx) =>
      !!ctx.editedFilePaths?.length && ctx.pipelineState !== "running",
  },
  {
    trigger: "file_edited",
    command: "/pdse",
    label: "Score edited file",
    reason: "Check PDSE quality score on the recently edited file.",
    priority: "low",
    applies: (ctx) =>
      !!ctx.editedFilePaths?.length &&
      ctx.editedFilePaths.some((f) => /\.(ts|js|py)$/.test(f)),
  },
];

// ---------------------------------------------------------------------------
// ContextualSuggestions
// ---------------------------------------------------------------------------

export class ContextualSuggestions {
  private readonly maxSuggestions: number;

  constructor(options: ContextualSuggestionsOptions = {}) {
    this.maxSuggestions = options.maxSuggestions ?? 5;
  }

  /**
   * Generate ranked suggestions for the given session context.
   * Returns up to `maxSuggestions` suggestions, deduped by command,
   * sorted high→medium→low priority.
   */
  suggest(ctx: SuggestionContext): Suggestion[] {
    const seen = new Set<string>();
    const results: Suggestion[] = [];

    // Apply query-based boost: if user is typing something, rerank by relevance
    const query = ctx.currentQuery?.toLowerCase() ?? "";

    const matched = SUGGESTION_RULES.filter((r) => r.applies(ctx));

    // Sort: priority order, then query relevance boost
    const PRIORITY_ORDER: Record<string, number> = { high: 0, medium: 1, low: 2 };
    matched.sort((a, b) => {
      const pDiff = PRIORITY_ORDER[a.priority]! - PRIORITY_ORDER[b.priority]!;
      if (pDiff !== 0) return pDiff;
      if (query) {
        const aRel = this._queryRelevance(query, a.command + " " + a.label);
        const bRel = this._queryRelevance(query, b.command + " " + b.label);
        return bRel - aRel;
      }
      return 0;
    });

    for (const rule of matched) {
      if (seen.has(rule.command)) continue;
      seen.add(rule.command);
      results.push({
        command: rule.command,
        label: rule.label,
        reason: rule.reason,
        priority: rule.priority,
        trigger: rule.trigger,
      });
      if (results.length >= this.maxSuggestions) break;
    }

    return results;
  }

  /**
   * Detect which triggers are active for the given context.
   */
  detectTriggers(ctx: SuggestionContext): SuggestionTrigger[] {
    const active = new Set<SuggestionTrigger>();
    for (const rule of SUGGESTION_RULES) {
      if (rule.applies(ctx)) active.add(rule.trigger);
    }
    return Array.from(active);
  }

  /**
   * Get the single highest-priority suggestion (or null if none apply).
   */
  topSuggestion(ctx: SuggestionContext): Suggestion | null {
    return this.suggest(ctx)[0] ?? null;
  }

  /**
   * Format suggestions as a CLI hint block.
   */
  format(suggestions: Suggestion[], options: { colors?: boolean } = {}): string {
    if (!suggestions.length) return "";
    const colors = options.colors ?? true;
    const CYAN = colors ? "\x1b[36m" : "";
    const YELLOW = colors ? "\x1b[33m" : "";
    const DIM = colors ? "\x1b[2m" : "";
    const BOLD = colors ? "\x1b[1m" : "";
    const RESET = colors ? "\x1b[0m" : "";

    const lines: string[] = [`${BOLD}Suggested next steps:${RESET}`];
    for (const s of suggestions) {
      const badge =
        s.priority === "high"
          ? `${YELLOW}!${RESET}`
          : s.priority === "medium"
            ? `${CYAN}›${RESET}`
            : `${DIM}·${RESET}`;
      lines.push(`  ${badge} ${CYAN}${s.command}${RESET}  ${DIM}${s.reason}${RESET}`);
    }
    return lines.join("\n");
  }

  // -------------------------------------------------------------------------
  // Private
  // -------------------------------------------------------------------------

  private _queryRelevance(query: string, target: string): number {
    const q = query.toLowerCase();
    const t = target.toLowerCase();
    if (t.includes(q)) return 1;
    // Token overlap
    const qTokens = q.split(/\s+/);
    const matches = qTokens.filter((tok) => t.includes(tok));
    return matches.length / Math.max(qTokens.length, 1);
  }
}

/** Singleton with default options. */
export const contextualSuggestions = new ContextualSuggestions();
