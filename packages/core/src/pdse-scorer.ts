export type VerificationMetricName =
  | "faithfulness"
  | "correctness"
  | "hallucination"
  | "completeness"
  | "safety";

export interface VerificationMetricScore {
  name: VerificationMetricName;
  score: number;
  passed: boolean;
  reason: string;
}

export interface PdseWeights {
  faithfulness: number;
  correctness: number;
  hallucination: number;
  completeness: number;
  safety: number;
}

export interface PdseScoreReport {
  overallScore: number;
  passedGate: boolean;
  gate: number;
  weights: PdseWeights;
}

export interface PdseScoreOptions {
  gate?: number;
  weights?: Partial<PdseWeights>;
}

export const DEFAULT_PDSE_WEIGHTS: PdseWeights = {
  faithfulness: 0.22,
  correctness: 0.28,
  hallucination: 0.18,
  completeness: 0.22,
  safety: 0.1,
};

export function scorePdseMetrics(
  metrics: VerificationMetricScore[],
  options: PdseScoreOptions = {},
): PdseScoreReport {
  const weights: PdseWeights = {
    ...DEFAULT_PDSE_WEIGHTS,
    ...options.weights,
  };
  const gate = options.gate ?? 0.85;

  let totalWeight = 0;
  let weightedScore = 0;

  for (const metric of metrics) {
    const weight = weights[metric.name];
    totalWeight += weight;
    weightedScore += metric.score * weight;
  }

  const overallScore = totalWeight > 0 ? weightedScore / totalWeight : 0;
  return {
    overallScore,
    passedGate: overallScore >= gate,
    gate,
    weights,
  };
}
