/**
 * theme-preferences.ts
 *
 * Persistent user theme preferences for DanteCode.
 * Saves/loads theme name and UX options to/from .dantecode/preferences.json.
 * Allows themes to persist across sessions and sync between CLI and VS Code.
 *
 * Inspired by Mastra's opinionated config loading patterns.
 */

import * as fs from "node:fs";
import * as path from "node:path";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ThemeName = "default" | "minimal" | "rich" | "matrix" | "ocean";

export interface UXPreferences {
  /** Active theme name. Default: "default". */
  theme: ThemeName;
  /** Enable ANSI colors in CLI. Default: true. */
  colors: boolean;
  /** Enable rich markdown rendering in stream output. Default: false. */
  richMode: boolean;
  /** Show PDSE score in status line after each response. Default: true. */
  showPdseInline: boolean;
  /** Show contextual suggestions after pipeline completion. Default: true. */
  showSuggestions: boolean;
  /** Show tool annotations inline during streaming. Default: true. */
  showToolAnnotations: boolean;
}

export type PreferenceKey = keyof UXPreferences;
export type PreferenceValue = UXPreferences[PreferenceKey];

export interface ThemePreferencesOptions {
  /** Root directory containing .dantecode/. Defaults to process.cwd(). */
  projectRoot?: string;
  /** Override preferences file path entirely. */
  prefsFilePath?: string;
}

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

const DEFAULTS: UXPreferences = {
  theme: "default",
  colors: true,
  richMode: false,
  showPdseInline: true,
  showSuggestions: true,
  showToolAnnotations: true,
};

// ---------------------------------------------------------------------------
// ThemePreferences
// ---------------------------------------------------------------------------

export class ThemePreferences {
  private readonly filePath: string;
  private _prefs: UXPreferences;

  constructor(options: ThemePreferencesOptions = {}) {
    const root = options.projectRoot ?? process.cwd();
    this.filePath =
      options.prefsFilePath ?? path.join(root, ".dantecode", "preferences.json");
    this._prefs = { ...DEFAULTS };
    this._load();
  }

  // -------------------------------------------------------------------------
  // Read API
  // -------------------------------------------------------------------------

  /** Get all preferences. */
  getAll(): UXPreferences {
    return { ...this._prefs };
  }

  /** Get a single preference value. */
  get<K extends PreferenceKey>(key: K): UXPreferences[K] {
    return this._prefs[key];
  }

  /** Get the active theme name. */
  getTheme(): ThemeName {
    return this._prefs.theme;
  }

  // -------------------------------------------------------------------------
  // Write API
  // -------------------------------------------------------------------------

  /** Set a single preference and persist. */
  set<K extends PreferenceKey>(key: K, value: UXPreferences[K]): void {
    this._prefs[key] = value;
    this._save();
  }

  /** Update multiple preferences at once and persist. */
  update(partial: Partial<UXPreferences>): void {
    this._prefs = { ...this._prefs, ...partial };
    this._save();
  }

  /** Apply a named theme and persist. */
  applyTheme(name: ThemeName): void {
    this._prefs.theme = name;
    this._save();
  }

  /** Reset all preferences to defaults and persist. */
  reset(): void {
    this._prefs = { ...DEFAULTS };
    this._save();
  }

  // -------------------------------------------------------------------------
  // Validation
  // -------------------------------------------------------------------------

  /** List all valid theme names. */
  validThemes(): ThemeName[] {
    return ["default", "minimal", "rich", "matrix", "ocean"];
  }

  /** Check if a string is a valid theme name. */
  isValidTheme(name: string): name is ThemeName {
    return this.validThemes().includes(name as ThemeName);
  }

  // -------------------------------------------------------------------------
  // File path
  // -------------------------------------------------------------------------

  getFilePath(): string {
    return this.filePath;
  }

  // -------------------------------------------------------------------------
  // Private
  // -------------------------------------------------------------------------

  private _load(): void {
    try {
      if (!fs.existsSync(this.filePath)) return;
      const raw = fs.readFileSync(this.filePath, "utf-8");
      const parsed = JSON.parse(raw) as Partial<UXPreferences>;
      // Merge loaded values with defaults (guards against missing keys on upgrade)
      this._prefs = { ...DEFAULTS, ...this._sanitize(parsed) };
    } catch {
      // Corrupt file — fall back to defaults silently
      this._prefs = { ...DEFAULTS };
    }
  }

  private _save(): void {
    try {
      const dir = path.dirname(this.filePath);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(this.filePath, JSON.stringify(this._prefs, null, 2));
    } catch {
      // Write failure is non-fatal — preferences just won't persist
    }
  }

  private _sanitize(raw: Partial<UXPreferences>): Partial<UXPreferences> {
    const out: Partial<UXPreferences> = {};
    if (typeof raw.theme === "string" && this.isValidTheme(raw.theme)) out.theme = raw.theme;
    if (typeof raw.colors === "boolean") out.colors = raw.colors;
    if (typeof raw.richMode === "boolean") out.richMode = raw.richMode;
    if (typeof raw.showPdseInline === "boolean") out.showPdseInline = raw.showPdseInline;
    if (typeof raw.showSuggestions === "boolean") out.showSuggestions = raw.showSuggestions;
    if (typeof raw.showToolAnnotations === "boolean") out.showToolAnnotations = raw.showToolAnnotations;
    return out;
  }
}
