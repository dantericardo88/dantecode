// ============================================================================
// FIM Acceptance Rate Adapter (dim 1)
// Pure functions for computing debounce adjustments from acceptance rate,
// and logging rate metrics to an output channel.
// These functions are also used by packages/vscode/src/inline-completion.ts
// but are duplicated here to keep the CLI package self-contained.
// ============================================================================

/**
 * Returns a debounce adjustment based on FIM completion acceptance rate.
 * Low acceptance → increase debounce (reduce noise).
 * High acceptance → decrease debounce (user values completions).
 *
 * @param acceptanceRate - 0.0–1.0 ratio of accepted / shown completions
 * @returns ms adjustment to add to base debounce (positive = slower, negative = faster)
 */
export function getAcceptanceRateDebounceAdjustment(acceptanceRate: number): number {
  if (acceptanceRate < 0.2) return 80;
  if (acceptanceRate < 0.4) return 40;
  if (acceptanceRate < 0.6) return 0;
  if (acceptanceRate < 0.8) return -20;
  return -40;
}

// ─── Per-language acceptance history (dim 1) ─────────────────────────────────

export interface LanguageAcceptanceStats {
  language: string;
  shown: number;
  accepted: number;
  rate: number;
}

export interface RankedCompletion {
  insertText: string;
  language: string;
  /** Estimated quality score (0–1) based on per-language acceptance history */
  qualityScore: number;
}

/**
 * Ranks completion candidates by per-language acceptance history.
 * Completions in languages with higher historical acceptance rates
 * are surfaced with higher quality scores.
 *
 * @param completions - Candidate completions with language metadata
 * @param history - Per-language acceptance stats from telemetry
 * @returns Completions sorted by qualityScore descending
 */
export function rankCompletionsByAcceptanceRate(
  completions: Array<{ insertText: string; language: string }>,
  history: LanguageAcceptanceStats[],
): RankedCompletion[] {
  const rateByLanguage = new Map(history.map((h) => [h.language, h.rate]));
  const globalRate = history.length > 0
    ? history.reduce((sum, h) => sum + h.rate, 0) / history.length
    : 0.5;

  return completions
    .map((c) => ({
      ...c,
      qualityScore: rateByLanguage.get(c.language) ?? globalRate,
    }))
    .sort((a, b) => b.qualityScore - a.qualityScore);
}

/**
 * Logs the current FIM acceptance rate to the output channel.
 * Includes rate percentage, counts, and debounce adjustment direction.
 */
export function logAcceptanceRateToChannel(
  acceptanceRate: number,
  totalViewed: number,
  totalAccepted: number,
  outputChannel: { appendLine(msg: string): void },
): void {
  const pct = (acceptanceRate * 100).toFixed(1);
  const adj = getAcceptanceRateDebounceAdjustment(acceptanceRate);
  outputChannel.appendLine(
    `[FIM acceptance] Rate=${pct}% (${totalAccepted}/${totalViewed} accepted) — debounce adj: ${adj >= 0 ? "+" : ""}${adj}ms`,
  );
}
