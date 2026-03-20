/**
 * help-engine.test.ts — @dantecode/ux-polish
 * Tests for HelpEngine and getContextualSuggestions.
 */

import { describe, it, expect } from "vitest";
import { HelpEngine, getContextualSuggestions } from "./help-engine.js";
import { ThemeEngine } from "./theme-engine.js";
import type { SuggestionContext } from "./types.js";

const noColor = new ThemeEngine({ colors: false });

describe("HelpEngine", () => {
  it("lists built-in commands", () => {
    const h = new HelpEngine({ theme: noColor });
    expect(h.list()).toContain("/magic");
    expect(h.list()).toContain("/verify");
    expect(h.list()).toContain("/debug");
  });

  it("get() returns entry for known command", () => {
    const h = new HelpEngine({ theme: noColor });
    const entry = h.get("/magic");
    expect(entry).toBeDefined();
    expect(entry?.shortDesc).toBeTruthy();
  });

  it("get() returns undefined for unknown command", () => {
    const h = new HelpEngine({ theme: noColor });
    expect(h.get("/nonexistent")).toBeUndefined();
  });

  it("search() returns relevant results", () => {
    const h = new HelpEngine({ theme: noColor });
    const results = h.search("verify");
    expect(results.length).toBeGreaterThan(0);
    // At least one result should be for /verify
    expect(results.some((r) => r.entry.command.includes("verify"))).toBe(true);
  });

  it("search() returns all entries for empty query", () => {
    const h = new HelpEngine({ theme: noColor });
    const results = h.search("");
    expect(results.length).toBeGreaterThan(0);
  });

  it("search() respects limit", () => {
    const h = new HelpEngine({ theme: noColor });
    const results = h.search("", 3);
    expect(results.length).toBeLessThanOrEqual(3);
  });

  it("formatEntry() returns non-empty string", () => {
    const h = new HelpEngine({ theme: noColor });
    const entry = h.get("/magic")!;
    const formatted = h.formatEntry(entry);
    expect(formatted).toContain("/magic");
  });

  it("formatResults() returns 'No matching commands' for empty results", () => {
    const h = new HelpEngine({ theme: noColor });
    const result = h.formatResults([]);
    expect(result).toContain("No matching commands");
  });

  it("formatSuggestionsHint() returns empty string for no suggestions", () => {
    const h = new HelpEngine({ theme: noColor });
    expect(h.formatSuggestionsHint([])).toBe("");
  });

  it("formatSuggestionsHint() formats suggestions list", () => {
    const h = new HelpEngine({ theme: noColor });
    const hints = h.formatSuggestionsHint([
      { command: "/verify", label: "Verify", reason: "test", priority: "high" },
    ]);
    expect(hints).toContain("/verify");
  });

  it("accepts extra entries via options", () => {
    const h = new HelpEngine({
      theme: noColor,
      extraEntries: [{ command: "/custom", shortDesc: "Custom cmd" }],
    });
    expect(h.list()).toContain("/custom");
    expect(h.get("/custom")).toBeDefined();
  });
});

describe("getContextualSuggestions()", () => {
  it("returns empty array for neutral context", () => {
    const ctx: SuggestionContext = {};
    const suggestions = getContextualSuggestions(ctx);
    // Should have some defaults (idle pipeline → /magic)
    expect(Array.isArray(suggestions)).toBe(true);
  });

  it("returns /autoforge for low PDSE score", () => {
    const ctx: SuggestionContext = { pdseScore: 0.4 };
    const suggestions = getContextualSuggestions(ctx);
    expect(suggestions.some((s) => s.command === "/autoforge")).toBe(true);
  });

  it("returns /verify for TypeScript errors", () => {
    const ctx: SuggestionContext = { activeErrors: ["TS2345: Type error"] };
    const suggestions = getContextualSuggestions(ctx);
    expect(suggestions.some((s) => s.command === "/verify")).toBe(true);
  });

  it("returns /debug for test failures", () => {
    const ctx: SuggestionContext = { activeErrors: ["AssertionError: expected 1 to equal 2"] };
    const suggestions = getContextualSuggestions(ctx);
    expect(suggestions.some((s) => s.command === "/debug")).toBe(true);
  });

  it("returns /compact for high context usage", () => {
    const ctx: SuggestionContext = { contextPercent: 80 };
    const suggestions = getContextualSuggestions(ctx);
    expect(suggestions.some((s) => s.command === "/compact")).toBe(true);
  });

  it("returns /commit for uncommitted changes", () => {
    const ctx: SuggestionContext = { hasUncommittedChanges: true, pipelineState: "idle" };
    const suggestions = getContextualSuggestions(ctx);
    expect(suggestions.some((s) => s.command === "/commit")).toBe(true);
  });

  it("respects maxResults limit", () => {
    const ctx: SuggestionContext = { pdseScore: 0.3, activeErrors: ["TS1234: err"], contextPercent: 90 };
    const suggestions = getContextualSuggestions(ctx, 2);
    expect(suggestions.length).toBeLessThanOrEqual(2);
  });

  it("deduplicates commands", () => {
    const ctx: SuggestionContext = { pipelineState: "complete" };
    const suggestions = getContextualSuggestions(ctx);
    const cmds = suggestions.map((s) => s.command);
    const unique = new Set(cmds);
    expect(unique.size).toBe(cmds.length);
  });
});
