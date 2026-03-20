// ============================================================================
// @dantecode/memory-engine — Pruning Engine
// Safe, policy-driven pruning of low-value memory items.
// GF-04: prune low-value, preserve high-value + frequently recalled + verified.
// ============================================================================

import type { MemoryItem, MemoryPruneResult, MemoryScope, MemoryLayer } from "./types.js";
import type { LocalStore } from "./storage/local-store.js";
import type { VectorStore } from "./vector-store.js";
import { RetentionPolicy } from "./policies/retention-policy.js";
import type { RetentionPolicyConfig } from "./types.js";
import { ScoringPolicy } from "./policies/scoring-policy.js";
import { Summarizer } from "./summarizer.js";

export interface PruningEngineOptions {
  retentionConfig?: Partial<RetentionPolicyConfig>;
  /** Whether to compress items before pruning (default: true). */
  compressBeforePrune?: boolean;
  /** Dry-run mode: evaluate but don't actually delete. */
  dryRun?: boolean;
}

/** Statistics from a pruning run. */
export interface PruningStats {
  evaluated: number;
  kept: number;
  pruned: number;
  compressed: number;
  policyUsed: string;
  dryRun: boolean;
}

/**
 * Pruning Engine applies retention policies to remove or compress stale memory.
 *
 * Pipeline:
 * 1. Load all items from the target scope/layer
 * 2. Re-score each item via ScoringPolicy
 * 3. Evaluate each against RetentionPolicy
 * 4. Compress items marked for compression (replace with SessionKnowledge)
 * 5. Delete items marked for pruning
 * 6. If semantic layer exceeds capacity, force-prune lowest-scoring items
 * 7. Return PruningStats
 */
export class PruningEngine {
  private readonly localStore: LocalStore;
  private readonly vectorStore: VectorStore;
  private readonly retentionPolicy: RetentionPolicy;
  private readonly scoringPolicy: ScoringPolicy;
  private readonly summarizer: Summarizer;
  private readonly compressBeforePrune: boolean;

  constructor(
    localStore: LocalStore,
    vectorStore: VectorStore,
    options: PruningEngineOptions = {},
  ) {
    this.localStore = localStore;
    this.vectorStore = vectorStore;
    this.retentionPolicy = new RetentionPolicy(options.retentionConfig ?? {});
    this.scoringPolicy = new ScoringPolicy();
    this.summarizer = new Summarizer();
    this.compressBeforePrune = options.compressBeforePrune ?? true;
  }

  // --------------------------------------------------------------------------
  // Core pruning
  // --------------------------------------------------------------------------

  /**
   * Run a pruning pass on all items in a scope+layer.
   *
   * @param threshold - Optional score threshold override (prune < threshold).
   * @param dryRun - If true, simulate without deleting.
   */
  async prune(
    scope: MemoryScope,
    layer: MemoryLayer,
    threshold?: number,
    dryRun = false,
  ): Promise<MemoryPruneResult> {
    const items = await this.localStore.list(scope, layer);
    const stats = await this.runPruningPass(items, scope, layer, threshold, dryRun);

    return {
      prunedCount: stats.pruned,
      retainedCount: stats.kept,
      policy: `retention(${layer}${threshold !== undefined ? `,threshold=${threshold}` : ""})`,
    };
  }

  /**
   * Prune all layers for all scopes. Comprehensive cleanup.
   */
  async pruneAll(threshold?: number, dryRun = false): Promise<MemoryPruneResult> {
    const scopes: MemoryScope[] = ["session", "project", "user", "global"];
    const layers: MemoryLayer[] = ["checkpoint", "semantic", "entity"];
    let totalPruned = 0;
    let totalRetained = 0;

    for (const scope of scopes) {
      for (const layer of layers) {
        const items = await this.localStore.list(scope, layer);
        if (items.length === 0) continue;
        const stats = await this.runPruningPass(items, scope, layer, threshold, dryRun);
        totalPruned += stats.pruned;
        totalRetained += stats.kept;
      }
    }

    // Also prune semantic layer in vector store if over capacity
    const vectorItems = this.vectorStore.listAll();
    const config = this.retentionPolicy.getConfig();
    if (vectorItems.length > config.maxSemanticItems) {
      const toRemove = this.retentionPolicy.selectForPruning(
        vectorItems,
        config.maxSemanticItems,
      );
      if (!dryRun) {
        for (const key of toRemove) {
          // Find scope from vector store
          const item = vectorItems.find((i) => i.key === key);
          if (item) {
            await this.vectorStore.delete(key, item.scope);
            totalPruned++;
          }
        }
      } else {
        totalPruned += toRemove.length;
      }
    }

    return {
      prunedCount: totalPruned,
      retainedCount: totalRetained,
      policy: `retention(all${threshold !== undefined ? `,threshold=${threshold}` : ""})`,
    };
  }

  /**
   * Score-based pruning: prune items below a threshold score.
   */
  async pruneByScore(
    items: MemoryItem[],
    scope: MemoryScope,
    layer: MemoryLayer,
    threshold: number,
  ): Promise<number> {
    let pruned = 0;
    for (const item of items) {
      const scored = this.scoringPolicy.applyScore(item);
      if (scored.score < threshold) {
        await this.localStore.delete(item.key, scope, layer);
        pruned++;
      }
    }
    return pruned;
  }

  // --------------------------------------------------------------------------
  // Private
  // --------------------------------------------------------------------------

  private async runPruningPass(
    items: MemoryItem[],
    scope: MemoryScope,
    layer: MemoryLayer,
    threshold?: number,
    dryRun = false,
  ): Promise<PruningStats> {
    let kept = 0;
    let pruned = 0;
    let compressed = 0;

    // First, re-score all items
    const rescored = this.scoringPolicy.scoreMany(items);

    // Apply threshold override
    if (threshold !== undefined) {
      for (const item of rescored) {
        if (item.score < threshold) {
          if (!dryRun) await this.localStore.delete(item.key, scope, layer);
          pruned++;
        } else {
          kept++;
        }
      }
    } else {
      // Use retention policy
      const decisions = this.retentionPolicy.evaluateBatch(rescored);

      kept += decisions.keep.length;

      for (const ev of decisions.prune) {
        if (!dryRun) await this.localStore.delete(ev.item.key, scope, layer);
        pruned++;
      }

      for (const ev of decisions.compress) {
        if (!dryRun && this.compressBeforePrune) {
          const compressed_item = this.summarizer.compress(
            ev.item.source ?? ev.item.key,
            [ev.item],
          );
          // Replace with compressed version
          await this.localStore.delete(ev.item.key, scope, layer);
          await this.localStore.put({ ...compressed_item, scope, layer });
        }
        compressed++;
        kept++; // compressed items are retained (as summaries)
      }
    }

    return {
      evaluated: items.length,
      kept,
      pruned,
      compressed,
      policyUsed: threshold !== undefined ? `threshold:${threshold}` : "retention_policy",
      dryRun,
    };
  }
}
