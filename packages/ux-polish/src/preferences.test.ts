/**
 * preferences.test.ts — @dantecode/ux-polish
 * Tests for UXPreferences (ux-preferences.ts).
 */

import { describe, it, expect, beforeEach } from "vitest";
import { UXPreferences, PREFERENCE_DEFAULTS } from "./preferences/ux-preferences.js";

// ---------------------------------------------------------------------------
// UXPreferences
// ---------------------------------------------------------------------------

describe("UXPreferences", () => {
  let store: Map<string, string>;
  let prefs: UXPreferences;

  beforeEach(() => {
    store = new Map<string, string>();
    prefs = new UXPreferences({
      prefsFilePath: "/fake/preferences.json",
      writeFn: (p, d) => { store.set(p, d); },
      readFn:  (p) => store.get(p) ?? null,
      existsFn: (p) => store.has(p),
      mkdirFn: () => { /* no-op */ },
    });
  });

  it("getAll() returns defaults initially", () => {
    const all = prefs.getAll();
    expect(all.theme).toBe(PREFERENCE_DEFAULTS.theme);
    expect(all.colors).toBe(PREFERENCE_DEFAULTS.colors);
    expect(all.onboardingComplete).toBe(false);
  });

  it("get() returns a specific preference", () => {
    expect(prefs.get("theme")).toBe("default");
  });

  it("set() updates a single preference", () => {
    prefs.set("theme", "ocean");
    expect(prefs.get("theme")).toBe("ocean");
  });

  it("update() updates multiple preferences at once", () => {
    prefs.update({ theme: "matrix", density: "compact", colors: false });
    expect(prefs.getTheme()).toBe("matrix");
    expect(prefs.getDensity()).toBe("compact");
    expect(prefs.get("colors")).toBe(false);
  });

  it("applyTheme() sets theme", () => {
    prefs.applyTheme("rich");
    expect(prefs.getTheme()).toBe("rich");
  });

  it("markOnboardingComplete() sets flag", () => {
    prefs.markOnboardingComplete();
    expect(prefs.isOnboardingComplete()).toBe(true);
  });

  it("setAccessibilityMode() sets flag", () => {
    prefs.setAccessibilityMode(true);
    expect(prefs.isAccessibilityMode()).toBe(true);
  });

  it("reset() restores all defaults", () => {
    prefs.update({ theme: "ocean", colors: false });
    prefs.reset();
    const all = prefs.getAll();
    expect(all.theme).toBe(PREFERENCE_DEFAULTS.theme);
    expect(all.colors).toBe(PREFERENCE_DEFAULTS.colors);
  });

  it("persists to and loads from the injected store", () => {
    prefs.applyTheme("matrix");
    prefs.markOnboardingComplete();

    // Create new instance pointing to same store
    const prefs2 = new UXPreferences({
      prefsFilePath: "/fake/preferences.json",
      writeFn: (p, d) => { store.set(p, d); },
      readFn:  (p) => store.get(p) ?? null,
      existsFn: (p) => store.has(p),
      mkdirFn: () => { /* no-op */ },
    });
    expect(prefs2.getTheme()).toBe("matrix");
    expect(prefs2.isOnboardingComplete()).toBe(true);
  });

  it("isValidTheme() returns true for all built-in themes", () => {
    const themes = ["default", "minimal", "rich", "matrix", "ocean"];
    for (const t of themes) {
      expect(prefs.isValidTheme(t)).toBe(true);
    }
    expect(prefs.isValidTheme("nonexistent")).toBe(false);
  });

  it("isValidDensity() works correctly", () => {
    expect(prefs.isValidDensity("compact")).toBe(true);
    expect(prefs.isValidDensity("normal")).toBe(true);
    expect(prefs.isValidDensity("verbose")).toBe(true);
    expect(prefs.isValidDensity("super")).toBe(false);
  });

  it("ignores invalid theme in sanitize (keeps default)", () => {
    store.set("/fake/preferences.json", JSON.stringify({ theme: "neon", colors: false }));
    const prefs3 = new UXPreferences({
      prefsFilePath: "/fake/preferences.json",
      writeFn: (p, d) => { store.set(p, d); },
      readFn:  (p) => store.get(p) ?? null,
      existsFn: (p) => store.has(p),
      mkdirFn: () => { /* no-op */ },
    });
    // "neon" is not valid so defaults to "default"
    expect(prefs3.getTheme()).toBe("default");
    // "colors: false" IS valid
    expect(prefs3.get("colors")).toBe(false);
  });

  it("handles corrupt JSON file gracefully", () => {
    store.set("/fake/preferences.json", "{ corrupt json ::::");
    const prefs4 = new UXPreferences({
      prefsFilePath: "/fake/preferences.json",
      writeFn: (p, d) => { store.set(p, d); },
      readFn:  (p) => store.get(p) ?? null,
      existsFn: (p) => store.has(p),
      mkdirFn: () => { /* no-op */ },
    });
    // Should fall back to defaults
    expect(prefs4.getTheme()).toBe("default");
  });
});
