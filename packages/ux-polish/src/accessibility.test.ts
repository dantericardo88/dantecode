/**
 * accessibility.test.ts — @dantecode/ux-polish
 * Tests for keyboard-nav, screen-reader, and contrast-rules.
 */

import { describe, it, expect, afterEach } from "vitest";
import { NavController, STANDARD_BINDINGS } from "./accessibility/keyboard-nav.js";
import {
  ScreenReaderSupport,
  detectScreenReaderMode,
  detectReducedMotion,
} from "./accessibility/screen-reader.js";
import { ContrastValidator } from "./accessibility/contrast-rules.js";

// ---------------------------------------------------------------------------
// keyboard-nav
// ---------------------------------------------------------------------------

describe("NavController", () => {
  it("initializes with correct state", () => {
    const nav = new NavController({ totalItems: 5 });
    const state = nav.getState();
    expect(state.focusIndex).toBe(0);
    expect(state.totalItems).toBe(5);
    expect(state.active).toBe(false);
  });

  it("activate() / deactivate() set active flag", () => {
    const nav = new NavController({ totalItems: 3 });
    nav.activate();
    expect(nav.getState().active).toBe(true);
    nav.deactivate();
    expect(nav.getState().active).toBe(false);
  });

  it("down key moves focus forward", () => {
    const nav = new NavController({ totalItems: 3, initialIndex: 0 });
    const state = nav.handleKey("down");
    expect(state?.focusIndex).toBe(1);
  });

  it("up key moves focus backward", () => {
    const nav = new NavController({ totalItems: 3, initialIndex: 2 });
    const state = nav.handleKey("up");
    expect(state?.focusIndex).toBe(1);
  });

  it("wraps around at bottom when wrap=true", () => {
    const nav = new NavController({ totalItems: 3, initialIndex: 2 });
    const state = nav.handleKey("down");
    expect(state?.focusIndex).toBe(0);
  });

  it("wraps around at top when wrap=true", () => {
    const nav = new NavController({ totalItems: 3, initialIndex: 0 });
    const state = nav.handleKey("up");
    expect(state?.focusIndex).toBe(2);
  });

  it("does not wrap when wrap=false", () => {
    const nav = new NavController({ totalItems: 3, initialIndex: 2, wrap: false });
    const state = nav.handleKey("down");
    expect(state?.focusIndex).toBe(2); // stays at end
  });

  it("ctrl+c deactivates navigation", () => {
    const nav = new NavController({ totalItems: 3 });
    nav.activate();
    const state = nav.handleKey("ctrl+c");
    expect(state?.active).toBe(false);
  });

  it("returns null for unhandled keys", () => {
    const nav = new NavController({ totalItems: 3 });
    expect(nav.handleKey("f5")).toBeNull();
  });

  it("custom key handler overrides built-in", () => {
    const nav = new NavController({ totalItems: 5, initialIndex: 0 });
    const unsub = nav.onKey((_key, state) => {
      if (_key === "down") return { ...state, focusIndex: 4 };
      return null;
    });
    const result = nav.handleKey("down");
    expect(result?.focusIndex).toBe(4);
    unsub(); // cleanup
    // After unsub, built-in behavior resumes — focus was at 4, wraps to 0
    const result2 = nav.handleKey("down");
    expect(result2?.focusIndex).toBe(0); // wraps around (4+1 = 5 → 0)
  });

  it("setTotalItems updates total and clamps focus", () => {
    const nav = new NavController({ totalItems: 10, initialIndex: 8 });
    nav.setTotalItems(3);
    expect(nav.getState().totalItems).toBe(3);
    expect(nav.getState().focusIndex).toBeLessThan(3);
  });

  it("renderList marks focused item with prefix", () => {
    const nav = new NavController({ totalItems: 3, initialIndex: 1 });
    const rendered = nav.renderList(["a", "b", "c"], { colors: false });
    const lines = rendered.split("\n");
    expect(lines[1]).toContain("▶");
  });

  it("STANDARD_BINDINGS has expected entries", () => {
    expect(STANDARD_BINDINGS.length).toBeGreaterThan(0);
    expect(STANDARD_BINDINGS.some((b) => b.key === "enter")).toBe(true);
  });

  it("NavController.formatBindings() returns non-empty string", () => {
    const str = NavController.formatBindings();
    expect(str.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// screen-reader
// ---------------------------------------------------------------------------

describe("ScreenReaderSupport", () => {
  afterEach(() => {
    delete process.env["DANTE_A11Y"];
    delete process.env["FORCE_A11Y"];
    delete process.env["DANTE_REDUCED_MOTION"];
  });

  it("defaults to non-SR mode", () => {
    const sr = new ScreenReaderSupport({ forceEnabled: false });
    expect(sr.enabled).toBe(false);
  });

  it("forceEnabled=true activates SR mode", () => {
    const sr = new ScreenReaderSupport({ forceEnabled: true });
    expect(sr.enabled).toBe(true);
  });

  it("stripAnsi removes ANSI codes", () => {
    const sr = new ScreenReaderSupport();
    const plain = sr.stripAnsi("\x1b[32mhello\x1b[0m");
    expect(plain).toBe("hello");
  });

  it("expandIcons replaces unicode icons when SR enabled", () => {
    const sr = new ScreenReaderSupport({ forceEnabled: true });
    expect(sr.expandIcons("✓ done")).toBe("success done");
    expect(sr.expandIcons("✗ error")).toBe("failed error");
  });

  it("expandIcons leaves text unchanged when SR disabled", () => {
    const sr = new ScreenReaderSupport({ forceEnabled: false });
    expect(sr.expandIcons("✓ done")).toBe("✓ done");
  });

  it("format() strips ANSI and expands icons when SR mode is on", () => {
    const sr = new ScreenReaderSupport({ forceEnabled: true });
    expect(sr.format("\x1b[32m✓\x1b[0m done")).toBe("success done");
  });

  it("announceStatus adds to log with polite role", () => {
    const sr = new ScreenReaderSupport();
    const ann = sr.announceStatus("Build complete");
    expect(ann.politeness).toBe("polite");
    expect(ann.role).toBe("status");
    expect(sr.getLog()).toHaveLength(1);
  });

  it("announceAlert adds assertive alert to log", () => {
    const sr = new ScreenReaderSupport();
    const ann = sr.announceAlert("Critical failure");
    expect(ann.politeness).toBe("assertive");
    expect(ann.role).toBe("alert");
  });

  it("announceProgress includes percent and position", () => {
    const sr = new ScreenReaderSupport({ includePosition: true });
    const ann = sr.announceProgress("Building", 50, { current: 2, total: 4 });
    expect(ann.text).toContain("50");
    expect(ann.text).toContain("step 2 of 4");
  });

  it("clearLog() empties the log", () => {
    const sr = new ScreenReaderSupport();
    sr.announceStatus("test");
    sr.clearLog();
    expect(sr.getLog()).toHaveLength(0);
  });
});

describe("detectScreenReaderMode()", () => {
  afterEach(() => {
    delete process.env["DANTE_A11Y"];
    delete process.env["FORCE_A11Y"];
  });

  it("returns true when DANTE_A11Y=1", () => {
    process.env["DANTE_A11Y"] = "1";
    expect(detectScreenReaderMode()).toBe(true);
  });

  it("returns false when no A11Y env vars set", () => {
    expect(detectScreenReaderMode()).toBe(false);
  });
});

describe("detectReducedMotion()", () => {
  afterEach(() => {
    delete process.env["DANTE_REDUCED_MOTION"];
  });

  it("returns true when DANTE_REDUCED_MOTION=1", () => {
    process.env["DANTE_REDUCED_MOTION"] = "1";
    expect(detectReducedMotion()).toBe(true);
  });

  it("returns false with no env vars", () => {
    expect(detectReducedMotion()).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// contrast-rules
// ---------------------------------------------------------------------------

describe("ContrastValidator", () => {
  it("check() returns a ContrastCheck record", () => {
    const v = new ContrastValidator();
    const check = v.check("success", "\x1b[32m");
    expect(check.role).toBe("success");
    expect(typeof check.ratio).toBe("number");
    expect(typeof check.passes).toBe("boolean");
    expect(["AA", "AAA", "fail"]).toContain(check.level);
  });

  it("minimal theme (no ANSI) has no checks to validate", () => {
    const v = new ContrastValidator();
    const report = v.validateTokens("minimal", { success: "", error: "", muted: "" });
    expect(report.checks).toHaveLength(0);
    expect(report.allPass).toBe(true);
  });

  it("validates tokens with ANSI sequences", () => {
    const v = new ContrastValidator();
    const tokens = { success: "\x1b[32m", error: "\x1b[31m", white: "\x1b[97m" };
    const report = v.validateTokens("custom", tokens);
    expect(report.checks.length).toBeGreaterThan(0);
    expect(report.theme).toBe("custom");
  });

  it("formatReport() returns human-readable string", () => {
    const v = new ContrastValidator();
    const report = v.validateTokens("test", { success: "\x1b[32m" });
    const formatted = v.formatReport(report);
    expect(formatted).toContain("Contrast report");
    expect(formatted).toContain("success");
  });

  it("allPass() is a convenience wrapper", () => {
    const v = new ContrastValidator();
    const result = v.allPass("minimal", { color: "" });
    expect(typeof result).toBe("boolean");
  });

  it("higher minimum ratio results in more failures", () => {
    const strict = new ContrastValidator({ minRatio: 10 });
    const normal = new ContrastValidator({ minRatio: 4.5 });
    const tokens = { success: "\x1b[32m" };

    const strictReport = strict.validateTokens("t", tokens);
    const normalReport = normal.validateTokens("t", tokens);
    // Strict should have equal or more failures
    expect(strictReport.failCount).toBeGreaterThanOrEqual(normalReport.failCount);
  });
});
