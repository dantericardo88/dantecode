/**
 * spinner.ts - CLI Spinner Component
 *
 * ANSI-based spinner with frame animation for CLI and terminal output.
 * Automatically detects VSCode and disables ANSI for compatibility.
 *
 * @example
 * ```typescript
 * const spinner = new Spinner({ text: 'Loading...' });
 * spinner.start();
 * // ... do work ...
 * spinner.succeed('Done!');
 * ```
 */

/** Spinner frame sets */
export const SPINNERS = {
  dots: { frames: ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧"], interval: 80 },
  line: { frames: ["-", "\\", "|", "/"], interval: 80 },
  arrow: { frames: ["←", "↖", "↑", "↗", "→", "↘", "↓", "↙"], interval: 100 },
  circle: { frames: ["◐", "◓", "◑", "◒"], interval: 120 },
} as const;

export type SpinnerName = keyof typeof SPINNERS;

export interface SpinnerFrames {
  frames: string[];
  interval?: number;
}

export interface SpinnerOptions {
  text?: string;
  color?: "cyan" | "yellow" | "green" | "red" | "white";
  interval?: number;
  stream?: NodeJS.WriteStream;
  spinner?: SpinnerName | SpinnerFrames;
}

/** ANSI color codes */
const COLORS = {
  cyan: "\x1b[36m",
  yellow: "\x1b[33m",
  green: "\x1b[32m",
  red: "\x1b[31m",
  white: "\x1b[37m",
  reset: "\x1b[0m",
};

/** Symbols for final states */
const SYMBOLS = {
  succeed: "✓",
  fail: "✗",
  warn: "⚠",
  info: "ℹ",
};

/**
 * Detect if running in VSCode (no ANSI support in output channel)
 */
function isVSCode(): boolean {
  return !!(process.env.VSCODE_PID || process.env.VSCODE_GIT_ASKPASS_NODE);
}

/**
 * Detect if stdout supports interactivity (TTY + not VSCode)
 */
function supportsInteractivity(): boolean {
  return process.stdout.isTTY && !isVSCode();
}

/**
 * CLI Spinner with frame-based animation
 */
export class Spinner {
  private text: string;
  private color: keyof typeof COLORS;
  private stream: NodeJS.WriteStream;
  private frames: string[];
  private interval: number;
  private frameIndex = 0;
  private timer: NodeJS.Timeout | null = null;
  private isSpinning = false;
  private linesToClear = 0;

  constructor(options: SpinnerOptions = {}) {
    this.text = options.text ?? "";
    this.color = options.color ?? "cyan";
    this.stream = options.stream ?? process.stderr;

    // Determine frames
    let spinnerConfig: SpinnerFrames;
    if (options.spinner) {
      if (typeof options.spinner === "string") {
        spinnerConfig = SPINNERS[options.spinner];
      } else {
        spinnerConfig = options.spinner;
      }
    } else {
      spinnerConfig = SPINNERS.dots;
    }

    this.frames = spinnerConfig.frames;
    this.interval = options.interval ?? spinnerConfig.interval ?? 80;

    // Register cleanup on process exit (defensive - check if once exists)
    if (typeof process.once === "function") {
      process.once("SIGINT", () => this.stop());
      process.once("exit", () => this.stop());
    }
  }

  /**
   * Start spinner animation
   */
  start(text?: string): void {
    if (this.isSpinning) return;

    if (text !== undefined) {
      this.text = text;
    }

    this.isSpinning = true;
    this.frameIndex = 0;

    // If not interactive, just print once and return
    if (!supportsInteractivity()) {
      this.stream.write(`${this.text}\n`);
      return;
    }

    // Start animation loop
    this.render();
    this.timer = setInterval(() => {
      this.frameIndex = (this.frameIndex + 1) % this.frames.length;
      this.render();
    }, this.interval);
  }

  /**
   * Update spinner text while spinning
   */
  update(text: string): void {
    this.text = text;
    if (this.isSpinning && supportsInteractivity()) {
      this.render();
    }
  }

  /**
   * Stop spinner with optional final text and symbol
   */
  stop(finalText?: string, symbol?: string): void {
    if (!this.isSpinning) return;

    this.isSpinning = false;

    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }

    if (supportsInteractivity()) {
      // Clear the spinner line
      this.clearLines();
    }

    // Print final message if provided
    if (finalText !== undefined || symbol !== undefined) {
      const text = finalText ?? this.text;
      const prefix = symbol ? `${symbol} ` : "";
      this.stream.write(`${prefix}${text}\n`);
    }
  }

  /**
   * Stop with green checkmark
   */
  succeed(text?: string): void {
    const finalText = text ?? this.text;
    const symbol = `${COLORS.green}${SYMBOLS.succeed}${COLORS.reset}`;
    this.stop(finalText, symbol);
  }

  /**
   * Stop with red X
   */
  fail(text?: string): void {
    const finalText = text ?? this.text;
    const symbol = `${COLORS.red}${SYMBOLS.fail}${COLORS.reset}`;
    this.stop(finalText, symbol);
  }

  /**
   * Stop with yellow warning
   */
  warn(text?: string): void {
    const finalText = text ?? this.text;
    const symbol = `${COLORS.yellow}${SYMBOLS.warn}${COLORS.reset}`;
    this.stop(finalText, symbol);
  }

  /**
   * Stop with cyan info
   */
  info(text?: string): void {
    const finalText = text ?? this.text;
    const symbol = `${COLORS.cyan}${SYMBOLS.info}${COLORS.reset}`;
    this.stop(finalText, symbol);
  }

  /**
   * Check if spinner is currently active
   */
  get spinning(): boolean {
    return this.isSpinning;
  }

  /**
   * Render current frame
   */
  private render(): void {
    if (!supportsInteractivity()) return;

    // Clear previous line
    this.clearLines();

    // Render spinner frame + text
    const frame = this.frames[this.frameIndex];
    const colorCode = COLORS[this.color];
    const line = `${colorCode}${frame}${COLORS.reset} ${this.text}`;

    this.stream.write(line);
    this.linesToClear = 1;
  }

  /**
   * Clear rendered lines (move cursor up and clear)
   */
  private clearLines(): void {
    if (this.linesToClear === 0) return;

    // Move cursor to start of line and clear
    this.stream.write("\r");
    this.stream.write("\x1b[K"); // Clear to end of line

    this.linesToClear = 0;
  }
}
