/**
 * theme-engine.ts — @dantecode/ux-polish
 *
 * Central theme management for the DanteCode shared UX engine.
 * Resolves semantic color tokens, icon sets, and layout decisions
 * from a named theme. Shared across CLI / REPL / VS Code surfaces.
 */

import type { ThemeName, ResolvedTheme } from "./types.js";
import { COLOR_TOKENS, NO_COLORS, supportsColor } from "./tokens/color-tokens.js";
import { resolveIcons } from "./tokens/icon-tokens.js";
import type { IconSet } from "./tokens/icon-tokens.js";

// ---------------------------------------------------------------------------
// ThemeEngine
// ---------------------------------------------------------------------------

export interface ThemeEngineOptions {
  /** Initial theme. Default: "default". */
  theme?: ThemeName;
  /** Enable ANSI colors. Default: auto-detected via supportsColor(). */
  colors?: boolean;
}

export class ThemeEngine {
  private _theme: ThemeName;
  private _useColors: boolean;

  constructor(options: ThemeEngineOptions = {}) {
    this._theme = options.theme ?? "default";
    this._useColors = options.colors ?? supportsColor();
  }

  // -------------------------------------------------------------------------
  // Theme selection
  // -------------------------------------------------------------------------

  /** Get the active theme name. */
  get name(): ThemeName {
    return this._theme;
  }

  /** Switch to a different theme. */
  setTheme(name: ThemeName): void {
    this._theme = name;
  }

  /** Enable or disable color output. */
  setColors(enabled: boolean): void {
    this._useColors = enabled;
  }

  /** Whether color output is currently enabled. */
  get colorsEnabled(): boolean {
    return this._useColors;
  }

  /** List all available built-in theme names. */
  listThemes(): ThemeName[] {
    return ["default", "minimal", "rich", "matrix", "ocean"];
  }

  // -------------------------------------------------------------------------
  // Token resolution
  // -------------------------------------------------------------------------

  /** Resolve the full theme (colors + icons) for the active theme. */
  resolve(): ResolvedTheme {
    const colors = this._useColors
      ? (COLOR_TOKENS[this._theme] ?? COLOR_TOKENS.default)
      : NO_COLORS;
    const icons = resolveIcons(this._theme);
    return {
      name: this._theme,
      colors,
      icons: icons as unknown as Record<string, string>,
    };
  }

  /** Get the icon set for the active theme. */
  icons(): IconSet {
    return resolveIcons(this._theme);
  }

  /** Get the ANSI color for a semantic role. Empty string if colors disabled. */
  color(role: "success" | "error" | "warning" | "info" | "progress" | "muted"): string {
    if (!this._useColors) return "";
    return COLOR_TOKENS[this._theme]?.[role] ?? "";
  }

  /** ANSI reset sequence (empty if colors disabled). */
  get reset(): string {
    return this._useColors ? "\x1b[0m" : "";
  }

  /** ANSI bold sequence (empty if colors disabled). */
  get bold(): string {
    return this._useColors ? "\x1b[1m" : "";
  }

  /** ANSI dim sequence (empty if colors disabled). */
  get dim(): string {
    return this._useColors ? "\x1b[2m" : "";
  }

  // -------------------------------------------------------------------------
  // Convenience colorizers
  // -------------------------------------------------------------------------

  /** Wrap text in success color. */
  success(text: string): string {
    return `${this.color("success")}${text}${this.reset}`;
  }

  /** Wrap text in error color. */
  error(text: string): string {
    return `${this.color("error")}${text}${this.reset}`;
  }

  /** Wrap text in warning color. */
  warning(text: string): string {
    return `${this.color("warning")}${text}${this.reset}`;
  }

  /** Wrap text in info color. */
  info(text: string): string {
    return `${this.color("info")}${text}${this.reset}`;
  }

  /** Wrap text in progress color. */
  progressColor(text: string): string {
    return `${this.color("progress")}${text}${this.reset}`;
  }

  /** Wrap text in muted/dim color. */
  muted(text: string): string {
    return `${this.color("muted")}${text}${this.reset}`;
  }

  /** Wrap text in bold. */
  boldText(text: string): string {
    return `${this.bold}${text}${this.reset}`;
  }

  // -------------------------------------------------------------------------
  // Serialization
  // -------------------------------------------------------------------------

  /** Serialize current settings for persistence. */
  toJSON(): { theme: ThemeName; colors: boolean } {
    return { theme: this._theme, colors: this._useColors };
  }

  /** Restore from serialized settings. */
  fromJSON(data: { theme?: ThemeName; colors?: boolean }): void {
    if (data.theme) this._theme = data.theme;
    if (typeof data.colors === "boolean") this._useColors = data.colors;
  }
}

// ---------------------------------------------------------------------------
// Default singleton
// ---------------------------------------------------------------------------

/** Default shared ThemeEngine instance. Lazily created. */
let _defaultEngine: ThemeEngine | null = null;

export function getThemeEngine(): ThemeEngine {
  if (!_defaultEngine) _defaultEngine = new ThemeEngine();
  return _defaultEngine;
}

/** Reset the default engine (useful for tests). */
export function resetThemeEngine(): void {
  _defaultEngine = null;
}
