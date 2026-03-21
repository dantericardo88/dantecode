// ============================================================================
// @dantecode/core — Council Router
// Routes tasks to the best available agent, enforces NOMA mandates,
// and manages lane lifecycle (assignment, freeze, reassignment, handoff).
// ============================================================================

import { randomUUID } from "node:crypto";
import type {
  AgentKind,
  TaskCategory,
  CouncilRunState,
  AgentSessionState,
  FileMandate,
  CouncilTaskPacket,
  HandoffPacket,
} from "./council-types.js";
import { newLaneId, newHandoffId } from "./council-types.js";
import type { UsageLedger } from "./usage-ledger.js";
import type { CouncilAgentAdapter } from "./agent-adapters/base.js";
import { OverlapDetector } from "./overlap-detector.js";
import type { WorktreeSnapshot } from "./worktree-observer.js";

// ----------------------------------------------------------------------------
// Types
// ----------------------------------------------------------------------------

export interface LaneAssignmentRequest {
  objective: string;
  taskCategory: TaskCategory;
  preferredAgent?: AgentKind;
  ownedFiles: string[];
  readOnlyFiles?: string[];
  forbiddenFiles?: string[];
  contractDependencies?: string[];
  worktreePath: string;
  branch: string;
  baseBranch: string;
  assumptions?: string[];
  /**
   * Nesting depth of this lane in a recursive sub-agent hierarchy.
   * 0 = root lane (default). 1 = first level sub-agent. Etc.
   * Enforced against CouncilConfig.maxNestingDepth by CouncilOrchestrator.assignLane().
   */
  nestingDepth?: number;
}

export interface LaneAssignmentResult {
  laneId: string;
  agentKind: AgentKind;
  sessionId: string;
  accepted: boolean;
  reason?: string;
}

export interface ReassignmentRequest {
  laneId: string;
  fromAgent: AgentKind;
  toAgent?: AgentKind; // if omitted, router picks best available
  reason: HandoffPacket["reason"];
  touchedFiles: string[];
  diffSummary: string;
  completedChecks?: string[];
  pendingTests?: string[];
  openQuestions?: string[];
  assumptions?: string[];
  blockerReason?: string;
}

export interface ReassignmentResult {
  success: boolean;
  handoffPacketId: string;
  newLaneId: string;
  newAgentKind: AgentKind;
  reason?: string;
}

// ----------------------------------------------------------------------------
// CouncilRouter
// ----------------------------------------------------------------------------

/**
 * The main routing brain of the Council Orchestrator.
 * Decides which agent gets each task, enforces NOMA, and handles failover.
 */
export class CouncilRouter {
  private readonly ledger: UsageLedger;
  private readonly adapters: Map<AgentKind, CouncilAgentAdapter>;
  private readonly overlapDetector: OverlapDetector;
  private readonly frozenLanes = new Set<string>();
  private runState: CouncilRunState | null = null;

  constructor(
    ledger: UsageLedger,
    adapters: Map<AgentKind, CouncilAgentAdapter>,
  ) {
    this.ledger = ledger;
    this.adapters = adapters;
    this.overlapDetector = new OverlapDetector();
  }

  /** Attach a run state for mutation (set when a council run starts). */
  attachRun(state: CouncilRunState): void {
    this.runState = state;
  }

  // --------------------------------------------------------------------------
  // Lane assignment
  // --------------------------------------------------------------------------

