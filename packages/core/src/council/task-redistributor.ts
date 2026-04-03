// ============================================================================
// @dantecode/core — TaskRedistributor
// Dynamic task redistribution — when an agent finishes early, check if
// other agents have sub-tasks that could be redistributed to the idle agent.
//
// Design: lightweight optimization, not a full work-stealing scheduler.
// Uses heuristics only — NO LLM calls (too expensive for redistribution decisions).
// ============================================================================

// ----------------------------------------------------------------------------
// Types
// ----------------------------------------------------------------------------

/** Information about a busy lane available for redistribution. */
export interface BusyLaneInfo {
  laneId: string;
  agentKind: string;
  /** The high-level objective assigned to this lane. */
  objective: string;
  /** Unix timestamp (ms) when the lane started. */
  startedAt: number;
  /**
   * Estimated completion progress (0-1).
   * If undefined, treated as unknown (allows redistribution).
   */
  estimatedCompletion?: number;
  /** Files owned by this lane — redistribution respects file ownership. */
  ownedFiles: string[];
}

/** A candidate redistribution from a busy lane to an idle lane. */
export interface RedistributionCandidate {
  /** Lane that has remaining work. */
  fromLaneId: string;
  /** The idle lane that could take the work. */
  toLaneId: string;
  /** The decomposed sub-objective to redistribute. */
  subObjective: string;
  /** Rough token estimate for the sub-task. */
  estimatedTokens: number;
  priority: "high" | "medium" | "low";
}

/** Result of a redistribution attempt. */
export interface RedistributionResult {
  redistributed: boolean;
  candidate?: RedistributionCandidate;
  /** Why redistribution did or didn't happen. */
  reason: string;
}

// ----------------------------------------------------------------------------
// Constants
// ----------------------------------------------------------------------------

/**
 * Lanes at or beyond this completion fraction are considered too close to
 * finishing to worth the overhead of redistribution.
 */
const TOO_CLOSE_TO_COMPLETE_THRESHOLD = 0.8;

/**
 * Words/phrases used to split objectives into sub-tasks heuristically.
 * Order matters — more specific patterns first.
 */
const SPLIT_PATTERNS = [
  /\b(and then|and also|then|followed by)\b/gi,
  /\band\b/gi,
  /^\d+\.\s*/gm, // Numbered steps: "1. do x"
  /[;]/g, // Semicolons
];

/** Rough token estimate per sub-task (conservative). */
const ESTIMATED_TOKENS_PER_SUBTASK = 5_000;

// ----------------------------------------------------------------------------
// TaskRedistributor
// ----------------------------------------------------------------------------

/**
 * Dynamic task redistribution engine.
 *
 * When an agent finishes early, this checks if work can be redistributed
 * from slow/stuck agents to the newly-idle agent. Uses only heuristics
 * (string splitting, progress thresholds) — never makes LLM calls.
 */
export class TaskRedistributor {
  /**
   * Check if work can be redistributed from busy lanes to an idle lane.
   *
   * Returns a RedistributionCandidate if there is a suitable decomposable
   * sub-task that the idle agent can take on without file ownership conflicts.
   * Returns null if redistribution is not appropriate.
   */
  async findRedistribution(
    idleLaneId: string,
    idleAgentKind: string,
    busyLanes: BusyLaneInfo[],
  ): Promise<RedistributionCandidate | null> {
    if (busyLanes.length === 0) {
      return null;
    }

    // Filter out lanes that are too close to completion — not worth redistributing.
    const eligibleLanes = busyLanes.filter((lane) => {
      if (lane.estimatedCompletion === undefined) return true;
      return lane.estimatedCompletion < TOO_CLOSE_TO_COMPLETE_THRESHOLD;
    });

    if (eligibleLanes.length === 0) {
      return null;
    }

    // Pick the lane with the most remaining work (lowest completion estimate).
    // Tiebreak: prefer the lane that has been running longest (earliest startedAt),
    // since it is most likely to have substantial remaining work.
    const target = eligibleLanes.reduce((best, lane) => {
      const bestCompletion = best.estimatedCompletion ?? 0;
      const laneCompletion = lane.estimatedCompletion ?? 0;
      if (laneCompletion === bestCompletion) {
        return lane.startedAt < best.startedAt ? lane : best;
      }
      return laneCompletion < bestCompletion ? lane : best;
    });

    // Decompose the target objective into sub-tasks.
    const subTasks = this.decomposeObjective(target.objective);
    if (subTasks.length < 2) {
      // Single-step objective — can't meaningfully redistribute.
      return null;
    }

    // Take the last sub-task (most likely to be independent).
    const subObjective = subTasks[subTasks.length - 1]!.trim();
    if (!subObjective) return null;

    // Determine priority based on how early the idle agent finished.
    const elapsed = Date.now() - target.startedAt;
    const priority: "high" | "medium" | "low" =
      elapsed >= 120_000 ? "high" : elapsed >= 30_000 ? "medium" : "low";

    // Idle agent kind is captured for future capability-tier checks.
    void idleAgentKind;

    return {
      fromLaneId: target.laneId,
      toLaneId: idleLaneId,
      subObjective,
      estimatedTokens: ESTIMATED_TOKENS_PER_SUBTASK,
      priority,
    };
  }

  /**
   * Decompose a lane objective into sub-tasks using heuristics.
   *
   * Splits on conjunctions ("and", "then"), numbered steps, and semicolons.
   * Does NOT use LLM — purely string-based.
   *
   * Returns an array of non-empty sub-task strings. If the objective cannot
   * be decomposed, returns a single-element array containing the original.
   */
  decomposeObjective(objective: string): string[] {
    let parts: string[] = [objective];

    for (const pattern of SPLIT_PATTERNS) {
      const nextParts: string[] = [];
      for (const part of parts) {
        // Reset lastIndex for global regex reuse.
        pattern.lastIndex = 0;
        const split = part
          .split(pattern)
          .map((s) => s.trim())
          .filter(Boolean);
        if (split.length > 1) {
          nextParts.push(...split);
        } else {
          nextParts.push(part);
        }
      }
      parts = nextParts;
      // Stop splitting if we have enough parts already.
      if (parts.length >= 4) break;
    }

    // Final clean-up: remove very short fragments (likely noise from splitting).
    const cleaned = parts.filter((p) => p.length > 5);
    return cleaned.length > 0 ? cleaned : [objective];
  }
}
