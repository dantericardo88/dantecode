// ============================================================================
// @dantecode/cli — Stream Renderer
// Renders streaming model output to the CLI with ANSI formatting.
// Enhanced: markdown rendering, PDSE inline display, tool-call annotations,
// rich mode with section headers and separator lines.
// ============================================================================

import { UXEngine } from "@dantecode/core";
import type { ThemeName } from "@dantecode/core";
import { renderDiff, Spinner, RichRenderer } from "@dantecode/ux-polish";

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
  /** Context window utilization percentage (0-100) shown in header. */
  contextPercent?: number;
  /** Budget tier for color coding the context gauge (green/yellow/red/critical). */
  budgetTier?: "green" | "yellow" | "red" | "critical";
}

export interface FinishOptions {
  /** If provided, renders a PDSE score footer after the response. */
  pdseScore?: number;
  /** Elapsed time in ms. */
  elapsedMs?: number;
  /** Number of tokens used. */
  tokens?: number;
  /** Context window utilization percentage to show in footer. */
  contextPercent?: number;
  /** Budget tier for footer color coding. */
  budgetTier?: "green" | "yellow" | "red" | "critical";
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
  private readonly contextPercent: number | undefined;
  private readonly budgetTier: "green" | "yellow" | "red" | "critical" | undefined;
  /** Shared RichRenderer instance for inline markdown line coloring (non-richMode path). */
  private readonly _richRenderer: RichRenderer = new RichRenderer();
  /** Buffer for current incomplete line (non-richMode markdown routing). */
  private _lineBuffer = "";
  /** Spinner shown during inference wait (before first token). */
  private _thinkingSpinner: Spinner | null = null;
  /** Whether first token has arrived (spinner cleared). */
  private _firstTokenReceived = false;
  /** Timestamp when the thinking spinner was started. */
  private _spinnerStartTime = 0;
  /** Interval handle for multi-phase spinner label updates. */
  private _spinnerInterval: NodeJS.Timeout | null = null;

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
      this.contextPercent = undefined;
      this.budgetTier = undefined;
    } else {
      this.silent = options.silent ?? false;
      this.richMode = options.richMode ?? false;
      this.colors = options.colors ?? true;
      this.modelLabel = options.modelLabel ?? "DanteCode";
      this.ux = new UXEngine({ theme: options.theme ?? "default", colors: this.colors });
      this.reasoningTier = options.reasoningTier;
      this.thinkingBudget = options.thinkingBudget;
      this.contextPercent = options.contextPercent;
      this.budgetTier = options.budgetTier;
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

    let contextGauge = "";
    if (this.contextPercent !== undefined) {
      const pct = Math.round(this.contextPercent);
      const barWidth = 20;
      const filled = Math.round((pct / 100) * barWidth);
      const bar = "█".repeat(filled) + "░".repeat(barWidth - filled);
      const tierColor =
        this.budgetTier === "critical"
          ? this.colors ? "\x1b[31m" : ""  // red
          : this.budgetTier === "red"
            ? this.colors ? "\x1b[33m" : ""  // yellow
            : this.budgetTier === "yellow"
              ? this.colors ? "\x1b[33m" : ""  // yellow
              : this.colors ? "\x1b[32m" : ""; // green
      contextGauge = `  ${DIM}ctx${RESET} ${tierColor}${bar}${RESET} ${DIM}${pct}%${RESET}`;
    }

    process.stdout.write(`\n${CYAN}${BOLD}DanteCode${RESET}${label}${tierSuffix}${contextGauge}\n\n`);
  }

  /**
   * Start the "Thinking..." spinner before the first token arrives.
   * Uses a multi-phase label that evolves over time.
   * Called externally on stream start. Safe to call multiple times (idempotent).
   */
  startThinkingSpinner(): void {
    if (this.silent || this._thinkingSpinner || this._firstTokenReceived) return;
    this._spinnerStartTime = Date.now();
    this._thinkingSpinner = new Spinner({ text: "Thinking...", color: "cyan" });
    this._thinkingSpinner.start();

    // Multi-phase label updates every 500ms
    this._spinnerInterval = setInterval(() => {
      if (!this._thinkingSpinner) return;
      const elapsed = Date.now() - this._spinnerStartTime;
      let label: string;
      if (elapsed < 500) {
        label = "Thinking...";
      } else if (elapsed < 2000) {
        label = `Thinking... [${this.reasoningTier ?? "standard"}]`;
      } else if (elapsed < 10000) {
        label = `Still thinking... (${Math.floor(elapsed / 1000)}s)`;
      } else {
        label = `Deep thinking... (${Math.floor(elapsed / 1000)}s) — complex task`;
      }
      this._thinkingSpinner.update(label);
    }, 500);
  }

  /**
   * Stop and clear the spinner when the first token arrives.
   * Idempotent — safe to call on every token.
   */
  stopThinkingSpinner(): void {
    if (!this._thinkingSpinner) return;
    if (this._spinnerInterval) {
      clearInterval(this._spinnerInterval);
      this._spinnerInterval = null;
    }
    this._thinkingSpinner.stop();
    this._thinkingSpinner = null;
    this._firstTokenReceived = true;
  }

  /**
   * Update the spinner label to reflect a phase transition.
   * - `executing`: shown while agent is running tools
   * - `repairing`: shown during error recovery
   */
  updateSpinnerPhase(phase: "executing" | "repairing"): void {
    if (!this._thinkingSpinner) return;
    const label = phase === "executing" ? "Executing tools..." : "Repairing...";
    this._thinkingSpinner.update(label);
  }

  /**
   * Write a token chunk to the output.
   * In silent mode, buffers only (no stdout output).
   * In richMode, tokens are buffered and flushed line-by-line for markdown rendering.
   * Ink pattern: willRender pre-flight skips empty/unchanged writes.
   */
  write(token: string): void {
    if (!token) return; // Ink willRender pre-flight: skip empty writes entirely
    this.buffer += token;
    if (this.silent) return;

    // Stop the thinking spinner when first token arrives
    if (!this._firstTokenReceived) {
      this.stopThinkingSpinner();
    }

    if (this.richMode) {
      // Flush complete lines for markdown rendering; hold incomplete last line
      this._flushLines();
    } else {
      // Check if this token completes a diff block and route to renderDiff
      // Detect when buffer contains a diff header at a line start
      const hasDiffHeader =
        this.buffer.includes("\ndiff --git ") ||
        this.buffer.includes("\n--- a/") ||
        this.buffer.startsWith("diff --git ") ||
        this.buffer.startsWith("--- a/");
      if (hasDiffHeader && (token.endsWith("\n") || token.includes("\n"))) {
        // Try to extract and render any complete diff segments
        const lines = this.buffer.split("\n");
        const firstDiffIdx = lines.findIndex(
          (l) => l.startsWith("diff --git ") || l.startsWith("--- a/"),
        );
        if (firstDiffIdx !== -1) {
          // Render preceding non-diff lines normally
          const preLines = lines.slice(0, firstDiffIdx);
          if (preLines.length > 0) {
            process.stdout.write(preLines.join("\n") + (firstDiffIdx > 0 ? "\n" : ""));
          }
          // Render the diff block with renderDiff
          const diffLines = lines.slice(firstDiffIdx);
          const diffText = diffLines.join("\n");
          try {
            const result = renderDiff(diffText, { maxLines: 80 });
            process.stdout.write(result.rendered);
          } catch {
            // Fallback to raw text if renderDiff throws
            process.stdout.write(diffText);
          }
          return;
        }
      }
      // Buffer tokens line-by-line for inline markdown rendering
      this._lineBuffer += token;
      const nlIdx = this._lineBuffer.indexOf("\n");
      if (nlIdx !== -1) {
        // Process all complete lines
        const complete = this._lineBuffer.slice(0, nlIdx + 1);
        this._lineBuffer = this._lineBuffer.slice(nlIdx + 1);
        this._renderLineWithMarkdown(complete);
      }
      // Flush remaining partial token chars immediately (no newline yet)
      // so streaming feels responsive — partial lines go out raw
      else if (token.length > 0) {
        process.stdout.write(token);
        // Compensate: when _lineBuffer gets a \n later the prefix was already written
        // so we track we've flushed it
        this._lineBuffer = "";
      }
    }
  }

  /**
   * Route a complete line through RichRenderer if it starts with a markdown marker.
   * Falls back to raw output on error.
   */
  private _renderLineWithMarkdown(line: string): void {
    const trimmed = line.trimStart();
    const isMarkdownLine =
      trimmed.startsWith("## ") ||
      trimmed.startsWith("### ") ||
      trimmed.startsWith("**") ||
      trimmed.startsWith("- ") ||
      trimmed.startsWith("* ") ||
      trimmed.startsWith("`");

    if (!isMarkdownLine) {
      process.stdout.write(line);
      return;
    }

    try {
      const result = this._richRenderer.render("cli", { kind: "markdown", content: line });
      if (result.rendered && result.output) {
        process.stdout.write(result.output.endsWith("\n") ? result.output : result.output + "\n");
      } else {
        process.stdout.write(line);
      }
    } catch {
      process.stdout.write(line);
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
    this._renderedUpTo = 0;
    this._lineBuffer = "";
    if (this._spinnerInterval) {
      clearInterval(this._spinnerInterval);
      this._spinnerInterval = null;
    }
    if (this._thinkingSpinner) {
      this._thinkingSpinner.stop();
      this._thinkingSpinner = null;
    }
    this._firstTokenReceived = false;
    this._spinnerStartTime = 0;
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

    if (
      options.pdseScore !== undefined ||
      options.elapsedMs !== undefined ||
      options.tokens !== undefined
    ) {
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
  // Private: rich-mode line buffering (Ink incremental line-diff pattern)
  // -------------------------------------------------------------------------

  /** Tracks how many bytes of this.buffer have already been rendered to stdout. */
  private _renderedUpTo = 0;
  /** Holds the incomplete current line (no trailing \n yet). */
  private _richLineBuffer = "";

  /**
   * Ink incremental line-diff pattern: only process content added since last flush.
   * Compares lines using `nextLine !== previousLine` logic — only writes changed lines.
   * This eliminates streaming flicker from full-repaint on each chunk.
   */
  private _flushLines(): void {
    // Get only the new content since the last flush
    const newContent = this.buffer.slice(this._renderedUpTo);
    if (!newContent) return; // Ink willRender: nothing new to render

    // Append new content to the current incomplete line buffer
    const combined = this._richLineBuffer + newContent;
    const nlIdx = combined.lastIndexOf("\n");

    if (nlIdx === -1) {
      // No complete line yet — accumulate
      this._richLineBuffer = combined;
      this._renderedUpTo = this.buffer.length;
      return;
    }

    // Extract all complete lines, keep the trailing incomplete fragment
    const complete = combined.slice(0, nlIdx + 1);
    this._richLineBuffer = combined.slice(nlIdx + 1);
    this._renderedUpTo = this.buffer.length - this._richLineBuffer.length;

    const rendered = this.ux.formatMarkdown(complete);
    if (rendered) process.stdout.write(rendered); // Ink willRender: skip empty renders
  }

  // -------------------------------------------------------------------------
  // Private: footer
  // -------------------------------------------------------------------------

  private _renderFooter(opts: FinishOptions): void {
    const DIM = this.colors ? "\x1b[2m" : "";
    const GREEN = this.colors ? "\x1b[32m" : "";
    const YELLOW = this.colors ? "\x1b[33m" : "";
    const RESET = this.colors ? "\x1b[0m" : "";

    const parts: string[] = [];

    // Human-readable verification status instead of raw PDSE score
    if (opts.pdseScore !== undefined) {
      if (opts.pdseScore >= 0.75) {
        parts.push(`${GREEN}Verified${RESET}`);
      } else if (opts.pdseScore >= 0.5) {
        parts.push(`${YELLOW}Review recommended${RESET}`);
      } else {
        parts.push(`${YELLOW}Needs attention${RESET}`);
      }
    }

    if (opts.elapsedMs !== undefined) {
      const secs = (opts.elapsedMs / 1000).toFixed(1);
      parts.push(`${DIM}${secs}s${RESET}`);
    }

    if (opts.tokens !== undefined) {
      parts.push(`${DIM}${opts.tokens.toLocaleString()} tokens${RESET}`);
    }

    if (opts.contextPercent !== undefined) {
      const pct = Math.round(opts.contextPercent);
      const tierColor =
        opts.budgetTier === "critical" || opts.budgetTier === "red"
          ? this.colors ? "\x1b[31m" : ""
          : opts.budgetTier === "yellow"
            ? this.colors ? "\x1b[33m" : ""
            : this.colors ? "\x1b[32m" : "";
      parts.push(`${tierColor}ctx ${pct}%${RESET}`);
    }

    if (parts.length > 0) {
      process.stdout.write(`${DIM}[${parts.join(" | ")}]${RESET}\n`);
    }
  }
}
