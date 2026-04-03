/**
 * slash-command-bridge.test.ts — @dantecode/ux-polish
 * Tests for G16 — Slash-command / inline completion polish.
 */

import { describe, it, expect } from "vitest";
import { SlashCommandBridge } from "./slash-command-bridge.js";
import { ThemeEngine } from "../theme-engine.js";

const noColorTheme = new ThemeEngine({ colors: false });

function makeBridge() {
  return new SlashCommandBridge({ theme: noColorTheme });
}

describe("SlashCommandBridge", () => {
  describe("formatCommandSuggestions()", () => {
    it("returns array of CommandSuggestionItems", () => {
      const bridge = makeBridge();
      const items = bridge.formatCommandSuggestions("/ver");
      expect(Array.isArray(items)).toBe(true);
    });

    it("returns suggestions matching the prefix", () => {
      const bridge = makeBridge();
      const items = bridge.formatCommandSuggestions("/ver");
      expect(items.some((i) => i.command.includes("ver"))).toBe(true);
    });

    it("each item has command, shortDesc, category, line fields", () => {
      const bridge = makeBridge();
      const items = bridge.formatCommandSuggestions("/magic");
      if (items.length > 0) {
        const item = items[0]!;
        expect(item.command).toBeDefined();
        expect(item.shortDesc).toBeDefined();
        expect(item.category).toBeDefined();
        expect(item.line).toBeDefined();
      }
    });

    it("returns empty array for completely unknown prefix", () => {
      const bridge = makeBridge();
      const items = bridge.formatCommandSuggestions("/zzz-no-match-xyz");
      expect(items).toHaveLength(0);
    });

    it("command field starts with /", () => {
      const bridge = makeBridge();
      const items = bridge.formatCommandSuggestions("/m");
      for (const item of items) {
        expect(item.command.startsWith("/")).toBe(true);
      }
    });
  });

  describe("renderCommandHelp()", () => {
    it("returns help text for a known command", () => {
      const bridge = makeBridge();
      const help = bridge.renderCommandHelp("magic");
      expect(help).toBeTruthy();
      expect(help.length).toBeGreaterThan(10);
    });

    it("returns error text for unknown command", () => {
      const bridge = makeBridge();
      const help = bridge.renderCommandHelp("totally-unknown-cmd");
      expect(help).toContain("Unknown");
    });
  });

  describe("renderInlineCompletionHint()", () => {
    it("returns empty hint for non-slash input", () => {
      const bridge = makeBridge();
      const hint = bridge.renderInlineCompletionHint("hello");
      expect(hint.completions).toHaveLength(0);
      expect(hint.hintText).toBe("");
    });

    it("returns completions for a slash prefix", () => {
      const bridge = makeBridge();
      const hint = bridge.renderInlineCompletionHint("/ver");
      expect(hint.completions.length).toBeGreaterThan(0);
    });

    it("includes hintText when completions found", () => {
      const bridge = makeBridge();
      const hint = bridge.renderInlineCompletionHint("/m");
      if (hint.completions.length > 0) {
        expect(hint.hintText).toBeTruthy();
      }
    });

    it("preserves partial in returned object", () => {
      const bridge = makeBridge();
      const hint = bridge.renderInlineCompletionHint("/ver");
      expect(hint.partial).toBe("/ver");
    });
  });

  describe("getCommandCompletions()", () => {
    it("returns HelpSearchResults for a prefix", () => {
      const bridge = makeBridge();
      const results = bridge.getCommandCompletions("magic");
      expect(Array.isArray(results)).toBe(true);
    });
  });

  describe("renderCommandList()", () => {
    it("returns non-empty list", () => {
      const bridge = makeBridge();
      const list = bridge.renderCommandList();
      expect(list.length).toBeGreaterThan(10);
    });

    it("includes command names", () => {
      const bridge = makeBridge();
      const list = bridge.renderCommandList();
      expect(list).toContain("magic");
    });
  });

  describe("renderGroupedMenu()", () => {
    it("returns a grouped menu string", () => {
      const bridge = makeBridge();
      const menu = bridge.renderGroupedMenu();
      expect(menu).toBeTruthy();
    });

    it("groups commands under category headers", () => {
      const bridge = makeBridge();
      const menu = bridge.renderGroupedMenu();
      // Should have at least one line with a command
      expect(menu).toContain("/");
    });
  });
});
