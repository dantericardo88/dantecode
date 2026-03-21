// ============================================================================
// @dantecode/core — FleetBudget
// Fleet-wide resource budget — prevents runaway agents from consuming
// the entire token/cost budget across all council lanes.
//
// When the aggregate budget is exhausted:
// - Running lanes should receive an abort signal (wired in CouncilOrchestrator)
// - Pending lanes are not started
// - A report shows per-agent consumption
//
// Design: purely synchronous (no async, no IO) — just arithmetic and state.
// ============================================================================

// ----------------------------------------------------------------------------
// Configuration
// ----------------------------------------------------------------------------

/** Fleet-wide resource budget configuration. */
export interface FleetBudgetConfig {
  /** Maximum total tokens across all agents. 0 = unlimited. */
  maxTotalTokens: number;
  /** Maximum tokens per individual agent. 0 = unlimited. */
  maxTokensPerAgent: number;
  /** Maximum total cost in USD. 0 = unlimited. */
  maxTotalCostUsd: number;
  /**
   * Warning threshold (0-1): emit warning at this fraction of budget.
   * Default: 0.8 (80%).
   */
  warningThreshold: number;
}

/** Default configuration: unlimited budget, 80% warning threshold. */
export const DEFAULT_FLEET_BUDGET_CONFIG: FleetBudgetConfig = {
  maxTotalTokens: 0,
  maxTokensPerAgent: 0,
  maxTotalCostUsd: 0,
  warningThreshold: 0.8,
};

// ----------------------------------------------------------------------------
// State
// ----------------------------------------------------------------------------

/** Internal state for a single agent's usage. */
interface AgentUsage {
  tokens: number;
  cost: number;
}

/** Observable state snapshot for the fleet budget. */
export interface FleetBudgetState {
  totalTokensUsed: number;
  totalCostUsd: number;
  perAgent: Map<string, AgentUsage>;
  exhausted: boolean;
  warningEmitted: boolean;
}

// ----------------------------------------------------------------------------
// Report types
// ----------------------------------------------------------------------------

/** Per-agent entry in a fleet budget report. */
export interface AgentBudgetEntry {
  agentId: string;
  tokens: number;
  cost: number;
  /** Percentage of the total tokens consumed by this agent (0-100). */
  pctOfTotal: number;
}

/** Summary report produced by FleetBudget.report(). */
export interface FleetBudgetReport {
  totalTokens: number;
  totalCost: number;
  /** Remaining tokens before fleet budget is exhausted. -1 if unlimited. */
  budgetRemaining: number;
  perAgent: AgentBudgetEntry[];
}

/** Remaining budget for a specific agent. */
export interface AgentBudgetRemaining {
  /** Remaining tokens before this agent's per-agent limit is reached. -1 if unlimited. */
  tokens: number;
  /** Remaining cost budget for this agent. -1 if unlimited. */
  cost: number;
}

// ----------------------------------------------------------------------------
// FleetBudget
// ----------------------------------------------------------------------------

/**
 * Fleet-wide resource budget tracker.
 *
 * Tracks aggregate token and cost usage across all council lanes.
 * Enforces per-agent limits and a fleet-wide ceiling.
 *
 * Purely synchronous — no async, no IO. Designed to be called from the
 * CouncilOrchestrator's poll loop without blocking.
 */
export class FleetBudget {
  private readonly config: FleetBudgetConfig;
  private readonly state: FleetBudgetState;

  constructor(config: Partial<FleetBudgetConfig> = {}) {
    this.config = {
      maxTotalTokens: config.maxTotalTokens ?? DEFAULT_FLEET_BUDGET_CONFIG.maxTotalTokens,
      maxTokensPerAgent: config.maxTokensPerAgent ?? DEFAULT_FLEET_BUDGET_CONFIG.maxTokensPerAgent,
      maxTotalCostUsd: config.maxTotalCostUsd ?? DEFAULT_FLEET_BUDGET_CONFIG.maxTotalCostUsd,
      warningThreshold: config.warningThreshold ?? DEFAULT_FLEET_BUDGET_CONFIG.warningThreshold,
    };
    this.state = {
      totalTokensUsed: 0,
      totalCostUsd: 0,
      perAgent: new Map(),
      exhausted: false,
      warningEmitted: false,
    };
  }

  /**
   * Record token and cost usage for a specific agent.
   *
   * The values passed are CUMULATIVE totals (snapshot from the adapter),
   * not incremental deltas. FleetBudget stores per-agent totals and
   * updates the fleet aggregate accordingly.
   *
   * Returns false if recording this usage causes any limit to be exceeded
   * (per-agent token limit OR fleet-wide token limit OR cost limit).
   * Returns true if usage is within bounds.
   */
  record(agentId: string, tokens: number, costUsd: number): boolean {
    const existing = this.state.perAgent.get(agentId) ?? { tokens: 0, cost: 0 };

