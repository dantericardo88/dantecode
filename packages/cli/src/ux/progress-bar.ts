// ============================================================================
// @dantecode/cli — Progress Indicators
// Comprehensive progress display system with spinners, bars, and status updates.
// ============================================================================

import chalk from "chalk";

// ANSI escape codes for cursor control
const HIDE_CURSOR = "\x1b[?25l";
const SHOW_CURSOR = "\x1b[?25h";
const CLEAR_LINE = "\x1b[2K";
const MOVE_TO_START = "\x1b[1G";
const MOVE_UP = (lines: number) => `\x1b[${lines}A`;

/**
 * Spinner frames for animated progress indicators.
 */
const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

/**
 * Simple progress bar renderer.
 * @param current - Current progress value
 * @param total - Total progress value
 * @param width - Width of the bar in characters (default: 40)
 * @returns Formatted progress bar string with percentage
 */
export function renderProgressBar(current: number, total: number, width = 40): string {
  const percent = Math.round((current / total) * 100);
  const filled = Math.round((width * current) / total);
  const bar = "█".repeat(filled) + "░".repeat(width - filled);
  return `${chalk.cyan(bar)} ${percent}%`;
}

/**
 * Animated spinner for indeterminate progress.
 */
export class Spinner {
  private frame = 0;
  private interval?: NodeJS.Timeout;
  private message: string;
  private startTime: number;

  constructor(message: string) {
    this.message = message;
    this.startTime = Date.now();
  }

  start(): void {
    if (this.interval) return;

    process.stdout.write(HIDE_CURSOR);
    process.stdout.write(`${SPINNER_FRAMES[0]} ${this.message}`);

    this.interval = setInterval(() => {
      this.frame = (this.frame + 1) % SPINNER_FRAMES.length;
      const elapsed = Math.floor((Date.now() - this.startTime) / 1000);
      const status = `${SPINNER_FRAMES[this.frame]} ${this.message} (${elapsed}s)`;
      process.stdout.write(MOVE_TO_START + CLEAR_LINE + status);
    }, 100);
  }

  update(message: string): void {
    this.message = message;
  }

  stop(success = true): void {
    if (!this.interval) return;

    clearInterval(this.interval);
    this.interval = undefined;

    const elapsed = ((Date.now() - this.startTime) / 1000).toFixed(1);
    const icon = success ? chalk.green("✓") : chalk.red("✗");
    const finalMessage = `${icon} ${this.message} (${elapsed}s)`;

    process.stdout.write(MOVE_TO_START + CLEAR_LINE + finalMessage + "\n");
    process.stdout.write(SHOW_CURSOR);
  }
}

/**
 * Multi-step progress indicator with status tracking.
 */
export class MultiStepProgress {
  private steps: Array<{ name: string; status: "pending" | "running" | "completed" | "failed" }>;
  private currentStep = 0;

  constructor(steps: string[]) {
    this.steps = steps.map((name) => ({ name, status: "pending" }));
  }

  start(): void {
    this.render();
  }

  next(): void {
    if (this.currentStep < this.steps.length) {
      const currentStep = this.steps[this.currentStep];
      if (!currentStep) {
        return;
      }
      currentStep.status = "completed";
      this.currentStep++;
      if (this.currentStep < this.steps.length) {
        const nextStep = this.steps[this.currentStep];
        if (nextStep) {
          nextStep.status = "running";
        }
      }
      this.render();
    }
  }

  fail(): void {
    if (this.currentStep < this.steps.length) {
      const currentStep = this.steps[this.currentStep];
      if (currentStep) {
        currentStep.status = "failed";
      }
    }
    this.render();
  }

  private render(): void {
    // Move cursor up to overwrite previous output
    if (this.currentStep > 0) {
      process.stdout.write(MOVE_UP(this.steps.length));
    }

    for (const step of this.steps) {
      let icon: string;
      let color: any;

      switch (step.status) {
        case "pending":
          icon = "○";
          color = chalk.dim;
          break;
        case "running":
          icon = "●";
          color = chalk.yellow;
          break;
        case "completed":
          icon = "✓";
          color = chalk.green;
          break;
        case "failed":
          icon = "✗";
          color = chalk.red;
          break;
      }

      process.stdout.write(MOVE_TO_START + CLEAR_LINE);
      process.stdout.write(`${color(icon)} ${step.name}\n`);
    }
  }
}

/**
 * Progress indicator for long-running operations.
 */
export class ProgressIndicator {
  private spinner: Spinner;
  private startTime: number;
  private lastUpdate = 0;

  constructor(message: string) {
    this.spinner = new Spinner(message);
    this.startTime = Date.now();
  }

  start(): void {
    this.spinner.start();
  }

  update(message: string): void {
    // Throttle updates to avoid flickering
    const now = Date.now();
    if (now - this.lastUpdate > 500) {
      this.spinner.update(message);
      this.lastUpdate = now;
    }
  }

  complete(message?: string): void {
    this.spinner.stop(true);
    const duration = ((Date.now() - this.startTime) / 1000).toFixed(1);
    if (message) {
      console.log(message);
    }
    console.log(chalk.dim(`  Duration: ${duration}s`));
  }

  fail(message?: string): void {
    this.spinner.stop(false);
    if (message) {
      console.log(message);
    }
  }
}
