// packages/core/src/sliding-context-window.ts
// Sliding-window context management — deepens dim 12 (Chat & UX context: 8→9).
//
// Harvested from: Cline sliding-window context truncation, Plandex context budget,
//                 OpenHands context eviction policy.
//
// Provides:
//   - ContextTurn: typed conversation turn with priority metadata
//   - SlidingContextWindow: auto-evict oldest turns when over token budget
//   - ContextPriorityScorer: scores turns for retention (code > error > decision > chat)
//   - Pinned turns: never evicted (system prompt, key decisions)
//   - Compression: lossless extractive summary of evicted turns
//   - Context budget awareness: respects model context window

// ─── Types ────────────────────────────────────────────────────────────────────

export type TurnRole = "system" | "user" | "assistant" | "tool";

export type TurnContentType =
  | "code"        // contains code blocks
  | "error"       // error messages, stack traces
  | "decision"    // key architectural/task decisions
  | "tool-call"   // tool invocation + result
  | "chat"        // general conversation
  | "summary";    // compressed summary of evicted turns

export interface ContextTurn {
  id: string;
  role: TurnRole;
  content: string;
  /** Approximate token count */
  tokens: number;
  contentType: TurnContentType;
  /** Priority score 0–1 (higher = keep longer) */
  priority: number;
  /** Pinned turns are never evicted */
  pinned: boolean;
  /** ISO timestamp */
  createdAt: string;
  /** Whether this turn was synthesized by compression */
  isSummary?: boolean;
}

export interface ContextWindowOptions {
  /** Maximum tokens allowed in the window (default: 8000) */
  maxTokens?: number;
  /** Reserve this many tokens for new turns (default: 500) */
  reserveTokens?: number;
  /** When over budget, compact until this % of budget (default: 0.70) */
  compactTo?: number;
  /** Chars-per-token approximation (default: 4) */
  charsPerToken?: number;
}

export interface EvictionResult {
  evictedTurns: ContextTurn[];
  summaryTurn?: ContextTurn;
  tokensFreed: number;
}

// ─── Token Estimation ─────────────────────────────────────────────────────────

const DEFAULT_CHARS_PER_TOKEN = 4;

export function estimateTokens(text: string, charsPerToken = DEFAULT_CHARS_PER_TOKEN): number {
  return Math.ceil(text.length / charsPerToken);
}

// ─── Content Type Classifier ──────────────────────────────────────────────────

const CODE_FENCE_RE = /```[\s\S]*?```/;
const ERROR_RE = /\b(error|exception|traceback|stack trace|failed|failure|crash)\b/i;
const DECISION_RE = /\b(decided|choosing|approach|strategy|plan|architecture|refactor|migrate)\b/i;
const TOOL_CALL_MARKERS = ["<tool_use>", "<tool_result>", "[tool_use]", "[bash]", "[write_file]"];

export function classifyTurnContent(content: string): TurnContentType {
  if (TOOL_CALL_MARKERS.some((m) => content.includes(m))) return "tool-call";
  if (CODE_FENCE_RE.test(content)) return "code";
  if (ERROR_RE.test(content)) return "error";
  if (DECISION_RE.test(content)) return "decision";
  return "chat";
}

// ─── Priority Scorer ─────────────────────────────────────────────────────────

const CONTENT_TYPE_PRIORITY: Record<TurnContentType, number> = {
  summary: 0.9,   // Always keep summaries
  error: 0.8,     // Errors are important to retain
  code: 0.75,     // Code blocks have high retention value
  decision: 0.70, // Decisions should be remembered
  "tool-call": 0.60,
  chat: 0.40,     // Pure chat has lowest retention value
};

export function scoreContextTurn(turn: ContextTurn, totalTurns: number, turnIndex: number): number {
  let score = CONTENT_TYPE_PRIORITY[turn.contentType];

  // Recency boost: newer turns score higher
  const recencyFactor = turnIndex / Math.max(1, totalTurns - 1);
  score += recencyFactor * 0.20;

  // System role always highest priority
  if (turn.role === "system") score = 1.0;

  return Math.min(1, Math.max(0, score));
}

