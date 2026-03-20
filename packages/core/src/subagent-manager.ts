// ============================================================================
// @dantecode/core — Sub-Agent Registry, Spawn, and Parallel Orchestration
// Inspired by CrewAI agent orchestration + OpenHands multi-agent patterns.
// Provides lifecycle management for spawned sub-agents with depth-gating,
// concurrency control, and result merging.
// ============================================================================

import { randomUUID } from "node:crypto";
import { fingerprintAction, LoopDetector } from "./loop-detector.js";
import { criticDebate, type CriticDebateResult, type CriticOpinion } from "./critic-debater.js";

// ----------------------------------------------------------------------------
// Types & Interfaces
// ----------------------------------------------------------------------------

/** Configuration for a spawned sub-agent. */
export interface SubAgentConfig {
  /** Unique identifier for this agent. */
  id: string;
  /** Human-readable name. */
  name: string;
  /** What this agent is responsible for. */
  description: string;
  /** Tools available to this agent. */
  tools: string[];
  /** Maximum nesting depth allowed for children spawned by this agent. */
  maxDepth: number;
  /** Maximum rounds this agent may use. */
  maxRounds: number;
  /** Whether the agent runs in an isolated git worktree. */
  worktreeIsolation: boolean;
  /** ID of the parent agent, if any. */
  parentId?: string;
  /** Session ID for correlation with the host session. */
  sessionId?: string;
}

/** A unit of work assigned to a sub-agent. */
export interface SubAgentTask {
  /** Unique identifier for this task. */
  id: string;
  /** The agent executing this task. */
  agentId: string;
  /** The prompt / instruction for the agent. */
  prompt: string;
  /** Current execution state. */
  status: "pending" | "running" | "completed" | "failed" | "cancelled";
  /** Output produced by the agent on success. */
  result?: string;
  /** Error message on failure. */
  error?: string;
  /** ISO-8601 timestamp when the task transitioned to "running". */
  startedAt?: string;
  /** ISO-8601 timestamp when the task reached a terminal state. */
  completedAt?: string;
  /** Number of rounds consumed so far. */
  rounds: number;
}

/** Options passed to `spawn()` or `spawnParallel()`. */
export interface SpawnOptions {
  /** Custom name for the agent. Auto-generated if omitted. */
  name?: string;
  /** Human-readable description of what the agent should accomplish. */
  description?: string;
  /** Tools to make available. Defaults to an empty set (inherits from host). */
  tools?: string[];
  /** Run the agent in a git worktree. Default: false. */
  worktreeIsolation?: boolean;
  /** Override the default max rounds for this agent. */
  maxRounds?: number;
  /** Parent agent ID for depth tracking. */
  parentId?: string;
  /** Session correlation ID. */
  sessionId?: string;
}

/** Outcome from a single parallel task. */
export interface ParallelResult {
  /** The task that was executed. */
  taskId: string;
  /** The agent that executed it. */
  agentId: string;
  /** Terminal state of the task. */
  status: "completed" | "failed";
  /** Agent output on success. */
  result?: string;
  /** Error description on failure. */
  error?: string;
}

/** Aggregated outcome from `mergeResults()`. */
export interface MergedResult {
  /** Per-task results. */
  results: ParallelResult[];
  /** Number of tasks that completed successfully. */
  successCount: number;
  /** Number of tasks that failed. */
  failureCount: number;
  /** All agent outputs concatenated (failures include their error). */
  combinedOutput: string;
}

/** Snapshot of task counts by status. */
export interface AgentStats {
  total: number;
  pending: number;
  running: number;
  completed: number;
  failed: number;
  cancelled: number;
}

/** Constructor options for `SubAgentManager`. */
export interface SubAgentManagerOptions {
  /** Maximum concurrent agents. Default: 4. */
  maxConcurrency?: number;
  /** Maximum agent nesting depth. Default: 3. */
  maxDepth?: number;
  /** Default maximum rounds per agent. Default: 50. */
  defaultMaxRounds?: number;
  /** Injectable hook to create an isolated git worktree and return its path. */
  createWorktreeHook?: (agentId: string) => Promise<string>;
  /** Injectable hook to cleanup the worktree after task completion. */
  cleanupWorktreeHook?: (agentId: string) => Promise<void>;
}

// ----------------------------------------------------------------------------
// Constants
// ----------------------------------------------------------------------------

const DEFAULT_MAX_CONCURRENCY = 4;
const DEFAULT_MAX_DEPTH = 3;
const DEFAULT_MAX_ROUNDS = 50;
const COMPLEXITY_DELEGATE_THRESHOLD = 0.7;

