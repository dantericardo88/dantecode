// ============================================================================
// @dantecode/core — CouncilOrchestrator
// Top-level coordinator that wires all council modules into a coherent
// lifecycle: start → assign lanes → monitor → detect overlaps → merge → verify.
//
// State machine:
//   planning → running → (blocked | merging) → verifying → completed | failed
// ============================================================================

import { EventEmitter } from "node:events";
import type { AgentKind, CouncilRunState } from "./council-types.js";
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
import type { MergeCandidatePatch } from "./merge-confidence.js";

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
  verifying: ["completed", "failed"],
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
}

export interface OrchestratorStartOptions {
  objective: string;
  agents: AgentKind[];
  repoRoot: string;
  auditLogPath?: string;
}

type OrchestratorEvents = {
  "state:transition": [{ from: CouncilLifecycleStatus; to: CouncilLifecycleStatus; runId: string }];
  "lane:assigned": [{ laneId: string; agentKind: AgentKind }];
  "lane:frozen": [{ laneId: string; reason: string }];
  "lane:reassigned": [{ oldLaneId: string; newLaneId: string; newAgent: AgentKind }];
  "lane:completed": [{ laneId: string; agentKind: string; sessionId: string }];
  "lanes:all-terminal": [];
  "overlap:detected": [{ laneA: string; laneB: string; level: number }];
  "merge:complete": [MergeBrainResult];
  "error": [{ message: string; context?: string }];
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
  private readonly options: Required<CouncilOrchestratorOptions>;
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  /** Prevents double-emit of "lanes:all-terminal" across concurrent poll cycles. */
  private _allTerminalFired = false;

  constructor(
    adapters: Map<AgentKind, CouncilAgentAdapter>,
    options: CouncilOrchestratorOptions = {},
  ) {
    super();
    this.adapters = adapters;
    this.ledger = new UsageLedger();
    this.brain = new MergeBrain();
    this.options = {
      pollIntervalMs: options.pollIntervalMs ?? 15_000,
      baseBranch: options.baseBranch ?? "main",
      auditDir: options.auditDir ?? "",
      allowAutoMerge: options.allowAutoMerge ?? true,
      maxLaneRetries: options.maxLaneRetries ?? 2,
      retryBaseDelayMs: options.retryBaseDelayMs ?? 2_000,
      retryMaxDelayMs: options.retryMaxDelayMs ?? 30_000,
    };

    // Register all adapters in the ledger
    for (const [kind] of adapters) {
      this.ledger.register(kind);
    }

    // Default safety handler: prevents Node ERR_UNHANDLED_ERROR if no external
    // listener is attached. Callers should attach their own handler.
    this.on("error", () => { /* intentional default no-op */ });
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

    const auditLogPath =
      opts.auditLogPath ??
      `${opts.repoRoot}/.dantecode/council/audit.jsonl`;

    const runState = createCouncilRunState(opts.repoRoot, opts.objective, auditLogPath);
    this.runState = runState;
    this._allTerminalFired = false;

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
        const snapshots = this.observer.getLaneIds()
          .map((id) => this.observer!.getSnapshot(id))
          .filter((s) => s !== null);
        this.router?.detectAndEnforceOverlap(snapshots);
      }
    });

    await saveCouncilRun(runState);
    this.transition("running");
    this.observer.start();
    this.startPolling();

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
      if (agent.status === "running" || agent.status === "paused" || agent.status === "retry-pending") {
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
   */
  async assignLane(request: LaneAssignmentRequest) {
    this.assertStatus("running");
    if (!this.router) throw new Error("Router not initialized");

    const result = await this.router.assignLane(request);
    if (result.accepted) {
      this.observer?.register(result.laneId, result.agentKind, request.worktreePath);
      this.emit("lane:assigned", { laneId: result.laneId, agentKind: result.agentKind });
      await this.persistRunState();
    }
    return result;
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

    // Collect patches from completed lanes
    const candidates: MergeCandidatePatch[] = [];
    for (const session of this.runState.agents) {
      if (session.status !== "completed") continue;
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
    await setRunStatus(
      this.runState.repoRoot,
      this.runState.runId,
      "completed",
    );
  }

  /**
   * Abort the run and mark it failed.
   */
  async fail(reason?: string): Promise<void> {
    if (!this.runState) return;
    this.stopPolling();
    this.observer?.stop();
    // Abort any in-process agent loops before transitioning to failed (parallel).
    await Promise.all(
      this.runState.agents
        .filter((s) =>
          s.status === "running" ||
          s.status === "idle" ||
          s.status === "retry-pending" ||
          s.status === "paused",
        )
        .map((s) => {
          const adapter = this.adapters.get(s.agentKind);
          const sessionId = s.sessionId ?? s.laneId;
          return adapter
            ? adapter.abortTask(sessionId).catch(() => { /* per-lane fault isolation */ })
            : Promise.resolve();
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
      throw new Error(`Expected orchestrator to be in status '${expected}' but got '${this.status}'`);
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

  /** Start the adapter completion polling loop. Called automatically by start()/resume(). */
  private startPolling(): void {
    if (this.pollTimer) return;
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
          void this.fail(`watchUntilComplete timed out after ${opts.timeoutMs}ms`);
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
        this.merge()
          .then((mergeResult) => {
            if (mergeResult.success) {
              return this.complete();
            }
            return this.fail(`Merge unsuccessful: ${mergeResult.error ?? "unknown"}`);
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

      const onTransition = ({ to }: { from: CouncilLifecycleStatus; to: CouncilLifecycleStatus; runId: string }) => {
        if (to === "completed" || to === "failed") {
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

    // Snapshot prevents newly-appended retry sessions from being visited
    // in the same poll cycle (fixes same-cycle retry storm — P1).
    const sessionsThisCycle = [...this.runState.agents];

    for (const session of sessionsThisCycle) {
      // ── Promote retry-pending sessions whose backoff has elapsed ──────────
      if (session.status === "retry-pending") {
        if (session.retryAfterTs !== undefined && Date.now() >= session.retryAfterTs) {
          session.status = "running";
          session.retryAfterTs = undefined;
          // Unfreeze lanes paused waiting for this retry lane
          for (const other of this.runState.agents) {
            if (other.pausedForRetry === session.laneId && other.status === "paused") {
              other.status = "running";
              other.pausedForRetry = undefined;
            }
          }
          // Fall through — session is now "running", will be polled below
        } else {
          continue; // backoff not elapsed — skip this cycle
        }
      }

      // ── Only poll running/idle lanes ──────────────────────────────────────
      if (session.status !== "running" && session.status !== "idle") continue;

      const adapter = this.adapters.get(session.agentKind);
      if (!adapter) continue;

      const sessionId = session.sessionId ?? session.laneId;

      try {
        const status = await adapter.pollStatus(sessionId);

        if (status.status === "completed") {
          session.status = "completed";
          session.completedAt = new Date().toISOString();
          await this.persistRunState();
          this.emit("lane:completed", {
            laneId: session.laneId,
            agentKind: session.agentKind as string,
            sessionId,
          });

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
                }

                this.observer?.register(
                  newSession.laneId,
                  newSession.agentKind,
                  newSession.worktreePath,
                );

                // P6: Freeze overlapping running lanes during retry
                if (newSession.assignedFiles.length > 0) {
                  const retryFiles = new Set(newSession.assignedFiles);
                  for (const other of this.runState.agents) {
                    if (other.laneId === newSession.laneId) continue;
                    if (other.status !== "running") continue;
                    if (other.assignedFiles.some((f) => retryFiles.has(f))) {
                      other.status = "paused";
                      other.pausedForRetry = newSession.laneId;
                    }
                  }
                }
              }

              await this.persistRunState();
              this.emitError(
                `Lane ${session.laneId} ${status.status} — retry ` +
                `${(session.retryCount + 1)}/${maxRetries} as ${retryResult.newLaneId}`,
                "retry",
              );
              retried = true;
            }
          }

          if (!retried) {
            session.status = status.status === "aborted" ? "aborted" : "failed";
            if (status.progressSummary) session.errorMessage = status.progressSummary;
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
    if (this.status === "running" && this.runState.agents.length > 0) {
      const allTerminal = this.runState.agents.every(
        (s) =>
          s.status === "completed" ||
          s.status === "failed" ||
          s.status === "aborted" ||
          s.status === "handed-off",
      );
      if (allTerminal && !this._allTerminalFired) {
        this._allTerminalFired = true;
        this.stopPolling();
        this.emit("lanes:all-terminal");
      }
    }
  }

  private async persistRunState(): Promise<void> {
    if (!this.runState) return;
    try {
      await saveCouncilRun(this.runState);
    } catch {
      // Retry once — handles transient FS contention (Windows EBUSY, NFS locks)
      try {
        await saveCouncilRun(this.runState);
      } catch (secondErr: unknown) {
        const msg = secondErr instanceof Error ? secondErr.message : String(secondErr);
        this.emitError(`Failed to persist run state: ${msg}`, "state-store");
      }
    }
  }
}
