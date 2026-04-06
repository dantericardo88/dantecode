// ============================================================================
// @dantecode/core — Multi-Agent Delegation Schema
// A parent agent can spawn child agents for subtasks.
// Based on OpenHands' AgentDelegateAction pattern.
// ============================================================================

import { randomUUID } from "node:crypto";

// ─── Delegation Types ─────────────────────────────────────────────────────────

export interface DelegationRequest {
  parentAgentId: string;
  taskDescription: string;
  /** Relevant files/info for the subtask */
  context: string;
  /** Maximum rounds the child agent may use. Default: 20 */
  maxRounds?: number;
  /** Restrict the child agent to only these tools (e.g. ["Read", "Grep"]) */
  tools?: string[];
  /** If an isolated worktree is needed for the child agent */
  worktreePath?: string;
}

export interface DelegationResult {
  delegationId: string;
  parentAgentId: string;
  success: boolean;
  /** What the child agent produced */
  output: string;
  filesModified: string[];
  roundsUsed: number;
  tokenCount?: number;
  pdseScore?: number;
  error?: string;
}

export interface ActiveDelegation {
  id: string;
  request: DelegationRequest;
  status: "pending" | "running" | "completed" | "failed";
  startedAt: string;
  completedAt?: string;
  /** Partial result, populated when status transitions to completed/failed */
  result?: Partial<DelegationResult>;
}

// ─── Delegation Manager ───────────────────────────────────────────────────────

export class AgentDelegationManager {
  private readonly activeDelegations = new Map<string, ActiveDelegation>();

  /**
   * Register a new delegation request. Returns the generated delegationId.
   */
  delegate(request: DelegationRequest): string {
    const id = randomUUID();
    const delegation: ActiveDelegation = {
      id,
      request,
      status: "pending",
      startedAt: new Date().toISOString(),
    };
    this.activeDelegations.set(id, delegation);
    return id;
  }

  /**
   * Update the status of an existing delegation.
   * No-ops if the delegationId is unknown.
   */
  updateStatus(delegationId: string, status: ActiveDelegation["status"]): void {
    const delegation = this.activeDelegations.get(delegationId);
    if (!delegation) return;
    delegation.status = status;
    if (status === "completed" || status === "failed") {
      delegation.completedAt = new Date().toISOString();
    }
  }

  /**
   * Mark a delegation as complete and attach partial result data.
   */
  complete(delegationId: string, result: Partial<DelegationResult>): void {
    const delegation = this.activeDelegations.get(delegationId);
    if (!delegation) return;
    delegation.status = result.success === false ? "failed" : "completed";
    delegation.completedAt = new Date().toISOString();
    delegation.result = result;
  }

  /**
   * Get all active delegations for a given parent agent.
   */
  getByParent(parentAgentId: string): ActiveDelegation[] {
    const results: ActiveDelegation[] = [];
    for (const delegation of this.activeDelegations.values()) {
      if (delegation.request.parentAgentId === parentAgentId) {
        results.push(delegation);
      }
    }
    return results;
  }

  /**
   * Aggregate metrics across all tracked delegations.
   */
  getMetrics(): {
    totalDelegations: number;
    completedDelegations: number;
    failedDelegations: number;
    averageRoundsUsed: number;
  } {
    let completed = 0;
    let failed = 0;
    let totalRounds = 0;
    let roundCount = 0;

    for (const delegation of this.activeDelegations.values()) {
      if (delegation.status === "completed") {
        completed++;
        if (delegation.result?.roundsUsed !== undefined) {
          totalRounds += delegation.result.roundsUsed;
          roundCount++;
        }
      } else if (delegation.status === "failed") {
        failed++;
      }
    }

    return {
      totalDelegations: this.activeDelegations.size,
      completedDelegations: completed,
      failedDelegations: failed,
      averageRoundsUsed: roundCount > 0 ? totalRounds / roundCount : 0,
    };
  }
}

// ─── Singleton ────────────────────────────────────────────────────────────────

/** Process-scoped singleton delegation manager. */
export const globalDelegationManager = new AgentDelegationManager();