// ----------------------------------------------------------------------------
// SubAgentManager
// ----------------------------------------------------------------------------

/**
 * Registry and orchestrator for sub-agents.
 *
 * Responsibilities:
 * - Spawn individual or parallel agent tasks.
 * - Enforce depth and concurrency limits.
 * - Track lifecycle transitions (pending → running → completed/failed/cancelled).
 * - Merge parallel results into a single `MergedResult`.
 * - Gate delegation decisions via `shouldDelegate()`.
 *
 * Usage:
 * ```ts
 * const manager = new SubAgentManager({ maxConcurrency: 4, maxDepth: 3 });
 * const task = manager.spawn("Refactor auth module", { tools: ["Read", "Edit"] });
 * // ... executor drives the task ...
 * manager.completeTask(task.id, "Refactored 3 files.");
 * ```
 */
export class SubAgentManager {
  private readonly agents: Map<string, SubAgentConfig> = new Map();
  private readonly tasks: Map<string, SubAgentTask> = new Map();
  /** Maps agentId → current nesting depth of that agent. */
  private readonly currentDepth: Map<string, number> = new Map();
  /** Maps task/agent → assigned isolated worktree path. */
  public readonly agentWorktrees: Map<string, string> = new Map();
  private readonly options: Required<SubAgentManagerOptions>;

  constructor(options: SubAgentManagerOptions = {}) {
    this.options = {
      maxConcurrency: options.maxConcurrency ?? DEFAULT_MAX_CONCURRENCY,
      maxDepth: options.maxDepth ?? DEFAULT_MAX_DEPTH,
      defaultMaxRounds: options.defaultMaxRounds ?? DEFAULT_MAX_ROUNDS,
      createWorktreeHook: options.createWorktreeHook ?? (async () => ""),
      cleanupWorktreeHook: options.cleanupWorktreeHook ?? (async () => {}),
    };
  }

  // --------------------------------------------------------------------------
  // Spawning
  // --------------------------------------------------------------------------

  /**
   * Spawns a new sub-agent and creates a pending task for it.
   *
   * @param prompt - The instruction or goal for the agent.
   * @param options - Optional configuration overrides.
   * @returns The newly created `SubAgentTask` in "pending" state.
   * @throws {Error} If the requested spawn depth exceeds `maxDepth`.
   */
  spawn(prompt: string, options: SpawnOptions = {}): SubAgentTask {
    // Determine nesting depth for this spawn.
    const parentDepth = options.parentId
      ? (this.currentDepth.get(options.parentId) ?? 0)
      : 0;
    const depth = parentDepth + (options.parentId ? 1 : 0);

    if (!this.validateDepthLimit(depth)) {
      throw new Error(
        `SubAgent spawn rejected: depth ${depth} exceeds maxDepth ${this.options.maxDepth}. ` +
          `Consider flattening the task hierarchy.`,
      );
    }

    const agentId = randomUUID();
    const taskId = randomUUID();

    // Build the agent fingerprint for loop detection correlation.
    fingerprintAction("spawn", prompt);

    const config: SubAgentConfig = {
      id: agentId,
      name: options.name ?? `agent-${agentId.slice(0, 8)}`,
      description: options.description ?? prompt.slice(0, 120),
      tools: options.tools ?? [],
      maxDepth: this.options.maxDepth,
      maxRounds: options.maxRounds ?? this.options.defaultMaxRounds,
      worktreeIsolation: options.worktreeIsolation ?? false,
      parentId: options.parentId,
      sessionId: options.sessionId,
    };

    const task: SubAgentTask = {
      id: taskId,
      agentId,
      prompt,
      status: "pending",
      rounds: 0,
    };

    this.agents.set(agentId, config);
    this.tasks.set(taskId, task);
    this.currentDepth.set(agentId, depth);

    return task;
  }

  /**
   * Initializes the worktree for an isolated agent. Must be called immediately after spawn if `worktreeIsolation` is true.
   */
  async initializeWorktree(agentId: string): Promise<string> {
    const config = this.agents.get(agentId);
    if (!config || !config.worktreeIsolation) return "";
    const wtPath = await this.options.createWorktreeHook(agentId);
    if (wtPath) {
      this.agentWorktrees.set(agentId, wtPath);
    }
    return wtPath;
  }

