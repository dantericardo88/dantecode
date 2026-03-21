/**
 * spacing-tokens.ts — @dantecode/ux-polish
 *
 * Spacing, layout, and sizing tokens for terminal and VS Code surfaces.
 * All values are in character units for terminal, and px/rem equivalents
 * for VS Code CSS variable mapping.
 */

// ---------------------------------------------------------------------------
// Terminal spacing (character units)
// ---------------------------------------------------------------------------

/** Standard horizontal indent levels (in spaces). */
export const INDENT = {
  none: 0,
  sm: 2,
  md: 4,
  lg: 6,
  xl: 8,
} as const;

/** Column widths for common layout elements. */
export const COLUMN_WIDTH = {
  /** Default terminal width assumption. */
  terminal: 80,
  /** Minimum useful render width. */
  min: 40,
  /** Wide terminal. */
  wide: 120,
  /** Progress bar default width (chars). */
  progressBar: 20,
  /** Status label max width. */
  statusLabel: 30,
  /** Table cell max width before truncation. */
  tableCell: 32,
} as const;

/** Vertical padding (empty lines). */
export const V_PAD = {
  /** No padding. */
  none: 0,
  /** One blank line between sections. */
  section: 1,
  /** Two blank lines between major groups. */
  group: 2,
} as const;

// ---------------------------------------------------------------------------
// VS Code CSS variable equivalents
// ---------------------------------------------------------------------------

/** CSS variable names for VS Code surfaces (mapped from token names). */
export const VSCODE_SPACING_VARS: Record<string, string> = {
  "indent.sm": "--dante-space-2",
  "indent.md": "--dante-space-4",
  "indent.lg": "--dante-space-6",
  "column.progressBar": "--dante-progress-width",
  "column.tableCell": "--dante-table-cell-max",
};

// ---------------------------------------------------------------------------
// Utility
// ---------------------------------------------------------------------------

/**
 * Generate an indent string of N spaces.
 * Clamps to [0, 20] to prevent runaway output.
 */
export function indent(n: number): string {
  return " ".repeat(Math.max(0, Math.min(n, 20)));
}

/**
 * Pad a string to exactly `width` chars, truncating with suffix if too long.
 */
export function padOrTruncate(s: string, width: number, suffix = "…"): string {
  if (s.length <= width) return s.padEnd(width);
  return s.slice(0, width - suffix.length) + suffix;
}

/**
 * Create a horizontal rule of `char` repeated to `width` chars.
 */
export function hRule(width: number = COLUMN_WIDTH.terminal, char = "─"): string {
  return char.repeat(Math.max(0, width));
}
