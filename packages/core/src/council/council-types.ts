// ============================================================================
// @dantecode/core — Council Orchestrator Types
// Core state types for the DanteCode Council Orchestrator:
// a usage-aware, NOMA-enforcing multi-agent Git conductor.
// ============================================================================

import { randomUUID } from "node:crypto";

// ----------------------------------------------------------------------------
// Agent identity
// ----------------------------------------------------------------------------

/** Known agent environment identifiers. */
export type AgentKind = "dantecode" | "codex" | "claude-code" | "antigravity" | "custom";

/** Adapter communication class in priority order. */
export type AdapterKind = "native-cli" | "api" | "file-bridge" | "gui";

// ----------------------------------------------------------------------------
// Usage / health
// ----------------------------------------------------------------------------

/** Observed health states for an agent adapter. */
export type AgentHealthStatus =
  | "ready"
  | "degraded"
  | "soft-capped"
  | "hard-capped"
  | "cooling-down"
  | "offline"
  | "manual-only";

/** Cost tier used in routing decisions. */
export type CostClass = "free" | "subscription" | "pay-per-token" | "local";

/** Task categories that affect routing quality scores. */
export type TaskCategory =
  | "coding"
  | "reviewing"
  | "testing"
  | "synthesis"
  | "debugging"
  | "long-context";

/** Per-task-category quality / cost profile for one agent. */
export interface AgentTaskProfile {
  category: TaskCategory;
  /** 0-100 expected quality for this task type. */
  qualityScore: number;
  /** 0-100 cost score (lower = cheaper). */
  costScore: number;
  /** Estimated average latency in ms. */
  latencyMs: number;
  /** Probability 0-1 that this agent will hit a cap on this task. */
  capRisk: number;
}

// ----------------------------------------------------------------------------
// NOMA — Non-Overlapping Mandate Assignment
// ----------------------------------------------------------------------------

/** Overlap severity level between two lanes. */
export type OverlapLevel = 0 | 1 | 2 | 3 | 4;

/**
 * File ownership mandate for a single council lane.
 * Implements the NOMA contract described in the PRD.
 */
export interface FileMandate {
  laneId: string;
  /** Files this lane may write. */
  ownedFiles: string[];
  /** Files this lane may read but not write. */
  readOnlyFiles: string[];
  /** Files this lane must not touch at all. */
  forbiddenFiles: string[];
  /** Shared contract/type files that may be read-only-written under supervision. */
  contractDependencies: string[];
  /** What to do when overlap is detected. */
  overlapPolicy: "freeze" | "warn" | "allow";
}

// ----------------------------------------------------------------------------
// Overlap detection
// ----------------------------------------------------------------------------

/** A detected overlap between two lanes. */
export interface OverlapRecord {
  id: string;
  laneA: string;
  laneB: string;
  level: OverlapLevel;
  files: string[];
  symbols?: string[];
  detectedAt: string;
  /** Whether either lane has been frozen as a result. */
  frozen: boolean;
  resolution?: "resolved" | "pending-synthesis" | "skipped";
}

// ----------------------------------------------------------------------------
// Handoff packet
// ----------------------------------------------------------------------------

/**
 * Structured handoff packet produced when an agent caps out or goes offline.
 * Must be complete enough for a replacement agent to resume without losing work.
 */
export interface HandoffPacket {
  id: string;
  /** The lane this packet was created for. */
  laneId: string;
  /** Why the handoff was triggered. */
  reason: "hard-cap" | "soft-cap" | "offline" | "error" | "timeout" | "manual";
  createdAt: string;
  /** The high-level goal that was in progress. */
  objective: string;
  /** Git branch name. */
  branch: string;
  /** Absolute path to the worktree. */
  worktreePath: string;
  /** Files that were modified (or being modified) before the handoff. */
  touchedFiles: string[];
  /** Unified diff of in-progress changes. */
  diffSummary: string;
  /** Known facts the replacement agent should be aware of. */
  assumptions: string[];
  /** Verification checks that were completed. */
  completedChecks: string[];
  /** Tests that still need to pass. */
  pendingTests: string[];
  /** Open questions the replacement agent should investigate. */
  openQuestions: string[];
  /** Recommended agent to continue the work. */
  recommendedNextAgent?: AgentKind;
  /** Raw blocker description. */
  blockerReason?: string;
}

// ----------------------------------------------------------------------------
// Agent session state
// ----------------------------------------------------------------------------

/** The durable per-lane state tracked throughout a council run. */
export interface AgentSessionState {
  laneId: string;
  agentKind: AgentKind;
  adapterKind: AdapterKind;
  /** Opaque session/process identifier managed by the adapter. */
  sessionId: string;
  health: AgentHealthStatus;
  worktreePath: string;
  branch: string;
  assignedFiles: string[];
  status:
    | "running"
    | "paused"
    | "frozen"
    | "completed"
    | "failed"
    | "aborted"
    | "handed-off"
    | "reassigned"
    | "retry-pending";
  startedAt?: string;
  completedAt?: string;
  lastProgressAt?: string;
  objective: string;
  taskCategory: TaskCategory;
  /** Files actually written so far (union of all writes). */
  touchedFiles: string[];
  /** Number of times this lane was retried after failure. */
  retryCount: number;
  handoffPacketId?: string;
  errorMessage?: string;
  /** PDSE score from per-lane verification (0-100). Undefined if not yet verified. */
  pdseScore?: number;
  /** Whether per-lane verification passed. Undefined if not yet verified. */
  verificationPassed?: boolean;
  /**
   * Unix timestamp (ms) after which this "retry-pending" session may be promoted
   * to "running". Undefined for sessions that are not pending.
   */
  retryAfterTs?: number;
  /**
   * If this session is paused for retry coordination, holds the laneId of the
   * retry-pending session it is waiting for. Cleared on unfreeze.
   */
  pausedForRetry?: string;
  /**
   * Nesting depth of this lane in a recursive sub-agent hierarchy.
   * 0 = root lane spawned by the user. 1 = first sub-agent level, etc.
   * Enforced against CouncilConfig.maxNestingDepth by assignLane().
   */
  nestingDepth?: number;
  /**
   * Cumulative token usage reported by the adapter for this lane.
   * Updated on each poll cycle when the adapter reports usage.
   */
  tokensUsed?: number;
  /**
   * Cumulative cost in USD reported by the adapter for this lane.
   * Updated on each poll cycle when the adapter reports cost.
   */
  costUsd?: number;
  /**
   * Git branch name for this lane's worktree (e.g. "council/<sessionId>/<laneId>").
   * Populated when worktree is created for the lane.
   */
  worktreeBranch?: string;
  /**
   * Git checkpoint reference for recovery (e.g. commit SHA or stash ref).
   * Populated during checkpoint operations for durable recovery.
   */
  checkpointRef?: string;
}

