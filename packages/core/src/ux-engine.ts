/**
 * ux-engine.ts
 *
 * Theme engine, progress formatting, error/success styling,
 * PDSE-driven hints, status line builder, spinner, table, markdown,
 * and diff rendering.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ThemeName = "default" | "minimal" | "rich" | "matrix" | "ocean";

export interface ThemeIcons {
  success: string;
  error: string;
  warning: string;
  info: string;
  progress: string;
}

export interface ThemeColors {
  success: string;
  error: string;
  warning: string;
  info: string;
  progress: string;
  reset: string;
}

export interface Theme {
  name: ThemeName;
  icons: ThemeIcons;
  colors: ThemeColors;
}

export interface ProgressOptions {
  current: number;
  total: number;
  label?: string;
  /** Bar width in chars. Default: 20 */
  width?: number;
}

export interface StatusLineOptions {
  model?: string;
  tokens?: number;
  latencyMs?: number;
  pdseScore?: number;
  activeTask?: string;
}

export interface UXEngineOptions {
  theme?: ThemeName;
  /** Whether to emit ANSI color codes. Default: true */
  color?: boolean;
  /** Alias for color. */
  colors?: boolean;
}

// ---------------------------------------------------------------------------
// Theme definitions
// ---------------------------------------------------------------------------

const NO_COLORS: ThemeColors = {
  success: "",
  error: "",
  warning: "",
  info: "",
  progress: "",
  reset: "",
};

const THEMES: Record<ThemeName, Theme> = {
  default: {
    name: "default",
    icons: {
      success: "\u2713",
      error: "\u2717",
      warning: "\u26a0",
      info: "\u2139",
      progress: "\u25ba",
    },
    colors: {
      success: "\x1b[32m",
      error: "\x1b[31m",
      warning: "\x1b[33m",
      info: "\x1b[36m",
      progress: "\x1b[34m",
      reset: "\x1b[0m",
    },
  },
  minimal: {
    name: "minimal",
    icons: { success: "[ok]", error: "[err]", warning: "[warn]", info: "[i]", progress: "[>]" },
    colors: NO_COLORS,
  },
  rich: {
    name: "rich",
    icons: {
      success: "\u2713",
      error: "\u2717",
      warning: "\u26a0",
      info: "\u2139",
      progress: "\u25ba",
    },
    colors: {
      success: "\x1b[1m\x1b[32m",
      error: "\x1b[1m\x1b[31m",
      warning: "\x1b[1m\x1b[33m",
      info: "\x1b[1m\x1b[36m",
      progress: "\x1b[1m\x1b[34m",
      reset: "\x1b[0m",
    },
  },
  matrix: {
    name: "matrix",
    icons: {
      success: "\u2713",
      error: "\u2717",
      warning: "\u26a0",
      info: "\u2139",
      progress: "\u25ba",
    },
    colors: {
      success: "\x1b[32m",
      error: "\x1b[91m",
      warning: "\x1b[93m",
      info: "\x1b[92m",
      progress: "\x1b[32m",
      reset: "\x1b[0m",
    },
  },
  ocean: {
    name: "ocean",
    icons: {
      success: "\u2713",
      error: "\u2717",
      warning: "\u26a0",
      info: "\u2139",
      progress: "\u25ba",
    },
    colors: {
      success: "\x1b[96m",
      error: "\x1b[35m",
      warning: "\x1b[94m",
      info: "\x1b[96m",
      progress: "\x1b[94m",
      reset: "\x1b[0m",
    },
  },
};

// ---------------------------------------------------------------------------
// UXEngine
// ---------------------------------------------------------------------------

export class UXEngine {
  private theme: Theme;
  private readonly useColors: boolean;

  constructor(options: UXEngineOptions = {}) {
    this.theme = THEMES[options.theme ?? "default"];
    this.useColors = options.color ?? options.colors ?? true;
  }

  /** Switch theme at runtime. */
  applyTheme(name: ThemeName): void {
    this.theme = THEMES[name];
  }

  /** Get current theme object. */
  getTheme(): Theme {
    return this.theme;
  }

  /** Get current theme name. */
  getThemeName(): ThemeName {
    return this.theme.name;
  }

  /** List all available theme names. */
  listThemes(): ThemeName[] {
    return Object.keys(THEMES) as ThemeName[];
  }

  // -------------------------------------------------------------------------
  // Formatting
  // -------------------------------------------------------------------------

  /** Format a progress bar string. */
  formatProgress(opts: ProgressOptions): string {
    const { current, total, label = "", width = 20 } = opts;
    const pct = total > 0 ? Math.min(current / total, 1) : 0;
    const filled = Math.round(pct * width);
    const empty = width - filled;
    const bar = "\u2588".repeat(filled) + "\u2591".repeat(empty);
    const pctStr = Math.round(pct * 100)
      .toString()
      .padStart(3);
    const labelPart = label ? ` ${label}` : "";
    return `[${bar}] ${pctStr}%${labelPart}`;
  }

