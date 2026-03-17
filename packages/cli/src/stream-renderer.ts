// ============================================================================
// @dantecode/cli — Stream Renderer
// Renders streaming model output to the CLI with ANSI formatting.
// ============================================================================

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
