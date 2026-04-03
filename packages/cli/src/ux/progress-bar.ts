// ============================================================================
// @dantecode/cli — Progress Bar
// Renders progress bars with percentage indicators.
// ============================================================================

import chalk from 'chalk';

/**
 * Renders a visual progress bar with percentage.
 * @param current - Current progress value
 * @param total - Total progress value
 * @param width - Width of the bar in characters (default: 40)
 * @returns Formatted progress bar string with percentage
 */
export function renderProgressBar(current: number, total: number, width = 40): string {
  const percent = Math.round((current / total) * 100);
  const filled = Math.round((width * current) / total);
  const bar = '█'.repeat(filled) + '░'.repeat(width - filled);
  return `${chalk.cyan(bar)} ${percent}%`;
}