  /** Format an error message with optional hint. */
  formatError(message: string, hint?: string): string {
    const c = this.useColors ? this.theme.colors.error : "";
    const r = this.useColors ? this.theme.colors.reset : "";
    const hintPart = hint ? `\n  Hint: ${hint}` : "";
    return `${c}Error: ${message}${r}${hintPart}`;
  }

  /** Format a success message. */
  formatSuccess(message: string): string {
    const icon = this.theme.icons.success;
    const c = this.useColors ? this.theme.colors.success : "";
    const r = this.useColors ? this.theme.colors.reset : "";
    return `${c}${icon} ${message}${r}`;
  }

  /** Format a warning message. */
  formatWarning(message: string): string {
    const icon = this.theme.icons.warning;
    const c = this.useColors ? this.theme.colors.warning : "";
    const r = this.useColors ? this.theme.colors.reset : "";
    return `${c}${icon} ${message}${r}`;
  }

  /** Format an info message. */
  formatInfo(message: string): string {
    const icon = this.theme.icons.info;
    const c = this.useColors ? this.theme.colors.info : "";
    const r = this.useColors ? this.theme.colors.reset : "";
    return `${c}${icon} ${message}${r}`;
  }

  /**
   * Generate a PDSE-driven hint based on score.
   * < 0.5  → Quality gate corrective hint
   * 0.5–0.8 → Good progress improvement hint
   * > 0.8  → Excellent positive reinforcement
   */
  generateHint(pdseScore: number, context?: string): string {
    const ctx = context ? ` (${context})` : "";
    if (pdseScore < 0.5) {
      return `Quality gate${ctx}: Score ${pdseScore.toFixed(2)} is below threshold. Consider breaking task into smaller steps.`;
    }
    if (pdseScore < 0.8) {
      return `Good progress${ctx}: Score ${pdseScore.toFixed(2)}. Add verification steps to improve further.`;
    }
    return `Excellent${ctx}: PDSE score ${pdseScore.toFixed(2)} meets quality standards.`;
  }

  /** Build a status line string for terminal display. */
  buildStatusLine(opts: StatusLineOptions): string {
    const parts: string[] = [];
    if (opts.model) parts.push(`model:${opts.model}`);
    if (opts.tokens !== undefined) parts.push(`tokens:${opts.tokens}`);
    if (opts.latencyMs !== undefined) parts.push(`${opts.latencyMs}ms`);
    if (opts.pdseScore !== undefined) parts.push(`pdse:${opts.pdseScore.toFixed(2)}`);
    if (opts.activeTask) parts.push(`task:${opts.activeTask}`);
    return `[${parts.join(" | ")}]`;
  }

