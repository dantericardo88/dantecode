// ============================================================================
// @dantecode/core — CouncilOrchestrator
// Top-level coordinator that wires all council modules into a coherent
// lifecycle: start → assign lanes → monitor → detect overlaps → merge → verify.
//
// State machine:
//   planning → running → (blocked | merging) → verifying → completed | failed
// ============================================================================

import { EventEmitter } from "node:events";
import type { AgentKind, CouncilRunState, CouncilConfig } from "./council-types.js";
import { createCouncilRunState } from "./council-types.js";
import {
  saveCouncilRun,
  tryLoadCouncilRun,
  setRunStatus,
  appendHandoffPacket,
} from "./council-state-store.js";
import { UsageLedger } from "./usage-ledger.js";
import type { CouncilAgentAdapter } from "./agent-adapters/base.js";
import { CouncilRouter } from "./council-router.js";
import type { LaneAssignmentRequest, ReassignmentRequest } from "./council-router.js";
import { WorktreeObserver } from "./worktree-observer.js";
import { MergeBrain } from "./merge-brain.js";
import type { MergeBrainResult } from "./merge-brain.js";
import type { WorktreeHooks } from "@dantecode/runtime-spine";
import type { MergeCandidatePatch } from "./merge-confidence.js";
import { FleetBudget } from "./fleet-budget.js";
import type { FleetBudgetReport } from "./fleet-budget.js";
import { TaskRedistributor } from "./task-redistributor.js";
import type { WorktreeCreateResult, WorktreeMergeResult } from "@dantecode/runtime-spine";
import { HealthSurface } from "@dantecode/observability";
// Worktree functions now injected via WorktreeHooks - see merge-brain.ts for pattern

// ----------------------------------------------------------------------------
// Types
// ----------------------------------------------------------------------------

export type CouncilLifecycleStatus =
  | "idle"
  | "planning"
  | "running"
  | "blocked"
  | "merging"
  | "verifying"
  | "completed"
  | "failed";

/** Valid state machine transitions. */
const VALID_TRANSITIONS: Record<CouncilLifecycleStatus, CouncilLifecycleStatus[]> = {
  idle: ["planning"],
  planning: ["running", "failed"],
  running: ["blocked", "merging", "failed"],
  blocked: ["running", "merging", "failed"],
  merging: ["verifying", "failed"],
  verifying: ["completed", "failed", "blocked"],
  completed: [],
  failed: [],
};

export interface CouncilOrchestratorOptions {
  /** Polling interval for worktree observer in ms (default 15 seconds). */
  pollIntervalMs?: number;
  /** Base branch for diff computation (default "main"). */
  baseBranch?: string;
  /** Directory for handoff and audit files. Defaults to <repoRoot>/.dantecode/council. */
  auditDir?: string;
  /** Whether auto-merge is allowed on high-confidence synthesis (default true). */
  allowAutoMerge?: boolean;
  /** Max automatic retries per lane on failure or abort (default 2, 0 = disabled). */
  maxLaneRetries?: number;
  /**
   * Base delay in ms for exponential retry backoff (default 2000).
   * Set to 0 to disable backoff (immediate retry — useful in tests).
   */
  retryBaseDelayMs?: number;
  /**
   * Hard cap on backoff delay in ms (default 30_000).
   */
  retryMaxDelayMs?: number;
  /**
   * Fleet-plus configuration: budget limits, PDSE threshold, nesting depth.
   * All fields optional — omit for unlimited/default behaviour.
   */
  councilConfig?: CouncilConfig;
  /** Worktree create/remove callbacks for structural merge isolation. */
  worktreeHooks?: WorktreeHooks;
}

export interface OrchestratorStartOptions {
  objective: string;
  agents: AgentKind[];
  repoRoot: string;
  auditLogPath?: string;
}

export type OrchestratorEvents = {
  "state:transition": [{ from: CouncilLifecycleStatus; to: CouncilLifecycleStatus; runId: string }];
  "lane:assigned": [{ laneId: string; agentKind: AgentKind }];
  "lane:frozen": [{ laneId: string; reason: string }];
  "lane:reassigned": [{ oldLaneId: string; newLaneId: string; newAgent: AgentKind }];
  "lane:completed": [{ laneId: string; agentKind: string; sessionId: string }];
  "lanes:all-terminal": [];
  "overlap:detected": [{ laneA: string; laneB: string; level: number }];
  "merge:complete": [MergeBrainResult];
  /** Emitted when a retry session enters backoff — waiting for delay to elapse. */
  "lane:retry-pending": [
    { laneId: string; agentKind: string; retryCount: number; retryAfterTs: number },
  ];
  /** Emitted when a running lane is paused because an overlapping retry is in progress. */
  "lane:paused": [{ laneId: string; agentKind: string; pausedForRetry: string }];
  /** Emitted when a paused lane resumes because its coordinating retry finished or was promoted. */
  "lane:resumed": [{ laneId: string; agentKind: string }];
  /** Emitted when per-lane verification passes. */
  "lane:verified": [{ laneId: string; pdseScore: number }];
  /** Emitted when per-lane verification produces a score below the PDSE threshold. */
  "lane:accepted-with-warning": [{ laneId: string; pdseScore: number }];
  /**
   * Emitted when per-lane verification finds no changes at all (score=0).
   * The lane is marked as "failed" and excluded from merge candidates.
   */
  "lane:verify-failed": [{ laneId: string; score: number; findings: string[] }];
  /** Emitted when the fleet budget crosses the warning threshold. */
  "budget:warning": [FleetBudgetReport];
  /** Emitted when fleet budget is fully exhausted — all lanes aborted. */
  "budget:exhausted": [FleetBudgetReport];
  /** Emitted when a single agent's per-agent token limit is reached. */
  "budget:agent-limit": [{ agentId: string; report: FleetBudgetReport }];
  /** Emitted when TaskRedistributor finds a redistribution candidate for an idle lane. */
  redistribution: [{ fromLaneId: string; toLaneId: string; subObjective: string }];
  /** Emitted when a worktree is created for a lane. */
  "worktree:created": [{ laneId: string; worktreePath: string; worktreeBranch: string }];
  /** Emitted when a worktree is successfully merged back to the target branch. */
  "worktree:merged": [
    { laneId: string; worktreeBranch: string; targetBranch: string; commitSha: string },
  ];
  /** Emitted when a worktree is cleaned up (removed). */
  "worktree:cleaned": [{ laneId: string; worktreePath: string; reason: "success" | "failure" }];
  error: [{ message: string; context?: string }];
};

// ----------------------------------------------------------------------------
// CouncilOrchestrator
// ----------------------------------------------------------------------------

/**
 * Wires CouncilRouter + WorktreeObserver + MergeBrain + HandoffEngine
 * into a coordinated lifecycle that advances a CouncilRunState through its
 * full planning → running → merging → verifying → completed path.
 */
