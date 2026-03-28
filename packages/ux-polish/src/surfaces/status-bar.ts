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
  /** Current approval mode: "review" | "apply" | "autoforge" | "plan" | "yolo" */
  approvalMode?: string;
  /** Index readiness for semantic search. */
  indexReadiness?: {
    status: "indexing" | "ready" | "error";
    progress: number; // 0-100
  };
  /** Context pressure percentage (0-100) */
  contextPressure?: number;
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

    // Approval mode with color coding
    if (this.state.approvalMode) {
      const mode = this.state.approvalMode;
      const modeColor =
        mode === "plan" || mode === "review"
          ? c.info // cyan for read-only/safe modes
          : mode === "apply"
            ? c.warning // yellow for caution
            : mode === "autoforge"
              ? c.error // red for autonomous
              : "\x1b[35m"; // magenta for yolo (fallback color)
      parts.push(`${modeColor}mode:${mode}${c.reset}`);
    }

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
    const sandboxColor =
      this.state.sandboxMode === "read-only"
        ? c.warning
        : this.state.sandboxMode === "full-access"
          ? c.error
          : c.success;
    parts.push(`${sandboxColor}${this.state.sandboxMode}${c.reset}`);

    // PDSE score
    if (this.state.pdseScore !== undefined) {
      const pdseColor =
        this.state.pdseScore >= 85 ? c.success : this.state.pdseScore >= 70 ? c.warning : c.error;
      parts.push(`${pdseColor}PDSE: ${this.state.pdseScore}${c.reset}`);
    }

    // Index readiness
    if (this.state.indexReadiness) {
      const { status, progress } = this.state.indexReadiness;
      if (status === "ready") {
        parts.push(`${c.success}idx: ✓${c.reset}`);
      } else if (status === "error") {
        parts.push(`${c.error}idx: ✗${c.reset}`);
      } else {
        // indexing
        const idxColor = progress >= 80 ? c.success : progress >= 40 ? c.warning : c.muted;
        parts.push(`${idxColor}idx: ${progress}%${c.reset}`);
      }
    }

    // Context pressure badge
    if (this.state.contextPressure !== undefined) {
      const pressureColor =
        this.state.contextPressure >= 80
          ? c.error // red for >80%
          : this.state.contextPressure >= 50
            ? c.warning // yellow for 50-80%
            : c.success; // green for <50%
      parts.push(`${pressureColor}ctx: ${this.state.contextPressure}%${c.reset}`);
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
   * No-op if disabled, non-TTY, or terminal too narrow.
   */
  draw(): void {
    if (!this.enabled || !this.isTTY()) return;

    const rows = process.stdout.rows;
    const cols = process.stdout.columns;
    if (!rows || rows < 5 || !cols || cols < 50) return;

    const rendered = this.render();
    if (!rendered) return;

    // Truncate to visible width to prevent wrapping on narrow terminals
    const truncated = truncateToVisible(rendered, cols - 2) + "\x1b[0m";

    // Hide cursor → save → position → clear → write → restore → show cursor
    process.stdout.write(`\x1b[?25l\x1b[s\x1b[${rows};1H\x1b[2K${truncated}\x1b[u\x1b[?25h`);
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
  if (ms < 1000) return "<1s";
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const rem = s % 60;
  return `${m}m ${rem}s`;
}

/**
 * Truncate string to at most maxVisible visible characters, preserving ANSI escape sequences.
 * Ensures status bar never wraps to the next terminal line.
 */
function truncateToVisible(s: string, maxVisible: number): string {
  let visible = 0;
  let result = "";
  let i = 0;
  while (i < s.length) {
    // Detect ANSI SGR escape sequence (\x1b[ ... m) and copy it verbatim
    if (s[i] === "\x1b" && s[i + 1] === "[") {
      const end = s.indexOf("m", i + 2);
      if (end >= 0) {
        result += s.slice(i, end + 1);
        i = end + 1;
        continue;
      }
    }
    if (visible >= maxVisible) break;
    result += s[i];
    visible++;
    i++;
  }
  return result;
}
