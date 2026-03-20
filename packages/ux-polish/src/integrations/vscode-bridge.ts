/**
 * vscode-bridge.ts — @dantecode/ux-polish
 *
 * G15 — VS Code polish weld.
 * Bridges VscodeSurface to the VS Code extension's sidebar/status bar,
 * ensuring shared theme and consistent messaging across IDE and CLI surfaces.
 */

import { VscodeSurface } from "../surfaces/vscode-surface.js";
import type { VscodeMessage, VscodeMessageKind, StatusBarItem } from "../surfaces/vscode-surface.js";
import type { ThemeEngine } from "../theme-engine.js";
import type { ProgressState, UXSuggestion } from "../types.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** A segment of status bar content. */
export interface StatusBarPart {
  text: string;
  tooltip?: string;
  command?: string;
  priority?: number;
}

/** Sidebar panel definition. */
export interface SidebarPanel {
  id: string;
  title: string;
  items: SidebarItem[];
}

/** An item within a sidebar panel. */
export interface SidebarItem {
  label: string;
  detail?: string;
  icon?: string;
  command?: string;
  collapsible?: boolean;
  children?: SidebarItem[];
}

export interface VscodeBridgeOptions {
  /** VscodeSurface instance to drive. */
  surface: VscodeSurface;
  /** Optional postMessage handler (wired to VSCode webview in real extension). */
  onMessage?: (msg: VscodeMessage) => void;
  /** ThemeEngine for consistent color/icon mapping. */
  theme?: ThemeEngine;
}

// ---------------------------------------------------------------------------
// VscodeBridge
// ---------------------------------------------------------------------------

/**
 * Bridges the shared UX engine to the VSCode extension runtime.
 *
 * Ensures:
 * - Sidebar/status bar use the shared theme and messaging
 * - No separate "preview-feel" UX island in VS Code
 * - Consistent status language across IDE and CLI surfaces
 */
export class VscodeBridge {
  private _surface: VscodeSurface;
  private _onMessage: ((msg: VscodeMessage) => void) | undefined;
  private _theme: ThemeEngine | undefined;

  constructor(opts: VscodeBridgeOptions) {
    this._surface = opts.surface;
    this._onMessage = opts.onMessage;
    this._theme = opts.theme;
  }

  /**
   * Synchronizes the ThemeEngine state to VSCode — sends a theme-changed message
   * so the webview can update CSS variables / icon sets.
   */
  syncTheme(theme: ThemeEngine): void {
    this._theme = theme;
    const msg: VscodeMessage = {
      kind: "render" as VscodeMessageKind,
      payload: {
        type: "theme-sync",
        name: theme.name,
        colors: theme.resolve().colors,
      },
      timestamp: new Date().toISOString(),
    };
    this._dispatch(msg);
  }

  /**
   * Builds a sidebar panel message from a title + item list.
   * Uses shared theme icons for visual consistency.
   */
  buildSidebarPanel(panel: SidebarPanel): VscodeMessage {
    const msg: VscodeMessage = {
      kind: "render" as VscodeMessageKind,
      payload: {
        type: "sidebar-panel",
        id: panel.id,
        title: panel.title,
        items: panel.items,
      },
      timestamp: new Date().toISOString(),
    };
    this._dispatch(msg);
    return msg;
  }

  /**
   * Builds a status bar segment from structured parts.
   * Returns a StatusBarItem using shared theme for the active state icon.
   */
  buildStatusBarSegment(parts: StatusBarPart[]): StatusBarItem {
    const text = parts.map((p) => p.text).join("  ");
    const tooltip = parts
      .filter((p) => p.tooltip)
      .map((p) => p.tooltip)
      .join(" | ");

    const diamond = this._theme
      ? `${this._theme.color("info")}◆${this._theme.reset}`
      : "◆";
    const item: StatusBarItem = {
      text: this._theme ? `${diamond} ${text}` : text,
      tooltip: tooltip || undefined,
      command: parts.find((p) => p.command)?.command,
    };

    this._surface.updateStatusBar(item);
    return item;
  }

  /**
   * Renders a progress state to the VSCode status bar and progress area.
   * Uses the same ProgressState shape as CLI/REPL surfaces.
   */
  renderProgress(state: ProgressState): void {
    this._surface.sendProgress(state);

    // Mirror to status bar with consistent language
    const icon = state.status === "completed" ? "✓" : state.status === "failed" ? "✗" : "⟳";
    const pct = state.progress !== undefined ? ` ${state.progress}%` : "";
    this._surface.updateStatusBar({
      text: `${icon} ${state.phase}${pct}`,
      tooltip: state.message,
    });
  }

  /**
   * Sends contextual suggestions to the VSCode suggestion panel.
   */
  renderSuggestions(suggestions: UXSuggestion[]): void {
    this._surface.sendSuggestions(suggestions);
  }

  /**
   * Sends a PDSE score to the VSCode trust indicator.
   */
  renderPdseScore(score: number, label?: string): void {
    this._surface.sendPdseScore(score, label);
  }

  /**
   * Returns all messages sent via this bridge (for testing).
   */
  getMessageLog(): VscodeMessage[] {
    return this._surface.getMessageLog();
  }

  /**
   * Clears the message log.
   */
  clearLog(): void {
    this._surface.clearLog();
  }

  // ---------------------------------------------------------------------------
  // Private
  // ---------------------------------------------------------------------------

  private _dispatch(msg: VscodeMessage): void {
    if (this._onMessage) this._onMessage(msg);
  }
}
