/**
 * status-bar.ts — @dantecode/ux-polish
 *
 * Persistent bottom status bar for the DanteCode CLI REPL.
 * Renders a single line showing: model | tokens | session | sandbox | PDSE.
 * Uses ANSI escape codes to position at the bottom of the terminal.
 *
 * Non-TTY: render() returns "" and draw() is a no-op.
 * All rendering is pure — side effects only in draw() and clear().
 */

import { ThemeEngine } from "../theme-engine.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface StatusBarState {
  /** e.g. "grok/grok-3" or "anthropic/claude-sonnet-4" */
  modelLabel: string;
  /** Cumulative session tokens used. */
  tokensUsed: number;
  /** Optional max tokens for this session. */
  tokenBudget?: number;
  /** Display name for the session. */
  sessionName?: string;
  /** "workspace-write" | "read-only" | "full-access" */
  sandboxMode: string;
  /** Last PDSE score (0–100). */
  pdseScore?: number;
  /** Active experimental feature flags. */
  featureFlags?: string[];
  /** Session elapsed time in milliseconds. */
  elapsedMs?: number;
}

// ---------------------------------------------------------------------------
// StatusBar
// ---------------------------------------------------------------------------

export class StatusBar {
  private state: StatusBarState;
  private readonly theme: ThemeEngine;
  private enabled: boolean = true;

  constructor(initialState: StatusBarState, theme?: ThemeEngine) {
    this.state = { ...initialState };
    this.theme = theme ?? new ThemeEngine();
  }

  /** Update state fields and optionally redraw. */
  update(patch: Partial<StatusBarState>): void {
    this.state = { ...this.state, ...patch };
  }

  /** Enable or disable the status bar. When disabled, draw() is a no-op. */
  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
  }

  /**
   * Render the status bar as a string.
   * Returns "" in non-TTY environments.
   */
  render(): string {
    if (!this.isTTY()) return "";

    const c = this.theme.resolve().colors;
    const parts: string[] = [];

    // Model label
    parts.push(`${c.info}${this.state.modelLabel}${c.reset}`);

    // Token count
    const tokenStr = formatNumber(this.state.tokensUsed);
    const tokenDisplay = this.state.tokenBudget
      ? `${tokenStr}/${formatNumber(this.state.tokenBudget)}`
      : tokenStr;
    parts.push(`${c.muted}${tokenDisplay} tokens${c.reset}`);

    // Session name
    if (this.state.sessionName) {
      parts.push(`${c.muted}${this.state.sessionName}${c.reset}`);
    }

    // Sandbox mode
    const sandboxColor = this.state.sandboxMode === "read-only"
      ? c.warning
      : this.state.sandboxMode === "full-access"
        ? c.error
        : c.success;
    parts.push(`${sandboxColor}${this.state.sandboxMode}${c.reset}`);

    // PDSE score
    if (this.state.pdseScore !== undefined) {
      const pdseColor = this.state.pdseScore >= 85 ? c.success
        : this.state.pdseScore >= 70 ? c.warning
        : c.error;
      parts.push(`${pdseColor}PDSE: ${this.state.pdseScore}${c.reset}`);
    }

    // Elapsed time
    if (this.state.elapsedMs !== undefined) {
      parts.push(`${c.muted}${formatDuration(this.state.elapsedMs)}${c.reset}`);
    }

    return ` ${parts.join(` ${c.muted}│${c.reset} `)} `;
  }

  /**
   * Write the status bar to the terminal bottom row.
   * Uses ANSI save-cursor / move / restore to avoid disrupting output.
   * No-op if disabled or non-TTY.
   */
  draw(): void {
    if (!this.enabled || !this.isTTY()) return;

    const rows = process.stdout.rows;
    if (!rows || rows < 5) return;

    const rendered = this.render();
    if (!rendered) return;

    // Save cursor, move to bottom row, clear line, write bar, restore cursor
    process.stdout.write(
      `\x1b[s\x1b[${rows};1H\x1b[2K${rendered}\x1b[u`,
    );
  }

  /**
   * Clear the status bar from the terminal bottom row.
   * No-op if non-TTY.
   */
  clear(): void {
    if (!this.isTTY()) return;

    const rows = process.stdout.rows;
    if (!rows || rows < 5) return;

    process.stdout.write(`\x1b[s\x1b[${rows};1H\x1b[2K\x1b[u`);
  }

  private isTTY(): boolean {
    return process.stdout.isTTY === true;
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatNumber(n: number): string {
  return n.toLocaleString("en-US");
}

function formatDuration(ms: number): string {
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const rem = s % 60;
  return `${m}m ${rem}s`;
}