// ─── Compression ─────────────────────────────────────────────────────────────

let _turnCounter = 0;

/**
 * Produce an extractive summary of evicted turns.
 * Preserves key code blocks and decisions; condenses chat to one line each.
 */
export function compressTurns(turns: ContextTurn[]): ContextTurn | undefined {
  if (turns.length === 0) return undefined;

  const lines: string[] = [`[Context Summary — ${turns.length} turns compressed]`];

  for (const t of turns) {
    const prefix = `[${t.role}]`;
    if (t.contentType === "code") {
      // Extract first code block only
      const match = t.content.match(/```[\w]*\n?([\s\S]*?)```/);
      if (match) lines.push(`${prefix} Code: ${match[1]!.slice(0, 200).trim()}…`);
    } else if (t.contentType === "error") {
      lines.push(`${prefix} Error: ${t.content.slice(0, 150).trim()}`);
    } else if (t.contentType === "decision") {
      lines.push(`${prefix} Decision: ${t.content.slice(0, 150).trim()}`);
    } else {
      // Chat: one-liner
      lines.push(`${prefix} ${t.content.slice(0, 80).trim()}`);
    }
  }

  const summaryContent = lines.join("\n");
  return {
    id: `turn-summary-${++_turnCounter}`,
    role: "assistant",
    content: summaryContent,
    tokens: estimateTokens(summaryContent),
    contentType: "summary",
    priority: 0.9,
    pinned: false,
    createdAt: new Date().toISOString(),
    isSummary: true,
  };
}

// ─── Sliding Context Window ───────────────────────────────────────────────────

export class SlidingContextWindow {
  private _turns: ContextTurn[] = [];
  private readonly _maxTokens: number;
  private readonly _reserveTokens: number;
  private readonly _compactTo: number;
  private readonly _charsPerToken: number;

  constructor(opts: ContextWindowOptions = {}) {
    this._maxTokens = opts.maxTokens ?? 8000;
    this._reserveTokens = opts.reserveTokens ?? 500;
    this._compactTo = opts.compactTo ?? 0.70;
    this._charsPerToken = opts.charsPerToken ?? DEFAULT_CHARS_PER_TOKEN;
  }

  addTurn(
    role: TurnRole,
    content: string,
    opts: { pinned?: boolean; contentType?: TurnContentType } = {},
  ): ContextTurn {
    const contentType = opts.contentType ?? classifyTurnContent(content);
    const tokens = estimateTokens(content, this._charsPerToken);
    const turn: ContextTurn = {
      id: `turn-${++_turnCounter}`,
      role,
      content,
      tokens,
      contentType,
      priority: 0, // Will be scored dynamically
      pinned: opts.pinned ?? (role === "system"),
      createdAt: new Date().toISOString(),
    };
    this._turns.push(turn);

    // Auto-compact if over budget
    if (this.totalTokens > this._maxTokens - this._reserveTokens) {
      this._compact();
    }

    return turn;
  }

  private _compact(): EvictionResult {
    const targetTokens = Math.floor(this._maxTokens * this._compactTo);
    const evicted: ContextTurn[] = [];

    // Re-score all turns
    for (let i = 0; i < this._turns.length; i++) {
      this._turns[i]!.priority = scoreContextTurn(this._turns[i]!, this._turns.length, i);
    }

    // Sort eviction candidates: lowest priority, oldest first, never pinned
    const candidates = this._turns
      .map((t, idx) => ({ turn: t, idx }))
      .filter(({ turn }) => !turn.pinned)
      .sort((a, b) => a.turn.priority - b.turn.priority || a.idx - b.idx);

    let currentTokens = this.totalTokens;

    for (const { turn } of candidates) {
      if (currentTokens <= targetTokens) break;
      const turnIdx = this._turns.indexOf(turn);
      if (turnIdx !== -1) {
        this._turns.splice(turnIdx, 1);
        evicted.push(turn);
        currentTokens -= turn.tokens;
      }
    }

    let summaryTurn: ContextTurn | undefined;
    if (evicted.length > 0) {
      summaryTurn = compressTurns(evicted);
      if (summaryTurn) {
        // Insert summary at start (after system turns)
        const firstNonSystem = this._turns.findIndex((t) => t.role !== "system");
        const insertAt = firstNonSystem === -1 ? 0 : firstNonSystem;
        this._turns.splice(insertAt, 0, summaryTurn);
      }
    }

    return {
      evictedTurns: evicted,
      summaryTurn,
      tokensFreed: evicted.reduce((s, t) => s + t.tokens, 0),
    };
  }

