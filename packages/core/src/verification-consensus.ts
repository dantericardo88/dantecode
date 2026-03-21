// =============================================================================
// Verification Consensus — standalone consensus logic for critic/debate flows.
// Extracted as a separate module for reuse across critic-runner and debater.
// Supports weighted voting, quorum, and confidence-aware adjudication.
// Inspired by CrewAI hierarchical consensus patterns.
// =============================================================================

export type ConsensusVerdict = "pass" | "warn" | "fail";

export interface ConsensusVote {
  agentId: string;
  verdict: ConsensusVerdict;
  confidence?: number;
  weight?: number;   // default 1.0
  findings?: string[];
}

export interface ConsensusOptions {
  /** Strategy for resolving consensus. Default: "weighted" */
  strategy?: "majority" | "weighted" | "strict";
  /**
   * Quorum: minimum fraction of votes needed. 0–1.
   * Only applies to "majority" strategy. Default: 0.5
   */
  quorum?: number;
  /**
   * In "strict" mode: any fail → consensus fail, any warn → warn.
   * In "majority": simple count majority.
   * In "weighted": confidence-weighted majority.
   */
}

export interface ConsensusResult {
  verdict: ConsensusVerdict;
  confidence: number;
  voteBreakdown: Record<ConsensusVerdict, number>;
  weightedBreakdown: Record<ConsensusVerdict, number>;
  blockingFindings: string[];
  summary: string;
  quorumMet: boolean;
}

// ---------------------------------------------------------------------------
// Core consensus function
// ---------------------------------------------------------------------------

/**
 * Compute consensus from a set of critic votes.
 */
export function computeConsensus(
  votes: ConsensusVote[],
  options: ConsensusOptions = {},
): ConsensusResult {
  const strategy = options.strategy ?? "weighted";
  const quorumFraction = options.quorum ?? 0.5;

  if (votes.length === 0) {
    return {
      verdict: "pass",
      confidence: 0,
      voteBreakdown: { pass: 0, warn: 0, fail: 0 },
      weightedBreakdown: { pass: 0, warn: 0, fail: 0 },
      blockingFindings: [],
      summary: "No votes cast — default pass.",
      quorumMet: false,
    };
  }

  const voteBreakdown: Record<ConsensusVerdict, number> = { pass: 0, warn: 0, fail: 0 };
  const weightedBreakdown: Record<ConsensusVerdict, number> = { pass: 0, warn: 0, fail: 0 };
  let _totalWeight = 0;
  let totalConfidence = 0;
  const blockingFindings: string[] = [];

  for (const vote of votes) {
    const weight = vote.weight ?? 1.0;
    const confidence = clamp(vote.confidence ?? 0.5);
    voteBreakdown[vote.verdict] += 1;
    weightedBreakdown[vote.verdict] += weight * confidence;
    _totalWeight += weight;
    totalConfidence += confidence;
    if (vote.verdict === "fail") {
      blockingFindings.push(...(vote.findings ?? []));
    }
  }

  const averageConfidence = totalConfidence / votes.length;
  const quorumMet = votes.length >= Math.ceil(quorumFraction * votes.length);

  let verdict: ConsensusVerdict;

  if (strategy === "strict") {
    if (voteBreakdown.fail > 0) {
      verdict = "fail";
    } else if (voteBreakdown.warn > 0) {
      verdict = "warn";
    } else {
      verdict = "pass";
    }
  } else if (strategy === "majority") {
    const maxVerdictCount = Math.max(voteBreakdown.pass, voteBreakdown.warn, voteBreakdown.fail);
    if (voteBreakdown.fail === maxVerdictCount) {
      verdict = "fail";
    } else if (voteBreakdown.warn === maxVerdictCount) {
      verdict = "warn";
    } else {
      verdict = "pass";
    }
  } else {
    // weighted (default)
    if (
      weightedBreakdown.fail > 0 &&
      (weightedBreakdown.fail >= weightedBreakdown.pass || voteBreakdown.fail >= voteBreakdown.pass)
    ) {
      verdict = "fail";
    } else {
      const warnPressure = weightedBreakdown.warn + weightedBreakdown.fail;
      verdict = weightedBreakdown.pass > warnPressure * 1.5 ? "pass" : "warn";
    }
  }

  return {
    verdict,
    confidence: averageConfidence,
    voteBreakdown,
    weightedBreakdown,
    blockingFindings: [...new Set(blockingFindings)],
    summary: buildSummary(verdict, voteBreakdown, blockingFindings),
    quorumMet,
  };
}

// ---------------------------------------------------------------------------
// Private helpers
// ---------------------------------------------------------------------------

function clamp(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function buildSummary(
  verdict: ConsensusVerdict,
  breakdown: Record<ConsensusVerdict, number>,
  findings: string[],
): string {
  const parts = [
    `Consensus: ${verdict}`,
    `pass=${breakdown.pass}`,
    `warn=${breakdown.warn}`,
    `fail=${breakdown.fail}`,
  ];
  if (findings.length > 0) {
    parts.push(`findings: ${findings.slice(0, 2).join("; ")}`);
  }
  return parts.join(" | ");
}
