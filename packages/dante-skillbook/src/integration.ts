/**
 * integration.ts
 *
 * High-level integration surface for DanteSkillbook.
 * External packages use this, not the internal modules.
 */

import { DanteSkillbook } from "./skillbook.js";
import { GitSkillbookStore } from "./git-skillbook-store.js";
import { pruneSkills } from "./pruning.js";
import { getRelevantSkills } from "./retrieval.js";
import { runReflectionLoop, isMeaningfulTask } from "./reflection-loop.js";
import { ReviewQueue } from "./review-queue.js";
import type { Skill, TaskResult, TaskContext, ReflectionOptions, UpdateOperation, SkillbookGateDecision } from "./types.js";

export interface IntegrationOptions {
  skillbookPath?: string;
  cwd?: string;
  gitStage?: boolean;
}

/**
 * DanteSkillbookIntegration — high-level entry point.
 * Manages load/save, reflection, and governed update application.
 */
export class DanteSkillbookIntegration {
  private book: DanteSkillbook;
  private store: GitSkillbookStore;
  readonly reviewQueue: ReviewQueue;

  constructor(options: IntegrationOptions = {}) {
    this.store = new GitSkillbookStore({
      skillbookPath: options.skillbookPath,
      cwd: options.cwd,
      gitStage: options.gitStage,
    });
    const data = this.store.load();
    this.book = data ? new DanteSkillbook(data) : new DanteSkillbook();
    this.reviewQueue = new ReviewQueue();
  }

  /** Get skillbook stats. */
  stats() {
    return this.book.stats();
  }

  /** Get relevant skills for a task context. */
  getRelevantSkills(context: TaskContext, limit = 5): Skill[] {
    return getRelevantSkills(this.book.getSkills(), context, limit);
  }

  /**
   * Trigger reflection after a task.
   * Only runs for meaningful tasks. Does NOT write to skillbook (call applyProposals after gate).
   */
  async triggerReflection(
    taskResult: TaskResult,
    options: ReflectionOptions = {},
    llmCall?: (sys: string, user: string) => Promise<string>,
  ) {
    if (!isMeaningfulTask(taskResult)) {
      return { proposedUpdates: [], reflectionText: "", mode: options.mode ?? "standard", skipped: true };
    }
    const result = await runReflectionLoop(taskResult, this.book.getSkills(), options, llmCall);
    return { ...result, skipped: false };
  }

  /**
   * Apply proposals from reflection with gate decisions.
   * Each proposal must have an associated gate decision.
   * - "pass" → apply immediately and save
   * - "review-required" → enqueue for manual review
   * - "fail" → discard
   */
  applyProposals(
    proposals: UpdateOperation[],
    decisions: SkillbookGateDecision[],
    opts: { sessionId?: string; runId?: string } = {},
  ): { applied: number; queued: number; rejected: number } {
    let applied = 0;
    let queued = 0;
    let rejected = 0;

    for (let i = 0; i < proposals.length; i++) {
      const proposal = proposals[i]!;
      const decision = decisions[i] ?? "fail";

      if (decision === "pass") {
        const ok = this.book.applyUpdate(proposal, "pass");
        if (ok) applied++;
        else rejected++;
      } else if (decision === "review-required") {
        this.reviewQueue.enqueue(proposal, opts);
        queued++;
      } else {
        rejected++;
      }
    }

    if (applied > 0) {
      this.save();
    }

    return { applied, queued, rejected };
  }

  /**
   * Apply a review-approved item by queue ID.
   */
  applyReviewItem(queueId: string): boolean {
    const pending = this.reviewQueue.getPending();
    const item = pending.find(i => i.id === queueId);
    if (!item) return false;
    const ok = this.book.applyUpdate(item.proposal, "pass");
    if (ok) {
      this.reviewQueue.approve(queueId);
      this.save();
    }
    return ok;
  }

  /** Prune skills by policy and save. */
  prune(policy = {}): void {
    const pruned = pruneSkills(this.book.getSkills(), policy);
    this.book._replaceSkills(pruned);
    this.save();
  }

  /** Save current skillbook to disk. */
  save(): void {
    this.store.save(this.book.getData());
  }

  /** Reload skillbook from disk. */
  reload(): void {
    const data = this.store.load();
    if (data) {
      this.book = new DanteSkillbook(data);
    }
  }
}
