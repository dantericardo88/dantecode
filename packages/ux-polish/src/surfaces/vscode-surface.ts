/**
 * vscode-surface.ts — @dantecode/ux-polish
 *
 * VS Code surface adapter for the DanteCode shared UX engine.
 * Maps UX engine output to VS Code webview/sidebar-compatible messages.
 * Does NOT import VS Code APIs (runs in both webview and tests).
 */

import type { RenderPayload, ProgressState, UXSuggestion } from "../types.js";
import { ThemeEngine } from "../theme-engine.js";

// ---------------------------------------------------------------------------
// VS Code message types (serializable — sent to webview)
// ---------------------------------------------------------------------------

export type VscodeMessageKind =
  | "render"
  | "progress"
  | "suggestion"
  | "status-bar"
  | "error"
  | "success"
  | "warning"
  | "info"
  | "pdse";

export interface VscodeMessage {
  kind: VscodeMessageKind;
  payload: unknown;
  timestamp: string;
}

export interface StatusBarItem {
  text: string;
  tooltip?: string;
  /** "success" | "warning" | "error" | "info" | "default" */
  color?: string;
  command?: string;
}

// ---------------------------------------------------------------------------
// VscodeSurface
// ---------------------------------------------------------------------------

export interface VscodeSurfaceOptions {
  theme?: ThemeEngine;
  /** Post message callback (inject VS Code API reference). */
  postMessage?: (msg: VscodeMessage) => void;
}

export class VscodeSurface {
  private readonly _engine: ThemeEngine;
  private readonly _postMessage: ((msg: VscodeMessage) => void) | undefined;
  private readonly _messageLog: VscodeMessage[] = [];

  constructor(options: VscodeSurfaceOptions = {}) {
    this._engine = options.theme ?? new ThemeEngine({ colors: false });
    this._postMessage = options.postMessage;
  }

  // -------------------------------------------------------------------------
  // Rendering
  // -------------------------------------------------------------------------

  /** Send a render payload to the VS Code webview. */
  render(payload: RenderPayload): VscodeMessage {
    const msg = this._emit("render", { payload });
    return msg;
  }

  /** Send a progress update to the sidebar. */
  sendProgress(state: ProgressState): VscodeMessage {
    return this._emit("progress", state);
  }

  /** Send contextual suggestions to the sidebar. */
  sendSuggestions(suggestions: UXSuggestion[]): VscodeMessage {
    return this._emit("suggestion", { suggestions });
  }

  /** Update the VS Code status bar. */
  updateStatusBar(item: StatusBarItem): VscodeMessage {
    return this._emit("status-bar", item);
  }

  /** Send a PDSE score update. */
  sendPdseScore(score: number, label?: string, context?: string): VscodeMessage {
    return this._emit("pdse", { score, label: label ?? "pdse", context });
  }

  // -------------------------------------------------------------------------
  // Convenience formatters (for sidebar text rendering)
  // -------------------------------------------------------------------------

  /** Format a success message as sidebar-safe text. */
  formatSuccess(msg: string): string {
    const icons = this._engine.icons();
    return `${icons.success} ${msg}`;
  }

  /** Format an error message as sidebar-safe text. */
  formatError(msg: string): string {
    const icons = this._engine.icons();
    return `${icons.error} ${msg}`;
  }

  /** Format a progress line for sidebar display. */
  formatProgressLine(state: ProgressState): string {
    const icons = this._engine.icons();
    const statusIcon =
      state.status === "completed" ? icons.success :
      state.status === "failed"    ? icons.error :
      state.status === "running"   ? icons.running :
      state.status === "paused"    ? icons.paused :
      icons.pending;

    const pctStr = state.progress !== undefined ? ` (${state.progress}%)` : "";
    const msgStr = state.message ? ` — ${state.message}` : "";
    return `${statusIcon} ${state.phase}${pctStr}${msgStr}`;
  }

  /**
   * Build a status bar item from session context.
   */
  buildStatusBarItem(opts: {
    model?: string;
    pdseScore?: number;
    activeTask?: string;
    tokens?: number;
  }): StatusBarItem {
    const parts: string[] = [];
    if (opts.model) parts.push(`$(sparkle) ${opts.model}`);
    if (opts.pdseScore !== undefined) parts.push(`PDSE:${opts.pdseScore.toFixed(2)}`);
    if (opts.activeTask) parts.push(`$(sync~spin) ${opts.activeTask}`);
    if (opts.tokens !== undefined) parts.push(`${opts.tokens}t`);

    const colorKey =
      (opts.pdseScore ?? 1) >= 0.8 ? "success" :
      (opts.pdseScore ?? 1) >= 0.5 ? "warning" :
      "error";

    return {
      text: parts.join(" | ") || "DanteCode",
      tooltip: "DanteCode Status",
      color: colorKey,
      command: "dantecode.openSidebar",
    };
  }

  // -------------------------------------------------------------------------
  // Log access
  // -------------------------------------------------------------------------

  /** Get all messages sent during this session (for testing). */
  getMessageLog(): VscodeMessage[] {
    return [...this._messageLog];
  }

  /** Clear the message log. */
  clearLog(): void {
    this._messageLog.length = 0;
  }

  // -------------------------------------------------------------------------
  // Private
  // -------------------------------------------------------------------------

  private _emit(kind: VscodeMessageKind, payload: unknown): VscodeMessage {
    const msg: VscodeMessage = { kind, payload, timestamp: new Date().toISOString() };
    this._messageLog.push(msg);
    this._postMessage?.(msg);
    return msg;
  }
}
