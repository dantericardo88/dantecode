// ============================================================================
// @dantecode/core — Memory Consolidator
// Merges duplicate/overlapping memories using Jaccard similarity, evicts
// lowest-scoring memories at capacity thresholds, and supports periodic
// scheduled consolidation.
// ============================================================================

import { tokenize, jaccardSimilarity } from "./approach-memory.js";
import { MemoryQualityScorer } from "./memory-quality-scorer.js";
import type { ScoredMemory, QualityScore } from "./memory-quality-scorer.js";

// ────────────────────────────────────────────────────────────────────────────
// Types
// ────────────────────────────────────────────────────────────────────────────

/** A memory item that can be consolidated. */
export interface MemoryItem {
  /** Unique identifier for the memory. */
  id: string;
  /** The textual content of the memory. */
  content: string;
  /** Unix timestamp (ms) when the memory was created. */
  createdAt: number;
  /** Unix timestamp (ms) when the memory was last accessed. */
  lastAccessedAt: number;
  /** Total number of times this memory has been accessed. */
  accessCount: number;
  /** Externally-assigned impact score (0-1). */
  impactScore: number;
}

/** Options for the consolidator. */
export interface MemoryConsolidatorOptions {
  /** Jaccard similarity threshold for merge (default: 0.6). */
  mergeThreshold?: number;
  /** Capacity utilization ratio that triggers eviction (default: 0.8). */
  evictionTrigger?: number;
  /** Custom quality scorer instance. */
  scorer?: MemoryQualityScorer;
  /** Custom time provider for testing. */
  nowFn?: () => number;
}

// ────────────────────────────────────────────────────────────────────────────
// Consolidator
// ────────────────────────────────────────────────────────────────────────────

/**
 * Consolidates a memory store by merging duplicates and evicting low-quality items.
 *
 * - **Merge**: Two memories with Jaccard similarity >= threshold are merged.
 *   The merged result keeps the higher impact score, combined access count,
 *   and the longer content as the primary text.
 * - **Eviction**: When the memory count exceeds `capacity * evictionTrigger`,
 *   the lowest-scoring memories are removed to bring count to `capacity`.
 * - **Scheduled**: `scheduleConsolidation` runs consolidation on a timer.
 */
export class MemoryConsolidator {
  private readonly mergeThreshold: number;
  private readonly evictionTrigger: number;
  private readonly scorer: MemoryQualityScorer;
  private consolidationTimer: ReturnType<typeof setInterval> | null = null;

  constructor(options?: MemoryConsolidatorOptions) {
    this.mergeThreshold = options?.mergeThreshold ?? 0.6;
    this.evictionTrigger = options?.evictionTrigger ?? 0.8;
    this.scorer =
      options?.scorer ??
      new MemoryQualityScorer(options?.nowFn ? { nowFn: options.nowFn } : undefined);
  }

  /**
   * Merge duplicate/overlapping memories using Jaccard similarity.
   * Returns a new array with duplicates merged. Original array is not mutated.
   */
  consolidate(memories: MemoryItem[]): MemoryItem[] {
    if (memories.length <= 1) return [...memories];

    const merged = new Map<string, MemoryItem>();
    const consumed = new Set<string>();

    for (const mem of memories) {
      if (consumed.has(mem.id)) continue;
      merged.set(mem.id, { ...mem });
    }

    const items = [...merged.values()];
    const tokenSets = new Map<string, Set<string>>();
    for (const item of items) {
      tokenSets.set(item.id, tokenize(item.content));
    }

    for (let i = 0; i < items.length; i++) {
      const a = items[i]!;
      if (consumed.has(a.id)) continue;

      const tokensA = tokenSets.get(a.id)!;

      for (let j = i + 1; j < items.length; j++) {
        const b = items[j]!;
        if (consumed.has(b.id)) continue;

        const tokensB = tokenSets.get(b.id)!;
        const similarity = jaccardSimilarity(tokensA, tokensB);

        if (similarity >= this.mergeThreshold) {
          // Merge b into a
          const mergedItem = this.mergeItems(a, b);
          merged.set(a.id, mergedItem);
          // Update reference for further merges
          items[i] = mergedItem;
          tokenSets.set(a.id, tokenize(mergedItem.content));
          merged.delete(b.id);
          consumed.add(b.id);
        }
      }
    }

    return [...merged.values()];
  }

  /**
   * Evict lowest-scoring memories when count exceeds capacity threshold.
   * Returns a filtered array with at most `capacity` items.
   */
  evict(memories: MemoryItem[], capacity: number): MemoryItem[] {
    if (capacity <= 0) return [];
    if (memories.length <= capacity) return [...memories];

    const threshold = Math.floor(capacity * this.evictionTrigger);
    if (memories.length <= threshold) return [...memories];

    // Score each memory and sort by quality (ascending)
    const scored: Array<{ item: MemoryItem; quality: QualityScore }> = memories.map((item) => ({
      item,
      quality: this.scorer.score(this.toScoredMemory(item)),
    }));

    scored.sort((a, b) => b.quality.total - a.quality.total);

    // Keep only up to capacity items (highest quality first)
    return scored.slice(0, capacity).map((s) => s.item);
  }

  /**
   * Schedule periodic consolidation.
   * Calls the provided callback with consolidated results at `intervalMs`.
   * Returns immediately; use `stopConsolidation()` to cancel.
   */
  scheduleConsolidation(
    intervalMs: number,
    getMemories: () => MemoryItem[],
    onConsolidated: (result: MemoryItem[]) => void,
  ): void {
    this.stopConsolidation();
    this.consolidationTimer = setInterval(() => {
      const current = getMemories();
      const result = this.consolidate(current);
      onConsolidated(result);
    }, intervalMs);
  }

  /** Stop scheduled consolidation. */
  stopConsolidation(): void {
    if (this.consolidationTimer !== null) {
      clearInterval(this.consolidationTimer);
      this.consolidationTimer = null;
    }
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Helpers
  // ──────────────────────────────────────────────────────────────────────────

  /** Merge two memory items into one, preserving the highest quality attributes. */
  private mergeItems(a: MemoryItem, b: MemoryItem): MemoryItem {
    const primary = a.content.length >= b.content.length ? a : b;
    return {
      id: a.id,
      content: primary.content,
      createdAt: Math.min(a.createdAt, b.createdAt),
      lastAccessedAt: Math.max(a.lastAccessedAt, b.lastAccessedAt),
      accessCount: a.accessCount + b.accessCount,
      impactScore: Math.max(a.impactScore, b.impactScore),
    };
  }

  /** Convert a MemoryItem to a ScoredMemory for the quality scorer. */
  private toScoredMemory(item: MemoryItem): ScoredMemory {
    return {
      content: item.content,
      createdAt: item.createdAt,
      lastAccessedAt: item.lastAccessedAt,
      accessCount: item.accessCount,
      impactScore: item.impactScore,
    };
  }
}