  /**
   * Assign a new lane for a task. Picks the best available agent,
   * validates NOMA mandates, submits the task packet.
   */
  async assignLane(request: LaneAssignmentRequest): Promise<LaneAssignmentResult> {
    const agentKind = this.selectAgent(request.taskCategory, request.preferredAgent);
    if (!agentKind) {
      return {
        laneId: "",
        agentKind: "dantecode",
        sessionId: "",
        accepted: false,
        reason: "No available agent found for this task",
      };
    }

    // Generate the laneId up front so NOMA checks use the real lane ID
    const laneId = newLaneId(agentKind);

    // Check NOMA against existing mandates
    const existingMandates = this.runState?.mandates ?? [];
    for (const file of request.ownedFiles) {
      const check = this.overlapDetector.checkWrite(laneId, file, existingMandates);
      if (!check.safe) {
        return {
          laneId: "",
          agentKind,
          sessionId: "",
          accepted: false,
          reason: `NOMA violation: ${check.reason}`,
        };
      }
    }
    const adapter = this.adapters.get(agentKind)!;

    const packet: CouncilTaskPacket = {
      packetId: randomUUID().slice(0, 12),
      runId: this.runState?.runId ?? "unknown",
      laneId,
      objective: request.objective,
      taskCategory: request.taskCategory,
      ownedFiles: request.ownedFiles,
      readOnlyFiles: request.readOnlyFiles ?? [],
      forbiddenFiles: request.forbiddenFiles ?? [],
      contractDependencies: request.contractDependencies ?? [],
      worktreePath: request.worktreePath,
      branch: request.branch,
      baseBranch: request.baseBranch,
      assumptions: request.assumptions ?? [],
    };

    const submission = await adapter.submitTask(packet);
    if (!submission.accepted) {
      return {
        laneId: "",
        agentKind,
        sessionId: "",
        accepted: false,
        reason: submission.reason,
      };
    }

    // Register mandate and session
    const mandate: FileMandate = {
      laneId,
      ownedFiles: request.ownedFiles,
      readOnlyFiles: request.readOnlyFiles ?? [],
      forbiddenFiles: request.forbiddenFiles ?? [],
      contractDependencies: request.contractDependencies ?? [],
      overlapPolicy: "freeze",
    };

    const session: AgentSessionState = {
      laneId,
      agentKind,
      adapterKind: adapter.kind,
      sessionId: submission.sessionId,
      health: "ready",
      worktreePath: request.worktreePath,
      branch: request.branch,
      assignedFiles: request.ownedFiles,
      status: "running",
      startedAt: new Date().toISOString(),
      lastProgressAt: new Date().toISOString(),
      objective: request.objective,
      taskCategory: request.taskCategory,
      touchedFiles: [],
      retryCount: 0,
      nestingDepth: request.nestingDepth ?? 0,
    };

    if (this.runState) {
      this.runState.mandates.push(mandate);
      this.runState.agents.push(session);
    }

    return {
      laneId,
      agentKind,
      sessionId: submission.sessionId,
      accepted: true,
    };
  }

  // --------------------------------------------------------------------------
  // Freeze / thaw
  // --------------------------------------------------------------------------

  /** Freeze a lane — it will no longer proceed until thawed or resolved. */
  freezeLane(laneId: string): void {
    this.frozenLanes.add(laneId);
    const session = this.runState?.agents.find((a) => a.laneId === laneId);
    if (session) session.status = "frozen";
  }

  /** Thaw a previously frozen lane. */
  thawLane(laneId: string): void {
    this.frozenLanes.delete(laneId);
    const session = this.runState?.agents.find((a) => a.laneId === laneId);
    if (session && session.status === "frozen") session.status = "paused";
  }

  /** Check if a lane is frozen. */
  isFrozen(laneId: string): boolean {
    return this.frozenLanes.has(laneId);
  }

  // --------------------------------------------------------------------------
  // Reassignment / handoff
  // --------------------------------------------------------------------------

