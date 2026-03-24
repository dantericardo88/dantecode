// ============================================================================
// @dantecode/core — Council Resilience
// Detects stale agents, handles timeouts, redistributes work on failure,
// and recovers partial completion state for council orchestration.
// ============================================================================

// ────────────────────────────────────────────────────────────────────────────
// Types
// ────────────────────────────────────────────────────────────────────────────

/** Plan for redistributing tasks from a failed agent to available agents. */
export interface RedistributionPlan {
  /** Tasks reassigned from the failed agent to surviving agents. */
  reassignments: Array<{ taskId: string; fromAgent: string; toAgent: string }>;
  /** Tasks that could not be reassigned (no available agents). */
  unassignable: string[];
}

/** Report summarizing partial completion after a council interruption. */
export interface PartialRecoveryReport {
  /** Task IDs that completed successfully. */
  completed: string[];
  /** Task IDs still pending or in-progress at interruption. */
  pending: string[];
  /** Percentage of total tasks completed (0-100). */
  completionPercentage: number;
  /** Whether enough tasks completed to consider the council run salvageable. */
  canContinue: boolean;
}

// ────────────────────────────────────────────────────────────────────────────
// CouncilResilience
// ────────────────────────────────────────────────────────────────────────────

/**
 * Resilience layer for council orchestration.
 *
 * Provides four capabilities:
 * 1. Stale agent detection (no output within timeout)
 * 2. Council-wide timeout monitoring
 * 3. Task redistribution when an agent fails
 * 4. Partial completion recovery reporting
 */
export class CouncilResilience {
  /**
   * Detects whether an agent has gone stale (no output within the timeout).
   *
   * @param _agentId - The agent identifier (for logging context).
   * @param lastOutputAt - Timestamp (ms since epoch) of the agent's last output.
   * @param timeoutMs - Maximum allowed silence in milliseconds.
   * @returns true if the agent is considered stale.
   */
  detectStaleAgent(_agentId: string, lastOutputAt: number, timeoutMs: number): boolean {
    const elapsed = Date.now() - lastOutputAt;
    return elapsed > timeoutMs;
  }

  /**
   * Monitors whether the entire council run has exceeded its maximum duration.
   *
   * @param startedAt - Timestamp (ms since epoch) when the council started.
   * @param maxDurationMs - Maximum allowed council run time in milliseconds.
   * @returns true if the council has exceeded the time limit.
   */
  monitorCouncilTimeout(startedAt: number, maxDurationMs: number): boolean {
    const elapsed = Date.now() - startedAt;
    return elapsed > maxDurationMs;
  }

  /**
   * Creates a redistribution plan for tasks owned by a failed agent.
   *
   * Strategy: round-robin assignment of failed tasks to available agents.
   * Tasks are marked unassignable if no agents are available.
   *
   * @param failedAgentId - The agent that failed.
   * @param failedTasks - Task IDs that were assigned to the failed agent.
   * @param availableAgents - Agent IDs that are still operational.
   * @returns A redistribution plan with reassignments and unassignable tasks.
   */
  handleAgentFailure(
    failedAgentId: string,
    failedTasks: string[],
    availableAgents: string[],
  ): RedistributionPlan {
    if (availableAgents.length === 0) {
      return {
        reassignments: [],
        unassignable: [...failedTasks],
      };
    }

    const reassignments: Array<{ taskId: string; fromAgent: string; toAgent: string }> = [];

    for (let i = 0; i < failedTasks.length; i++) {
      const targetAgent = availableAgents[i % availableAgents.length]!;
      reassignments.push({
        taskId: failedTasks[i]!,
        fromAgent: failedAgentId,
        toAgent: targetAgent,
      });
    }

    return { reassignments, unassignable: [] };
  }

  /**
   * Produces a recovery report for a partially completed council run.
   *
   * The council run is considered continuable if at least 25% of tasks
   * completed successfully (enough state to build upon).
   *
   * @param completedTasks - Task IDs that finished successfully.
   * @param totalTasks - All task IDs (completed + pending).
   * @returns A partial recovery report with completion stats.
   */
  recoverPartialCompletion(
    completedTasks: string[],
    totalTasks: string[],
  ): PartialRecoveryReport {
    const completedSet = new Set(completedTasks);
    const pending = totalTasks.filter((t) => !completedSet.has(t));
    const total = totalTasks.length;
    const completionPercentage = total === 0 ? 100 : Math.round((completedTasks.length / total) * 100);

    // A council run is continuable if at least 25% of tasks succeeded
    const canContinue = completionPercentage >= 25;

    return {
      completed: [...completedTasks],
      pending,
      completionPercentage,
      canContinue,
    };
  }
}
