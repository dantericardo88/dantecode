import { evaluateScoreClaimGate } from "./regression-gate.js";
import type { ScoreClaimGateInput } from "./regression-gate.js";

// Detects unverified score/metric claims in text-only model responses.
// Implements the Cline "double-check completion" pattern at the content level:
// if the model claims score deltas without a verified danteforge score tool result,
// the response is flagged so users know the numbers are unverified.

const SCORE_PATTERNS: RegExp[] = [
  /\b\d+(\.\d+)?\s*\/\s*10\b/,                          // "7.5/10"
  /PDSE[:\s]+\d+/i,                                      // "PDSE: 75"
  /\bscore[:\s]+\d+(\.\d+)?/i,                           // "score: 8.2"
  /\+\d+(\.\d+)?\s*(points?|dims?|dimensions?|pts?)\b/i,  // "+1.2 dimensions"
  /improved\s+from\s+\d/i,                               // "improved from 6"
  /went\s+(?:up|from)\s+\d/i,                            // "went up from"
  /cycles?\s+run[:\s]+\d+/i,                             // "cycles run: 5"
  /dimensions?\s+improved[:\s]+\d+/i,                   // "dimensions improved: 3"
];

/**
 * Scans a text-only model response for score/improvement claims and checks whether
 * they are grounded in actual tool outputs from the current session.
 *
 * Returns a warning string to append if unverified claims are found, or null if
 * everything looks grounded (or no improvement commands ran this session).
 *
 * @param responseText - The model's final text response
 * @param sessionToolOutputs - All Bash tool outputs accumulated this session
 * @param ranImprovementCmd - True if any danteforge improvement command ran this session
 * @param verifiedScoreOutput - Output of the last danteforge score call, or null
 */
export function detectUnverifiedScoreClaims(
  responseText: string,
  _sessionToolOutputs: string[],
  ranImprovementCmd: boolean,
  verifiedScoreOutput: string | null,
  regressionGate?: ScoreClaimGateInput | null,
): string | null {
  if (!ranImprovementCmd) return null;

  const matchedPatterns = SCORE_PATTERNS.filter((p) => p.test(responseText));
  if (matchedPatterns.length === 0) return null;

  // If we have verified score output, check if the claimed values appear in it.
  if (verifiedScoreOutput) {
    const allGrounded = matchedPatterns.every((p) => {
      const m = responseText.match(p);
      if (!m) return true;
      const claimed = m[0].replace(/\s+/g, "");
      return verifiedScoreOutput.replace(/\s+/g, "").includes(claimed);
    });
    if (allGrounded) {
      const regressionProof = evaluateScoreClaimGate(regressionGate);
      if (regressionProof.ok) {
        return null;
      }
      return (
        `\n\n---\n⚠️ *Score or matrix claim is numerically verified, but blocked by ` +
        `${regressionProof.reason ?? "missing regression gate"} proof. Run ` +
        `\`dantecode regression gate --profile score-claim --evidence\` before trusting the claim.*`
      );
    }
  }

  return (
    `\n\n---\n⚠️ *One or more score or improvement claims in this response could not be ` +
    `verified against tool output from this session. Run ` +
    `\`danteforge score --level light\` to get actual numbers before trusting these figures.*`
  );
}
