// ============================================================================
// @dantecode/core — Council Usage Ledger
// Tracks adapter health, cap status, latency, cost, and task-type quality
// to inform usage-aware routing decisions.
// ============================================================================

import type {
  AgentKind,
  AgentHealthStatus,
  CostClass,
  TaskCategory,
  AgentTaskProfile,
} from "./council-types.js";

// ----------------------------------------------------------------------------
// Types
// ----------------------------------------------------------------------------

/** A single latency sample used for rolling average computation. */
interface LatencySample {
  durationMs: number;
  recordedAt: number;
}

/** Internal state tracked per agent. */
export interface LedgerEntry {
  agentKind: AgentKind;
  health: AgentHealthStatus;
  costClass: CostClass;
  /** Rolling window of recent task durations (last 20 samples). */
  latencySamples: LatencySample[];
  /** Total tasks completed successfully. */
  successCount: number;
  /** Total tasks that failed or were abandoned. */
  failureCount: number;
  /** ISO timestamp of last successful task completion. */
  lastSuccessAt?: string;
  /** ISO timestamp of last failure or cap event. */
  lastFailureAt?: string;
  /** ISO timestamp of last heartbeat from the adapter. */
  lastHeartbeatAt?: string;
  /** Task-type quality/cost profiles. */
  taskProfiles: AgentTaskProfile[];
  /** Number of consecutive timeouts/no-output windows (used for cap detection). */
  consecutiveTimeouts: number;
}

/** Snapshot of a ledger entry for external consumers. */
export interface LedgerSnapshot {
  agentKind: AgentKind;
  health: AgentHealthStatus;
  costClass: CostClass;
  averageLatencyMs: number;
  successRate: number;
  successCount: number;
  failureCount: number;
  consecutiveTimeouts: number;
  lastSuccessAt?: string;
  lastHeartbeatAt?: string;
  taskProfiles: AgentTaskProfile[];
}

// ----------------------------------------------------------------------------
// Default task profiles
// ----------------------------------------------------------------------------

function defaultProfiles(kind: AgentKind): AgentTaskProfile[] {
  const map: Record<AgentKind, AgentTaskProfile[]> = {
    dantecode: [
      { category: "coding", qualityScore: 90, costScore: 10, latencyMs: 3000, capRisk: 0.05 },
      { category: "reviewing", qualityScore: 85, costScore: 10, latencyMs: 4000, capRisk: 0.05 },
      { category: "testing", qualityScore: 88, costScore: 10, latencyMs: 3500, capRisk: 0.05 },
      { category: "synthesis", qualityScore: 88, costScore: 10, latencyMs: 5000, capRisk: 0.05 },
      { category: "debugging", qualityScore: 87, costScore: 10, latencyMs: 4000, capRisk: 0.05 },
      { category: "long-context", qualityScore: 90, costScore: 10, latencyMs: 6000, capRisk: 0.05 },
    ],
    codex: [
      { category: "coding", qualityScore: 82, costScore: 50, latencyMs: 5000, capRisk: 0.2 },
      { category: "reviewing", qualityScore: 75, costScore: 50, latencyMs: 6000, capRisk: 0.2 },
      { category: "testing", qualityScore: 78, costScore: 50, latencyMs: 5500, capRisk: 0.2 },
      { category: "synthesis", qualityScore: 72, costScore: 50, latencyMs: 7000, capRisk: 0.25 },
      { category: "debugging", qualityScore: 80, costScore: 50, latencyMs: 5000, capRisk: 0.2 },
      { category: "long-context", qualityScore: 70, costScore: 50, latencyMs: 8000, capRisk: 0.3 },
    ],
    "claude-code": [
      { category: "coding", qualityScore: 93, costScore: 40, latencyMs: 4000, capRisk: 0.3 },
      { category: "reviewing", qualityScore: 92, costScore: 40, latencyMs: 5000, capRisk: 0.3 },
      { category: "testing", qualityScore: 90, costScore: 40, latencyMs: 4500, capRisk: 0.3 },
      { category: "synthesis", qualityScore: 94, costScore: 40, latencyMs: 6000, capRisk: 0.35 },
      { category: "debugging", qualityScore: 91, costScore: 40, latencyMs: 4500, capRisk: 0.3 },
      { category: "long-context", qualityScore: 95, costScore: 40, latencyMs: 7000, capRisk: 0.4 },
    ],
    antigravity: [
      { category: "coding", qualityScore: 80, costScore: 30, latencyMs: 6000, capRisk: 0.15 },
      { category: "reviewing", qualityScore: 78, costScore: 30, latencyMs: 7000, capRisk: 0.15 },
      { category: "testing", qualityScore: 75, costScore: 30, latencyMs: 6500, capRisk: 0.15 },
      { category: "synthesis", qualityScore: 78, costScore: 30, latencyMs: 8000, capRisk: 0.2 },
      { category: "debugging", qualityScore: 77, costScore: 30, latencyMs: 7000, capRisk: 0.15 },
      { category: "long-context", qualityScore: 85, costScore: 30, latencyMs: 9000, capRisk: 0.1 },
    ],
    custom: [
      { category: "coding", qualityScore: 70, costScore: 50, latencyMs: 10000, capRisk: 0.2 },
      { category: "reviewing", qualityScore: 65, costScore: 50, latencyMs: 10000, capRisk: 0.2 },
      { category: "testing", qualityScore: 65, costScore: 50, latencyMs: 10000, capRisk: 0.2 },
      { category: "synthesis", qualityScore: 65, costScore: 50, latencyMs: 10000, capRisk: 0.2 },
      { category: "debugging", qualityScore: 65, costScore: 50, latencyMs: 10000, capRisk: 0.2 },
      {
        category: "long-context",
        qualityScore: 60,
        costScore: 50,
        latencyMs: 12000,
        capRisk: 0.25,
      },
    ],
  };
  return map[kind] ?? map.custom;
}

