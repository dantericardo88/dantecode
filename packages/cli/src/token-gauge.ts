// packages/cli/src/token-gauge.ts
// Real-time token usage gauge for the DanteCode CLI.
// Closes dim 19 (observability) gap: Cursor shows a live token count
// bar in its status bar; this gives DanteCode equivalent visibility
// in the terminal.
//
// Displays: [████░░░░] 12.4K/128K tokens | $0.0023 | ↑2.1K ↓0.8K

const DIM = "\x1b[2m";
const RESET = "\x1b[0m";
const GREEN = "\x1b[32m";
const YELLOW = "\x1b[33m";
const RED = "\x1b[31m";
const CYAN = "\x1b[36m";
const BOLD = "\x1b[1m";

export interface TokenUsageSnapshot {
  /** Total tokens used in this session (input + output) */
  sessionTokens: number;
  /** Input tokens for the most recent request */
  lastInputTokens?: number;
  /** Output tokens for the most recent request */
  lastOutputTokens?: number;
  /** Total session cost in USD */
  sessionCostUsd?: number;
  /** Cost for the most recent request in USD */
  lastRequestCostUsd?: number;
  /** Model context window size in tokens */
  contextWindowTokens: number;
  /** Tokens currently used in the context window */
  contextUsedTokens: number;
}

// ─── Bar Rendering ─────────────────────────────────────────────────────────

function formatK(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return `${n}`;
}

function formatUsd(usd: number): string {
  if (usd < 0.001) return `$${(usd * 1000).toFixed(2)}m`;  // millicents
  if (usd < 1) return `$${usd.toFixed(4)}`;
  return `$${usd.toFixed(2)}`;
}

function renderMiniBar(used: number, total: number, width = 12): string {
  const pct = Math.min(1, used / Math.max(1, total));
  const filled = Math.round(pct * width);
  const empty = width - filled;
  const color = pct > 0.85 ? RED : pct > 0.6 ? YELLOW : GREEN;
  return `${color}[${"█".repeat(filled)}${"░".repeat(empty)}]${RESET}`;
}

// ─── Token Gauge ──────────────────────────────────────────────────────────────

/**
 * Renders a compact one-line token usage gauge.
 *
 * Example output:
 *   [████░░░░░░░░] 12.4K/128K  ↑2.1K ↓0.8K  $0.0023
 */
export function renderTokenGauge(usage: TokenUsageSnapshot): string {
  const bar = renderMiniBar(usage.contextUsedTokens, usage.contextWindowTokens);
  const contextStr = `${formatK(usage.contextUsedTokens)}/${formatK(usage.contextWindowTokens)}`;

  const parts: string[] = [bar, `${DIM}${contextStr}${RESET}`];

  if (usage.lastInputTokens !== undefined || usage.lastOutputTokens !== undefined) {
    const inp = usage.lastInputTokens ?? 0;
    const out = usage.lastOutputTokens ?? 0;
    parts.push(`${DIM}↑${formatK(inp)} ↓${formatK(out)}${RESET}`);
  }

  if (usage.lastRequestCostUsd !== undefined && usage.lastRequestCostUsd > 0) {
    parts.push(`${CYAN}${formatUsd(usage.lastRequestCostUsd)}${RESET}`);
  } else if (usage.sessionCostUsd !== undefined && usage.sessionCostUsd > 0) {
    parts.push(`${DIM}${formatUsd(usage.sessionCostUsd)} total${RESET}`);
  }

  return parts.join("  ");
}

/**
 * Renders a multi-line token usage summary (for /status or session end).
 */
export function renderTokenSummary(usage: TokenUsageSnapshot): string {
  const bar = renderMiniBar(usage.contextUsedTokens, usage.contextWindowTokens, 20);
  const pct = Math.round((usage.contextUsedTokens / Math.max(1, usage.contextWindowTokens)) * 100);
  const lines: string[] = [
    `${BOLD}Token Usage${RESET}`,
    `  Context  ${bar} ${pct}% (${formatK(usage.contextUsedTokens)}/${formatK(usage.contextWindowTokens)})`,
    `  Session  ${formatK(usage.sessionTokens)} tokens total`,
  ];

  if (usage.lastInputTokens !== undefined) {
    lines.push(`  Last req  ↑${formatK(usage.lastInputTokens)} in  ↓${formatK(usage.lastOutputTokens ?? 0)} out`);
  }

  if (usage.sessionCostUsd !== undefined && usage.sessionCostUsd > 0) {
    lines.push(`  Cost      ${formatUsd(usage.sessionCostUsd)} this session`);
  }

  return lines.join("\n");
}

// ─── Live Gauge Updater ──────────────────────────────────────────────────────

/**
 * Tracks token usage across a session and emits gauge lines to stdout.
 * Wire into agent-loop's onCostUpdate and context utilization callbacks.
 */
export class TokenGauge {
  private _session: TokenUsageSnapshot = {
    sessionTokens: 0,
    contextWindowTokens: 128_000,
    contextUsedTokens: 0,
  };
  /** Update the gauge with new usage data and optionally reprint. */
  update(patch: Partial<TokenUsageSnapshot>, print = true): void {
    this._session = { ...this._session, ...patch };
    if (print) this._print();
  }

  /** Update context utilization from the agent loop's getContextUtilization(). */
  updateContext(usedTokens: number, maxTokens: number): void {
    this.update({
      contextUsedTokens: usedTokens,
      contextWindowTokens: maxTokens,
    }, false);
  }

  /** Update with cost/token data from a completed LLM round. */
  updateRound(opts: {
    inputTokens?: number;
    outputTokens?: number;
    requestCostUsd?: number;
    sessionCostUsd?: number;
  }): void {
    const tokens = (opts.inputTokens ?? 0) + (opts.outputTokens ?? 0);
    this.update({
      lastInputTokens: opts.inputTokens,
      lastOutputTokens: opts.outputTokens,
      lastRequestCostUsd: opts.requestCostUsd,
      sessionCostUsd: opts.sessionCostUsd,
      sessionTokens: this._session.sessionTokens + tokens,
    });
  }

  private _print(): void {
    if (!process.stdout.isTTY) {
      // Non-TTY: only print occasionally to avoid log spam
      return;
    }
    const line = renderTokenGauge(this._session);
    // Overwrite previous line
    process.stdout.write(`\r${line}\x1b[K`);
  }

  /** Print the gauge on its own line (after a newline from the model response). */
  printLine(): void {
    if (!process.stdout.isTTY) return;
    const line = renderTokenGauge(this._session);
    process.stdout.write(`${DIM}${line}${RESET}\n`);
  }

  /** Print the full summary block. */
  printSummary(): void {
    process.stdout.write(renderTokenSummary(this._session) + "\n");
  }

  get snapshot(): TokenUsageSnapshot {
    return { ...this._session };
  }
}
