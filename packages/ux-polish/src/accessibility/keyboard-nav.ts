/**
 * keyboard-nav.ts — @dantecode/ux-polish
 *
 * Keyboard navigation model for interactive CLI flows.
 * Provides key binding definitions, handler registration,
 * and navigation state for menus and wizard steps.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type NavKey =
  | "up"
  | "down"
  | "left"
  | "right"
  | "enter"
  | "escape"
  | "tab"
  | "shift+tab"
  | "space"
  | "ctrl+c"
  | "ctrl+z";

export interface KeyBinding {
  key: NavKey | string;
  description: string;
  action: string;
}

export interface NavState {
  /** Currently focused item index. */
  focusIndex: number;
  /** Total number of items in the nav list. */
  totalItems: number;
  /** Whether the navigation is active (listening for keys). */
  active: boolean;
}

export type KeyHandler = (key: NavKey | string, state: NavState) => NavState | null;

// ---------------------------------------------------------------------------
// Standard key bindings
// ---------------------------------------------------------------------------

/** Standard keyboard shortcuts for CLI interactive flows. */
export const STANDARD_BINDINGS: KeyBinding[] = [
  { key: "up", description: "Move selection up", action: "move_up" },
  { key: "down", description: "Move selection down", action: "move_down" },
  { key: "enter", description: "Confirm selection", action: "confirm" },
  { key: "escape", description: "Cancel / go back", action: "cancel" },
  { key: "tab", description: "Move to next field", action: "next_field" },
  { key: "shift+tab", description: "Move to previous field", action: "prev_field" },
  { key: "space", description: "Toggle selection", action: "toggle" },
  { key: "ctrl+c", description: "Exit immediately", action: "exit" },
  { key: "ctrl+z", description: "Undo last action", action: "undo" },
];

// ---------------------------------------------------------------------------
// NavController
// ---------------------------------------------------------------------------

export interface NavControllerOptions {
  /** Total items in the initial list. */
  totalItems?: number;
  /** Initial focus index. Default: 0. */
  initialIndex?: number;
  /** Whether to wrap around at boundaries. Default: true. */
  wrap?: boolean;
}

export class NavController {
  private _state: NavState;
  private readonly _wrap: boolean;
  private readonly _handlers: KeyHandler[] = [];

  constructor(options: NavControllerOptions = {}) {
    this._state = {
      focusIndex: options.initialIndex ?? 0,
      totalItems: options.totalItems ?? 0,
      active: false,
    };
    this._wrap = options.wrap ?? true;
  }

  // -------------------------------------------------------------------------
  // State management
  // -------------------------------------------------------------------------

  /** Activate navigation (start listening). */
  activate(): void {
    this._state = { ...this._state, active: true };
  }

  /** Deactivate navigation. */
  deactivate(): void {
    this._state = { ...this._state, active: false };
  }

  /** Update total items (e.g. when list changes). */
  setTotalItems(n: number): void {
    this._state = {
      ...this._state,
      totalItems: n,
      focusIndex: Math.min(this._state.focusIndex, Math.max(0, n - 1)),
    };
  }

  /** Get current navigation state. */
  getState(): NavState {
    return { ...this._state };
  }

  // -------------------------------------------------------------------------
  // Key handling
  // -------------------------------------------------------------------------

  /** Register a custom key handler. Returns unsubscribe function. */
  onKey(handler: KeyHandler): () => void {
    this._handlers.push(handler);
    return () => {
      const idx = this._handlers.indexOf(handler);
      if (idx >= 0) this._handlers.splice(idx, 1);
    };
  }

  /**
   * Process a key press. Returns updated state, or null if key was not handled.
   */
  handleKey(key: NavKey | string): NavState | null {
    // Custom handlers first
    for (const handler of this._handlers) {
      const result = handler(key, this._state);
      if (result !== null) {
        this._state = result;
        return { ...this._state };
      }
    }

    // Built-in navigation
    switch (key) {
      case "up": {
        const idx = this._state.focusIndex - 1;
        const next = idx < 0 ? (this._wrap ? this._state.totalItems - 1 : 0) : idx;
        this._state = { ...this._state, focusIndex: next };
        return { ...this._state };
      }
      case "down": {
        const idx = this._state.focusIndex + 1;
        const next =
          idx >= this._state.totalItems ? (this._wrap ? 0 : this._state.totalItems - 1) : idx;
        this._state = { ...this._state, focusIndex: next };
        return { ...this._state };
      }
      case "ctrl+c":
        this._state = { ...this._state, active: false };
        return { ...this._state };
      default:
        return null;
    }
  }

  // -------------------------------------------------------------------------
  // Rendering
  // -------------------------------------------------------------------------

  /**
   * Format a list of items with a focus indicator.
   * Focused item shows a highlight prefix.
   */
  renderList(
    items: string[],
    options: { focusPrefix?: string; normalPrefix?: string; colors?: boolean } = {},
  ): string {
    const fp = options.focusPrefix ?? "▶ ";
    const np = options.normalPrefix ?? "  ";
    const colors = options.colors ?? true;

    const HIGHLIGHT = colors ? "\x1b[1m\x1b[36m" : "";
    const RESET = colors ? "\x1b[0m" : "";

    return items
      .map((item, i) => {
        const prefix = i === this._state.focusIndex ? fp : np;
        const color = i === this._state.focusIndex ? HIGHLIGHT : "";
        return `${color}${prefix}${item}${RESET}`;
      })
      .join("\n");
  }

  /**
   * Format a key binding help line.
   */
  static formatBindings(bindings: KeyBinding[] = STANDARD_BINDINGS): string {
    return bindings.map((b) => `  ${b.key.padEnd(12)} ${b.description}`).join("\n");
  }
}
