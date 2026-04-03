/**
 * theme-engine.test.ts — @dantecode/ux-polish
 */

import { describe, it, expect, afterEach } from "vitest";
import { ThemeEngine, getThemeEngine, resetThemeEngine } from "./theme-engine.js";

afterEach(() => {
  resetThemeEngine();
});

describe("ThemeEngine", () => {
  it("defaults to 'default' theme", () => {
    const e = new ThemeEngine({ colors: false });
    expect(e.name).toBe("default");
  });

  it("setTheme changes the active theme", () => {
    const e = new ThemeEngine({ colors: false });
    e.setTheme("matrix");
    expect(e.name).toBe("matrix");
  });

  it("listThemes returns all 5 built-in themes", () => {
    const e = new ThemeEngine();
    expect(e.listThemes()).toHaveLength(5);
    expect(e.listThemes()).toContain("ocean");
  });

  it("color() returns ANSI when colors enabled", () => {
    const e = new ThemeEngine({ colors: true });
    const c = e.color("success");
    expect(c).toContain("\x1b[");
  });

  it("color() returns empty string when colors disabled", () => {
    const e = new ThemeEngine({ colors: false });
    expect(e.color("error")).toBe("");
  });

  it("reset is empty when colors disabled", () => {
    const e = new ThemeEngine({ colors: false });
    expect(e.reset).toBe("");
  });

  it("success() wraps text in success color", () => {
    const e = new ThemeEngine({ colors: true });
    const result = e.success("ok");
    expect(result).toContain("ok");
    expect(result).toContain("\x1b[");
  });

  it("muted() returns text unchanged when colors off", () => {
    const e = new ThemeEngine({ colors: false });
    expect(e.muted("hello")).toBe("hello");
  });

  it("toJSON() / fromJSON() round-trips settings", () => {
    const e = new ThemeEngine({ theme: "ocean", colors: false });
    const data = e.toJSON();
    expect(data.theme).toBe("ocean");
    expect(data.colors).toBe(false);

    const e2 = new ThemeEngine({ colors: true });
    e2.fromJSON(data);
    expect(e2.name).toBe("ocean");
    expect(e2.colorsEnabled).toBe(false);
  });

  it("resolve() returns full theme with name, colors, icons", () => {
    const e = new ThemeEngine({ colors: false });
    const resolved = e.resolve();
    expect(resolved.name).toBe("default");
    expect(resolved.colors).toBeDefined();
    expect(resolved.icons).toBeDefined();
  });
});

describe("getThemeEngine()", () => {
  it("returns the same singleton on repeated calls", () => {
    const a = getThemeEngine();
    const b = getThemeEngine();
    expect(a).toBe(b);
  });

  it("returns new instance after resetThemeEngine()", () => {
    const a = getThemeEngine();
    resetThemeEngine();
    const b = getThemeEngine();
    expect(a).not.toBe(b);
  });
});