// ----------------------------------------------------------------------------
// Merge / synthesis
// ----------------------------------------------------------------------------

/** Confidence bucket for a merge candidate. */
export type MergeConfidenceBucket = "high" | "medium" | "low";

/** Decision taken by the merge brain. */
export type MergeDecision = "auto-merge" | "review-required" | "blocked";

/** Evidence bundle produced by the merge brain. */
export interface FinalSynthesisRecord {
  id: string;
  councilRunId: string;
  candidateLanes: string[];
  mergedPatch: string;
  rationale: string;
  /** Original candidate patches keyed by laneId. */
  preservedCandidates: Record<string, string>;
  confidence: MergeConfidenceBucket;
  decision: MergeDecision;
  verificationPassed: boolean;
  auditBundlePath?: string;
  createdAt: string;
}

// ----------------------------------------------------------------------------
// Council run — top-level durable state
// ----------------------------------------------------------------------------

export type CouncilRunStatus =
  | "planning"
  | "running"
  | "blocked"
  | "merging"
  | "verifying"
  | "completed"
  | "failed";

/**
 * The root durable state object for a council orchestration run.
 * Persisted to disk so runs can be resumed after crashes or cap events.
 */
export interface CouncilRunState {
  runId: string;
  repoRoot: string;
  objective: string;
  status: CouncilRunStatus;
  createdAt: string;
  updatedAt: string;
  agents: AgentSessionState[];
  mandates: FileMandate[];
  overlaps: OverlapRecord[];
  handoffs: HandoffPacket[];
  finalSynthesis?: FinalSynthesisRecord;
  /** Path to the append-only audit log for this run. */
  auditLogPath: string;
}

// ----------------------------------------------------------------------------
// Task packet
// ----------------------------------------------------------------------------

/**
 * Task packet sent to an agent adapter to start a lane.
 * Portable protocol that any adapter implementation can consume.
 */
export interface CouncilTaskPacket {
  packetId: string;
  runId: string;
  laneId: string;
  objective: string;
  taskCategory: TaskCategory;
  ownedFiles: string[];
  readOnlyFiles: string[];
  forbiddenFiles: string[];
  contractDependencies: string[];
  worktreePath: string;
  branch: string;
  baseBranch: string;
  assumptions: string[];
  contextFiles?: string[];
  /** Handoff packet to resume from, if applicable. */
  resumeFrom?: HandoffPacket;
}

// ----------------------------------------------------------------------------
// Fleet configuration
// ----------------------------------------------------------------------------

/** Fleet-wide budget configuration (re-exported from fleet-budget). */
export interface FleetBudgetConfig {
  maxTotalTokens: number;
  maxTokensPerAgent: number;
  maxTotalCostUsd: number;
  warningThreshold: number;
}

/**
 * Fleet-level configuration for council runs.
 * Controls nesting depth, lane retries, and resource budgets.
 */
export interface CouncilConfig {
  /**
   * Maximum nesting depth for agent spawning.
   * Default: 1 (parent -> child only).
   * 0 = no sub-agents. 2 = parent -> child -> grandchild.
   */
  maxNestingDepth?: number;
  /** Maximum retries per lane on verification failure. Default: 1. */
  maxLaneRetries?: number;
  /** Fleet-wide resource budget. Omit or set limits to 0 for unlimited. */
  budget?: Partial<FleetBudgetConfig>;
  /**
   * Minimum PDSE score (0-100) required for lane acceptance.
   * Lanes below this score will be retried (up to maxLaneRetries times).
   * Default: 70.
   */
  pdseThreshold?: number;
}

// ----------------------------------------------------------------------------
// Factory helpers
// ----------------------------------------------------------------------------

/** Generate a new council run ID. */
export function newRunId(): string {
  return `council-${Date.now()}-${randomUUID().slice(0, 8)}`;
}

/** Generate a new lane ID. */
export function newLaneId(agentKind: AgentKind): string {
  return `${agentKind}-${randomUUID().slice(0, 8)}`;
}

/** Generate a new handoff packet ID. */
export function newHandoffId(): string {
  return `handoff-${Date.now()}-${randomUUID().slice(0, 8)}`;
}

/** Create a minimal empty CouncilRunState. */
export function createCouncilRunState(
  repoRoot: string,
  objective: string,
  auditLogPath: string,
): CouncilRunState {
  const now = new Date().toISOString();
  return {
    runId: newRunId(),
    repoRoot,
    objective,
    status: "planning",
    createdAt: now,
    updatedAt: now,
    agents: [],
    mandates: [],
    overlaps: [],
    handoffs: [],
    auditLogPath,
  };
}