  /** Strip ANSI escape codes from a string. */
  stripColors(text: string): string {
    return text.replace(/\x1b\[[0-9;]*m/g, "");
  }

  /**
   * Truncate text to maxLen characters.
   * Appends suffix (default: "…") if truncated.
   */
  truncate(text: string, maxLen: number, suffix = "\u2026"): string {
    if (text.length <= maxLen) return text;
    return text.slice(0, maxLen - suffix.length) + suffix;
  }

  // -------------------------------------------------------------------------
  // Table rendering
  // -------------------------------------------------------------------------

  /**
   * Render an ASCII box table.
   * @param headers - Column header labels.
   * @param rows - Data rows (each row must have same number of cells as headers).
   */
  formatTable(headers: string[], rows: string[][]): string {
    const colWidths = headers.map((h, i) =>
      Math.max(h.length, ...rows.map((r) => (r[i] ?? "").length)),
    );

    const divider = "+-" + colWidths.map((w) => "-".repeat(w)).join("-+-") + "-+";
    const renderRow = (cells: string[], bold = false): string => {
      const b = bold && this.useColors ? "\x1b[1m" : "";
      const r = bold && this.useColors ? this.theme.colors.reset : "";
      return (
        "| " +
        cells
          .map((cell, i) => {
            const padded = (cell ?? "").padEnd(colWidths[i] ?? 0);
            return `${b}${padded}${r}`;
          })
          .join(" | ") +
        " |"
      );
    };

    const lines = [divider, renderRow(headers, true), divider];
    for (const row of rows) lines.push(renderRow(row));
    lines.push(divider);
    return lines.join("\n");
  }

  // -------------------------------------------------------------------------
  // Markdown → ANSI rendering
  // -------------------------------------------------------------------------

  /**
   * Convert a limited subset of Markdown to ANSI-formatted terminal output.
   * Handles: headings (H1–H3), bold (**), inline code (`), horizontal rules,
   * bullet lists (- item), and numbered lists.
   */
  formatMarkdown(text: string): string {
    const BOLD = this.useColors ? "\x1b[1m" : "";
    const DIM = this.useColors ? "\x1b[2m" : "";
    const CYAN = this.useColors ? "\x1b[36m" : "";
    const YELLOW = this.useColors ? "\x1b[33m" : "";
    const RESET = this.useColors ? this.theme.colors.reset : "";

    return text
      .split("\n")
      .map((line) => {
        // H1
        if (/^# /.test(line)) return `${BOLD}${CYAN}${line.slice(2)}${RESET}`;
        // H2
        if (/^## /.test(line)) return `${BOLD}${line.slice(3)}${RESET}`;
        // H3
        if (/^### /.test(line)) return `${YELLOW}${line.slice(4)}${RESET}`;
        // Horizontal rule
        if (/^---+$/.test(line.trim())) return `${DIM}${"─".repeat(40)}${RESET}`;
        // Bullet list (structural, always converted)
        if (/^- /.test(line)) line = `  • ${line.slice(2)}`;
        // Numbered list — leave as-is but indent
        else if (/^\d+\. /.test(line)) line = `  ${line}`;

        // Inline: bold (**text**)
        line = line.replace(/\*\*(.+?)\*\*/g, `${BOLD}$1${RESET}`);
        // Inline: code (`text`)
        line = line.replace(/`([^`]+)`/g, `${DIM}$1${RESET}`);

        return line;
      })
      .join("\n");
  }

  // -------------------------------------------------------------------------
  // Diff rendering
  // -------------------------------------------------------------------------

  /**
   * Format a unified-style diff with color-coded added/removed lines.
   * @param added - Lines that were added (shown in green with +).
   * @param removed - Lines that were removed (shown in red with -).
   * @param context - Optional label shown as diff header.
   */
  formatDiff(added: string[], removed: string[], context?: string): string {
    const GREEN = this.useColors ? "\x1b[32m" : "";
    const RED = this.useColors ? "\x1b[31m" : "";
    const DIM = this.useColors ? "\x1b[2m" : "";
    const RESET = this.useColors ? this.theme.colors.reset : "";

    const lines: string[] = [];
    if (context) lines.push(`${DIM}--- ${context}${RESET}`);
    for (const line of removed) lines.push(`${RED}- ${line}${RESET}`);
    for (const line of added) lines.push(`${GREEN}+ ${line}${RESET}`);
    return lines.join("\n");
  }
}

// ---------------------------------------------------------------------------
// Spinner
// ---------------------------------------------------------------------------

const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

export interface SpinnerOptions {
  message?: string;
  /** Interval between frames in ms. Default: 80 */
  intervalMs?: number;
  /** Whether to emit ANSI color. Default: true */
  colors?: boolean;
}

/**
 * Terminal spinner for long-running operations.
 * Renders to process.stdout using carriage-return overwrite.
 *
 * Usage:
 *   const s = new Spinner({ message: "Building..." });
 *   s.start();
 *   // ... async work ...
 *   s.succeed("Build complete");
 */
export class Spinner {
  private frame = 0;
  private timer: ReturnType<typeof setInterval> | null = null;
  private message: string;
  private readonly intervalMs: number;
  private readonly useColors: boolean;

  constructor(options: SpinnerOptions = {}) {
    this.message = options.message ?? "";
    this.intervalMs = options.intervalMs ?? 80;
    this.useColors = options.colors ?? true;
  }

  /** Start spinning. */
  start(message?: string): void {
    if (message) this.message = message;
    if (this.timer) return;
    this.frame = 0;
    this.timer = setInterval(() => this._render(), this.intervalMs);
  }

  /** Update the spinner message without stopping. */
  update(message: string): void {
    this.message = message;
  }

  /** Stop and show a success line. */
  succeed(message?: string): void {
    this._stop();
    const icon = this.useColors ? "\x1b[32m✓\x1b[0m" : "✓";
    process.stdout.write(`\r${icon} ${message ?? this.message}\n`);
  }

  /** Stop and show a failure line. */
  fail(message?: string): void {
    this._stop();
    const icon = this.useColors ? "\x1b[31m✗\x1b[0m" : "✗";
    process.stdout.write(`\r${icon} ${message ?? this.message}\n`);
  }

  /** Stop and show a warning line. */
  warn(message?: string): void {
    this._stop();
    const icon = this.useColors ? "\x1b[33m⚠\x1b[0m" : "⚠";
    process.stdout.write(`\r${icon} ${message ?? this.message}\n`);
  }

  /** Stop with no output. */
  stop(): void {
    this._stop();
    process.stdout.write("\r\x1b[K");
  }

  private _render(): void {
    const f = SPINNER_FRAMES[this.frame % SPINNER_FRAMES.length]!;
    const color = this.useColors ? "\x1b[36m" : "";
    const reset = this.useColors ? "\x1b[0m" : "";
    process.stdout.write(`\r${color}${f}${reset} ${this.message}`);
    this.frame++;
  }

  private _stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }
}
