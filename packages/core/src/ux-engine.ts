/**
 * ux-engine.ts
 *
 * Theme engine, progress formatting, error/success styling,
 * PDSE-driven hints, and status line builder.
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

const NO_COLORS: ThemeColors = { success: "", error: "", warning: "", info: "", progress: "", reset: "" };

const THEMES: Record<ThemeName, Theme> = {
  default: {
    name: "default",
    icons: { success: "\u2713", error: "\u2717", warning: "\u26a0", info: "\u2139", progress: "\u25ba" },
    colors: { success: "\x1b[32m", error: "\x1b[31m", warning: "\x1b[33m", info: "\x1b[36m", progress: "\x1b[34m", reset: "\x1b[0m" },
  },
  minimal: {
    name: "minimal",
    icons: { success: "[ok]", error: "[err]", warning: "[warn]", info: "[i]", progress: "[>]" },
    colors: NO_COLORS,
  },
  rich: {
    name: "rich",
    icons: { success: "\u2713", error: "\u2717", warning: "\u26a0", info: "\u2139", progress: "\u25ba" },
    colors: { success: "\x1b[1m\x1b[32m", error: "\x1b[1m\x1b[31m", warning: "\x1b[1m\x1b[33m", info: "\x1b[1m\x1b[36m", progress: "\x1b[1m\x1b[34m", reset: "\x1b[0m" },
  },
  matrix: {
    name: "matrix",
    icons: { success: "\u2713", error: "\u2717", warning: "\u26a0", info: "\u2139", progress: "\u25ba" },
    colors: { success: "\x1b[32m", error: "\x1b[91m", warning: "\x1b[93m", info: "\x1b[92m", progress: "\x1b[32m", reset: "\x1b[0m" },
  },
  ocean: {
    name: "ocean",
    icons: { success: "\u2713", error: "\u2717", warning: "\u26a0", info: "\u2139", progress: "\u25ba" },
    colors: { success: "\x1b[96m", error: "\x1b[35m", warning: "\x1b[94m", info: "\x1b[96m", progress: "\x1b[94m", reset: "\x1b[0m" },
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
    const pctStr = Math.round(pct * 100).toString().padStart(3);
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
}
