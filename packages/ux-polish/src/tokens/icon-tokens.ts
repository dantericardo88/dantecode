/**
 * icon-tokens.ts — @dantecode/ux-polish
 *
 * Icon/emoji/symbol tokens for terminal and VS Code surfaces.
 * Includes Unicode-safe fallbacks for environments that don't render emoji.
 */

import type { ThemeName } from "../types.js";

// ---------------------------------------------------------------------------
// Icon set definition
// ---------------------------------------------------------------------------

export interface IconSet {
  success: string;
  error: string;
  warning: string;
  info: string;
  progress: string;
  pending: string;
  running: string;
  paused: string;
  skipped: string;
  bullet: string;
  arrow: string;
  check: string;
  cross: string;
  spinner: string[];
  separator: string;
  pdse: string;
  hint: string;
  onboarding: string;
}

// ---------------------------------------------------------------------------
// Icon sets per theme
// ---------------------------------------------------------------------------

/** Rich Unicode icon set (default, rich, matrix, ocean themes). */
export const ICONS_RICH: IconSet = {
  success: "✓",
  error: "✗",
  warning: "⚠",
  info: "ℹ",
  progress: "▶",
  pending: "○",
  running: "◉",
  paused: "⏸",
  skipped: "⊘",
  bullet: "•",
  arrow: "→",
  check: "✓",
  cross: "✗",
  spinner: ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"],
  separator: "─",
  pdse: "⬡",
  hint: "💡",
  onboarding: "🚀",
};

/** ASCII-only icon set (minimal theme / non-Unicode environments). */
export const ICONS_ASCII: IconSet = {
  success: "[ok]",
  error: "[err]",
  warning: "[warn]",
  info: "[i]",
  progress: "[>]",
  pending: "[ ]",
  running: "[*]",
  paused: "[=]",
  skipped: "[-]",
  bullet: "*",
  arrow: "->",
  check: "[ok]",
  cross: "[x]",
  spinner: ["|", "/", "-", "\\"],
  separator: "-",
  pdse: "[P]",
  hint: "[hint]",
  onboarding: "[go]",
};

// ---------------------------------------------------------------------------
// Theme → icon set mapping
// ---------------------------------------------------------------------------

const THEME_ICONS: Record<ThemeName, IconSet> = {
  default: ICONS_RICH,
  minimal: ICONS_ASCII,
  rich: ICONS_RICH,
  matrix: ICONS_RICH,
  ocean: ICONS_RICH,
};

/**
 * Get the icon set for a given theme name.
 * Falls back to rich icons for unrecognized themes.
 */
export function resolveIcons(theme: ThemeName): IconSet {
  return THEME_ICONS[theme] ?? ICONS_RICH;
}

/**
 * Get a spinner frame by index (wraps around).
 */
export function spinnerFrame(icons: IconSet, frameIndex: number): string {
  const frames = icons.spinner;
  return frames[frameIndex % frames.length] ?? frames[0] ?? "|";
}