  /**
   * Spawns multiple agents in parallel, one per prompt.
   *
   * All tasks are created synchronously and returned as an array.
   * The caller is responsible for executing them concurrently.
   *
   * @param prompts - Array of prompts, one per agent.
   * @param options - Shared options applied to all agents.
   * @returns Array of pending `SubAgentTask` objects.
   * @throws {Error} If `prompts.length` exceeds `maxConcurrency`.
   */
  spawnParallel(prompts: string[], options: SpawnOptions = {}): SubAgentTask[] {
    if (prompts.length === 0) {
      return [];
    }

    if (prompts.length > this.options.maxConcurrency) {
      throw new Error(
        `spawnParallel: requested ${prompts.length} agents but maxConcurrency is ` +
          `${this.options.maxConcurrency}. Batch your prompts.`,
      );
    }

    return prompts.map((prompt) => this.spawn(prompt, options));
  }

  // --------------------------------------------------------------------------
  // Task Lifecycle
  // --------------------------------------------------------------------------

  /**
   * Marks a task as successfully completed.
   *
   * @param taskId - ID of the task to complete.
   * @param result - Output produced by the agent.
   */
  completeTask(taskId: string, result: string): void {
    const task = this.tasks.get(taskId);
    if (!task) return;

    task.status = "completed";
    task.result = result;
    task.completedAt = new Date().toISOString();
    this.tasks.set(taskId, task);

    // Trigger async cleanup
    if (this.agentWorktrees.has(task.agentId)) {
      this.options.cleanupWorktreeHook(task.agentId).catch(() => {});
      this.agentWorktrees.delete(task.agentId);
    }
  }

  /**
   * Marks a task as failed.
   *
   * @param taskId - ID of the task to fail.
   * @param error - Description of what went wrong.
   */
  failTask(taskId: string, error: string): void {
    const task = this.tasks.get(taskId);
    if (!task) return;

    task.status = "failed";
    task.error = error;
    task.completedAt = new Date().toISOString();
    this.tasks.set(taskId, task);

    // Trigger async cleanup on failure too
    if (this.agentWorktrees.has(task.agentId)) {
      this.options.cleanupWorktreeHook(task.agentId).catch(() => {});
      this.agentWorktrees.delete(task.agentId);
    }
  }

  /**
   * Cancels a task that has not yet reached a terminal state.
   *
   * Cancelling an already-completed or already-failed task is a no-op.
   *
   * @param taskId - ID of the task to cancel.
   */
  cancelTask(taskId: string): void {
    const task = this.tasks.get(taskId);
    if (!task) return;
    if (task.status === "completed" || task.status === "failed") return;

    task.status = "cancelled";
    task.completedAt = new Date().toISOString();
    this.tasks.set(taskId, task);
  }

  // --------------------------------------------------------------------------
  // Queries
  // --------------------------------------------------------------------------

  /**
   * Retrieves a task by its ID.
   *
   * @param taskId - ID of the task.
   * @returns The task, or `undefined` if not found.
   */
  getTask(taskId: string): SubAgentTask | undefined {
    return this.tasks.get(taskId);
  }

  /**
   * Retrieves an agent configuration by its ID.
   *
   * @param agentId - ID of the agent.
   * @returns The agent config, or `undefined` if not found.
   */
  getAgent(agentId: string): SubAgentConfig | undefined {
    return this.agents.get(agentId);
  }

  /**
   * Lists all tasks, optionally filtered by status.
   *
   * @param status - When provided, only tasks with this status are returned.
   * @returns Array of matching `SubAgentTask` objects.
   */
  listTasks(status?: SubAgentTask["status"]): SubAgentTask[] {
    const all = Array.from(this.tasks.values());
    if (status === undefined) return all;
    return all.filter((t) => t.status === status);
  }

  /**
   * Aggregates results from a set of task IDs into a `MergedResult`.
   *
   * Only tasks in "completed" or "failed" terminal states are included.
   * Tasks still in "pending", "running", or "cancelled" are silently skipped.
   *
   * @param taskIds - IDs of the tasks to merge.
   * @returns Aggregated result with per-task details and combined output.
   */
  mergeResults(taskIds: string[]): MergedResult {
    const results: ParallelResult[] = [];
    let successCount = 0;
    let failureCount = 0;
    const outputParts: string[] = [];

    for (const taskId of taskIds) {
      const task = this.tasks.get(taskId);
      if (!task) continue;
      if (task.status !== "completed" && task.status !== "failed") continue;

      const pr: ParallelResult = {
        taskId: task.id,
        agentId: task.agentId,
        status: task.status,
        result: task.result,
        error: task.error,
      };

      results.push(pr);

      if (task.status === "completed") {
        successCount++;
        if (task.result) {
          outputParts.push(`[${task.id.slice(0, 8)}] ${task.result}`);
        }
      } else {
        failureCount++;
        outputParts.push(`[${task.id.slice(0, 8)}] ERROR: ${task.error ?? "unknown error"}`);
      }
    }

    return {
      results,
      successCount,
      failureCount,
      combinedOutput: outputParts.join("\n"),
    };
  }

