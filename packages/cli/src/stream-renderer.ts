// ============================================================================
// @dantecode/cli — Stream Renderer
// Renders streaming model output to the CLI with ANSI formatting.
// ============================================================================


// ── StreamThinkingIndicator ───────────────────────────────────────────────────
// Emits a "Thinking..." hint to stdout if the first token takes longer than
// a threshold. Inspired by Cursor's in-progress ghost text UX and Continue's
// provider latency budget pattern: give user feedback during slow TTFB.

export class StreamThinkingIndicator {
  private timer: ReturnType<typeof setTimeout> | null = null;
  private shown = false;

  startWaiting(thresholdMs = 800, onShow: () => void): void {
    this.dispose();
    this.shown = false;
    this.timer = setTimeout(() => {
      this.shown = true;
      onShow();
    }, thresholdMs);
  }

  onFirstChunk(): void {
    this.dispose();
  }

  dispose(): void {
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  get wasShown(): boolean {
    return this.shown;
  }
}

const CYAN = "\x1b[36m";
const BOLD = "\x1b[1m";
const RESET = "\x1b[0m";

/**
 * Renders streaming token chunks to stdout.
 * Handles silent mode (buffers without printing) and provides the
 * complete response text after streaming finishes.
 */
export class StreamRenderer {
  private buffer = "";
  private headerPrinted = false;

  constructor(private readonly silent: boolean = false) {}

  /**
   * Called once before streaming begins to print the response header.
   */
  printHeader(): void {
    if (this.silent || this.headerPrinted) return;
    this.headerPrinted = true;
    process.stdout.write(`\n${CYAN}${BOLD}DanteCode${RESET}\n\n`);
  }

  /**
   * Write a token chunk to the output.
   * In silent mode, buffers only (no stdout output).
   */
  write(token: string): void {
    this.buffer += token;
    if (!this.silent) {
      process.stdout.write(token);
    }
  }

  /**
   * Returns the complete buffered response text.
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
  }

  /**
   * Prints a trailing newline after streaming completes.
   */
  finish(): void {
    if (!this.silent && this.buffer.length > 0) {
      process.stdout.write("\n");
    }
  }
}
