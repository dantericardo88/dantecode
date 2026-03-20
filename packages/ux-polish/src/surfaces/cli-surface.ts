/**
 * cli-surface.ts — @dantecode/ux-polish
 *
 * CLI surface adapter. Wraps RichRenderer with CLI-specific output helpers:
 * - writes directly to process.stdout
 * - manages the spinner lifecycle
 * - formats status line for terminal display
 * - handles TTY/non-TTY graceful degradation
 */

import type { RenderPayload, RenderOptions } from "../types.js";
import { RichRenderer } from "../rich-renderer.js";
import { ThemeEngine } from "../theme-engine.js";
import { spinnerFrame } from "../tokens/icon-tokens.js";

// ---------------------------------------------------------------------------
// CliSurface
// ---------------------------------------------------------------------------

export interface CliSurfaceOptions {
  theme?: ThemeEngine;
  /** If false, suppress all output (useful for testing). Default: true. */
  writeToStdout?: boolean;
}

export class CliSurface {
  private readonly renderer: RichRenderer;
  private readonly engine: ThemeEngine;
  private readonly writeToStdout: boolean;

  // Spinner state
  private _spinnerActive = false;
  private _spinnerFrame = 0;
  private _spinnerTimer: ReturnType<typeof setInterval> | null = null;
  private _spinnerMsg = "";

  constructor(options: CliSurfaceOptions = {}) {
    this.engine = options.theme ?? new ThemeEngine();
    this.renderer = new RichRenderer({ theme: this.engine });
    this.writeToStdout = options.writeToStdout ?? true;
  }

  // -------------------------------------------------------------------------
  // Rendering
  // -------------------------------------------------------------------------

  /** Render a payload and optionally write to stdout. */
  render(payload: RenderPayload, options?: RenderOptions): string {
    const result = this.renderer.render("cli", payload, options);
    if (result.rendered && this.writeToStdout) {
      this._write(result.output + "\n");
    }
    return result.output;
  }

  /** Write a line of text with optional newline. */
  writeLine(text: string, newline = true): void {
    this._write(newline ? text + "\n" : text);
  }

  /** Write a success line. */
  success(message: string): void {
    this.render({ kind: "success", content: message });
  }

  /** Write an error line. */
  error(message: string): void {
    this.render({ kind: "error", content: message });
  }

  /** Write a warning line. */
  warning(message: string): void {
    this.render({ kind: "warning", content: message });
  }

  /** Write an info line. */
  info(message: string): void {
    this.render({ kind: "info", content: message });
  }

  // -------------------------------------------------------------------------
  // Spinner
  // -------------------------------------------------------------------------

  /** Start the terminal spinner. */
  startSpinner(message: string): void {
    if (this._spinnerActive) this.stopSpinner();
    this._spinnerMsg = message;
    this._spinnerFrame = 0;
    this._spinnerActive = true;
    if (!this.writeToStdout) return; // headless — don't actually start

    this._spinnerTimer = setInterval(() => {
      const icons = this.engine.icons();
      const frame = spinnerFrame(icons, this._spinnerFrame++);
      const color = this.engine.info("");
      const reset = this.engine.reset;
      process.stdout.write(`\r${color}${frame}${reset} ${this._spinnerMsg}`);
    }, 80);
  }

  /** Update spinner message without restarting. */
  updateSpinner(message: string): void {
    this._spinnerMsg = message;
  }

  /** Stop spinner with success. */
  succeedSpinner(message?: string): void {
    this._clearSpinner();
    const icons = this.engine.icons();
    const msg = message ?? this._spinnerMsg;
    this._write(`\r${this.engine.success(icons.success + " " + msg)}\n`);
  }

  /** Stop spinner with failure. */
  failSpinner(message?: string): void {
    this._clearSpinner();
    const icons = this.engine.icons();
    const msg = message ?? this._spinnerMsg;
    this._write(`\r${this.engine.error(icons.error + " " + msg)}\n`);
  }

  /** Stop spinner silently. */
  stopSpinner(): void {
    this._clearSpinner();
    if (this.writeToStdout) {
      process.stdout.write("\r\x1b[K");
    }
  }

  /** Whether the spinner is currently active. */
  get spinnerActive(): boolean {
    return this._spinnerActive;
  }

  // -------------------------------------------------------------------------
  // Status bar
  // -------------------------------------------------------------------------

  /** Build a compact status line string for the terminal. */
  buildStatusLine(parts: Record<string, string | number | undefined>): string {
    const tokens = Object.entries(parts)
      .filter(([, v]) => v !== undefined && v !== "")
      .map(([k, v]) => `${k}:${String(v)}`);
    return this.engine.muted(`[${tokens.join(" | ")}]`);
  }

  // -------------------------------------------------------------------------
  // Private
  // -------------------------------------------------------------------------

  private _write(text: string): void {
    if (this.writeToStdout) process.stdout.write(text);
  }

  private _clearSpinner(): void {
    this._spinnerActive = false;
    if (this._spinnerTimer) {
      clearInterval(this._spinnerTimer);
      this._spinnerTimer = null;
    }
  }
}
