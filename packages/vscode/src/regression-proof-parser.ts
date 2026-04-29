import type { ScoreClaimGateInput } from "@dantecode/core";

export function parseRegressionGateProofFromOutput(output: string): ScoreClaimGateInput | null {
  const start = output.indexOf("{");
  const end = output.lastIndexOf("}");
  if (start === -1 || end <= start) {
    return null;
  }

  try {
    const parsed = JSON.parse(output.slice(start, end + 1)) as Partial<ScoreClaimGateInput> & {
      dimensionId?: string;
    };
    if (parsed.dimensionId !== "regression_prevention") {
      return null;
    }
    if (
      typeof parsed.pass !== "boolean" ||
      typeof parsed.score !== "number" ||
      typeof parsed.threshold !== "number" ||
      typeof parsed.profile !== "string"
    ) {
      return null;
    }
    return {
      pass: parsed.pass,
      score: parsed.score,
      threshold: parsed.threshold,
      profile: parsed.profile,
    };
  } catch {
    return null;
  }
}