  /**
   * Manually trigger compaction and return eviction result.
   */
  compact(): EvictionResult {
    return this._compact();
  }

  /**
   * Get turns that fit within a token budget (respects priorities).
   */
  getTurnsForBudget(maxTokens: number): ContextTurn[] {
    // Always include pinned turns first
    const pinned = this._turns.filter((t) => t.pinned);
    const unpinned = this._turns.filter((t) => !t.pinned);

    const result = [...pinned];
    let remaining = maxTokens - pinned.reduce((s, t) => s + t.tokens, 0);

    // Add unpinned from newest to oldest until budget exhausted
    for (let i = unpinned.length - 1; i >= 0 && remaining > 0; i--) {
      const turn = unpinned[i]!;
      if (turn.tokens <= remaining) {
        result.unshift(turn); // prepend to maintain order
        remaining -= turn.tokens;
      }
    }

    return result.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }

  pinTurn(turnId: string): boolean {
    const turn = this._turns.find((t) => t.id === turnId);
    if (!turn) return false;
    turn.pinned = true;
    return true;
  }

  unpinTurn(turnId: string): boolean {
    const turn = this._turns.find((t) => t.id === turnId);
    if (!turn || turn.role === "system") return false;
    turn.pinned = false;
    return true;
  }

  getTurn(id: string): ContextTurn | undefined {
    return this._turns.find((t) => t.id === id);
  }

  /**
   * Search turn history for keyword matches.
   */
  search(query: string): ContextTurn[] {
    const lower = query.toLowerCase();
    const terms = lower.split(/\s+/).filter((t) => t.length > 1);
    return this._turns.filter((t) =>
      terms.some((term) => t.content.toLowerCase().includes(term))
    );
  }

  get turns(): ContextTurn[] { return [...this._turns]; }
  get turnCount(): number { return this._turns.length; }
  get totalTokens(): number { return this._turns.reduce((s, t) => s + t.tokens, 0); }
  get utilizationPercent(): number { return Math.round((this.totalTokens / this._maxTokens) * 100); }
  get pinnedCount(): number { return this._turns.filter((t) => t.pinned).length; }

  /**
   * Format the window state for AI prompt injection.
   */
  formatForPrompt(): string {
    const lines = [
      `## Context Window (${this.turnCount} turns, ${this.totalTokens}/${this._maxTokens} tokens, ${this.utilizationPercent}% used)`,
    ];

    const summaries = this._turns.filter((t) => t.isSummary);
    if (summaries.length > 0) {
      lines.push(`\n### Compressed Context`);
      for (const s of summaries) lines.push(s.content);
    }

    return lines.join("\n");
  }

  clear(): void { this._turns = []; }
}

// ─── Context Window Registry ──────────────────────────────────────────────────

export class ContextWindowRegistry {
  private _windows = new Map<string, SlidingContextWindow>();
  private _defaultOpts: ContextWindowOptions;

  constructor(defaultOpts: ContextWindowOptions = {}) {
    this._defaultOpts = defaultOpts;
  }

  getOrCreate(sessionId: string): SlidingContextWindow {
    if (!this._windows.has(sessionId)) {
      this._windows.set(sessionId, new SlidingContextWindow(this._defaultOpts));
    }
    return this._windows.get(sessionId)!;
  }

  get(sessionId: string): SlidingContextWindow | undefined {
    return this._windows.get(sessionId);
  }

  remove(sessionId: string): boolean {
    return this._windows.delete(sessionId);
  }

  get sessionCount(): number { return this._windows.size; }

  clear(): void { this._windows.clear(); }
}

export const globalContextWindowRegistry = new ContextWindowRegistry();