    // Guard against backward-moving cumulative values (caller bug or session restart).
    // Clamp to 0 delta — never subtract from fleet totals. Warn but don't throw.
    if (tokens < existing.tokens || costUsd < existing.cost) {
      console.warn(
        `[FleetBudget] cumulative regression for ${agentId}: ` +
          `tokens ${existing.tokens}→${tokens}, cost ${existing.cost}→${costUsd}`,
      );
    }

    // Compute the delta (new cumulative − old cumulative)
    const tokenDelta = Math.max(0, tokens - existing.tokens);
    const costDelta = Math.max(0, costUsd - existing.cost);

    // Update per-agent
    this.state.perAgent.set(agentId, {
      tokens,
      cost: costUsd,
    });

    // Update fleet totals
    this.state.totalTokensUsed += tokenDelta;
    this.state.totalCostUsd += costDelta;

    // Check exhaustion
    const tokenExhausted =
      this.config.maxTotalTokens > 0 && this.state.totalTokensUsed >= this.config.maxTotalTokens;
    const costExhausted =
      this.config.maxTotalCostUsd > 0 && this.state.totalCostUsd >= this.config.maxTotalCostUsd;
    const perAgentExhausted =
      this.config.maxTokensPerAgent > 0 && tokens >= this.config.maxTokensPerAgent;

    // Check warning threshold BEFORE updating exhausted — ensures warning fires
    // even when the same call simultaneously crosses the exhaustion boundary.
    if (!this.state.warningEmitted) {
      const tokenWarning =
        this.config.maxTotalTokens > 0 &&
        this.state.totalTokensUsed / this.config.maxTotalTokens >= this.config.warningThreshold;
      const costWarning =
        this.config.maxTotalCostUsd > 0 &&
        this.state.totalCostUsd / this.config.maxTotalCostUsd >= this.config.warningThreshold;
      if (tokenWarning || costWarning) {
        this.state.warningEmitted = true;
      }
    }

    if (tokenExhausted || costExhausted) {
      this.state.exhausted = true;
    }

    // Return false if ANY limit is exceeded
    return !this.state.exhausted && !perAgentExhausted;
  }

  /**
   * Check if a specific agent can continue (has not hit its per-agent limit
   * AND the fleet-wide budget is not exhausted).
   */
  canContinue(agentId: string): boolean {
    if (this.state.exhausted) return false;

    if (this.config.maxTokensPerAgent > 0) {
      const usage = this.state.perAgent.get(agentId);
      if (usage && usage.tokens >= this.config.maxTokensPerAgent) {
        return false;
      }
    }

    return true;
  }

  /**
   * Check if the fleet-wide budget is approaching exhaustion
   * (crossed the warning threshold).
   */
  isWarning(): boolean {
    return this.state.warningEmitted;
  }

  /**
   * Check if the fleet-wide budget is exhausted.
   * When true, no new work should be started and running lanes should be aborted.
   */
  isExhausted(): boolean {
    return this.state.exhausted;
  }

  /**
   * Get a summary report of current fleet budget usage.
   */
  report(): FleetBudgetReport {
    const perAgent: AgentBudgetEntry[] = [];
    for (const [agentId, usage] of this.state.perAgent) {
      perAgent.push({
        agentId,
        tokens: usage.tokens,
        cost: usage.cost,
        pctOfTotal:
          this.state.totalTokensUsed > 0
            ? Math.round((usage.tokens / this.state.totalTokensUsed) * 100)
            : 0,
      });
    }

    const budgetRemaining =
      this.config.maxTotalTokens > 0
        ? Math.max(0, this.config.maxTotalTokens - this.state.totalTokensUsed)
        : -1;

    return {
      totalTokens: this.state.totalTokensUsed,
      totalCost: this.state.totalCostUsd,
      budgetRemaining,
      perAgent,
    };
  }

  /**
   * Get remaining budget for a specific agent.
   * Returns -1 for unlimited dimensions.
   */
  remainingForAgent(agentId: string): AgentBudgetRemaining {
    const usage = this.state.perAgent.get(agentId) ?? { tokens: 0, cost: 0 };

    const tokens =
      this.config.maxTokensPerAgent > 0
        ? Math.max(0, this.config.maxTokensPerAgent - usage.tokens)
        : -1;

    const cost = -1; // Per-agent cost limit not currently tracked independently

    return { tokens, cost };
  }

  /** Reset all usage state (useful in tests). */
  reset(): void {
    this.state.totalTokensUsed = 0;
    this.state.totalCostUsd = 0;
    this.state.perAgent.clear();
    this.state.exhausted = false;
    this.state.warningEmitted = false;
  }
}