  /**
   * Converts completed and failed task outcomes into critic opinions that can
   * be fed into the verification debate layer.
   */
  deriveCriticOpinions(taskIds: string[]): CriticOpinion[] {
    const opinions: CriticOpinion[] = [];

    for (const taskId of taskIds) {
      const task = this.tasks.get(taskId);
      if (!task) continue;
      if (task.status !== "completed" && task.status !== "failed") continue;

      if (task.status === "failed") {
        const finding = task.error ?? "Sub-agent task failed.";
        opinions.push({
          agentId: task.agentId,
          verdict: "fail",
          confidence: 0.95,
          critique: finding,
          findings: [finding],
        });
        continue;
      }

      const findings = extractCriticFindings(task.result ?? "");
      opinions.push({
        agentId: task.agentId,
        verdict: findings.length > 0 ? "warn" : "pass",
        confidence: findings.length > 0 ? 0.68 : 0.82,
        critique: task.result,
        ...(findings.length > 0 ? { findings } : {}),
      });
    }

    return opinions;
  }

  /**
   * Runs the shared critic debate helper against a set of completed sub-agent
   * tasks, allowing sub-agent outputs to act as verification critics.
   */
  debateResults(taskIds: string[], output?: string): CriticDebateResult {
    return criticDebate(this.deriveCriticOpinions(taskIds), output);
  }

  // --------------------------------------------------------------------------
  // Delegation Decisions
  // --------------------------------------------------------------------------

  /**
   * Determines whether a task should be delegated to a sub-agent.
   *
   * Delegation is recommended when:
   * - The task complexity score exceeds the threshold (> 0.7).
   * - The current nesting depth is below `maxDepth`.
   * - We are below the maximum concurrent agent limit.
   *
   * @param taskComplexity - Normalized complexity score in [0, 1].
   * @param currentDepth - Current nesting depth of the calling agent.
   * @returns `true` if delegation is advisable.
   */
  shouldDelegate(taskComplexity: number, currentDepth: number): boolean {
    if (taskComplexity <= COMPLEXITY_DELEGATE_THRESHOLD) return false;
    if (!this.validateDepthLimit(currentDepth + 1)) return false;

    const activeAgents = this.listTasks("running").length;
    if (activeAgents >= this.options.maxConcurrency) return false;

    return true;
  }

  /**
   * Validates that a given depth is within the configured limit.
   *
   * @param depth - Depth to validate.
   * @returns `true` if `depth` is within bounds (i.e. <= maxDepth).
   */
  validateDepthLimit(depth: number): boolean {
    return depth <= this.options.maxDepth;
  }

  // --------------------------------------------------------------------------
  // Statistics
  // --------------------------------------------------------------------------

  /**
   * Returns a snapshot of task counts broken down by status.
   *
   * @returns `AgentStats` object with counts for each status + a total.
   */
  getStats(): AgentStats {
    const all = Array.from(this.tasks.values());
    return {
      total: all.length,
      pending: all.filter((t) => t.status === "pending").length,
      running: all.filter((t) => t.status === "running").length,
      completed: all.filter((t) => t.status === "completed").length,
      failed: all.filter((t) => t.status === "failed").length,
      cancelled: all.filter((t) => t.status === "cancelled").length,
    };
  }

  // --------------------------------------------------------------------------
  // Lifecycle
  // --------------------------------------------------------------------------

  /**
   * Clears all agents, tasks, and depth tracking state.
   *
   * Useful between test cases or when starting a fresh session.
   */
  clear(): void {
    this.agents.clear();
    this.tasks.clear();
    this.currentDepth.clear();
  }
}

// ----------------------------------------------------------------------------
// Re-export loop-detector utilities for consumers that import from this module
// ----------------------------------------------------------------------------
export { LoopDetector, fingerprintAction };

function extractCriticFindings(result: string): string[] {
  return result
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(
      (line) =>
        /\b(warning|risk|todo|follow-up|missing|needs proof|needs evidence)\b/i.test(line),
    )
    .slice(0, 4);
}
