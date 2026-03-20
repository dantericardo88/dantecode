import { randomUUID } from "node:crypto";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface RepoCoordinatorEntry {
  repoRoot: string;
  activeWorkflows: number;
  queuedEvents: number;
  maxConcurrent: number;
  lastEventAt?: string;
}

export interface MultiRepoCoordinatorOptions {
  /** Max concurrent workflows per individual repo. Default: 4 */
  maxConcurrentPerRepo?: number;
  /** Hard ceiling across ALL repos. Default: 16 */
  maxGlobalConcurrent?: number;
}

export interface WorkflowStartResult {
  workflowId: string;
  repoRoot: string;
  startedAt: string;
}

// ─── MultiRepoCoordinator ────────────────────────────────────────────────────

/**
 * Partitions workflow execution across multiple repos / worktrees.
 *
 * - Each repo has an independent concurrency limit.
 * - A global ceiling prevents runaway parallelism.
 * - `canRun()` is a non-destructive check.
 * - `startWorkflow()` acquires a slot; `finishWorkflow()` releases it.
 * - `getLoad()` reports per-repo and global utilisation.
 */
export class MultiRepoCoordinator {
  private readonly maxConcurrentPerRepo: number;
  private readonly maxGlobalConcurrent: number;

  /** Per-repo: set of active workflow IDs */
  private readonly activeWorkflows = new Map<string, Set<string>>();

  /** Per-repo: pending event queue depth (informational counter) */
  private readonly queuedEvents = new Map<string, number>();

  /** Per-repo: last event timestamp */
  private readonly lastEventAt = new Map<string, string>();

  /** Per-repo: max concurrency override */
  private readonly repoConcurrencyOverride = new Map<string, number>();

  constructor(options: MultiRepoCoordinatorOptions = {}) {
    this.maxConcurrentPerRepo = Math.max(1, options.maxConcurrentPerRepo ?? 4);
    this.maxGlobalConcurrent = Math.max(1, options.maxGlobalConcurrent ?? 16);
  }

  /**
   * Register a repo with an optional per-repo concurrency override.
   * Safe to call multiple times for the same repo.
   */
  registerRepo(repoRoot: string, maxConcurrent?: number): void {
    const normalized = normalize(repoRoot);
    if (!this.activeWorkflows.has(normalized)) {
      this.activeWorkflows.set(normalized, new Set());
      this.queuedEvents.set(normalized, 0);
    }
    if (maxConcurrent !== undefined) {
      this.repoConcurrencyOverride.set(normalized, maxConcurrent);
    }
  }

  /**
   * Check whether a new workflow can start for the given repo
   * without mutating any state.
   */
  canRun(repoRoot: string): boolean {
    const normalized = normalize(repoRoot);
    const active = this.activeWorkflows.get(normalized);
    const repoMax = this.repoConcurrencyOverride.get(normalized) ?? this.maxConcurrentPerRepo;
    const repoCount = active?.size ?? 0;

    if (repoCount >= repoMax) {
      return false;
    }

    if (this.globalActiveCount() >= this.maxGlobalConcurrent) {
      return false;
    }

    return true;
  }

  /**
   * Acquire a workflow slot for `repoRoot`.
   * Returns the new workflow's ID and start timestamp.
   * Throws if the slot is unavailable — callers should check `canRun()` first.
   */
  startWorkflow(repoRoot: string): WorkflowStartResult {
    const normalized = normalize(repoRoot);
    this.ensureRegistered(normalized);

    if (!this.canRun(normalized)) {
      throw new Error(
        `Cannot start workflow: concurrency limit reached for ${repoRoot}`,
      );
    }

    const workflowId = randomUUID().slice(0, 12);
    const startedAt = new Date().toISOString();

    this.activeWorkflows.get(normalized)!.add(workflowId);
    this.lastEventAt.set(normalized, startedAt);

    return { workflowId, repoRoot: normalized, startedAt };
  }

  /**
   * Release a workflow slot.  Safe to call with an unknown workflowId (no-op).
   */
  finishWorkflow(repoRoot: string, workflowId: string): void {
    const normalized = normalize(repoRoot);
    this.activeWorkflows.get(normalized)?.delete(workflowId);
  }

  /**
   * Record that an event is queued/dequeued for informational load reporting.
   * delta = +1 (event added) or -1 (event consumed).
   */
  adjustQueuedEvents(repoRoot: string, delta: number): void {
    const normalized = normalize(repoRoot);
    this.ensureRegistered(normalized);
    const current = this.queuedEvents.get(normalized) ?? 0;
    this.queuedEvents.set(normalized, Math.max(0, current + delta));
  }

  /**
   * Returns true when any registered repo (or the specific repo) is
   * at or above its concurrency limit.
   */
  isBackpressured(repoRoot?: string): boolean {
    if (repoRoot) {
      return !this.canRun(repoRoot);
    }
    return this.globalActiveCount() >= this.maxGlobalConcurrent;
  }

  /**
   * Per-repo and global load report.
   */
  getLoad(): RepoCoordinatorEntry[] {
    const entries: RepoCoordinatorEntry[] = [];
    for (const [repoRoot, activeSet] of this.activeWorkflows) {
      entries.push({
        repoRoot,
        activeWorkflows: activeSet.size,
        queuedEvents: this.queuedEvents.get(repoRoot) ?? 0,
        maxConcurrent: this.repoConcurrencyOverride.get(repoRoot) ?? this.maxConcurrentPerRepo,
        ...(this.lastEventAt.has(repoRoot)
          ? { lastEventAt: this.lastEventAt.get(repoRoot) }
          : {}),
      });
    }
    return entries;
  }

  /**
   * Global count of all active workflows across all repos.
   */
  globalActiveCount(): number {
    let count = 0;
    for (const activeSet of this.activeWorkflows.values()) {
      count += activeSet.size;
    }
    return count;
  }

  /**
   * Reset all state (useful for testing).
   */
  reset(): void {
    this.activeWorkflows.clear();
    this.queuedEvents.clear();
    this.lastEventAt.clear();
    this.repoConcurrencyOverride.clear();
  }

  private ensureRegistered(normalized: string): void {
    if (!this.activeWorkflows.has(normalized)) {
      this.registerRepo(normalized);
    }
  }
}

function normalize(repoRoot: string): string {
  return repoRoot.replace(/\\/g, "/");
}
