// =============================================================================
// Verification Critic Runner — orchestrates named critics for structured
// debate flows. Supports synchronous critic functions and async critics.
// Wraps computeConsensus for structured critique with traceability.
// Inspired by CrewAI critic agent patterns + OpenHands review loops.
// =============================================================================

import { randomUUID } from "node:crypto";
import {
  computeConsensus,
  type ConsensusOptions,
  type ConsensusResult,
  type ConsensusVote,
} from "./verification-consensus.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CriticInput {
  task: string;
  output: string;
  context?: Record<string, unknown>;
}

export interface CriticOutput {
  verdict: "pass" | "warn" | "fail";
  confidence?: number;
  findings?: string[];
  rationale?: string;
}

export type CriticFn = (input: CriticInput) => CriticOutput | Promise<CriticOutput>;

export interface CriticRegistration {
  id: string;
  name: string;
  description?: string;
  weight?: number;
  fn: CriticFn;
}

export interface CriticRunResult {
  runId: string;
  agentId: string;
  agentName: string;
  verdict: CriticOutput["verdict"];
  confidence: number;
  findings: string[];
  rationale: string;
  durationMs: number;
}

export interface DebateResult {
  debateId: string;
  task: string;
  criticResults: CriticRunResult[];
  consensus: ConsensusResult;
  overallVerdict: ConsensusResult["verdict"];
  summary: string;
}

// ---------------------------------------------------------------------------
// Critic Runner
// ---------------------------------------------------------------------------

export class VerificationCriticRunner {
  private readonly critics = new Map<string, CriticRegistration>();

  /** Register a critic function. */
  register(critic: CriticRegistration): void {
    this.critics.set(critic.id, { ...critic });
  }

  /** Unregister a critic. */
  unregister(id: string): boolean {
    return this.critics.delete(id);
  }

  /** List registered critic ids. */
  listIds(): string[] {
    return [...this.critics.keys()];
  }

  /**
   * Run all registered critics (or a subset by ids) against the input
   * and produce a consensus result.
   */
  async run(
    input: CriticInput,
    options?: { ids?: string[]; consensusOptions?: ConsensusOptions },
  ): Promise<DebateResult> {
    const debateId = randomUUID();
    const toRun =
      options?.ids && options.ids.length > 0
        ? options.ids
            .map((id) => this.critics.get(id))
            .filter((c): c is CriticRegistration => c !== undefined)
        : [...this.critics.values()];

    const criticResults: CriticRunResult[] = await Promise.all(
      toRun.map(async (critic) => {
        const start = Date.now();
        let output: CriticOutput;
        try {
          output = await Promise.resolve(critic.fn(input));
        } catch (err) {
          output = {
            verdict: "fail",
            findings: [`Critic errored: ${String(err)}`],
            rationale: "Internal critic error.",
          };
        }
        return {
          runId: randomUUID(),
          agentId: critic.id,
          agentName: critic.name,
          verdict: output.verdict,
          confidence: clamp(output.confidence ?? 0.5),
          findings: output.findings ?? [],
          rationale: output.rationale ?? "",
          durationMs: Date.now() - start,
        };
      }),
    );

    const votes: ConsensusVote[] = criticResults.map((result) => ({
      agentId: result.agentId,
      verdict: result.verdict,
      confidence: result.confidence,
      weight: this.critics.get(result.agentId)?.weight ?? 1.0,
      findings: result.findings,
    }));

    const consensus = computeConsensus(votes, options?.consensusOptions);

    return {
      debateId,
      task: input.task,
      criticResults,
      consensus,
      overallVerdict: consensus.verdict,
      summary: buildDebateSummary(criticResults, consensus),
    };
  }

  clear(): void {
    this.critics.clear();
  }
}

// ---------------------------------------------------------------------------
// Built-in heuristic critics
// ---------------------------------------------------------------------------

/** Critic that checks output length and placeholder content. */
export const COMPLETENESS_CRITIC: CriticRegistration = {
  id: "builtin-completeness",
  name: "Completeness Check",
  weight: 0.8,
  fn(input: CriticInput): CriticOutput {
    const output = input.output.trim();
    const hasTodo = /\b(TODO|FIXME|TBD|placeholder)\b/i.test(output);
    const tooShort = output.length < 30;
    const findings: string[] = [];
    if (hasTodo) findings.push("Output contains placeholder language.");
    if (tooShort) findings.push(`Output is too short (${output.length} chars).`);
    return {
      verdict: findings.length > 0 ? "fail" : "pass",
      confidence: findings.length > 0 ? 0.9 : 0.85,
      findings,
    };
  },
};

/** Critic that checks for overconfident or unsupported claims. */
export const HALLUCINATION_CRITIC: CriticRegistration = {
  id: "builtin-hallucination",
  name: "Hallucination Check",
  weight: 1.0,
  fn(input: CriticInput): CriticOutput {
    const patterns = ["guaranteed", "definitely correct", "never fails", "100% accurate"];
    const normalized = input.output.toLowerCase();
    const hits = patterns.filter((p) => normalized.includes(p));
    return {
      verdict: hits.length > 0 ? "warn" : "pass",
      confidence: hits.length > 0 ? 0.75 : 0.9,
      findings: hits.map((h) => `Overconfident claim: "${h}"`),
    };
  },
};

/** Critic that checks task relevance (output addresses the task). */
export const RELEVANCE_CRITIC: CriticRegistration = {
  id: "builtin-relevance",
  name: "Task Relevance Check",
  weight: 1.2,
  fn(input: CriticInput): CriticOutput {
    const taskWords = input.task
      .toLowerCase()
      .split(/\s+/)
      .filter((w) => w.length > 4);
    const normalized = input.output.toLowerCase();
    const matched = taskWords.filter((w) => normalized.includes(w));
    const coverage = taskWords.length > 0 ? matched.length / taskWords.length : 1;
    const verdict = coverage >= 0.5 ? "pass" : coverage >= 0.25 ? "warn" : "fail";
    return {
      verdict,
      confidence: 0.7,
      findings:
        coverage < 0.5
          ? [`Low task relevance: ${(coverage * 100).toFixed(0)}% of task keywords covered.`]
          : [],
    };
  },
};

// ---------------------------------------------------------------------------
// Private helpers
// ---------------------------------------------------------------------------

function clamp(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function buildDebateSummary(results: CriticRunResult[], consensus: ConsensusResult): string {
  const parts = results.map((r) => `${r.agentName}=${r.verdict}`).join(", ");
  return `Debate: [${parts}] → ${consensus.summary}`;
}

/** Global singleton runner with no pre-registered critics. */
export const globalCriticRunner = new VerificationCriticRunner();
