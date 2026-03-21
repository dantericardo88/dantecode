import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { ThemePreferences } from "./theme-preferences.js";

function makeTempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dante-theme-"));
  return dir;
}

describe("ThemePreferences", () => {
  let tmpDir: string;
  let prefsPath: string;
  let prefs: ThemePreferences;

  beforeEach(() => {
    tmpDir = makeTempDir();
    prefsPath = path.join(tmpDir, "preferences.json");
    prefs = new ThemePreferences({ prefsFilePath: prefsPath });
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  // 1. defaults applied when no file
  it("defaults to 'default' theme and colors:true", () => {
    expect(prefs.getTheme()).toBe("default");
    expect(prefs.get("colors")).toBe(true);
    expect(prefs.get("richMode")).toBe(false);
  });

  // 2. getAll returns all preferences
  it("getAll() returns all preference keys", () => {
    const all = prefs.getAll();
    expect(all).toHaveProperty("theme");
    expect(all).toHaveProperty("colors");
    expect(all).toHaveProperty("richMode");
    expect(all).toHaveProperty("showPdseInline");
    expect(all).toHaveProperty("showSuggestions");
    expect(all).toHaveProperty("showToolAnnotations");
  });

  // 3. set persists to file
  it("set() persists preference to disk", () => {
    prefs.set("theme", "matrix");
    expect(fs.existsSync(prefsPath)).toBe(true);
    const saved = JSON.parse(fs.readFileSync(prefsPath, "utf-8"));
    expect(saved.theme).toBe("matrix");
  });

  // 4. get returns updated value after set
  it("get() returns updated value after set()", () => {
    prefs.set("colors", false);
    expect(prefs.get("colors")).toBe(false);
  });

  // 5. applyTheme updates theme
  it("applyTheme() updates the theme and persists", () => {
    prefs.applyTheme("ocean");
    expect(prefs.getTheme()).toBe("ocean");
    const saved = JSON.parse(fs.readFileSync(prefsPath, "utf-8"));
    expect(saved.theme).toBe("ocean");
  });

  // 6. update merges partial
  it("update() merges partial preferences", () => {
    prefs.update({ richMode: true, showSuggestions: false });
    expect(prefs.get("richMode")).toBe(true);
    expect(prefs.get("showSuggestions")).toBe(false);
    // Other defaults intact
    expect(prefs.getTheme()).toBe("default");
  });

  // 7. reset restores defaults
  it("reset() restores all defaults", () => {
    prefs.applyTheme("rich");
    prefs.set("colors", false);
    prefs.reset();
    expect(prefs.getTheme()).toBe("default");
    expect(prefs.get("colors")).toBe(true);
  });

  // 8. load persisted values on construction
  it("loads persisted values from disk on construction", () => {
    prefs.applyTheme("minimal");
    prefs.set("richMode", true);

    // Create a new instance pointing at the same file
    const prefs2 = new ThemePreferences({ prefsFilePath: prefsPath });
    expect(prefs2.getTheme()).toBe("minimal");
    expect(prefs2.get("richMode")).toBe(true);
  });

  // 9. corrupt file falls back to defaults
  it("falls back to defaults if preferences file is corrupt JSON", () => {
    fs.writeFileSync(prefsPath, "not json {{{");
    const prefs2 = new ThemePreferences({ prefsFilePath: prefsPath });
    expect(prefs2.getTheme()).toBe("default");
  });

  // 10. invalid theme name ignored on load
  it("ignores invalid theme name from disk", () => {
    fs.writeFileSync(prefsPath, JSON.stringify({ theme: "neonPink" }));
    const prefs2 = new ThemePreferences({ prefsFilePath: prefsPath });
    expect(prefs2.getTheme()).toBe("default");
  });

  // 11. validThemes lists all 5 themes
  it("validThemes() returns 5 themes", () => {
    const themes = prefs.validThemes();
    expect(themes).toHaveLength(5);
    expect(themes).toContain("ocean");
    expect(themes).toContain("matrix");
  });

  // 12. isValidTheme
  it("isValidTheme() returns true for valid themes", () => {
    expect(prefs.isValidTheme("rich")).toBe(true);
  });

  it("isValidTheme() returns false for invalid themes", () => {
    expect(prefs.isValidTheme("neonPink")).toBe(false);
  });

  // 14. getFilePath returns the configured path
  it("getFilePath() returns the configured file path", () => {
    expect(prefs.getFilePath()).toBe(prefsPath);
  });

  // 15. creates parent directory if missing
  it("set() creates .dantecode/ dir if it does not exist", () => {
    const deep = path.join(tmpDir, "nested", "dir", "prefs.json");
    const deepPrefs = new ThemePreferences({ prefsFilePath: deep });
    deepPrefs.set("richMode", true);
    expect(fs.existsSync(deep)).toBe(true);
  });

  // 16. defaults applied for unknown keys in file
  it("fills in defaults for keys missing in saved file", () => {
    fs.writeFileSync(prefsPath, JSON.stringify({ theme: "ocean" }));
    const prefs2 = new ThemePreferences({ prefsFilePath: prefsPath });
    // richMode default is false — not in file
    expect(prefs2.get("richMode")).toBe(false);
  });
});