export class CouncilOrchestrator extends EventEmitter<OrchestratorEvents> {
  private status: CouncilLifecycleStatus = "idle";
  private runState: CouncilRunState | null = null;
  private readonly ledger: UsageLedger;
  private readonly adapters: Map<AgentKind, CouncilAgentAdapter>;
  private router: CouncilRouter | null = null;
  private observer: WorktreeObserver | null = null;
  private readonly brain: MergeBrain;
  private readonly worktreeHooks?: import("@dantecode/runtime-spine").WorktreeHooks;
  private readonly options: Required<Omit<CouncilOrchestratorOptions, "worktreeHooks">> &
    Pick<CouncilOrchestratorOptions, "worktreeHooks">;
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  /** Prevents double-emit of "lanes:all-terminal" across concurrent poll cycles. */
  private _allTerminalFired = false;
  /** Serializes worktree merge operations — prevents concurrent git operations. */
  private _worktreeMergeLock: Promise<void> = Promise.resolve();
  /** Serializes all persistRunState() calls — prevents concurrent writes to state.json (Windows EBUSY). */
  private _pendingWrite: Promise<void> = Promise.resolve();
  /** Last persist error for observability; null means the most recent write succeeded. */
  private _lastPersistError: string | null = null;
  /** Fleet-wide resource budget tracker. */
  private readonly _budget: FleetBudget;
  /** Set to true after the first budget:warning emission to prevent duplicate events. */
  private _budgetWarnFired = false;
  /** Set to true after the first budget:exhausted emission to prevent duplicate events. */
  private _budgetExhaustFired = false;
  /** Tracks lanes whose per-agent cap has already been signalled — prevents repeated events. */
  private readonly _capExceededLanes = new Set<string>();
  /** Counts poll cycles to enforce a maximum and prevent deadlock. */
  private _pollCount = 0;
  /** Dynamic task redistribution engine. */
  private readonly _redistributor: TaskRedistributor;
  /** Fleet-plus configuration (nesting depth, PDSE threshold, budget). */
  private readonly _config: CouncilConfig;
  /** Health surface for council + lane health checks */
  private readonly _health: HealthSurface;

  constructor(
    adapters: Map<AgentKind, CouncilAgentAdapter>,
    options: CouncilOrchestratorOptions = {},
  ) {
    super();
    this.adapters = adapters;
    this.ledger = new UsageLedger();
    this.worktreeHooks = options.worktreeHooks;
    this.brain = new MergeBrain(options.worktreeHooks);
    this._config = options.councilConfig ?? {};
    this._budget = new FleetBudget(this._config.budget ?? {});
    this._redistributor = new TaskRedistributor();
    this._health = new HealthSurface();
    this._health.setTimeout(3000); // 3 second timeout for health checks
    this.options = {
      pollIntervalMs: options.pollIntervalMs ?? 15_000,
      baseBranch: options.baseBranch ?? "main",
      auditDir: options.auditDir ?? "",
      allowAutoMerge: options.allowAutoMerge ?? true,
      maxLaneRetries: options.maxLaneRetries ?? 2,
      retryBaseDelayMs: options.retryBaseDelayMs ?? 2_000,
      retryMaxDelayMs: options.retryMaxDelayMs ?? 30_000,
      councilConfig: this._config,
      worktreeHooks: options.worktreeHooks,
    };

    // Register all adapters in the ledger
    for (const [kind] of adapters) {
      this.ledger.register(kind);
    }

    // Default safety handler: prevents Node ERR_UNHANDLED_ERROR if no external
    // listener is attached. Callers should attach their own handler.
    this.on("error", () => {
      /* intentional default no-op */
    });
  }

  // --------------------------------------------------------------------------
  // Lifecycle
  // --------------------------------------------------------------------------

  /**
   * Start a new council run.
   * Transitions: idle → planning → running
   */
  async start(opts: OrchestratorStartOptions): Promise<string> {
    this.transition("planning");

    const auditLogPath = opts.auditLogPath ?? `${opts.repoRoot}/.dantecode/council/audit.jsonl`;

    const runState = createCouncilRunState(opts.repoRoot, opts.objective, auditLogPath);
    this.runState = runState;
    this._allTerminalFired = false;
    this._budgetExhaustFired = false;
    this._capExceededLanes.clear(); // Reset per-run dedup guard (not reset by constructor)

    // Init router
    this.router = new CouncilRouter(this.ledger, this.adapters);
    this.router.attachRun(runState);

    // Init worktree observer
    this.observer = new WorktreeObserver({
      pollIntervalMs: this.options.pollIntervalMs,
      baseBranch: this.options.baseBranch,
    });

    // Forward observer errors to orchestrator
    this.observer.on("error", ({ laneId, error }) => {
      this.emitError(`WorktreeObserver error on lane ${laneId}: ${error}`, "observer");
    });

    // Forward drift events — trigger overlap detection
    this.observer.on("drift", () => {
      if (this.status === "running" && this.observer && this.runState) {
        const snapshots = this.observer
          .getLaneIds()
          .map((id) => this.observer!.getSnapshot(id))
          .filter((s) => s !== null);
        this.router?.detectAndEnforceOverlap(snapshots);
      }
    });

    await saveCouncilRun(runState);
    this.transition("running");
    this.observer.start();
    this.startPolling();

    // Register health checks for observability
    this.registerHealthChecks();

    return runState.runId;
  }

  /**
   * Resume a paused or blocked run from persistent state.
   */
  async resume(repoRoot: string, runId: string): Promise<void> {
    const state = await tryLoadCouncilRun(repoRoot, runId);
    if (!state) {
      throw new Error(`Council run not found: ${runId}`);
    }
    if (state.status === "completed" || state.status === "failed") {
      throw new Error(`Cannot resume run in terminal state: ${state.status}`);
    }

    this.runState = state;
    this.router = new CouncilRouter(this.ledger, this.adapters);
    this.router.attachRun(state);

    // Re-register agents from saved state
    for (const agent of state.agents) {
      this.ledger.register(agent.agentKind);
    }

    this.observer = new WorktreeObserver({
      pollIntervalMs: this.options.pollIntervalMs,
      baseBranch: this.options.baseBranch,
    });

    // Re-register active lanes with the observer
    for (const agent of state.agents) {
      if (
        agent.status === "running" ||
        agent.status === "paused" ||
        agent.status === "retry-pending"
      ) {
        this.observer.register(agent.laneId, agent.agentKind, agent.worktreePath);
      }
    }

    this.status = "running";
    this._allTerminalFired = false;
    this.observer.start();
    this.startPolling();
    await setRunStatus(repoRoot, runId, "running");
  }

