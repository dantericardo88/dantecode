/**
 * ux-preferences.ts — @dantecode/ux-polish
 *
 * Full UX preference management with persistence to .dantecode/preferences.json.
 * Covers theme, density, accessibility, rendering mode, and onboarding state.
 * Integrates with the Memory Engine for cross-session recall (optional).
 */

import * as fs from "node:fs";
import * as path from "node:path";
import type { UXPreferenceRecord, ThemeName, RenderDensity } from "../types.js";

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

export const PREFERENCE_DEFAULTS: UXPreferenceRecord = {
  theme: "default",
  colors: true,
  density: "normal",
  richMode: false,
  showPdseInline: true,
  showSuggestions: true,
  showToolAnnotations: true,
  onboardingComplete: false,
  accessibilityMode: false,
};

// ---------------------------------------------------------------------------
// UXPreferences
// ---------------------------------------------------------------------------

export interface UXPreferencesOptions {
  /** Root directory containing .dantecode/. Default: process.cwd(). */
  projectRoot?: string;
  /** Override preferences file path. */
  prefsFilePath?: string;
  /** Injectable write fn (for testing). */
  writeFn?: (filePath: string, data: string) => void;
  /** Injectable read fn (for testing). */
  readFn?: (filePath: string) => string | null;
  /** Injectable exists fn (for testing). */
  existsFn?: (filePath: string) => boolean;
  /** Injectable mkdir fn (for testing). */
  mkdirFn?: (dirPath: string) => void;
}

export class UXPreferences {
  private readonly _filePath: string;
  private _prefs: UXPreferenceRecord;
  private readonly _write: (p: string, d: string) => void;
  private readonly _read: (p: string) => string | null;
  private readonly _exists: (p: string) => boolean;
  private readonly _mkdir: (p: string) => void;

  constructor(options: UXPreferencesOptions = {}) {
    const root = options.projectRoot ?? process.cwd();
    this._filePath =
      options.prefsFilePath ?? path.join(root, ".dantecode", "preferences.json");
    this._write = options.writeFn ?? ((p, d) => fs.writeFileSync(p, d));
    this._read  = options.readFn  ?? ((p) => { try { return fs.readFileSync(p, "utf-8"); } catch { return null; } });
    this._exists = options.existsFn ?? ((p) => fs.existsSync(p));
    this._mkdir  = options.mkdirFn  ?? ((p) => fs.mkdirSync(p, { recursive: true }));
    this._prefs = { ...PREFERENCE_DEFAULTS };
    this._load();
  }

  // -------------------------------------------------------------------------
  // Read API
  // -------------------------------------------------------------------------

  /** Get all preferences. */
  getAll(): UXPreferenceRecord {
    return { ...this._prefs };
  }

  /** Get a single preference value. */
  get<K extends keyof UXPreferenceRecord>(key: K): UXPreferenceRecord[K] {
    return this._prefs[key];
  }

  /** Get the active theme name. */
  getTheme(): ThemeName {
    return this._prefs.theme;
  }

  /** Get the active render density. */
  getDensity(): RenderDensity {
    return this._prefs.density;
  }

  /** Whether accessibility mode is on. */
  isAccessibilityMode(): boolean {
    return this._prefs.accessibilityMode;
  }

  /** Whether onboarding was completed. */
  isOnboardingComplete(): boolean {
    return this._prefs.onboardingComplete;
  }

  // -------------------------------------------------------------------------
  // Write API
  // -------------------------------------------------------------------------

  /** Set a single preference and persist. */
  set<K extends keyof UXPreferenceRecord>(
    key: K,
    value: UXPreferenceRecord[K],
  ): void {
    this._prefs[key] = value;
    this._save();
  }

  /** Update multiple preferences at once and persist. */
  update(partial: Partial<UXPreferenceRecord>): void {
    this._prefs = { ...this._prefs, ...partial };
    this._save();
  }

  /** Apply a theme. */
  applyTheme(name: ThemeName): void {
    this.set("theme", name);
  }

  /** Mark onboarding as complete. */
  markOnboardingComplete(): void {
    this.set("onboardingComplete", true);
  }

  /** Enable/disable accessibility mode. */
  setAccessibilityMode(enabled: boolean): void {
    this.set("accessibilityMode", enabled);
  }

  /** Reset all preferences to defaults. */
  reset(): void {
    this._prefs = { ...PREFERENCE_DEFAULTS };
    this._save();
  }

  // -------------------------------------------------------------------------
  // Validation helpers
  // -------------------------------------------------------------------------

  /** Check if a string is a valid ThemeName. */
  isValidTheme(name: string): name is ThemeName {
    const valid: ThemeName[] = ["default", "minimal", "rich", "matrix", "ocean"];
    return valid.includes(name as ThemeName);
  }

  /** Check if a string is a valid RenderDensity. */
  isValidDensity(d: string): d is RenderDensity {
    return d === "compact" || d === "normal" || d === "verbose";
  }

  /** Get the preferences file path. */
  getFilePath(): string {
    return this._filePath;
  }

  // -------------------------------------------------------------------------
  // Private
  // -------------------------------------------------------------------------

  private _load(): void {
    try {
      const raw = this._read(this._filePath);
      if (!raw) return;
      const parsed = JSON.parse(raw) as Partial<UXPreferenceRecord>;
      this._prefs = { ...PREFERENCE_DEFAULTS, ...this._sanitize(parsed) };
    } catch {
      // Corrupt or missing file — fall back to defaults
    }
  }

  private _save(): void {
    try {
      const dir = path.dirname(this._filePath);
      if (!this._exists(dir)) this._mkdir(dir);
      this._write(this._filePath, JSON.stringify(this._prefs, null, 2));
    } catch {
      // Non-fatal — preferences just won't persist
    }
  }

  private _sanitize(raw: Partial<UXPreferenceRecord>): Partial<UXPreferenceRecord> {
    const out: Partial<UXPreferenceRecord> = {};
    if (typeof raw.theme === "string" && this.isValidTheme(raw.theme)) out.theme = raw.theme;
    if (typeof raw.colors === "boolean") out.colors = raw.colors;
    if (typeof raw.density === "string" && this.isValidDensity(raw.density)) out.density = raw.density;
    if (typeof raw.richMode === "boolean") out.richMode = raw.richMode;
    if (typeof raw.showPdseInline === "boolean") out.showPdseInline = raw.showPdseInline;
    if (typeof raw.showSuggestions === "boolean") out.showSuggestions = raw.showSuggestions;
    if (typeof raw.showToolAnnotations === "boolean") out.showToolAnnotations = raw.showToolAnnotations;
    if (typeof raw.onboardingComplete === "boolean") out.onboardingComplete = raw.onboardingComplete;
    if (typeof raw.accessibilityMode === "boolean") out.accessibilityMode = raw.accessibilityMode;
    return out;
  }
}
