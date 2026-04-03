/**
 * color-tokens.ts — @dantecode/ux-polish
 *
 * Semantic color tokens for the DanteCode shared UX engine.
 * All ANSI escape codes are terminal-safe. VS Code adapter maps
 * these to CSS variables at the surface layer.
 *
 * Token naming: {theme}.{role}
 */

import type { ThemeName, SemanticColors } from "../types.js";

// ---------------------------------------------------------------------------
// ANSI escape shorthands
// ---------------------------------------------------------------------------

const A = (code: string): string => `\x1b[${code}m`;

const RESET = A("0");
const BOLD = A("1");
const DIM = A("2");

// ---------------------------------------------------------------------------
// Per-theme ANSI color maps
// ---------------------------------------------------------------------------

/** Full ANSI color map per theme. */
export const COLOR_TOKENS: Record<ThemeName, SemanticColors> = {
  default: {
    success: A("32"), // green
    error: A("31"), // red
    warning: A("33"), // yellow
    info: A("36"), // cyan
    progress: A("34"), // blue
    muted: DIM,
    reset: RESET,
  },
  minimal: {
    success: "",
    error: "",
    warning: "",
    info: "",
    progress: "",
    muted: "",
    reset: "",
  },
  rich: {
    success: BOLD + A("32"), // bold green
    error: BOLD + A("31"), // bold red
    warning: BOLD + A("33"), // bold yellow
    info: BOLD + A("36"), // bold cyan
    progress: BOLD + A("34"), // bold blue
    muted: DIM,
    reset: RESET,
  },
  matrix: {
    success: A("32"), // classic matrix green
    error: A("91"), // bright red
    warning: A("93"), // bright yellow
    info: A("92"), // bright green
    progress: A("32"), // matrix green
    muted: DIM,
    reset: RESET,
  },
  ocean: {
    success: A("96"), // bright cyan
    error: A("35"), // magenta
    warning: A("94"), // bright blue
    info: A("96"), // bright cyan
    progress: A("94"), // bright blue
    muted: DIM,
    reset: RESET,
  },
};

/** No-color fallback (for non-TTY, CI, accessibility mode). */
export const NO_COLORS: SemanticColors = {
  success: "",
  error: "",
  warning: "",
  info: "",
  progress: "",
  muted: "",
  reset: "",
};

/**
 * Resolve color tokens for a given theme.
 * When useColors is false, returns the no-color set.
 */
export function resolveColors(theme: ThemeName, useColors: boolean): SemanticColors {
  return useColors ? (COLOR_TOKENS[theme] ?? COLOR_TOKENS.default) : NO_COLORS;
}

/**
 * Check whether the current process supports ANSI color output.
 * Returns false in CI environments, dumb terminals, or when NO_COLOR is set.
 */
export function supportsColor(): boolean {
  if (typeof process === "undefined") return false;
  if (process.env["NO_COLOR"]) return false;
  if (process.env["TERM"] === "dumb") return false;
  if (process.env["CI"] && !process.env["FORCE_COLOR"]) return false;
  return process.stdout?.isTTY === true || !!process.env["FORCE_COLOR"];
}