function defaultCostClass(kind: AgentKind): CostClass {
  const map: Record<AgentKind, CostClass> = {
    dantecode: "local",
    codex: "subscription",
    "claude-code": "subscription",
    antigravity: "subscription",
    custom: "pay-per-token",
  };
  return map[kind] ?? "pay-per-token";
}

// ----------------------------------------------------------------------------
// UsageLedger
// ----------------------------------------------------------------------------

const LATENCY_WINDOW = 20;
const TIMEOUT_CAP_THRESHOLD = 3;

/**
 * Tracks the health and capability of each registered agent adapter.
 * Used by the CouncilRouter to make usage-aware routing decisions.
 */
export class UsageLedger {
  private readonly entries = new Map<AgentKind, LedgerEntry>();

  /** Register an agent kind (idempotent). */
  register(kind: AgentKind, costClass?: CostClass): void {
    if (this.entries.has(kind)) return;
    this.entries.set(kind, {
      agentKind: kind,
      health: "ready",
      costClass: costClass ?? defaultCostClass(kind),
      latencySamples: [],
      successCount: 0,
      failureCount: 0,
      taskProfiles: defaultProfiles(kind),
      consecutiveTimeouts: 0,
    });
  }

  /** Record a successful task completion with duration. */
  recordSuccess(kind: AgentKind, durationMs: number): void {
    const entry = this.getOrCreate(kind);
    entry.successCount++;
    entry.consecutiveTimeouts = 0;
    entry.lastSuccessAt = new Date().toISOString();
    entry.latencySamples.push({ durationMs, recordedAt: Date.now() });
    if (entry.latencySamples.length > LATENCY_WINDOW) {
      entry.latencySamples.shift();
    }
    if (entry.health === "degraded" || entry.health === "cooling-down") {
      entry.health = "ready";
    }
  }

  /** Record a task failure. */
  recordFailure(kind: AgentKind, reason?: string): void {
    const entry = this.getOrCreate(kind);
    entry.failureCount++;
    entry.lastFailureAt = new Date().toISOString();
    if (reason?.includes("cap") || reason?.includes("rate-limit")) {
      entry.health = "hard-capped";
    } else if (entry.health !== "hard-capped") {
      entry.health = "degraded";
    }
  }

