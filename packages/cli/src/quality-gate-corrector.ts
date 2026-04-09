// ============================================================================
// @dantecode/cli — Quality Gate Corrector
// Formats self-correction nudges when DanteForge anti-stub or constitution
// checks fail on a just-written file. Injected into tool results so the model
// receives immediate feedback and can self-correct in the next round.
// ============================================================================

/**
 * Builds a correction nudge message to inject into tool results when the
 * DanteForge quality gate fails on a written file.
 *
 * The nudge is appended to the tool's output so the model sees the failure
 * as part of the current round's feedback and can fix it in the next round.
 */
export function buildCorrectionNudge(filePath: string, summary: string): string {
  return (
    `\n\u26a0\ufe0f DanteForge quality gate failed for \`${filePath}\`:\n` +
    `${summary}\n\n` +
    `ACTION REQUIRED: Fix the violations listed above before continuing.\n` +
    `- Remove all TODO/FIXME/HACK markers and replace with real implementations\n` +
    `- Remove hardcoded credentials (use environment variables instead)\n` +
    `- Fill in empty function bodies with actual logic\n` +
    `Rewrite the file now to pass the gate.`
  );
}

/**
 * Returns true when the number of correction attempts for a file has reached
 * the limit. After 2 failed attempts, the gate gives up and allows the loop
 * to continue rather than blocking indefinitely.
 */
export function shouldGiveUp(attempt: number): boolean {
  return attempt >= 2;
}
