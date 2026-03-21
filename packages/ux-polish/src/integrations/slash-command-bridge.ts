/**
 * slash-command-bridge.ts — @dantecode/ux-polish
 *
 * G16 — Slash-command / inline completion polish.
 * Provides consistent rendering of slash command suggestions, command discovery,
 * and inline completion hints — all driven by HelpEngine and ThemeEngine.
 */

import { HelpEngine } from "../help-engine.js";
import type { HelpEntry, HelpSearchResult } from "../help-engine.js";
import type { ThemeEngine } from "../theme-engine.js";
import { ICONS_RICH } from "../tokens/icon-tokens.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** A rendered slash command suggestion entry. */
export interface CommandSuggestionItem {
  /** The full command string (e.g. "/verify"). */
  command: string;
  /** Short description for inline display. */
  shortDesc: string;
  /** Category/group for grouping in menus. */
  category: string;
  /** ANSI-colored display line (empty string if no theme). */
  line: string;
}

/** Inline completion hint for partial input. */
export interface InlineCompletionHint {
  /** The partial text that was typed. */
  partial: string;
  /** Matching commands in completion order. */
  completions: string[];
  /** Single-line hint text to display below the cursor. */
  hintText: string;
}

export interface SlashCommandBridgeOptions {
  /** HelpEngine to drive command discovery. */
  helpEngine?: HelpEngine;
  /** ThemeEngine for consistent rendering. */
  theme?: ThemeEngine;
}

// ---------------------------------------------------------------------------
// SlashCommandBridge
// ---------------------------------------------------------------------------

export class SlashCommandBridge {
  private _help: HelpEngine;
  private _theme: ThemeEngine | undefined;

  constructor(opts: SlashCommandBridgeOptions = {}) {
    this._help = opts.helpEngine ?? new HelpEngine();
    this._theme = opts.theme;
  }

  /**
   * Formats command suggestions for a given prefix (e.g. "/ver").
   * Returns consistently styled suggestion items.
   */
  formatCommandSuggestions(prefix: string): CommandSuggestionItem[] {
    const results = this._help.search(prefix, 8);
    return results.map((r) => this._toItem(r));
  }

  /**
   * Renders full help for a single command ID.
   * Returns a multi-line string suitable for any surface.
   */
  renderCommandHelp(commandId: string): string {
    const entry = this._help.get(commandId);
    if (!entry) {
      const notFound = `Unknown command: ${commandId}`;
      return this._theme ? this._theme.error(notFound) : notFound;
    }
    return this._help.formatEntry(entry);
  }

  /**
   * Builds an inline completion hint for partial input.
   * Used to display suggestions below the cursor as the user types.
   */
  renderInlineCompletionHint(partial: string): InlineCompletionHint {
    if (!partial.startsWith("/")) {
      return { partial, completions: [], hintText: "" };
    }

    const results = this._help.search(partial.slice(1), 5);
    const completions = results.map((r) => r.entry.command);

    if (completions.length === 0) {
      return { partial, completions: [], hintText: "" };
    }

    const top = completions[0]!;
    const rest = completions.slice(1, 4);
    const moreText = rest.length > 0 ? `  |  also: ${rest.join(", ")}` : "";
    const hintBase = `/${top}${moreText}`;
    const hintText = this._theme ? this._theme.muted(hintBase) : hintBase;

    return { partial, completions, hintText };
  }

  /**
   * Returns raw HelpSearchResults for a prefix (for programmatic use).
   */
  getCommandCompletions(prefix: string): HelpSearchResult[] {
    return this._help.search(prefix, 10);
  }

  /**
   * Renders a formatted list of all available commands.
   * Useful for /help output.
   */
  renderCommandList(): string {
    const all = this._help.list();
    if (all.length === 0) return "No commands available.";
    // list() returns command strings — search with empty query to get all entries
    const results = this._help.search("", all.length);
    return this._help.formatResults(results);
  }

  /**
   * Groups commands by tag/category and returns a structured menu string.
   * Since HelpEntry has no category field, uses tags[0] as group key.
   */
  renderGroupedMenu(): string {
    const results = this._help.search("", 50);
    const groups = new Map<string, HelpEntry[]>();

    for (const { entry } of results) {
      const cat = entry.tags?.[0] ?? "General";
      if (!groups.has(cat)) groups.set(cat, []);
      groups.get(cat)!.push(entry);
    }

    const lines: string[] = [];
    for (const [cat, entries] of groups) {
      const header = this._theme ? this._theme.boldText(cat) : cat;
      lines.push(header);
      for (const e of entries) {
        const cmd = e.command;
        const desc = e.shortDesc;
        const icon = ICONS_RICH.bullet;
        const coloredCmd = this._theme
          ? `${this._theme.color("info")}${cmd}${this._theme.reset}`
          : cmd;
        const line = `${icon} ${coloredCmd.padEnd(18)}  ${this._theme ? this._theme.muted(desc) : desc}`;
        lines.push(line);
      }
      lines.push("");
    }
    return lines.join("\n").trim();
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  private _toItem(r: HelpSearchResult): CommandSuggestionItem {
    const e = r.entry;
    const cmd = e.command;
    const shortDesc = e.shortDesc;
    const category = e.tags?.[0] ?? "General";

    const coloredCmd = this._theme ? `${this._theme.color("info")}${cmd}${this._theme.reset}` : cmd;
    const line = `${coloredCmd.padEnd(18)} ${this._theme ? this._theme.muted(shortDesc) : shortDesc}`;

    return { command: cmd, shortDesc, category, line };
  }
}
