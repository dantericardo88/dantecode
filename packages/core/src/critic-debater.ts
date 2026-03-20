export type CriticVerdict = "pass" | "warn" | "fail";

export interface CriticOpinion {
  agentId: string;
  verdict: CriticVerdict;
  confidence?: number;
  critique?: string;
  findings?: string[];
}

export interface CriticDebateResult {
  consensus: CriticVerdict;
  averageConfidence: number;
  verdictCounts: Record<CriticVerdict, number>;
  blockingFindings: string[];
  summary: string;
}

export function criticDebate(
  opinions: CriticOpinion[],
  output?: string,
): CriticDebateResult {
  void output;
  const verdictCounts: Record<CriticVerdict, number> = {
    pass: 0,
    warn: 0,
    fail: 0,
  };
  const weightedTotals: Record<CriticVerdict, number> = {
    pass: 0,
    warn: 0,
    fail: 0,
  };
  let confidenceTotal = 0;

  for (const opinion of opinions) {
    const confidence = clamp(opinion.confidence ?? 0.5);
    verdictCounts[opinion.verdict] += 1;
    weightedTotals[opinion.verdict] += confidence;
    confidenceTotal += confidence;
  }

  let consensus: CriticVerdict = "pass";
  if (
    verdictCounts.fail > 0 &&
    (weightedTotals.fail >= weightedTotals.pass || verdictCounts.fail >= verdictCounts.pass)
  ) {
    consensus = "fail";
  } else if (verdictCounts.warn > 0 || verdictCounts.fail > 0) {
    const warnPressure = weightedTotals.warn + weightedTotals.fail;
    consensus = weightedTotals.pass > warnPressure * 1.5 ? "pass" : "warn";
  }

  const averageConfidence = opinions.length > 0 ? confidenceTotal / opinions.length : 0;
  const blockingFindings = opinions
    .filter((opinion) => opinion.verdict === "fail")
    .flatMap((opinion) => opinion.findings ?? []);

  return {
    consensus,
    averageConfidence,
    verdictCounts,
    blockingFindings,
    summary: buildSummary(consensus, verdictCounts, blockingFindings),
  };
}

function clamp(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function buildSummary(
  consensus: CriticVerdict,
  verdictCounts: Record<CriticVerdict, number>,
  blockingFindings: string[],
): string {
  const parts = [
    `Consensus: ${consensus}`,
    `pass=${verdictCounts.pass}`,
    `warn=${verdictCounts.warn}`,
    `fail=${verdictCounts.fail}`,
  ];

  if (blockingFindings.length > 0) {
    parts.push(`blocking findings: ${blockingFindings.join("; ")}`);
  }

  return parts.join(" | ");
}
