/**
 * menu.ts - Interactive CLI Menu Component
 *
 * Keyboard-navigable menu with search/filter, single/multi-select modes.
 * Uses readline for cross-platform keyboard input.
 *
 * @example
 * ```typescript
 * const result = await showMenu({
 *   title: 'Select files',
 *   items: [
 *     { label: 'file1.ts', value: 'file1.ts' },
 *     { label: 'file2.ts', value: 'file2.ts' },
 *   ],
 *   multi: true,
 * });
 * ```
 */

import { createInterface } from "node:readline";
import type { ThemeEngine } from "../theme-engine.js";

export interface MenuItem<T = unknown> {
  label: string;
  value: T;
  description?: string;
  disabled?: boolean;
}

export interface MenuOptions<T = unknown> {
  title: string;
  items: MenuItem<T>[];
  multi?: boolean; // Multi-select mode
  searchable?: boolean; // Enable search/filter
  defaultIndex?: number; // Default selected index
  theme?: ThemeEngine;
  pageSize?: number; // Number of items to show per page
}

/** ANSI codes */
const COLORS = {
  cyan: "\x1b[36m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  dim: "\x1b[2m",
  reset: "\x1b[0m",
};

const SYMBOLS = {
  selected: "❯",
  unselected: " ",
  checked: "◉",
  unchecked: "◯",
};

/**
 * Show interactive menu and return selected item(s)
 * @returns Selected value(s) or null if cancelled
 */
export async function showMenu<T>(options: MenuOptions<T>): Promise<T | T[] | null> {
  // If not TTY, fallback to simple selection
  if (!process.stdin.isTTY) {
    return options.multi ? [] : null;
  }

  const menu = new Menu(options);
  return menu.show();
}

/**
 * Internal Menu class
 */
class Menu<T> {
  private items: MenuItem<T>[];
  private filteredItems: MenuItem<T>[];
  private title: string;
  private multi: boolean;
  private searchable: boolean;
  private pageSize: number;
  private selectedIndex = 0;
  private selectedValues = new Set<T>();
  private searchQuery = "";
  private rl: ReturnType<typeof createInterface> | null = null;

  constructor(options: MenuOptions<T>) {
    this.title = options.title;
    this.items = options.items;
    this.filteredItems = [...options.items];
    this.multi = options.multi ?? false;
    this.searchable = options.searchable ?? true;
    this.pageSize = options.pageSize ?? 10;
    this.selectedIndex = options.defaultIndex ?? 0;
  }

  async show(): Promise<T | T[] | null> {
    // Set up readline
    this.rl = createInterface({
      input: process.stdin,
      output: process.stdout,
      terminal: true,
    });

    // Enable raw mode for key capture
    if (process.stdin.isTTY) {
      process.stdin.setRawMode(true);
    }

    this.render();

    return new Promise((resolve) => {
      if (!this.rl) {
        resolve(null);
        return;
      }

      process.stdin.on("data", (key: Buffer) => {
        const char = key.toString();

        // Handle special keys
        if (char === "\x03") {
          // Ctrl+C
          this.cleanup();
          resolve(null);
        } else if (char === "\x1b") {
          // Escape
          this.cleanup();
          resolve(null);
        } else if (char === "\r" || char === "\n") {
          // Enter
          const result = this.getSelection();
          this.cleanup();
          resolve(result);
        } else if (char === " " && this.multi) {
          // Space (toggle in multi-select)
          this.toggleSelection();
          this.render();
        } else if (char === "\x1b[A" || char === "k") {
          // Up arrow or k
          this.moveUp();
          this.render();
        } else if (char === "\x1b[B" || char === "j") {
          // Down arrow or j
          this.moveDown();
          this.render();
        } else if (char === "/" && this.searchable) {
          // Start search (not implemented in basic version)
          // Would show search input
        } else if (this.searchable && char.length === 1 && /[a-zA-Z0-9]/.test(char)) {
          // Search as you type
          this.searchQuery += char;
          this.updateFilter();
          this.render();
        } else if (char === "\x7f" || char === "\x08") {
          // Backspace
          if (this.searchQuery.length > 0) {
            this.searchQuery = this.searchQuery.slice(0, -1);
            this.updateFilter();
            this.render();
          }
        }
      });
    });
  }

  private moveUp(): void {
    if (this.selectedIndex > 0) {
      this.selectedIndex--;
      // Skip disabled items
      while (
        this.selectedIndex > 0 &&
        this.filteredItems[this.selectedIndex]?.disabled
      ) {
        this.selectedIndex--;
      }
    }
  }

  private moveDown(): void {
    if (this.selectedIndex < this.filteredItems.length - 1) {
      this.selectedIndex++;
      // Skip disabled items
      while (
        this.selectedIndex < this.filteredItems.length - 1 &&
        this.filteredItems[this.selectedIndex]?.disabled
      ) {
        this.selectedIndex++;
      }
    }
  }

  private toggleSelection(): void {
    const item = this.filteredItems[this.selectedIndex];
    if (!item || item.disabled) return;

    if (this.selectedValues.has(item.value)) {
      this.selectedValues.delete(item.value);
    } else {
      this.selectedValues.add(item.value);
    }
  }

  private updateFilter(): void {
    if (this.searchQuery === "") {
      this.filteredItems = [...this.items];
    } else {
      const query = this.searchQuery.toLowerCase();
      this.filteredItems = this.items.filter((item) =>
        item.label.toLowerCase().includes(query)
      );
    }

    // Clamp selected index
    if (this.selectedIndex >= this.filteredItems.length) {
      this.selectedIndex = Math.max(0, this.filteredItems.length - 1);
    }
  }

  private getSelection(): T | T[] | null {
    if (this.multi) {
      return Array.from(this.selectedValues);
    } else {
      const item = this.filteredItems[this.selectedIndex];
      return item ? item.value : null;
    }
  }

  private render(): void {
    // Clear screen
    process.stdout.write("\x1b[2J\x1b[H");

    // Title
    process.stdout.write(`${COLORS.cyan}${this.title}${COLORS.reset}\n\n`);

    // Search query (if active)
    if (this.searchQuery) {
      process.stdout.write(`${COLORS.dim}Search: ${this.searchQuery}${COLORS.reset}\n\n`);
    }

    // Items
    const start = Math.max(0, this.selectedIndex - Math.floor(this.pageSize / 2));
    const end = Math.min(this.filteredItems.length, start + this.pageSize);

    for (let i = start; i < end; i++) {
      const item = this.filteredItems[i];
      if (!item) continue;

      const isSelected = i === this.selectedIndex;
      const isChecked = this.selectedValues.has(item.value);
      const isDisabled = item.disabled ?? false;

      const cursor = isSelected ? SYMBOLS.selected : SYMBOLS.unselected;
      const checkbox = this.multi
        ? isChecked
          ? SYMBOLS.checked
          : SYMBOLS.unchecked
        : "";

      const color = isSelected ? COLORS.green : isDisabled ? COLORS.dim : "";
      const reset = color ? COLORS.reset : "";

      const line = `${cursor} ${checkbox} ${color}${item.label}${reset}`;
      process.stdout.write(`${line}\n`);

      if (item.description && isSelected) {
        process.stdout.write(`  ${COLORS.dim}${item.description}${COLORS.reset}\n`);
      }
    }

    // Help text
    process.stdout.write(`\n${COLORS.dim}↑↓: Navigate | Enter: Select | Esc: Cancel`);
    if (this.multi) {
      process.stdout.write(` | Space: Toggle`);
    }
    if (this.searchable) {
      process.stdout.write(` | Type to search`);
    }
    process.stdout.write(`${COLORS.reset}\n`);
  }

  private cleanup(): void {
    if (process.stdin.isTTY) {
      process.stdin.setRawMode(false);
    }

    if (this.rl) {
      this.rl.close();
      this.rl = null;
    }

    process.stdin.removeAllListeners("data");

    // Clear screen and move cursor to top
    process.stdout.write("\x1b[2J\x1b[H");
  }
}
