/**
 * output-formatter.ts
 *
 * Centralized output utilities for the DanteCode CLI.
 *
 * Responsibilities:
 * - ANSI escape code stripping (for JSON output, pipe detection, test assertions)
 * - TTY detection (suppress colors when piping or NO_COLOR is set)
 * - Conditional color formatters that return plain text in non-TTY contexts
 *
 * NOTE ON DANTEFORGE MOCKING:
 * @dantecode/danteforge is an obfuscated compiled binary. Never use
 * vi.importActual("@dantecode/danteforge") in tests — it will crash the Vitest
 * worker. Always use explicit vi.mock() with all required symbol stubs.
 */

// ANSI escape sequences
export const ANSI_CYAN = "\x1b[36m";
export const ANSI_YELLOW = "\x1b[33m";
export const ANSI_GREEN = "\x1b[32m";
export const ANSI_RED = "\x1b[31m";
export const ANSI_DIM = "\x1b[2m";
export const ANSI_BOLD = "\x1b[1m";
export const ANSI_RESET = "\x1b[0m";

/**
 * Strip all ANSI escape codes from a string.
 * Use this before assertions on CLI output, JSON serialization, or pipe output.
 *
 * @example
 * stripAnsi("\x1b[2m15\x1b[0m")  // → "15"
 * stripAnsi("\x1b[32mDone\x1b[0m")  // → "Done"
 */
export function stripAnsi(text: string): string {
  // Covers color/style codes (m), cursor movement (ABCDEFGJKH), and erase (J/K)
  return text.replace(/\x1b\[[0-9;]*[mGKHFJABCDEFa]/g, "");
}

/**
 * Strip ANSI codes and trim whitespace. Use before JSON.stringify or structured output.
 */
export function cleanForStructured(text: string): string {
  return stripAnsi(text).trim();
}

/**
 * Returns true when color output is appropriate:
 * - stdout is a TTY
 * - NO_COLOR env var is not set
 * - FORCE_COLOR env var is not "0"
 */
export function isColorEnabled(): boolean {
  if (process.env.NO_COLOR !== undefined) return false;
  if (process.env.FORCE_COLOR === "0") return false;
  return process.stdout.isTTY === true;
}

// ---------------------------------------------------------------------------
// Conditional color formatters
// These return plain text when color is disabled (pipes, tests, NO_COLOR).
// ---------------------------------------------------------------------------

export function dim(value: unknown): string {
  const s = String(value);
  return isColorEnabled() ? `${ANSI_DIM}${s}${ANSI_RESET}` : s;
}

export function green(value: unknown): string {
  const s = String(value);
  return isColorEnabled() ? `${ANSI_GREEN}${s}${ANSI_RESET}` : s;
}

export function red(value: unknown): string {
  const s = String(value);
  return isColorEnabled() ? `${ANSI_RED}${s}${ANSI_RESET}` : s;
}

export function yellow(value: unknown): string {
  const s = String(value);
  return isColorEnabled() ? `${ANSI_YELLOW}${s}${ANSI_RESET}` : s;
}

export function cyan(value: unknown): string {
  const s = String(value);
  return isColorEnabled() ? `${ANSI_CYAN}${s}${ANSI_RESET}` : s;
}

export function bold(value: unknown): string {
  const s = String(value);
  return isColorEnabled() ? `${ANSI_BOLD}${s}${ANSI_RESET}` : s;
}