  /**
   * Reassign a lane to another agent after a cap, failure, or freeze.
   * Creates a handoff packet and submits to the next best agent.
   */
  async reassignLane(request: ReassignmentRequest): Promise<ReassignmentResult> {
    const currentSession = this.runState?.agents.find((a) => a.laneId === request.laneId);
    const mandate = this.runState?.mandates.find((m) => m.laneId === request.laneId);

    if (!currentSession || !mandate) {
      return { success: false, handoffPacketId: "", newLaneId: "", newAgentKind: request.fromAgent, reason: "Lane not found in run state" };
    }

    // STEP 1: Select next agent FIRST — no state mutations until we know it exists.
    // Exclude the failing agent so alternatives are tried first.
    // Fallback: if no alternative exists (single-adapter setup), allow same agent ONLY when healthy.
    // Hard-capped agents must not be used as fallback — they'd immediately fail again.
    const excludeAgents = new Set<AgentKind>([request.fromAgent]);
    const fromAgentHealth = this.ledger.getHealth(request.fromAgent);
    const nextAgent =
      request.toAgent ??
      this.selectAgent(currentSession.taskCategory, undefined, excludeAgents) ??
      (this.adapters.has(request.fromAgent) && fromAgentHealth !== "hard-capped" ? request.fromAgent : null);

    if (!nextAgent) {
      return { success: false, handoffPacketId: "", newLaneId: "", newAgentKind: request.fromAgent, reason: "No replacement agent available" };
    }

    // STEP 2: Build packets (pure — no state mutations yet)
    const packet: HandoffPacket = {
      id: newHandoffId(),
      laneId: request.laneId,
      reason: request.reason,
      createdAt: new Date().toISOString(),
      objective: currentSession.objective,
      branch: currentSession.branch,
      worktreePath: currentSession.worktreePath,
      touchedFiles: request.touchedFiles,
      diffSummary: request.diffSummary,
      assumptions: request.assumptions ?? [],
      completedChecks: request.completedChecks ?? [],
      pendingTests: request.pendingTests ?? [],
      openQuestions: request.openQuestions ?? [],
      blockerReason: request.blockerReason,
    };

    const newLane = newLaneId(nextAgent);
    const adapter = this.adapters.get(nextAgent)!;

    const newPacket: CouncilTaskPacket = {
      packetId: randomUUID().slice(0, 12),
      runId: this.runState?.runId ?? "unknown",
      laneId: newLane,
      objective: currentSession.objective,
      taskCategory: currentSession.taskCategory,
      ownedFiles: mandate.ownedFiles,
      readOnlyFiles: mandate.readOnlyFiles,
      forbiddenFiles: mandate.forbiddenFiles,
      contractDependencies: mandate.contractDependencies,
      worktreePath: currentSession.worktreePath,
      branch: currentSession.branch,
      baseBranch: "main",
      assumptions: request.assumptions ?? [],
      resumeFrom: packet,
    };

    // STEP 3: Submit — if rejected, currentSession is still untouched
    const submission = await adapter.submitTask(newPacket);
    if (!submission.accepted) {
      return { success: false, handoffPacketId: packet.id, newLaneId: "", newAgentKind: nextAgent, reason: submission.reason };
    }

    // STEP 4: Commit all mutations atomically (only reachable on full success)
    if (this.runState) {
      currentSession.status = "handed-off";
      currentSession.handoffPacketId = packet.id;
      this.runState.handoffs.push(packet);

      // F1: Remove stale overlap records for the old lane
      this.runState.overlaps = this.runState.overlaps.filter(
        (o) => o.laneA !== request.laneId && o.laneB !== request.laneId,
      );

      this.runState.mandates.push({ ...mandate, laneId: newLane });
      this.runState.agents.push({
        laneId: newLane,
        agentKind: nextAgent,
        adapterKind: adapter.kind,
        sessionId: submission.sessionId,
        health: "ready",
        worktreePath: currentSession.worktreePath,
        branch: currentSession.branch,
        assignedFiles: mandate.ownedFiles,
        status: "running",
        startedAt: new Date().toISOString(),
        lastProgressAt: new Date().toISOString(),
        objective: currentSession.objective,
        taskCategory: currentSession.taskCategory,
        touchedFiles: request.touchedFiles,
        retryCount: 0, // orchestrator overwrites this with cumulative count immediately after
      });
    }

    return { success: true, handoffPacketId: packet.id, newLaneId: newLane, newAgentKind: nextAgent };
  }

  // --------------------------------------------------------------------------
  // Overlap enforcement
  // --------------------------------------------------------------------------

  /**
   * Run overlap detection on current worktree snapshots.
   * Automatically freezes lanes that exceed L3 overlap.
   */
  detectAndEnforceOverlap(snapshots: WorktreeSnapshot[]): void {
    if (!this.runState) return;

    const result = this.overlapDetector.detect(snapshots, this.runState.mandates);

    for (const overlap of result.overlaps) {
      this.runState.overlaps.push(overlap);
    }

    for (const laneId of result.lanesToFreeze) {
      this.freezeLane(laneId);
    }
  }

  // --------------------------------------------------------------------------
  // Agent selection
  // --------------------------------------------------------------------------

  /**
   * Select the best available agent for a task category.
   *
   * Priority:
   * 1. Use the preferred agent if healthy.
   * 2. Otherwise, use the highest-scoring available agent.
   */
  private selectAgent(
    category: TaskCategory,
    preferred?: AgentKind,
    exclude?: Set<AgentKind>,
  ): AgentKind | null {
    if (preferred && !exclude?.has(preferred)) {
      const health = this.ledger.getHealth(preferred);
      if (health === "ready" || health === "degraded") {
        const adapter = this.adapters.get(preferred);
        if (adapter) return preferred;
      }
    }

    const ranked = this.ledger.rankAgents(category);
    for (const { kind, score } of ranked) {
      if (score === 0) continue;
      if (exclude?.has(kind)) continue;
      if (!this.adapters.has(kind)) continue;
      return kind;
    }

    return null;
  }
}
