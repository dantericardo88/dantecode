/**
 * fuzzy-finder.ts
 *
 * Fast, interactive fuzzy finder for files, commands, and skills.
 * Inspired by fzf, Telescope.nvim, and VS Code's Command Palette.
 *
 * Features:
 * - Real-time filtering as you type
 * - Smart scoring (consecutive matches, position, case sensitivity)
 * - Up/down arrow navigation
 * - Graceful non-TTY fallback
 * - Zero external dependencies
 */

import * as readline from "node:readline";
import { stdin as input, stdout as output } from "node:process";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface FuzzyItem {
  /** Display label */
  label: string;
  /** Optional value (defaults to label) */
  value?: string;
  /** Optional description */
  description?: string;
  /** Optional metadata for custom scoring */
  metadata?: Record<string, unknown>;
}

export interface FuzzyMatch extends FuzzyItem {
  score: number;
  matchedIndices: number[];
}

export interface FuzzyFinderOptions {
  /** Prompt message. Default: "Search:" */
  prompt?: string;
  /** Max results to display. Default: 10 */
  maxResults?: number;
  /** Enable ANSI colors. Default: true */
  colors?: boolean;
  /** Initial query. Default: "" */
  initialQuery?: string;
  /** Minimum score threshold (0-1). Default: 0.1 */
  minScore?: number;
  /** Case-sensitive matching. Default: false */
  caseSensitive?: boolean;
}

export interface FuzzyFinderResult {
  /** Whether user made a selection (false if cancelled) */
  selected: boolean;
  /** Selected item value (undefined if cancelled) */
  value?: string;
  /** Selected item (undefined if cancelled) */
  item?: FuzzyItem;
}

// ---------------------------------------------------------------------------
// Fuzzy Matching Algorithm
// ---------------------------------------------------------------------------

/**
 * Score a string against a query using fuzzy matching.
 *
 * Scoring:
 * - Consecutive match bonus: +2 per consecutive char after first
 * - Early match bonus: higher score for matches near start
 * - Case match bonus: +0.1 for exact case matches
 * - Normalized by query length and string length
 *
 * Returns: score (0-1), higher is better
 */
export function fuzzyScore(
  str: string,
  query: string,
  options: { caseSensitive?: boolean } = {},
): { score: number; matchedIndices: number[] } {
  if (!query) return { score: 1, matchedIndices: [] };
  if (!str) return { score: 0, matchedIndices: [] };

  const { caseSensitive = false } = options;
  const searchStr = caseSensitive ? str : str.toLowerCase();
  const searchQuery = caseSensitive ? query : query.toLowerCase();

  const matchedIndices: number[] = [];
  let queryIndex = 0;
  let score = 0;
  let consecutiveMatches = 0;

  for (let i = 0; i < searchStr.length && queryIndex < searchQuery.length; i++) {
    if (searchStr[i] === searchQuery[queryIndex]) {
      matchedIndices.push(i);

      // Base match score (decreases with position in string)
      const positionBonus = 1 - i / searchStr.length;
      score += positionBonus;

      // Consecutive match bonus
      if (consecutiveMatches > 0) {
        score += 2; // Strong bonus for consecutive matches
      }
      consecutiveMatches++;

      // Case sensitivity bonus
      if (str[i] === query[queryIndex]) {
        score += 0.1;
      }

      queryIndex++;
    } else {
      consecutiveMatches = 0;
    }
  }

  // Did we match all query characters?
  if (queryIndex < searchQuery.length) {
    return { score: 0, matchedIndices: [] }; // Not all chars matched
  }

  // Normalize score by query length (longer queries = harder to match)
  const normalizedScore = score / (searchQuery.length * 2);

  // Cap at 1.0
  return { score: Math.min(1, normalizedScore), matchedIndices };
}

/**
 * Filter and rank items by fuzzy match score.
 */
export function fuzzyFilter(
  items: FuzzyItem[],
  query: string,
  options: { minScore?: number; caseSensitive?: boolean; maxResults?: number } = {},
): FuzzyMatch[] {
  const { minScore = 0.1, caseSensitive = false, maxResults = 50 } = options;

  const matches: FuzzyMatch[] = [];

  for (const item of items) {
    const result = fuzzyScore(item.label, query, { caseSensitive });
    if (result.score >= minScore) {
      matches.push({
        ...item,
        score: result.score,
        matchedIndices: result.matchedIndices,
      });
    }
  }

  // Sort by score descending
  matches.sort((a, b) => b.score - a.score);

  return matches.slice(0, maxResults);
}

// ---------------------------------------------------------------------------
// Interactive Finder UI
// ---------------------------------------------------------------------------

/**
 * Launch an interactive fuzzy finder in the terminal.
 * Non-TTY safe: returns first item when stdin is not a TTY.
 */
