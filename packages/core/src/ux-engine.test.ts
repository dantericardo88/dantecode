import { describe, it, expect } from "vitest";
import { UXEngine } from "./ux-engine.js";

describe("UXEngine", () => {
  // 1. constructor defaults
  it("constructor defaults to 'default' theme", () => {
    const ux = new UXEngine();
    expect(ux.getThemeName()).toBe("default");
  });

  // 2. color option (colors=false suppresses ANSI)
  it("colors=false suppresses ANSI codes in formatSuccess", () => {
    const ux = new UXEngine({ colors: false });
    const result = ux.formatSuccess("hello");
    expect(result).not.toContain("\x1b");
  });

  // 3. theme switching via applyTheme
  it("applyTheme() switches the active theme", () => {
    const ux = new UXEngine();
    ux.applyTheme("ocean");
    expect(ux.getThemeName()).toBe("ocean");
  });

  // 4. getThemeName returns current theme name
  it("getThemeName() returns the theme name set in constructor", () => {
    const ux = new UXEngine({ theme: "matrix" });
    expect(ux.getThemeName()).toBe("matrix");
  });

  // 5. listThemes returns all theme names
  it("listThemes() includes default, minimal, rich, matrix, ocean", () => {
    const ux = new UXEngine();
    const themes = ux.listThemes();
    expect(themes).toContain("default");
    expect(themes).toContain("minimal");
    expect(themes).toContain("rich");
    expect(themes).toContain("matrix");
    expect(themes).toContain("ocean");
  });

  // 6. formatProgress 0%
  it("formatProgress() shows 0% when current=0", () => {
    const ux = new UXEngine({ colors: false });
    const result = ux.formatProgress({ current: 0, total: 10 });
    expect(result).toContain("  0%");
  });

  // 7. formatProgress 50%
  it("formatProgress() shows 50% at current=5 total=10", () => {
    const ux = new UXEngine({ colors: false });
    const result = ux.formatProgress({ current: 5, total: 10 });
    expect(result).toContain(" 50%");
  });

  // 8. formatProgress 100%
  it("formatProgress() shows 100% at current=total", () => {
    const ux = new UXEngine({ colors: false });
    const result = ux.formatProgress({ current: 10, total: 10 });
    expect(result).toContain("100%");
  });

  // 9. formatProgress custom width/label
  it("formatProgress() respects custom width and label", () => {
    const ux = new UXEngine({ colors: false });
    const result = ux.formatProgress({ current: 5, total: 10, label: "Loading", width: 10 });
    expect(result).toContain("Loading");
    const match = result.match(/\[([^\]]+)\]/);
    expect(match).not.toBeNull();
    expect(match![1]!.length).toBe(10);
  });

  // 10. formatError without hint
  it("formatError() includes message and icon without second argument", () => {
    const ux = new UXEngine({ colors: false });
    const result = ux.formatError("Something failed");
    expect(result).toContain("Something failed");
    // No context prefix appended
    expect(result).not.toContain("\n");
  });

  // 11. formatError with hint/context
  it("formatError() includes context when provided as second argument", () => {
    const ux = new UXEngine({ colors: false });
    const result = ux.formatError("Something failed", "Try again");
    expect(result).toContain("Something failed");
    expect(result).toContain("Try again");
  });

  // 12. formatSuccess
  it("formatSuccess() includes success icon and message", () => {
    const ux = new UXEngine({ colors: false });
    const result = ux.formatSuccess("Build complete");
    // The icon from theme (e.g. ✓)
    const icon = ux.getTheme().icons.success;
    expect(result).toContain(icon);
    expect(result).toContain("Build complete");
  });

  // 13. formatWarning
  it("formatWarning() includes warning icon and message", () => {
    const ux = new UXEngine({ colors: false });
    const result = ux.formatWarning("Deprecated API");
    const icon = ux.getTheme().icons.warning;
    expect(result).toContain(icon);
    expect(result).toContain("Deprecated API");
  });

  // 14. formatInfo
  it("formatInfo() includes info icon and message", () => {
    const ux = new UXEngine({ colors: false });
    const result = ux.formatInfo("Version 1.0");
    const icon = ux.getTheme().icons.info;
    expect(result).toContain(icon);
    expect(result).toContain("Version 1.0");
  });

  // 15. generateHint < 0.5 threshold
  it("generateHint() returns corrective hint for score < 0.5", () => {
    const ux = new UXEngine();
    const hint = ux.generateHint(0.3);
    // Should mention simplify/simplification or score below 0.5
    expect(hint.toLowerCase()).toMatch(/simplif|quality|below|threshold/);
    expect(hint).toContain("0.30");
  });

  // 16. generateHint 0.5-0.8 threshold
  it("generateHint() returns improvement hint for score in [0.5, 0.8)", () => {
    const ux = new UXEngine();
    const hint = ux.generateHint(0.65);
    expect(hint.toLowerCase()).toMatch(/good|progress|track|verif/);
    expect(hint).toContain("0.65");
  });

  // 17. generateHint > 0.8 threshold
  it("generateHint() returns positive reinforcement for score > 0.8", () => {
    const ux = new UXEngine();
    const hint = ux.generateHint(0.9);
    expect(hint.toLowerCase()).toMatch(/excellent|solid|ready/);
    expect(hint).toContain("0.90");
  });

  // 18. buildStatusLine with model only (legacy mode)
  it("buildStatusLine() legacy mode includes model when provided", () => {
    const ux = new UXEngine();
    const result = ux.buildStatusLine({ model: "claude-opus-4" });
    expect(result).toContain("model:claude-opus-4");
  });

  // 19. buildStatusLine with all legacy fields
  it("buildStatusLine() legacy mode includes all provided fields", () => {
    const ux = new UXEngine();
    const result = ux.buildStatusLine({
      model: "claude-sonnet",
      tokens: 1500,
      latencyMs: 250,
      pdseScore: 0.87,
      activeTask: "implement-feature",
    });
    expect(result).toContain("model:claude-sonnet");
    expect(result).toContain("tokens:1500");
    expect(result).toContain("250ms");
    expect(result).toContain("pdse:0.87");
    expect(result).toContain("task:implement-feature");
  });

  // 20. buildStatusLine with no fields returns empty bracket
  it("buildStatusLine() legacy mode with no fields returns '[]'", () => {
    const ux = new UXEngine();
    const result = ux.buildStatusLine({});
    expect(result).toBe("[]");
  });

  // 21. colors=false produces no ANSI codes in formatError
  it("colors=false produces no ANSI codes in formatError", () => {
    const ux = new UXEngine({ colors: false });
    const result = ux.formatError("oops");
    expect(result).not.toContain("\x1b");
  });

  // 22. colors=false produces no ANSI codes in formatProgress
  it("colors=false: formatProgress produces a bar with fill/empty chars", () => {
    const ux = new UXEngine({ colors: false });
    const result = ux.formatProgress({ current: 3, total: 10 });
    // Should still have bar characters
    expect(result).toContain("█");
    expect(result).toContain("░");
  });

  // 23. minimal theme produces no color codes in formatSuccess
  it("minimal theme: formatSuccess has no ANSI codes", () => {
    const ux = new UXEngine({ theme: "minimal" });
    const result = ux.formatSuccess("done");
    expect(result).not.toContain("\x1b");
  });

  // 24. minimal theme produces no color codes in formatWarning
  it("minimal theme: formatWarning has no ANSI codes", () => {
    const ux = new UXEngine({ theme: "minimal" });
    const result = ux.formatWarning("careful");
    expect(result).not.toContain("\x1b");
  });

  // 25. applyTheme changes theme from default to rich
  it("applyTheme() changes theme from default to rich", () => {
    const ux = new UXEngine();
    expect(ux.getThemeName()).toBe("default");
    ux.applyTheme("rich");
    expect(ux.getThemeName()).toBe("rich");
  });
});
