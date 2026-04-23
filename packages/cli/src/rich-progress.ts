// packages/cli/src/rich-progress.ts
// Rich CLI progress system: spinners, step counters, ETA, nested tasks.
// Zero dependencies — pure ANSI escape sequences.
// Closes dim 23 (CLI UX) gap vs Cursor/Copilot which have polished progress UI.

const ESC = "\x1b[";
const RESET = "\x1b[0m";
const BOLD = "\x1b[1m";
const DIM = "\x1b[2m";
const GREEN = "\x1b[32m";
const CYAN = "\x1b[36m";
const YELLOW = "\x1b[33m";
const RED = "\x1b[31m";
const BLUE = "\x1b[34m";
const MAGENTA = "\x1b[35m";

/** Move cursor up N lines and clear to end of screen */
const CURSOR_UP = (n: number) => `${ESC}${n}A`;
const CLEAR_LINE = `\r${ESC}K`;

const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
const CHECK = "✓";
const CROSS = "✗";
const ARROW = "→";
const DOT = "·";

function isTTY(): boolean {
  return Boolean(process.stdout.isTTY);
}

function formatMs(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.floor(ms / 60_000)}m${Math.floor((ms % 60_000) / 1000)}s`;
}

function renderBar(filled: number, total: number, width = 20): string {
  const pct = Math.min(1, filled / Math.max(1, total));
  const filledCount = Math.round(pct * width);
  const emptyCount = width - filledCount;
  return `[${"█".repeat(filledCount)}${"░".repeat(emptyCount)}] ${Math.round(pct * 100)}%`;
}

// ─── Spinner ─────────────────────────────────────────────────────────────────

export interface SpinnerOptions {
  text: string;
  color?: "cyan" | "yellow" | "green" | "blue" | "magenta";
  /** Frame interval in ms (default 80) */
  interval?: number;
}

const COLOR_MAP: Record<string, string> = {
  cyan: CYAN,
  yellow: YELLOW,
  green: GREEN,
  blue: BLUE,
  magenta: MAGENTA,
};

export class Spinner {
  private _frame = 0;
  private _timer: ReturnType<typeof setInterval> | undefined;
  private _text: string;
  private _color: string;
  private _startMs = Date.now();
  private _active = false;

  constructor(private readonly _opts: SpinnerOptions) {
    this._text = _opts.text;
    this._color = COLOR_MAP[_opts.color ?? "cyan"] ?? CYAN;
  }

  start(): this {
    if (!isTTY()) {
      process.stdout.write(`${DIM}${ARROW}${RESET} ${this._text}\n`);
      return this;
    }
    this._active = true;
    this._startMs = Date.now();
    this._render();
    this._timer = setInterval(() => {
      this._frame = (this._frame + 1) % SPINNER_FRAMES.length;
      this._render();
    }, this._opts.interval ?? 80);
    return this;
  }

  update(text: string): this {
    this._text = text;
    if (isTTY() && this._active) this._render();
    return this;
  }

  succeed(text?: string): void {
    this._stop();
    const msg = text ?? this._text;
    process.stdout.write(`${GREEN}${CHECK}${RESET} ${msg} ${DIM}(${formatMs(Date.now() - this._startMs)})${RESET}\n`);
  }

  fail(text?: string): void {
    this._stop();
    const msg = text ?? this._text;
    process.stdout.write(`${RED}${CROSS}${RESET} ${msg}\n`);
  }

  warn(text?: string): void {
    this._stop();
    const msg = text ?? this._text;
    process.stdout.write(`${YELLOW}!${RESET} ${msg}\n`);
  }

  stop(): void {
    this._stop();
    if (isTTY()) process.stdout.write(CLEAR_LINE);
  }

  private _render(): void {
    const frame = SPINNER_FRAMES[this._frame % SPINNER_FRAMES.length]!;
    const elapsed = formatMs(Date.now() - this._startMs);
    process.stdout.write(
      `\r${this._color}${frame}${RESET} ${this._text} ${DIM}${elapsed}${RESET}${ESC}K`,
    );
  }

  private _stop(): void {
    if (this._timer !== undefined) {
      clearInterval(this._timer);
      this._timer = undefined;
    }
    this._active = false;
    if (isTTY()) process.stdout.write(CLEAR_LINE);
  }
}

// ─── Progress Bar ─────────────────────────────────────────────────────────────

export interface ProgressBarOptions {
  total: number;
  label?: string;
  width?: number;
  unit?: string;
}

export class ProgressBar {
  private _current = 0;
  private _startMs = Date.now();

  constructor(private readonly _opts: ProgressBarOptions) {}

  update(current: number, label?: string): void {
    this._current = current;
    const bar = renderBar(current, this._opts.total, this._opts.width ?? 24);
    const elapsed = formatMs(Date.now() - this._startMs);
    const etaMs =
      current > 0
        ? ((Date.now() - this._startMs) / current) * (this._opts.total - current)
        : 0;
    const eta = current > 0 && current < this._opts.total ? ` ETA ${formatMs(etaMs)}` : "";
    const unit = this._opts.unit ?? "";
    const lbl = label ?? this._opts.label ?? "";
    const line = `${CYAN}${bar}${RESET} ${current}/${this._opts.total}${unit} ${DIM}${elapsed}${eta}${RESET} ${lbl}`;

    if (isTTY()) {
      process.stdout.write(`\r${line}${ESC}K`);
    } else {
      // Non-TTY: only write at 0%, 25%, 50%, 75%, 100%
      const pct = current / this._opts.total;
      if ([0, 0.25, 0.5, 0.75, 1].some((p) => Math.abs(pct - p) < 0.01)) {
        process.stdout.write(`${line}\n`);
      }
    }
  }

  complete(label?: string): void {
    this.update(this._opts.total, label);
    process.stdout.write(`\n`);
  }

  get current(): number {
    return this._current;
  }
}

// ─── Step List ────────────────────────────────────────────────────────────────

export type StepStatus = "pending" | "running" | "done" | "failed" | "skipped";

export interface Step {
  label: string;
  status: StepStatus;
  detail?: string;
  durationMs?: number;
}

/**
 * Multi-step task display — shows a live list of steps with status icons.
 * Ideal for sprint verification, typecheck + test + anti-stub sequences.
 */
export class StepList {
  private readonly _steps: Step[];
  private _renderedLines = 0;
  private _startMs = Date.now();

  constructor(stepLabels: string[]) {
    this._steps = stepLabels.map((label) => ({ label, status: "pending" as StepStatus }));
  }

  start(index: number): void {
    this._steps[index]!.status = "running";
    this._steps[index]!.durationMs = undefined;
    this._redraw();
  }

  complete(index: number, detail?: string): void {
    const step = this._steps[index]!;
    step.status = "done";
    step.detail = detail;
    step.durationMs = Date.now() - this._startMs;
    this._redraw();
  }

  fail(index: number, detail?: string): void {
    const step = this._steps[index]!;
    step.status = "failed";
    step.detail = detail;
    this._redraw();
  }

  skip(index: number, detail?: string): void {
    const step = this._steps[index]!;
    step.status = "skipped";
    step.detail = detail;
    this._redraw();
  }

  private _icon(status: StepStatus): string {
    switch (status) {
      case "pending": return `${DIM}${DOT}${RESET}`;
      case "running": return `${CYAN}${SPINNER_FRAMES[Math.floor(Date.now() / 80) % SPINNER_FRAMES.length]}${RESET}`;
      case "done":    return `${GREEN}${CHECK}${RESET}`;
      case "failed":  return `${RED}${CROSS}${RESET}`;
      case "skipped": return `${DIM}−${RESET}`;
    }
  }

  private _redraw(): void {
    if (!isTTY()) {
      // Non-TTY: just print status changes
      const nonPending = this._steps.filter((s) => s.status !== "pending");
      const last = nonPending[nonPending.length - 1];
      if (last) {
        const detail = last.detail ? ` — ${last.detail}` : "";
        process.stdout.write(`  ${this._icon(last.status)} ${last.label}${detail}\n`);
      }
      return;
    }

    // Move up to overwrite previous render
    if (this._renderedLines > 0) {
      process.stdout.write(CURSOR_UP(this._renderedLines));
    }

    const lines: string[] = [];
    for (const step of this._steps) {
      const detail = step.detail ? ` ${DIM}${step.detail}${RESET}` : "";
      const dur = step.durationMs ? ` ${DIM}(${formatMs(step.durationMs)})${RESET}` : "";
      lines.push(`  ${this._icon(step.status)} ${step.label}${detail}${dur}${ESC}K`);
    }
    process.stdout.write(lines.join("\n") + "\n");
    this._renderedLines = lines.length;
  }

  summary(): { passed: number; failed: number; skipped: number } {
    return {
      passed: this._steps.filter((s) => s.status === "done").length,
      failed: this._steps.filter((s) => s.status === "failed").length,
      skipped: this._steps.filter((s) => s.status === "skipped").length,
    };
  }
}

// ─── Convenience helpers ──────────────────────────────────────────────────────

/** Create and immediately start a spinner */
export function spin(text: string, color?: SpinnerOptions["color"]): Spinner {
  return new Spinner({ text, color }).start();
}

/** Print a section header */
export function header(text: string): void {
  process.stdout.write(`\n${BOLD}${BLUE}${text}${RESET}\n${"─".repeat(Math.min(text.length, 60))}\n`);
}

/** Print a success line */
export function ok(text: string): void {
  process.stdout.write(`${GREEN}${CHECK}${RESET} ${text}\n`);
}

/** Print a warning line */
export function warn(text: string): void {
  process.stdout.write(`${YELLOW}!${RESET} ${text}\n`);
}

/** Print an error line */
export function err(text: string): void {
  process.stdout.write(`${RED}${CROSS}${RESET} ${text}\n`);
}

/** Print a dimmed info line */
export function info(text: string): void {
  process.stdout.write(`${DIM}${ARROW} ${text}${RESET}\n`);
}