  /** Record a timeout (no-output window). Escalates to hard-capped after threshold. */
  recordTimeout(kind: AgentKind): void {
    const entry = this.getOrCreate(kind);
    entry.consecutiveTimeouts++;
    if (entry.consecutiveTimeouts >= TIMEOUT_CAP_THRESHOLD) {
      entry.health = "hard-capped";
    } else {
      entry.health = "degraded";
    }
  }

  /** Record a heartbeat from the adapter (resets timeout counter). */
  recordHeartbeat(kind: AgentKind): void {
    const entry = this.getOrCreate(kind);
    entry.lastHeartbeatAt = new Date().toISOString();
    entry.consecutiveTimeouts = 0;
    if (entry.health === "degraded" || entry.health === "cooling-down") {
      entry.health = "ready";
    }
  }

  /** Manually set the health status of an agent. */
  setHealth(kind: AgentKind, health: AgentHealthStatus): void {
    const entry = this.getOrCreate(kind);
    entry.health = health;
    if (health === "hard-capped" || health === "offline") {
      entry.consecutiveTimeouts = TIMEOUT_CAP_THRESHOLD;
    }
    if (health === "ready") {
      entry.consecutiveTimeouts = 0;
    }
  }

  /** Get the current health of an agent. */
  getHealth(kind: AgentKind): AgentHealthStatus {
    return this.entries.get(kind)?.health ?? "offline";
  }

  /** Get a routing score for an agent on a given task type. */
  getRoutingScore(kind: AgentKind, category: TaskCategory): number {
    const entry = this.entries.get(kind);
    if (!entry) return 0;

    // Unavailable agents score 0
    if (
      entry.health === "hard-capped" ||
      entry.health === "offline" ||
      entry.health === "manual-only"
    ) {
      return 0;
    }

    const profile = entry.taskProfiles.find((p) => p.category === category);
    if (!profile) return 0;

    const healthPenalty =
      entry.health === "soft-capped" ? 0.5 : entry.health === "degraded" ? 0.75 : 1.0;
    const successRate =
      entry.successCount + entry.failureCount > 0
        ? entry.successCount / (entry.successCount + entry.failureCount)
        : 1.0;

    return (
      (profile.qualityScore * 0.4 +
        (100 - profile.costScore) * 0.2 +
        (1 - profile.capRisk) * 100 * 0.2 +
        successRate * 100 * 0.2) *
      healthPenalty
    );
  }

  /** Return all agents sorted by routing score for a given task category. */
  rankAgents(category: TaskCategory): Array<{ kind: AgentKind; score: number }> {
    const result: Array<{ kind: AgentKind; score: number }> = [];
    for (const [kind] of this.entries) {
      result.push({ kind, score: this.getRoutingScore(kind, category) });
    }
    return result.sort((a, b) => b.score - a.score);
  }

  /** Get a full snapshot of a ledger entry. */
  getSnapshot(kind: AgentKind): LedgerSnapshot | null {
    const entry = this.entries.get(kind);
    if (!entry) return null;
    const total = entry.latencySamples.length;
    const avgLatency =
      total > 0 ? entry.latencySamples.reduce((s, x) => s + x.durationMs, 0) / total : 0;
    const successRate =
      entry.successCount + entry.failureCount > 0
        ? entry.successCount / (entry.successCount + entry.failureCount)
        : 1.0;
    return {
      agentKind: entry.agentKind,
      health: entry.health,
      costClass: entry.costClass,
      averageLatencyMs: Math.round(avgLatency),
      successRate,
      successCount: entry.successCount,
      failureCount: entry.failureCount,
      consecutiveTimeouts: entry.consecutiveTimeouts,
      lastSuccessAt: entry.lastSuccessAt,
      lastHeartbeatAt: entry.lastHeartbeatAt,
      taskProfiles: entry.taskProfiles,
    };
  }

  /** Get snapshots for all registered agents. */
  getAllSnapshots(): LedgerSnapshot[] {
    return Array.from(this.entries.keys())
      .map((k) => this.getSnapshot(k))
      .filter((s): s is LedgerSnapshot => s !== null);
  }

  private getOrCreate(kind: AgentKind): LedgerEntry {
    if (!this.entries.has(kind)) {
      this.register(kind);
    }
    return this.entries.get(kind)!;
  }
}