  /**
   * Assign a lane to the best available agent.
   * Must be called while status is "running".
   *
   * Creates a unique worktree for the lane if one is not already provided in the request.
   * Worktree branch pattern: council/<sessionId>/<laneId>
   */
  async assignLane(request: LaneAssignmentRequest) {
    this.assertStatus("running");
    if (!this.router || !this.runState) throw new Error("Router not initialized");

    // Enforce maxNestingDepth: prevent runaway recursive sub-agent hierarchies.
    const maxDepth = this._config.maxNestingDepth ?? Infinity;
    const requestedDepth = request.nestingDepth ?? 0;
    if (Number.isFinite(maxDepth) && requestedDepth >= maxDepth) {
      throw new Error(
        `Lane at depth ${requestedDepth} exceeds maxNestingDepth=${maxDepth}. ` +
          `Increase CouncilConfig.maxNestingDepth or reduce sub-agent nesting.`,
      );
    }

    // Create a unique worktree for this lane if not provided.
    // The worktree path must be determined before calling router.assignLane
    // because the router creates the AgentSessionState which requires worktreePath.
    let worktreeInfo: WorktreeCreateResult | null = null;
    let finalWorktreePath = request.worktreePath;
    let worktreeBranch: string | undefined = undefined;

    if (this.worktreeHooks && (!request.worktreePath || request.worktreePath === this.runState.repoRoot)) {
      // Generate a temporary laneId for worktree creation.
      // The actual laneId will be assigned by the router.
      const tempLaneId = `lane-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
      try {
        worktreeInfo = await this.createWorktreeForLane(
          tempLaneId,
          this.runState.runId,
          request.baseBranch ?? this.options.baseBranch,
        );
        finalWorktreePath = worktreeInfo.directory;
        worktreeBranch = worktreeInfo.branch;
      } catch (error: unknown) {
        const msg = error instanceof Error ? error.message : String(error);
        throw new Error(`Failed to create worktree for lane: ${msg}`);
      }
    }

    // Update the request with the final worktree path
    const modifiedRequest = { ...request, worktreePath: finalWorktreePath };

    const result = await this.router.assignLane(modifiedRequest);

    if (result.accepted) {
      // Update the session with worktree metadata
      const session = this.runState.agents.find((s) => s.laneId === result.laneId);
      if (session && worktreeBranch) {
        session.worktreeBranch = worktreeBranch;
      }

      this.observer?.register(result.laneId, result.agentKind, finalWorktreePath);
      this.emit("lane:assigned", { laneId: result.laneId, agentKind: result.agentKind });
      await this.persistRunState();
    } else if (worktreeInfo) {
      // Assignment failed — clean up the created worktree
      try {
        await this.cleanupFailedWorktree(
          worktreeInfo.branch, // Use branch as temp identifier
          worktreeInfo.directory,
          false, // Don't preserve on assignment failure
        );
      } catch {
        // Best effort cleanup — don't fail the assignment call
      }
    }

    return result;
  }

  /**
   * Launch multiple lanes concurrently — all lanes begin work simultaneously.
   *
   * Unlike sequential `assignLane()` calls, this method fires all lane assignments
   * in parallel using `Promise.allSettled`, so agents start at the same time rather
   * than one after another. The sequential `pollAllLanes()` loop continues to monitor
   * completion status safely (state machine correctness is preserved in the poll path).
   *
   * Returns the settled results — callers should inspect each result individually.
   * Rejected results are non-fatal: a lane that fails to start is logged but does not
   * abort the other lanes.
   */
  async launchLanesConcurrently(
    requests: LaneAssignmentRequest[],
  ): Promise<PromiseSettledResult<Awaited<ReturnType<typeof this.assignLane>>>[]> {
    this.assertStatus("running");
    const results = await Promise.allSettled(requests.map((req) => this.assignLane(req)));
    for (let i = 0; i < results.length; i++) {
      const r = results[i];
      const req = requests[i];
      if (r?.status === "rejected") {
        const reason = r.reason instanceof Error ? r.reason.message : String(r.reason);
        this.emitError(
          `Lane launch failed for ${req?.preferredAgent ?? "unknown"}: ${reason}`,
          "launchLanesConcurrently",
        );
      }
    }
    return results;
  }

  /**
   * Reassign a lane to a replacement agent (e.g. after a cap event).
   */
  async reassignLane(request: ReassignmentRequest) {
    if (!this.router || !this.runState) throw new Error("Router not initialized");

    const result = await this.router.reassignLane(request);
    if (result.success) {
      this.ledger.recordFailure(request.fromAgent, "cap");
      const handoff = this.runState.handoffs.find((h) => h.id === result.handoffPacketId);
      if (handoff) {
        await appendHandoffPacket(this.runState.repoRoot, this.runState.runId, handoff);
      }
      this.emit("lane:reassigned", {
        oldLaneId: request.laneId,
        newLaneId: result.newLaneId,
        newAgent: result.newAgentKind,
      });
    }
    return result;
  }

  /**
   * Collect all completed lane patches and run the MergeBrain synthesis.
   * Transitions: running → merging → verifying
   */
  async merge(): Promise<MergeBrainResult> {
    this.assertStatus("running");
    if (!this.runState) throw new Error("No active run state");

    this.stopPolling();
    this.transition("merging");
    this.observer?.stop();

    // Collect patches from completed lanes.
    // Lanes where PDSE verification explicitly failed with zero changes
    // (verificationPassed===false and pdseScore===0) are excluded from merge
    // candidates — they produced no output and should not block a successful merge.
    const candidates: MergeCandidatePatch[] = [];
    for (const session of this.runState.agents) {
      if (session.status !== "completed") continue;
      // Gate: skip lanes verified as producing no changes at all
      if (session.verificationPassed === false && (session.pdseScore ?? 1) === 0) continue;
      const adapter = this.adapters.get(session.agentKind);
      if (!adapter) continue;

      const patch = await adapter.collectPatch(session.sessionId).catch(() => null);
      if (patch && patch.unifiedDiff) {
        candidates.push({
          laneId: session.laneId,
          unifiedDiff: patch.unifiedDiff,
          changedFiles: patch.changedFiles,
          sourceBranch: patch.sourceBranch ?? session.branch,
          passedTests: [],
          failedTests: [],
        });
      }
    }

    const result = await this.brain.synthesize({
      runId: this.runState.runId,
      candidates,
      repoRoot: this.runState.repoRoot,
      targetBranch: this.options.baseBranch,
      allowAutoMerge: this.options.allowAutoMerge,
      auditDir: this.options.auditDir || undefined,
    });

    this.runState.finalSynthesis = result.synthesis;
    this.transition("verifying");
    this.emit("merge:complete", result);
    await this.persistRunState();
    return result;
  }

  /**
   * Mark verification as passed and advance to completed.
   */
  async complete(): Promise<void> {
    this.assertStatus("verifying");
    if (!this.runState) throw new Error("No active run state");

    if (this.runState.finalSynthesis) {
      this.runState.finalSynthesis.verificationPassed = true;
    }

    this.transition("completed");
    await setRunStatus(this.runState.repoRoot, this.runState.runId, "completed");
  }

  /**
   * Abort the run and mark it failed.
   */
  async fail(reason?: string): Promise<void> {
    if (!this.runState) return;
    this.stopPolling();
    this.observer?.stop();
    // Abort any in-process agent loops before transitioning to failed.
    // Use allSettled so a single adapter failure cannot block other aborts.
    await Promise.allSettled(
      this.runState.agents
        .filter(
          (s) => s.status === "running" || s.status === "retry-pending" || s.status === "paused",
        )
        .map((s) => {
          const adapter = this.adapters.get(s.agentKind);
          const sessionId = s.sessionId ?? s.laneId;
          return adapter ? adapter.abortTask(sessionId) : Promise.resolve();
        }),
    );
    // Use transition() when the current state allows it so state:transition is emitted.
    // Fall back to direct assignment for states outside the normal machine (e.g. idle).
    try {
      this.transition("failed");
    } catch {
      const prev = this.status;
      this.status = "failed";
      this.emit("state:transition", {
        from: prev,
        to: "failed",
        runId: this.runState?.runId ?? "unknown",
      });
    }
    this.emitError(reason ?? "Run aborted", "orchestrator");
    await setRunStatus(this.runState.repoRoot, this.runState.runId, "failed");
  }

  /**
   * Transition to "blocked" — merge found conflicts that require manual resolution.
   * Unlike fail(), this preserves all lane state and patches for human review.
   * Recovery: resolve conflicts manually, then call resume() to restart from blocked → running.
   */
  async block(reason: string): Promise<void> {
    if (!this.runState) return;
    this.stopPolling();
    this.observer?.stop();
    try {
      this.transition("blocked");
    } catch {
      const prev = this.status;
      this.status = "blocked";
      this.emit("state:transition", {
        from: prev,
        to: "blocked",
        runId: this.runState?.runId ?? "unknown",
      });
    }
    this.emitError(reason, "merge-blocked");
    await setRunStatus(this.runState.repoRoot, this.runState.runId, "blocked");
  }

  // --------------------------------------------------------------------------
  // Observers / state
  // --------------------------------------------------------------------------

  get currentStatus(): CouncilLifecycleStatus {
    return this.status;
  }

  get runId(): string | null {
    return this.runState?.runId ?? null;
  }

  get currentRunState(): CouncilRunState | null {
    return this.runState;
  }

  getLedger(): UsageLedger {
    return this.ledger;
  }

  /** Returns the last persist error message, or null if the most recent write succeeded. */
  get lastPersistError(): string | null {
    return this._lastPersistError;
  }

  /**
   * Verify the output patch for a specific lane using MergeConfidenceScorer.
   * Returns a structured verdict with a 0-1 confidence score and human-readable findings.
   *
   * A lane passes when score >= the configured pdseThreshold (default 0.7).
   * Returns { passed: false, score: 0 } when the lane has no patch or does not exist.
   *
   * This method is safe to call at any lifecycle stage.
   */
  async verifyLaneOutput(
    laneId: string,
  ): Promise<{ passed: boolean; score: number; findings: string[] }> {
    const lane = this.runState?.agents.find((l) => l.laneId === laneId);
    if (!lane) {
      return { passed: false, score: 0, findings: ["Lane not found"] };
    }

    // Collect the patch from the adapter so we can score it
    const adapter = this.adapters.get(lane.agentKind);
    if (!adapter) {
      return { passed: false, score: 0, findings: ["No adapter for agent kind"] };
    }

    const sessionId = lane.sessionId ?? lane.laneId;
    const patch = await adapter.collectPatch(sessionId).catch(() => null);
    if (!patch || !patch.unifiedDiff || typeof patch.unifiedDiff !== "string") {
      // No patch at all — mark lane and emit the verify-failed gate event.
      lane.pdseScore = 0;
      lane.verificationPassed = false;
      const noPatchFindings = ["No patch available"];
      this.emit("lane:verify-failed", { laneId, score: 0, findings: noPatchFindings });
      return { passed: false, score: 0, findings: noPatchFindings };
    }

    // NOMA pre-merge gate: reject the lane if it wrote any forbidden files.
    // This is the first hard enforcement point — overlap-detector catches violations
    // after the fact, but we gate the merge pool here before any patch is accepted.
    const mandate = this.runState?.mandates.find((m) => m.laneId === laneId);
    if (mandate && mandate.forbiddenFiles.length > 0) {
      const violations = patch.changedFiles.filter((f) =>
        mandate.forbiddenFiles.some(
          (fb) => f === fb || f.endsWith(`/${fb}`) || fb.endsWith(`/${f}`),
        ),
      );
      if (violations.length > 0) {
        lane.pdseScore = 0;
        lane.verificationPassed = false;
        const nomaFindings = [`NOMA violation: wrote forbidden file(s): ${violations.join(", ")}`];
        this.emit("lane:verify-failed", { laneId, score: 0, findings: nomaFindings });
        return { passed: false, score: 0, findings: nomaFindings };
      }
    }

    // Diff-based PDSE heuristic — avoids the always-passing scorer trap.
    // Scoring semantics:
    //   empty/trivial patch → 20 (fails 70 threshold) — suspicious lane
    //   source changes, no test files → 55 (fails) — no test evidence
    //   source + test files changed → 85 (passes) — demonstrates test-driven quality
    const testFiles = patch.changedFiles.filter(
      (f) => /\.(test|spec)\.(ts|js)x?$/.test(f) || /__tests__\//.test(f),
    );
    const hasTestEvidence = testFiles.length > 0;
    const diffLines = patch.unifiedDiff
      .split("\n")
      .filter((l) => l.startsWith("+") || l.startsWith("-")).length;
    const hasChanges = patch.changedFiles.length > 0 || diffLines > 0;

    const rawScore = !hasChanges ? 20 : hasTestEvidence ? 85 : 55;
    const normalizedScore = rawScore / 100;

    const pdseThreshold = (this._config.pdseThreshold ?? 70) / 100;
    const passed = normalizedScore >= pdseThreshold;

    const findings: string[] = [];
    if (hasTestEvidence) {
      findings.push(`Test files modified: ${testFiles.join(", ")}`);
    } else {
      findings.push("No test file changes detected in this patch");
    }
    if (!passed) {
      findings.push(`Score ${rawScore} is below threshold ${this._config.pdseThreshold ?? 70}`);
    }

    // Store verification result on the lane for observability
    lane.pdseScore = rawScore;
    lane.verificationPassed = passed;

    // Emit appropriate event so dashboard can update
    if (passed) {
      this.emit("lane:verified", { laneId, pdseScore: rawScore });
    } else {
      this.emit("lane:accepted-with-warning", { laneId, pdseScore: rawScore });
    }

    return { passed, score: normalizedScore, findings };
  }

  /**
   * Get a snapshot of current fleet budget usage.
   * Returns the FleetBudget report for external consumers (e.g. dashboard, tests).
   */
  getBudgetReport(): FleetBudgetReport {
    return this._budget.report();
  }

  /**
   * Create a worktree for a lane with branch pattern: council/<sessionId>/<laneId>
   * Emits worktree:created event on success.
   *
   * @param laneId - Lane identifier
   * @param sessionId - Session identifier (typically runId)
   * @param baseBranch - Base branch to branch from (default: "main")
   * @returns Worktree creation result with path and branch name
   */
  async createWorktreeForLane(
    laneId: string,
    sessionId: string,
    baseBranch: string = "main",
  ): Promise<WorktreeCreateResult> {
    if (!this.runState) throw new Error("No active run state");

    const worktreeBranch = `council/${sessionId}/${laneId}`;
    if (!this.worktreeHooks) {
      throw new Error("WorktreeHooks required for council worktree operations");
    }
    const result = this.worktreeHooks.createWorktree({
      directory: this.runState.repoRoot,
      sessionId: laneId, // Used as worktree directory name
      branch: worktreeBranch,
      baseBranch,
    });

    this.emit("worktree:created", {
      laneId,
      worktreePath: result.directory,
      worktreeBranch: result.branch,
    });

    return result;
  }

  /**
   * Merge a lane's worktree back into the target branch and clean up.
   * Only called for successful lanes that pass PDSE verification.
   * Emits worktree:merged and worktree:cleaned events.
   *
   * @param laneId - Lane identifier
   * @param worktreePath - Absolute path to the worktree
   * @param worktreeBranch - Branch name in the worktree
   * @param targetBranch - Target branch to merge into (default: "main")
   * @returns Merge result with commit SHA
   */
  async mergeAndCleanupWorktree(
    laneId: string,
    worktreePath: string,
    worktreeBranch: string,
    targetBranch: string = "main",
  ): Promise<WorktreeMergeResult> {
    if (!this.runState) throw new Error("No active run state");
    if (!this.worktreeHooks) {
      throw new Error("WorktreeHooks required for council worktree operations");
    }

    const mergeResult = this.worktreeHooks.mergeWorktree(
      worktreePath,
      targetBranch,
      this.runState.repoRoot,
    );

    this.emit("worktree:merged", {
      laneId,
      worktreeBranch,
      targetBranch,
      commitSha: mergeResult.mergeCommitHash || "",
    });

    this.emit("worktree:cleaned", {
      laneId,
      worktreePath,
      reason: "success",
    });

    return mergeResult;
  }

  /**
   * Clean up a failed lane's worktree without merging.
   * Preserves the worktree for manual inspection on failure.
   * Emits worktree:cleaned event.
   *
   * @param laneId - Lane identifier
   * @param worktreePath - Absolute path to the worktree
   * @param preserve - If true, log but don't remove (for manual review). Default: true
   */
  async cleanupFailedWorktree(
    laneId: string,
    worktreePath: string,
    preserve: boolean = true,
  ): Promise<void> {
    if (preserve) {
      // Log for operator but don't remove — allows manual investigation
      this.emitError(
        `Lane ${laneId} failed — worktree preserved at ${worktreePath} for manual review`,
        "worktree-cleanup",
      );
    } else {
      try {
        if (this.worktreeHooks) {
          this.worktreeHooks.removeWorktree(worktreePath);
        }
        this.emit("worktree:cleaned", {
          laneId,
          worktreePath,
          reason: "failure",
        });
      } catch (error: unknown) {
        const msg = error instanceof Error ? error.message : String(error);
        this.emitError(`Failed to remove worktree ${worktreePath}: ${msg}`, "worktree-cleanup");
      }
    }
  }

  // --------------------------------------------------------------------------
  // Private
  // --------------------------------------------------------------------------

  private transition(to: CouncilLifecycleStatus): void {
    const from = this.status;
    const allowed = VALID_TRANSITIONS[from];
    if (!allowed.includes(to)) {
      throw new Error(
        `Invalid council state transition: ${from} → ${to}. Allowed: ${allowed.join(", ")}`,
      );
    }
    this.status = to;
    this.emit("state:transition", { from, to, runId: this.runState?.runId ?? "unknown" });
  }

  private assertStatus(expected: CouncilLifecycleStatus): void {
    if (this.status !== expected) {
      throw new Error(
        `Expected orchestrator to be in status '${expected}' but got '${this.status}'`,
      );
    }
  }

  private emitError(message: string, context?: string): void {
    this.emit("error", { message, context });
  }

  /**
   * Exponential backoff with ±50% jitter.
   * Returns 0 if retryBaseDelayMs === 0 (backoff disabled).
   * retryCount is the FINAL count on the new session (1 = first retry, 2 = second, …)
   */
  private _computeRetryBackoff(retryCount: number): number {
    const base = this.options.retryBaseDelayMs;
    if (base === 0) return 0;
    const raw = base * Math.pow(2, retryCount - 1) * (0.5 + Math.random() * 0.5);
    return Math.min(raw, this.options.retryMaxDelayMs);
  }

  /**
   * Unpause all lanes waiting on retryLaneId completing.
   * Covers the zero-backoff path where sessions never enter "retry-pending"
   * and therefore bypass the promotion block's unpause scan.
   * Must be called BEFORE persistRunState() so on-disk state is never left
   * with lanes permanently paused after a crash.
   */
  private _unpauseWaiters(retryLaneId: string): void {
    if (!this.runState) return;
    for (const other of this.runState.agents) {
      if (other.pausedForRetry === retryLaneId && other.status === "paused") {
        other.status = "running";
        other.pausedForRetry = undefined;
        this.emit("lane:resumed", {
          laneId: other.laneId,
          agentKind: other.agentKind as string,
        });
      }
    }
  }

  /** Start the adapter completion polling loop. Called automatically by start()/resume(). */
  private startPolling(): void {
    if (this.pollTimer) return;
    this._pollCount = 0;
    const intervalMs = this.options.pollIntervalMs;
    this.pollTimer = setInterval(() => void this.pollAllLanes(), intervalMs);
  }

  /** Stop the polling loop. Called by merge()/fail(). */
  private stopPolling(): void {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
  }

  /**
   * Keeps the process alive, polls lanes, and auto-triggers merge + complete
   * when all lanes finish. Returns once the run reaches "completed" or "failed".
   * Use with `--watch` flag.
   */
  watchUntilComplete(opts?: { timeoutMs?: number }): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      if (this.status === "completed" || this.status === "failed") {
        resolve();
        return;
      }

      let timeoutHandle: ReturnType<typeof setTimeout> | undefined;

      const cleanup = () => {
        if (timeoutHandle !== undefined) clearTimeout(timeoutHandle);
        this.off("lanes:all-terminal", onAllTerminal);
        this.off("state:transition", onTransition);
      };

      if (opts?.timeoutMs !== undefined) {
        timeoutHandle = setTimeout(() => {
          cleanup();
          this.fail(`watchUntilComplete timed out after ${opts.timeoutMs}ms`).catch(() => {});
          reject(new Error(`Council run timed out after ${opts.timeoutMs}ms`));
        }, opts.timeoutMs);
      }

      const onAllTerminal = () => {
        this.off("lanes:all-terminal", onAllTerminal);
        if (this.status !== "running") {
          cleanup();
          resolve();
          return;
        }
        this.stopPolling();

        // Fast-path: all completed lanes already merged via worktree path.
        // Calling merge() again would find no patches (worktrees are removed) → skip.
        const completedLanes = this.runState?.agents.filter((s) => s.status === "completed") ?? [];
        const allWorktreeMerged =
          completedLanes.length > 0 && completedLanes.every((s) => s.worktreeMerged === true);
        if (allWorktreeMerged) {
          this.transition("merging");
          this.transition("verifying");
          this.complete().then(() => {
            cleanup();
            resolve();
          }).catch((err: unknown) => {
            const msg = err instanceof Error ? err.message : String(err);
            this.fail(`Complete error: ${msg}`).catch(() => {
              cleanup();
              reject(new Error(msg));
            });
          });
          return;
        }

        this.merge()
          .then((mergeResult) => {
            if (mergeResult.success) {
              return this.complete();
            }
            // Candidates exist but couldn't be auto-merged → blocked (recoverable by human)
            const hasCandidates = (mergeResult.synthesis.candidateLanes?.length ?? 0) > 0;
            if (hasCandidates) {
              return this.block(
                mergeResult.error ?? "Merge blocked: conflicts require manual resolution",
              );
            }
            // Zero candidates: distinguish verify-gate failures from no-op completions.
            //
            // A lane that failed verification WITHOUT a worktree represents a quality gate
            // failure in the unit-test / non-worktree path — fail the run.
            //
            // A lane that failed verification WITH a worktree is typically a no-op
            // (empty diff, score=20) or a threshold miss on a run that still completed —
            // the run should complete (the lane just won't be merged).
            const anyVerifyFailedNoWorktree = this.runState?.agents.some(
              (s) =>
                s.status === "completed" &&
                s.verificationPassed === false &&
                !s.worktreeBranch,
            ) ?? false;
            if (anyVerifyFailedNoWorktree) {
              return this.fail("All lanes failed verification — no viable patches to merge");
            }
            const anyCompleted =
              (this.runState?.agents.some((s) => s.status === "completed") ?? false);
            if (anyCompleted) {
              // Lanes completed (possibly no-op) — nothing to merge is acceptable
              return this.complete();
            }
            return this.fail("All lanes failed — no viable patches to merge");
          })
          .catch((err: unknown) => {
            const msg = err instanceof Error ? err.message : String(err);
            return this.fail(`Auto-merge error: ${msg}`).catch(() => {
              cleanup();
              reject(new Error(`Council run error: ${msg}`));
            });
          });
      };
      this.on("lanes:all-terminal", onAllTerminal);

      const onTransition = ({
        to,
      }: {
        from: CouncilLifecycleStatus;
        to: CouncilLifecycleStatus;
        runId: string;
      }) => {
        if (to === "completed" || to === "failed" || to === "blocked") {
          cleanup();
          resolve();
        }
      };
      this.on("state:transition", onTransition);
    });
  }

  /** Poll all running lanes for completion. Per-lane fault isolation. */
  private async pollAllLanes(): Promise<void> {
    if (!this.runState) return;

    // Guard against infinite polling — fail the run if we exceed the limit.
    const MAX_POLL_ITERATIONS = 10_000;
    this._pollCount++;
    if (this._pollCount >= MAX_POLL_ITERATIONS) {
      await this.fail(`Polling limit exceeded (${MAX_POLL_ITERATIONS} iterations)`);
      return;
    }

    // Snapshot prevents newly-appended retry sessions from being visited
    // in the same poll cycle (fixes same-cycle retry storm — P1).
    const sessionsThisCycle = [...this.runState.agents];

    // ── PHASE 1: Promote retry-pending sessions synchronously (no I/O) ──────
    for (const session of sessionsThisCycle) {
      if (session.status === "retry-pending") {
        if (session.retryAfterTs !== undefined && Date.now() >= session.retryAfterTs) {
          session.status = "running";
          session.retryAfterTs = undefined;
          for (const other of this.runState.agents) {
            if (other.pausedForRetry === session.laneId && other.status === "paused") {
              other.status = "running";
              other.pausedForRetry = undefined;
              this.emit("lane:resumed", {
                laneId: other.laneId,
                agentKind: other.agentKind as string,
              });
            }
          }
        }
      }
    }

    // ── PHASE 2: Fire all pollStatus calls in parallel ────────────────────
    // Collect running sessions (including those just promoted from retry-pending).
    type PollEntry = { session: (typeof sessionsThisCycle)[number]; adapter: CouncilAgentAdapter; sessionId: string };
    const toPoll: PollEntry[] = [];
    for (const session of sessionsThisCycle) {
      if (session.status !== "running") continue;
      const adapter = this.adapters.get(session.agentKind);
      if (!adapter) continue;
      toPoll.push({ session, adapter, sessionId: session.sessionId ?? session.laneId });
    }

    const pollResults = await Promise.allSettled(
      toPoll.map(({ adapter, sessionId }) => adapter.pollStatus(sessionId)),
    );

    // ── PHASE 3: Process results sequentially (state mutations + heavy I/O per lane) ──
    for (let _pi = 0; _pi < toPoll.length; _pi++) {
      const { session, adapter, sessionId } = toPoll[_pi]!;
      const _settled = pollResults[_pi]!;

      try {
        // Surface poll errors the same way as the original per-lane catch {}
        if (_settled.status === "rejected") continue;
        // Re-check: processing a prior lane's result in this same cycle may have
        // paused or transitioned this session (e.g. P6 cross-lane freeze).
        // Skip if no longer "running" — identical to the original sequential guard.
        if (session.status !== "running") continue;
        const status = _settled.value;

        // ── FleetBudget: record usage reported by this poll response ──────
        // Adapters report cumulative totals — FleetBudget.record() handles delta math.
        if (status.tokensUsed !== undefined || status.costUsd !== undefined) {
          const tokensForBudget = status.tokensUsed ?? 0;
          const costForBudget = status.costUsd ?? 0;
          // Mirror usage onto the session for dashboard/observability
          session.tokensUsed = tokensForBudget;
          session.costUsd = costForBudget;
          const canContinue = this._budget.record(session.laneId, tokensForBudget, costForBudget);
          // Per-agent cap path — only when fleet is NOT globally exhausted.
          // If the fleet is exhausted, fall through to the isExhausted() check below.
          if (
            !canContinue &&
            !this._budget.isExhausted() &&
            !this._capExceededLanes.has(session.laneId)
          ) {
            this._capExceededLanes.add(session.laneId);
            this.emit("budget:agent-limit", {
              agentId: session.laneId,
              report: this._budget.report(),
            });
            // Abort the lane — it has consumed its per-agent allocation
            await adapter?.abortTask(sessionId).catch(() => {});
            session.status = "failed";
            session.errorMessage = `Per-agent token cap exceeded (${tokensForBudget} tokens)`;
            // Verify before persisting — ensures pdseScore is set on cap-failed lanes
            // so the merge gate can correctly exclude them (undefined scores pass the gate).
            await this.verifyLaneOutput(session.laneId).catch(() => {});

            // Cleanup capped lane's worktree (preserve for manual review)
            if (session.worktreeBranch && session.worktreePath) {
              await this.cleanupFailedWorktree(
                session.laneId,
                session.worktreePath,
                true, // Preserve on budget cap
              ).catch(() => {
                /* best effort */
              });
            }

            await this.persistRunState();
            continue;
          }
          // Emit warning exactly once when threshold is crossed
          if (this._budget.isWarning() && !this._budgetWarnFired) {
            this._budgetWarnFired = true;
            this.emit("budget:warning", this._budget.report());
          }
          // Hard-stop: abort the entire run when budget is fully exhausted.
          // Guard with _budgetExhaustFired so the event fires exactly once even when
          // pollAllLanes() is called again before the observer stop propagates.
          if (this._budget.isExhausted() && !this._budgetExhaustFired) {
            this._budgetExhaustFired = true;
            this.emit("budget:exhausted", this._budget.report());
            await this.fail("Fleet budget exhausted");
            return;
          }
        }

        if (status.status === "completed") {
          session.status = "completed";
          session.completedAt = new Date().toISOString();
          this._unpauseWaiters(session.laneId);
          await this.persistRunState();
          this.emit("lane:completed", {
            laneId: session.laneId,
            agentKind: session.agentKind as string,
            sessionId,
          });

          // PDSE verification (auto, fail-closed — never crashes the poll loop).
          // Awaited so pdseScore / verificationPassed are persisted immediately after.
          const verifyResult = await this.verifyLaneOutput(session.laneId).catch(() => ({
            passed: false,
            score: 0,
            findings: ["Verification crashed"],
          }));
          await this.persistRunState();

          // Worktree merge/cleanup: only merge if verification passed and worktree was created.
          // Failed lanes preserve worktree for manual review.
          // Guard: skip if a merge was already queued (concurrent poll cycles can process the
          // same lane twice before worktreeMerged is set).
          if (
            session.worktreeBranch &&
            session.worktreePath &&
            verifyResult.passed &&
            !session.worktreeMergeQueued &&
            this.runState
          ) {
            session.worktreeMergeQueued = true;
            // Serialize git merge operations to prevent concurrent branch operations
            // (setInterval can trigger multiple pollAllLanes concurrently).
            const laneId = session.laneId;
            const worktreePath = session.worktreePath;
            const worktreeBranch = session.worktreeBranch;
            this._worktreeMergeLock = this._worktreeMergeLock.then(async () => {
              try {
                await this.mergeAndCleanupWorktree(
                  laneId,
                  worktreePath,
                  worktreeBranch,
                  this.options.baseBranch,
                );
                // Mark lane as worktree-merged so watchUntilComplete can skip MergeBrain re-synthesis
                const s = this.runState?.agents.find((a) => a.laneId === laneId);
                if (s) {
                  s.worktreeMerged = true;
                  await this.persistRunState();
                }
              } catch (error: unknown) {
                const msg = error instanceof Error ? error.message : String(error);
                this.emitError(
                  `Failed to merge worktree for lane ${laneId}: ${msg}`,
                  "worktree-merge",
                );
              }
            });
            await this._worktreeMergeLock;
          } else if (session.worktreeBranch && session.worktreePath) {
            // Verification failed — preserve worktree for manual investigation
            await this.cleanupFailedWorktree(
              session.laneId,
              session.worktreePath,
              true, // Preserve on verification failure
            ).catch(() => {
              /* best effort */
            });
          }

          // ── TaskRedistributor: spawn a new lane using the completing agent ──
          // When a lane finishes, check if any still-running lanes have work
          // that can be decomposed. If so, spawn a new lane via assignLane().
          // Best-effort — never crash the run on redistribution failure.
          if (this.runState && this.router) {
            const busyLanes = this.runState.agents
              .filter(
                (l) =>
                  (l.status === "running" || l.status === "retry-pending") &&
                  l.laneId !== session.laneId,
              )
              .map((l) => ({
                laneId: l.laneId,
                agentKind: l.agentKind as string,
                objective: l.objective,
                startedAt: l.startedAt ? new Date(l.startedAt).getTime() : Date.now(),
                ownedFiles: l.assignedFiles,
              }));
            if (busyLanes.length > 0) {
              try {
                const candidate = await this._redistributor.findRedistribution(
                  session.laneId,
                  session.agentKind as string,
                  busyLanes,
                );
                if (candidate) {
                  // Spawn a real new lane for the sub-objective
                  const newAssignment = await this.assignLane({
                    objective: candidate.subObjective,
                    taskCategory: "coding",
                    ownedFiles: [],
                    worktreePath: session.worktreePath,
                    branch: `${session.branch}-redist-${Date.now()}`,
                    baseBranch: this.options.baseBranch,
                    preferredAgent: session.agentKind,
                    nestingDepth: (session.nestingDepth ?? 0) + 1,
                  }).catch((err: unknown) => {
                    const msg = err instanceof Error ? err.message : String(err);
                    this.emitError(`Redistribution skipped: ${msg}`, "redistribution");
                    return null;
                  });
                  if (newAssignment?.accepted) {
                    this.emit("redistribution", {
                      fromLaneId: candidate.fromLaneId,
                      toLaneId: newAssignment.laneId,
                      subObjective: candidate.subObjective,
                    });
                  }
                }
              } catch {
                // Redistribution is always best-effort
              }
            }
          }
        } else if (status.status === "failed" || status.status === "aborted") {
          const maxRetries = this.options.maxLaneRetries;
          let retried = false;

          if (maxRetries > 0 && session.retryCount < maxRetries && this.router) {
            const handoffReason: "error" | "timeout" =
              status.status === "aborted" ? "timeout" : "error";

            const retryResult = await this.router
              .reassignLane({
                laneId: session.laneId,
                fromAgent: session.agentKind,
                // toAgent intentionally omitted — router tries alternatives first,
                // falls back to same agent for single-adapter setups (P2 fix)
                reason: handoffReason,
                touchedFiles: session.touchedFiles ?? [],
                diffSummary: session.errorMessage ?? `Lane ${status.status}, retrying`,
              })
              .catch(() => null);

            if (retryResult?.success) {
              const newSession = this.runState.agents.find(
                (s) => s.laneId === retryResult.newLaneId,
              );
              if (newSession) {
                // Carry cumulative retry count forward
                newSession.retryCount = session.retryCount + 1;

                // Apply exponential backoff (P1 fix)
                const backoffMs = this._computeRetryBackoff(newSession.retryCount);
                if (backoffMs > 0) {
                  newSession.status = "retry-pending";
                  newSession.retryAfterTs = Date.now() + backoffMs;
                  this.emit("lane:retry-pending", {
                    laneId: newSession.laneId,
                    agentKind: newSession.agentKind as string,
                    retryCount: newSession.retryCount,
                    retryAfterTs: newSession.retryAfterTs,
                  });
                }

                this.observer?.register(
                  newSession.laneId,
                  newSession.agentKind,
                  newSession.worktreePath,
                );

                // P6: Freeze overlapping running lanes during retry.
                // Include touchedFiles (actual writes from failing session carried via handoff)
                // so agents that drifted outside their mandate also trigger the freeze.
                const retryFiles = new Set([
                  ...newSession.assignedFiles,
                  ...(newSession.touchedFiles ?? []),
                ]);
                if (retryFiles.size > 0) {
                  for (const other of this.runState.agents) {
                    if (other.laneId === newSession.laneId) continue;
                    if (other.status !== "running") continue;
                    if (other.assignedFiles.some((f) => retryFiles.has(f))) {
                      other.status = "paused";
                      other.pausedForRetry = newSession.laneId;
                      this.emit("lane:paused", {
                        laneId: other.laneId,
                        agentKind: other.agentKind as string,
                        pausedForRetry: newSession.laneId,
                      });
                    }
                  }
                }

                // Transfer pausedForRetry from current failing session to new retry session.
                // Without this, lanes paused during an N-deep retry chain (maxLaneRetries ≥ 2)
                // stay permanently paused — _unpauseWaiters is never called for the old laneId
                // because the !retried branch is skipped when retried = true.
                for (const other of this.runState.agents) {
                  if (other.pausedForRetry === session.laneId && other.status === "paused") {
                    other.pausedForRetry = newSession.laneId;
                  }
                }
              }

              await this.persistRunState();
              this.emitError(
                `Lane ${session.laneId} ${status.status} — retry ` +
                  `${session.retryCount + 1}/${maxRetries} as ${retryResult.newLaneId}`,
                "retry",
              );
              retried = true;
            }
          }

          if (!retried) {
            session.status = status.status === "aborted" ? "aborted" : "failed";
            if (status.progressSummary) session.errorMessage = status.progressSummary;
            this._unpauseWaiters(session.laneId);

            // Cleanup failed lane's worktree (preserve for manual review)
            if (session.worktreeBranch && session.worktreePath) {
              await this.cleanupFailedWorktree(
                session.laneId,
                session.worktreePath,
                true, // Preserve on failure
              ).catch(() => {
                /* best effort */
              });
            }

            await this.persistRunState();
          }
        } else if (status.status === "capped" || status.status === "stalled") {
          session.health = "soft-capped";
        }
      } catch {
        // Per-lane fault isolation
      }
    }

    // ── allTerminal check with double-emit guard (P5 fix) ─────────────────
    // "retry-pending" and "paused" are NOT terminal — they represent active work.
    // Wait for any in-flight worktree merges to complete before firing the event,
    // so watchUntilComplete sees a consistent worktreeMerged state.
    await this._worktreeMergeLock;
    if (this.status === "running" && this.runState.agents.length > 0) {
      // A lane is "fully terminal" only when:
      //  - Status is in a terminal state, AND
      //  - If it completed with a worktree, the verify+merge decision has been made
      //    (either merge was queued, or verification failed/crashed).
      // This prevents a concurrent poll cycle from firing lanes:all-terminal before another
      // concurrent cycle has finished running verify/merge for the last lane.
      const allTerminal = this.runState.agents.every((s) => {
        const isTerminalStatus =
          s.status === "completed" ||
          s.status === "failed" ||
          s.status === "aborted" ||
          s.status === "handed-off";
        if (!isTerminalStatus) return false;
        // For completed lanes with a worktree, ensure verify+merge decision was made.
        // verificationPassed === undefined means verify hasn't run yet.
        if (s.status === "completed" && s.worktreeBranch) {
          return s.worktreeMergeQueued === true || s.verificationPassed === false;
        }
        return true;
      });
      if (allTerminal && !this._allTerminalFired) {
        this._allTerminalFired = true;
        this.stopPolling();
        this.emit("lanes:all-terminal");
      }
    }
  }

  private persistRunState(): Promise<void> {
    // Chain writes through the mutex — serializes all FS writes so concurrent poll
    // cycles never call saveCouncilRun simultaneously (eliminates Windows EBUSY races).
    this._pendingWrite = this._pendingWrite.then(() => this._doWrite()).catch(() => {});
    return this._pendingWrite;
  }

  private async _doWrite(): Promise<void> {
    if (!this.runState) return;
    try {
      await saveCouncilRun(this.runState);
      this._lastPersistError = null;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      this._lastPersistError = msg;
      this.emitError(`Failed to persist run state: ${msg}`, "state-store");
    }
  }

  // --------------------------------------------------------------------------
  // Observability: Health Checks
  // --------------------------------------------------------------------------

  /**
   * Register health checks for council components.
   * Called from start() to enable runtime health monitoring.
   */
  private registerHealthChecks(): void {
    // Clear existing checks (in case of resume)
    this._health.clear();

    // Health check: Fleet budget
    this._health.registerCheck("fleet-budget", async () => {
      const report = this._budget.report();
      // budgetRemaining = -1 means unlimited
      if (report.budgetRemaining === -1) return "healthy";
      // Exhausted if no budget remaining
      if (report.budgetRemaining <= 0) return "unhealthy";
      // Degraded if less than 20% remaining (assuming some initial budget)
      // Note: We don't know the initial budget, so we just check if very low
      if (report.budgetRemaining < 1000) return "degraded";
      return "healthy";
    });

    // Health check: Per-lane health (checks if any lanes are in error/failed state)
    this._health.registerCheck("lanes", async () => {
      if (!this.runState) return "healthy";

      const failedCount = this.runState.agents.filter(
        (a) => a.status === "failed" || a.status === "aborted",
      ).length;
      const totalCount = this.runState.agents.length;

      if (failedCount === totalCount && totalCount > 0) return "unhealthy"; // All lanes failed
      if (failedCount > 0) return "degraded"; // Some lanes failed
      return "healthy";
    });

    // Health check: Orchestrator state
    this._health.registerCheck("orchestrator-state", async () => {
      if (this.status === "failed") return "unhealthy";
      if (this.status === "blocked") return "degraded";
      return "healthy";
    });
  }

  /**
   * Get current health report for all registered checks.
   * Useful for CLI commands and monitoring dashboards.
   */
  async getHealthReport() {
    return this._health.runChecks();
  }
}
