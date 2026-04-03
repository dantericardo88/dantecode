/**
 * tokens.test.ts — @dantecode/ux-polish
 *
 * Tests for design tokens: color-tokens, spacing-tokens, icon-tokens.
 */

import { describe, it, expect, afterEach } from "vitest";

// color-tokens
import { COLOR_TOKENS, NO_COLORS, resolveColors, supportsColor } from "./tokens/color-tokens.js";

// spacing-tokens
import { INDENT, COLUMN_WIDTH, indent, padOrTruncate, hRule } from "./tokens/spacing-tokens.js";

// icon-tokens
import { ICONS_RICH, ICONS_ASCII, resolveIcons, spinnerFrame } from "./tokens/icon-tokens.js";

// ---------------------------------------------------------------------------
// color-tokens
// ---------------------------------------------------------------------------

describe("COLOR_TOKENS", () => {
  it("has entries for all themes", () => {
    const themes = ["default", "minimal", "rich", "matrix", "ocean"] as const;
    for (const t of themes) {
      expect(COLOR_TOKENS[t]).toBeDefined();
    }
  });

  it("minimal theme has empty strings (no-color)", () => {
    const m = COLOR_TOKENS.minimal;
    expect(m.success).toBe("");
    expect(m.error).toBe("");
    expect(m.reset).toBe("");
  });

  it("default theme has ANSI escape sequences", () => {
    const d = COLOR_TOKENS.default;
    expect(d.success).toContain("\x1b[");
    expect(d.error).toContain("\x1b[");
  });
});

describe("NO_COLORS", () => {
  it("all fields are empty strings", () => {
    for (const v of Object.values(NO_COLORS)) {
      expect(v).toBe("");
    }
  });
});

describe("resolveColors", () => {
  it("returns color tokens when useColors=true", () => {
    const result = resolveColors("default", true);
    expect(result.success).toContain("\x1b[");
  });

  it("returns NO_COLORS when useColors=false", () => {
    const result = resolveColors("default", false);
    expect(result.success).toBe("");
    expect(result.reset).toBe("");
  });

  it("falls back to default theme for unknown input", () => {
    // @ts-expect-error intentional bad theme
    const result = resolveColors("nonexistent", true);
    expect(result).toEqual(COLOR_TOKENS.default);
  });
});

describe("supportsColor", () => {
  afterEach(() => {
    delete process.env["NO_COLOR"];
    delete process.env["FORCE_COLOR"];
    delete process.env["TERM"];
    delete process.env["CI"];
  });

  it("returns false when NO_COLOR is set", () => {
    process.env["NO_COLOR"] = "1";
    expect(supportsColor()).toBe(false);
  });

  it("returns false when TERM=dumb", () => {
    process.env["TERM"] = "dumb";
    expect(supportsColor()).toBe(false);
  });

  it("returns false in CI without FORCE_COLOR", () => {
    process.env["CI"] = "true";
    expect(supportsColor()).toBe(false);
  });

  it("returns true with FORCE_COLOR in CI", () => {
    process.env["CI"] = "true";
    process.env["FORCE_COLOR"] = "1";
    expect(supportsColor()).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// spacing-tokens
// ---------------------------------------------------------------------------

describe("INDENT", () => {
  it("has expected values", () => {
    expect(INDENT.none).toBe(0);
    expect(INDENT.sm).toBe(2);
    expect(INDENT.md).toBe(4);
    expect(INDENT.lg).toBe(6);
  });
});

describe("COLUMN_WIDTH", () => {
  it("has terminal width 80", () => {
    expect(COLUMN_WIDTH.terminal).toBe(80);
  });

  it("has progressBar width", () => {
    expect(COLUMN_WIDTH.progressBar).toBeGreaterThan(0);
  });
});

describe("indent()", () => {
  it("returns correct number of spaces", () => {
    expect(indent(4)).toBe("    ");
    expect(indent(0)).toBe("");
  });

  it("clamps negative values to 0", () => {
    expect(indent(-5)).toBe("");
  });

  it("clamps large values to 20", () => {
    expect(indent(100)).toBe(" ".repeat(20));
  });
});

describe("padOrTruncate()", () => {
  it("pads short strings", () => {
    expect(padOrTruncate("hi", 5)).toBe("hi   ");
  });

  it("truncates long strings with suffix", () => {
    const result = padOrTruncate("hello world", 7);
    expect(result.length).toBe(7);
    expect(result.endsWith("…")).toBe(true);
  });

  it("returns string unchanged if exactly right length", () => {
    expect(padOrTruncate("hello", 5)).toBe("hello");
  });
});

describe("hRule()", () => {
  it("creates correct-length rule", () => {
    const rule = hRule(10);
    expect(rule.length).toBe(10);
  });

  it("supports custom char", () => {
    expect(hRule(5, "=")).toBe("=====");
  });

  it("handles zero width", () => {
    expect(hRule(0)).toBe("");
  });
});

// ---------------------------------------------------------------------------
// icon-tokens
// ---------------------------------------------------------------------------

describe("ICONS_RICH", () => {
  it("has all required fields", () => {
    const required = ["success", "error", "warning", "spinner", "bullet"];
    for (const k of required) {
      expect(ICONS_RICH).toHaveProperty(k);
    }
  });

  it("spinner is an array", () => {
    expect(Array.isArray(ICONS_RICH.spinner)).toBe(true);
    expect(ICONS_RICH.spinner.length).toBeGreaterThan(0);
  });
});

describe("ICONS_ASCII", () => {
  it("has no Unicode emoji in string fields", () => {
    // ASCII icon set should use brackets not Unicode
    expect(ICONS_ASCII.success).toMatch(/^\[/);
    expect(ICONS_ASCII.error).toMatch(/^\[/);
  });
});

describe("resolveIcons()", () => {
  it("returns ASCII icons for minimal theme", () => {
    const icons = resolveIcons("minimal");
    expect(icons).toBe(ICONS_ASCII);
  });

  it("returns rich icons for default theme", () => {
    const icons = resolveIcons("default");
    expect(icons).toBe(ICONS_RICH);
  });
});

describe("spinnerFrame()", () => {
  it("returns correct frame by index", () => {
    expect(spinnerFrame(ICONS_RICH, 0)).toBe(ICONS_RICH.spinner[0]);
    expect(spinnerFrame(ICONS_RICH, 1)).toBe(ICONS_RICH.spinner[1]);
  });

  it("wraps around on overflow", () => {
    const len = ICONS_RICH.spinner.length;
    expect(spinnerFrame(ICONS_RICH, len)).toBe(ICONS_RICH.spinner[0]);
  });
});
