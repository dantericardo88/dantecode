import { evaluateBenchmarkTransparencyClaimGate } from "./benchmark-transparency.js";
import type { BenchmarkTransparencyClaimGateInput } from "./benchmark-transparency.js";
import { evaluateScoreClaimGate } from "./regression-gate.js";
import type { ScoreClaimGateInput } from "./regression-gate.js";

const SCORE_PATTERNS: RegExp[] = [
  /\b\d+(\.\d+)?\s*\/\s*10\b/,
  /PDSE[:\s]+\d+/i,
  /\bscore[:\s]+\d+(\.\d+)?/i,
  /\+\d+(\.\d+)?\s*(points?|dims?|dimensions?|pts?)\b/i,
  /improved\s+from\s+\d/i,
  /went\s+(?:up|from)\s+\d/i,
  /cycles?\s+run[:\s]+\d+/i,
  /dimensions?\s+improved[:\s]+\d+/i,
];

export function detectUnverifiedScoreClaims(
  responseText: string,
  _sessionToolOutputs: string[],
  ranImprovementCmd: boolean,
  verifiedScoreOutput: string | null,
  regressionGate?: ScoreClaimGateInput | null,
  benchmarkTransparencyGate?: BenchmarkTransparencyClaimGateInput | null,
): string | null {
  if (!ranImprovementCmd) return null;

  const matchedPatterns = SCORE_PATTERNS.filter((pattern) => pattern.test(responseText));
  if (matchedPatterns.length === 0) return null;

  if (verifiedScoreOutput) {
    const allGrounded = matchedPatterns.every((pattern) => {
      const match = responseText.match(pattern);
      if (!match) return true;
      const claimed = match[0].replace(/\s+/g, "");
      return verifiedScoreOutput.replace(/\s+/g, "").includes(claimed);
    });

    if (allGrounded) {
      const regressionProof = evaluateScoreClaimGate(regressionGate);
      if (!regressionProof.ok) {
        return (
          `\n\n---\nWARNING: *Score or matrix claim is numerically verified, but blocked by ` +
          `${regressionProof.reason ?? "missing regression gate"} proof. Run ` +
          `\`dantecode regression gate --profile score-claim --evidence\` before trusting the claim.*`
        );
      }

      const benchmarkProof = evaluateBenchmarkTransparencyClaimGate(benchmarkTransparencyGate);
      if (!benchmarkProof.ok) {
        return (
          `\n\n---\nWARNING: *Score or matrix claim is numerically verified, but blocked by ` +
          `${benchmarkProof.reason ?? "missing benchmark transparency"} proof. Run ` +
          `\`dantecode bench transparency --suite builtin --seed 45 --evidence\` before trusting benchmark or matrix claims.*`
        );
      }

      return null;
    }
  }

  return (
    `\n\n---\nWARNING: *One or more score or improvement claims in this response could not be ` +
    `verified against tool output from this session. Run ` +
    `\`danteforge score --level light\` to get actual numbers before trusting these figures.*`
  );
}
