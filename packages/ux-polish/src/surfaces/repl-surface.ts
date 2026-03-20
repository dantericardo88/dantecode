/**
 * repl-surface.ts — @dantecode/ux-polish
 *
 * REPL surface adapter for the DanteCode shared UX engine.
 * The REPL runs interactively in a terminal session. This adapter
 * provides consistent output formatting, prompt styling, and
 * command-palette rendering appropriate for the REPL context.
 */

import type { RenderPayload, RenderOptions } from "../types.js";
import { RichRenderer } from "../rich-renderer.js";
import { ThemeEngine } from "../theme-engine.js";

// ---------------------------------------------------------------------------
// ReplSurface
// ---------------------------------------------------------------------------

export interface ReplSurfaceOptions {
  theme?: ThemeEngine;
  /** Custom prompt prefix. Default: "> " */
  promptPrefix?: string;
}

export class ReplSurface {
  private readonly _renderer: RichRenderer;
  private readonly _engine: ThemeEngine;
  private readonly _promptPrefix: string;

  constructor(options: ReplSurfaceOptions = {}) {
    this._engine = options.theme ?? new ThemeEngine();
    this._renderer = new RichRenderer({
      theme: this._engine,
    });
    this._promptPrefix = options.promptPrefix ?? "> ";
  }

  // -------------------------------------------------------------------------
  // Rendering
  // -------------------------------------------------------------------------

  /** Render a payload for REPL output. Returns formatted string. */
  render(payload: RenderPayload, options?: RenderOptions): string {
    const result = this._renderer.render("repl", payload, options);
    return result.output;
  }

  /** Format and write a response block (model output). */
  formatResponse(text: string): string {
    return this.render({ kind: "markdown", content: text });
  }

  /** Format a REPL prompt line. */
  formatPrompt(context?: { model?: string; tokens?: number }): string {
    const e = this._engine;
    const parts: string[] = [];
    if (context?.model) parts.push(e.muted(context.model));
    if (context?.tokens !== undefined) parts.push(e.muted(`${context.tokens}t`));
    const contextStr = parts.length ? ` ${parts.join(" ")}` : "";
    return `${e.info(this._promptPrefix)}${contextStr} `;
  }

  /** Format a command echo (show what was typed). */
  formatCommandEcho(command: string): string {
    return this._engine.muted(`← ${command}`);
  }

  /** Format a thinking/reasoning indicator. */
  formatThinking(phase?: string): string {
    const label = phase ? `Thinking: ${phase}` : "Thinking…";
    return this._engine.progressColor(label);
  }

  /** Format a PDSE inline display. */
  formatPdseInline(score: number, label?: string): string {
    const e = this._engine;
    const lbl = label ?? "pdse";
    const scoreStr = score.toFixed(2);
    if (score >= 0.8) return e.success(`[${lbl}:${scoreStr}]`);
    if (score >= 0.5) return e.warning(`[${lbl}:${scoreStr}]`);
    return e.error(`[${lbl}:${scoreStr}]`);
  }

  // -------------------------------------------------------------------------
  // Session separators
  // -------------------------------------------------------------------------

  /** Horizontal rule for visual separation between exchanges. */
  separator(): string {
    return this._engine.muted("─".repeat(60));
  }

  /** Header for a new session. */
  sessionHeader(sessionId: string): string {
    return this._engine.boldText(`Session: ${sessionId}`);
  }
}