export async function fuzzyFind(
  items: FuzzyItem[],
  options: FuzzyFinderOptions = {},
): Promise<FuzzyFinderResult> {
  const {
    prompt = "Search:",
    maxResults = 10,
    colors = true,
    initialQuery = "",
    minScore = 0.1,
    caseSensitive = false,
  } = options;

  // Non-TTY fallback: return first item
  if (!input.isTTY || !output.isTTY) {
    return {
      selected: true,
      value: items[0]?.value ?? items[0]?.label,
      item: items[0],
    };
  }

  const c = makeColors(colors);

  let query = initialQuery;
  let selectedIndex = 0;
  let matches = fuzzyFilter(items, query, { minScore, caseSensitive, maxResults });

  // Set up readline for raw mode (capture individual keystrokes)
  readline.emitKeypressEvents(input);
  if (input.isTTY) {
    input.setRawMode(true);
  }

  return new Promise((resolve) => {
    const cleanup = () => {
      if (input.isTTY) {
        input.setRawMode(false);
      }
      input.removeListener("keypress", onKeypress);
    };

    const render = () => {
      // Clear previous output (move cursor up and clear lines)
      const linesToClear = Math.min(matches.length, maxResults) + 2;
      for (let i = 0; i < linesToClear; i++) {
        readline.cursorTo(output, 0);
        readline.clearLine(output, 0);
        if (i < linesToClear - 1) {
          readline.moveCursor(output, 0, -1);
        }
      }
      readline.cursorTo(output, 0);

      // Render prompt and query
      output.write(`${c.CYAN}${prompt}${c.RESET} ${query}${c.DIM}_${c.RESET}\n`);

      // Render results
      const displayMatches = matches.slice(0, maxResults);
      if (displayMatches.length === 0) {
        output.write(`${c.DIM}  No matches${c.RESET}\n`);
      } else {
        displayMatches.forEach((match, i) => {
          const isSelected = i === selectedIndex;
          const marker = isSelected ? `${c.GREEN}>${c.RESET}` : " ";
          const labelHighlighted = highlightMatches(match.label, match.matchedIndices, colors);
          const desc = match.description ? ` ${c.DIM}(${match.description})${c.RESET}` : "";
          const scoreStr = colors ? ` ${c.DIM}[${match.score.toFixed(2)}]${c.RESET}` : "";
          output.write(`${marker} ${labelHighlighted}${desc}${scoreStr}\n`);
        });
      }
    };

    const onKeypress = (_str: string, key: { name: string; ctrl?: boolean; shift?: boolean }) => {
      if (key.ctrl && key.name === "c") {
        cleanup();
        output.write("\n");
        resolve({ selected: false });
        return;
      }

      if (key.name === "escape") {
        cleanup();
        output.write("\n");
        resolve({ selected: false });
        return;
      }

      if (key.name === "return") {
        cleanup();
        output.write("\n");
        const selected = matches[selectedIndex];
        if (selected) {
          resolve({
            selected: true,
            value: selected.value ?? selected.label,
            item: selected,
          });
        } else {
          resolve({ selected: false });
        }
        return;
      }

      if (key.name === "up") {
        selectedIndex = Math.max(0, selectedIndex - 1);
        render();
        return;
      }

      if (key.name === "down") {
        selectedIndex = Math.min(matches.length - 1, selectedIndex + 1);
        render();
        return;
      }

      if (key.name === "backspace") {
        query = query.slice(0, -1);
        matches = fuzzyFilter(items, query, { minScore, caseSensitive, maxResults });
        selectedIndex = 0;
        render();
        return;
      }

      // Regular character input
      if (_str && _str.length === 1 && !key.ctrl) {
        query += _str;
        matches = fuzzyFilter(items, query, { minScore, caseSensitive, maxResults });
        selectedIndex = 0;
        render();
      }
    };

    input.on("keypress", onKeypress);

    // Initial render
    output.write("\n");
    render();
  });
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeColors(enabled: boolean) {
  return {
    RED: enabled ? "\x1b[31m" : "",
    YELLOW: enabled ? "\x1b[33m" : "",
    CYAN: enabled ? "\x1b[36m" : "",
    GREEN: enabled ? "\x1b[32m" : "",
    BLUE: enabled ? "\x1b[34m" : "",
    MAGENTA: enabled ? "\x1b[35m" : "",
    BOLD: enabled ? "\x1b[1m" : "",
    DIM: enabled ? "\x1b[2m" : "",
    RESET: enabled ? "\x1b[0m" : "",
    UNDERLINE: enabled ? "\x1b[4m" : "",
  };
}

function highlightMatches(str: string, matchedIndices: number[], colors: boolean): string {
  if (!colors || matchedIndices.length === 0) return str;

  const c = makeColors(colors);
  let result = "";
  const matchSet = new Set(matchedIndices);

  for (let i = 0; i < str.length; i++) {
    if (matchSet.has(i)) {
      result += `${c.YELLOW}${c.BOLD}${str[i]}${c.RESET}`;
    } else {
      result += str[i];
    }
  }

  return result;
}

// ---------------------------------------------------------------------------
// Convenience Functions
// ---------------------------------------------------------------------------

/**
 * Fuzzy find a file from a list of paths.
 */
export async function fuzzyFindFile(
  files: string[],
  options?: FuzzyFinderOptions,
): Promise<string | undefined> {
  const items: FuzzyItem[] = files.map((f) => ({ label: f, value: f }));
  const result = await fuzzyFind(items, { ...options, prompt: "Select file:" });
  return result.selected ? result.value : undefined;
}

/**
 * Fuzzy find a command from a list of command names.
 */
export async function fuzzyFindCommand(
  commands: Array<{ name: string; description?: string }>,
  options?: FuzzyFinderOptions,
): Promise<string | undefined> {
  const items: FuzzyItem[] = commands.map((c) => ({
    label: c.name,
    value: c.name,
    description: c.description,
  }));
  const result = await fuzzyFind(items, { ...options, prompt: "Select command:" });
  return result.selected ? result.value : undefined;
}

/**
 * Fuzzy find a skill from a list of skill names.
 */
export async function fuzzyFindSkill(
  skills: Array<{ name: string; description?: string }>,
  options?: FuzzyFinderOptions,
): Promise<string | undefined> {
  const items: FuzzyItem[] = skills.map((s) => ({
    label: s.name,
    value: s.name,
    description: s.description,
  }));
  const result = await fuzzyFind(items, { ...options, prompt: "Select skill:" });
  return result.selected ? result.value : undefined;
}
