// ============================================================================
// @dantecode/cli — Stream Renderer
// Renders streaming model output to the CLI with ANSI formatting.
// Enhanced: markdown rendering, PDSE inline display, tool-call annotations,
// rich mode with section headers and separator lines.
// ============================================================================

import { UXEngine } from "@dantecode/core";
import type { ThemeName } from "@dantecode/core";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface StreamRendererOptions {
  silent?: boolean;
  /** Enable rich markdown rendering (headers, bold, bullets). Default: false. */
  richMode?: boolean;
  /** Theme name for UXEngine. Default: "default". */
  theme?: ThemeName;
  /** ANSI color output. Default: true. */
  colors?: boolean;
  /** Model label shown in header (e.g. "grok/grok-3"). */
  modelLabel?: string;
  /** Reasoning tier to display in header (quick/deep/expert). */
  reasoningTier?: string;
  /** Thinking token budget to display in header. */
  thinkingBudget?: number;
}

export interface FinishOptions {
  /** If provided, renders a PDSE score footer after the response. */
  pdseScore?: number;
  /** Elapsed time in ms. */
  elapsedMs?: number;
  /** Number of tokens used. */
  tokens?: number;
}

export interface ToolAnnotation {
  kind: "start" | "end" | "blocked";
  toolName: string;
  detail?: string;
}

// ---------------------------------------------------------------------------
// StreamRenderer
// ---------------------------------------------------------------------------

export class StreamRenderer {
  private buffer = "";
  private headerPrinted = false;
  private toolLineCount = 0;
  private readonly silent: boolean;
  private readonly richMode: boolean;
  private readonly colors: boolean;
  private readonly modelLabel: string;
  private readonly ux: UXEngine;
  private readonly reasoningTier: string | undefined;
  private readonly thinkingBudget: number | undefined;

  constructor(options: StreamRendererOptions | boolean = false) {
    // Backward compat: `new StreamRenderer(true)` = silent
    if (typeof options === "boolean") {
      this.silent = options;
      this.richMode = false;
      this.colors = true;
      this.modelLabel = "DanteCode";
      this.ux = new UXEngine();
      this.reasoningTier = undefined;
      this.thinkingBudget = undefined;
    } else {
      this.silent = options.silent ?? false;
      this.richMode = options.richMode ?? false;
      this.colors = options.colors ?? true;
      this.modelLabel = options.modelLabel ?? "DanteCode";
      this.ux = new UXEngine({ theme: options.theme ?? "default", colors: this.colors });
      this.reasoningTier = options.reasoningTier;
      this.thinkingBudget = options.thinkingBudget;
    }
  }

  // -------------------------------------------------------------------------
  // Core streaming
  // -------------------------------------------------------------------------

  /**
   * Called once before streaming begins to print the response header.
   */
  printHeader(): void {
    if (this.silent || this.headerPrinted) return;
    this.headerPrinted = true;

    const CYAN = this.colors ? "\x1b[36m" : "";
    const BOLD = this.colors ? "\x1b[1m" : "";
    const DIM = this.colors ? "\x1b[2m" : "";
    const RESET = this.colors ? "\x1b[0m" : "";

    const label = this.modelLabel !== "DanteCode" ? ` ${DIM}(${this.modelLabel})${RESET}` : "";

    let tierSuffix = "";
    if (this.reasoningTier) {
      const YELLOW = this.colors ? "\x1b[33m" : "";
      const RED = this.colors ? "\x1b[31m" : "";
      const tierLabel =
        this.reasoningTier === "quick"
          ? `${CYAN}⚡ quick${RESET}`
          : this.reasoningTier === "deep"
            ? `${YELLOW}🧠 deep${RESET}`
            : this.reasoningTier === "expert"
              ? `${RED}🔬 expert${RESET}`
              : this.reasoningTier;
      tierSuffix = ` [${tierLabel}]`;
      if (this.thinkingBudget !== undefined) {
        tierSuffix += ` ${DIM}(${this.thinkingBudget.toLocaleString()} thinking tokens)${RESET}`;
      }
    }

    process.stdout.write(`\n${CYAN}${BOLD}DanteCode${RESET}${label}${tierSuffix}\n\n`);
  }

  /**
   * Write a token chunk to the output.
   * In silent mode, buffers only (no stdout output).
   * In richMode, tokens are buffered and flushed line-by-line for markdown rendering.
   */
  write(token: string): void {
    this.buffer += token;
    if (this.silent) return;

    if (this.richMode) {
      // Flush complete lines for markdown rendering; hold incomplete last line
      this._flushLines();
    } else {
      process.stdout.write(token);
    }
  }

  /**
   * Returns the complete buffered response text (raw, no ANSI).
   */
  getFullText(): string {
    return this.buffer;
  }

  /**
   * Resets the buffer for a new streaming session.
   */
  reset(): void {
    this.buffer = "";
    this.headerPrinted = false;
    this.toolLineCount = 0;
    this._richLineBuffer = "";
  }

  /**
   * Finishes the response stream.
   * Flushes any remaining rich buffer, adds a trailing newline,
   * and optionally renders a PDSE score footer.
   */
  finish(options: FinishOptions = {}): void {
    if (this.silent) return;

    if (this.richMode && this._richLineBuffer) {
      // Flush the incomplete last line
      const rendered = this.ux.formatMarkdown(this._richLineBuffer);
      process.stdout.write(rendered);
      this._richLineBuffer = "";
    }

    if (this.buffer.length > 0) {
      process.stdout.write("\n");
    }

    if (options.pdseScore !== undefined || options.elapsedMs !== undefined || options.tokens !== undefined) {
      this._renderFooter(options);
    }
  }

  // -------------------------------------------------------------------------
  // Tool annotation display
  // -------------------------------------------------------------------------

  /**
   * Render a tool-call annotation inline (start/end/blocked).
   * Does nothing in silent mode.
   */
  annotateToolCall(annotation: ToolAnnotation): void {
    if (this.silent) return;

    const DIM = this.colors ? "\x1b[2m" : "";
    const CYAN = this.colors ? "\x1b[36m" : "";
    const YELLOW = this.colors ? "\x1b[33m" : "";
    const RED = this.colors ? "\x1b[31m" : "";
    const RESET = this.colors ? "\x1b[0m" : "";

    const detail = annotation.detail ? ` ${DIM}${annotation.detail}${RESET}` : "";

    switch (annotation.kind) {
      case "start":
        this.toolLineCount++;
        process.stdout.write(`\n${CYAN}  ▶ ${annotation.toolName}${RESET}${detail}\n`);
        break;
      case "end":
        process.stdout.write(`${CYAN}  ✓ ${annotation.toolName}${RESET}${detail}\n`);
        break;
      case "blocked":
        process.stdout.write(`\n${RED}  ✗ ${annotation.toolName} blocked${RESET}${detail}\n`);
        break;
    }

    // small visual separator after first tool
    if (this.toolLineCount === 1 && annotation.kind === "start") {
      process.stdout.write(`${DIM}${YELLOW}${"─".repeat(40)}${RESET}\n`);
    }
  }

  /**
   * Print a PDSE confidence score inline (e.g. after a verification step).
   */
  showPdseScore(score: number, context?: string): void {
    if (this.silent) return;
    const hint = this.ux.generateHint(score, context);
    const statusLine = this.ux.buildStatusLine({ pdseScore: score });
    const DIM = this.colors ? "\x1b[2m" : "";
    const RESET = this.colors ? "\x1b[0m" : "";
    process.stdout.write(`\n${DIM}${statusLine}${RESET}  ${hint}\n`);
  }

  /**
   * Print a section separator with an optional label.
   */
  printSeparator(label?: string): void {
    if (this.silent) return;
    const DIM = this.colors ? "\x1b[2m" : "";
    const RESET = this.colors ? "\x1b[0m" : "";
    const line = label
      ? `${"─".repeat(4)} ${label} ${"─".repeat(Math.max(0, 38 - label.length))}`
      : "─".repeat(44);
    process.stdout.write(`\n${DIM}${line}${RESET}\n\n`);
  }

  // -------------------------------------------------------------------------
  // Private: rich-mode line buffering
  // -------------------------------------------------------------------------

  private _richLineBuffer = "";

  private _flushLines(): void {
    // Find all complete lines (ending with \n) in _richLineBuffer + new additions
    const combined = this._richLineBuffer + (this.buffer.slice(-(this.buffer.length)));
    // We track incrementally — only process what was added to buffer
    const tail = this.buffer;
    const nlIdx = tail.lastIndexOf("\n");
    if (nlIdx === -1) {
      // No complete line yet — accumulate
      this._richLineBuffer = tail;
      return;
    }

    const complete = tail.slice(0, nlIdx + 1);
    this._richLineBuffer = tail.slice(nlIdx + 1);

    const rendered = this.ux.formatMarkdown(complete);
    process.stdout.write(rendered);
    void combined; // suppress unused warning
  }

  // -------------------------------------------------------------------------
  // Private: footer
  // -------------------------------------------------------------------------

  private _renderFooter(opts: FinishOptions): void {
    const parts: string[] = [];
    if (opts.pdseScore !== undefined) parts.push(`pdse:${opts.pdseScore.toFixed(2)}`);
    if (opts.tokens !== undefined) parts.push(`tokens:${opts.tokens}`);
    if (opts.elapsedMs !== undefined) parts.push(`${opts.elapsedMs}ms`);

    const DIM = this.colors ? "\x1b[2m" : "";
    const RESET = this.colors ? "\x1b[0m" : "";
    process.stdout.write(`${DIM}[${parts.join(" | ")}]${RESET}\n`);
  }
}
