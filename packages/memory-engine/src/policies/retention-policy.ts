// ============================================================================
// @dantecode/memory-engine — Retention Policy
// Rules for what to keep, prune, and protect in memory.
// Patterns from Mem0 pruning + Zep memory management.
// ============================================================================

import type { MemoryItem, RetentionPolicyConfig } from "../types.js";

const DEFAULT_CONFIG: RetentionPolicyConfig = {
  maxAgeDays: 30,
  minScore: 0.2,
  minRecallCount: 2,
  keepVerified: true,
  maxSemanticItems: 10_000,
};

/**
 * Decision returned by the retention policy for each item.
 */
export type RetentionDecision = "keep" | "prune" | "compress" | "archive";

export interface RetentionEvaluation {
  item: MemoryItem;
  decision: RetentionDecision;
  reason: string;
  score: number;
}

/**
 * Retention Policy evaluates MemoryItems against configured thresholds.
 *
 * Decision rules (in priority order):
 * 1. Verified items → always KEEP
 * 2. High recall count (>= minRecallCount * 3) → KEEP
 * 3. Age > maxAgeDays AND score < minScore → PRUNE
 * 4. Score < minScore AND recall < 1 → PRUNE
 * 5. Score < minScore / 2 (very low value) → PRUNE
 * 6. Age > maxAgeDays / 2 AND moderate score → COMPRESS
 * 7. Everything else → KEEP
 */
export class RetentionPolicy {
  private readonly config: RetentionPolicyConfig;

  constructor(config: Partial<RetentionPolicyConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /** Evaluate a single MemoryItem. */
  evaluate(item: MemoryItem): RetentionEvaluation {
    const now = Date.now();
    const ageDays =
      (now - new Date(item.createdAt).getTime()) / (1000 * 60 * 60 * 24);

    // Rule 1: Verified = always keep
    if (this.config.keepVerified && item.verified) {
      return { item, decision: "keep", reason: "verified", score: item.score };
    }

    // Rule 2: High recall = very useful
    if (item.recallCount >= this.config.minRecallCount * 3) {
      return { item, decision: "keep", reason: "high_recall", score: item.score };
    }

    // Rule 3: Old + low score = prune
    if (ageDays > this.config.maxAgeDays && item.score < this.config.minScore) {
      return {
        item,
        decision: "prune",
        reason: `age_${Math.floor(ageDays)}d+low_score_${item.score.toFixed(2)}`,
        score: item.score,
      };
    }

    // Rule 4: Very low score + never recalled = prune
    if (item.score < this.config.minScore && item.recallCount < 1) {
      return {
        item,
        decision: "prune",
        reason: `low_score_never_recalled`,
        score: item.score,
      };
    }

    // Rule 5: Extremely low quality = prune
    if (item.score < this.config.minScore / 2) {
      return {
        item,
        decision: "prune",
        reason: `very_low_score_${item.score.toFixed(2)}`,
        score: item.score,
      };
    }

    // Rule 6: Moderately old + medium score = compress
    if (ageDays > this.config.maxAgeDays / 2 && item.score < this.config.minScore * 2) {
      return {
        item,
        decision: "compress",
        reason: `aging_${Math.floor(ageDays)}d`,
        score: item.score,
      };
    }

    // Default: keep
    return { item, decision: "keep", reason: "within_policy", score: item.score };
  }

  /**
   * Evaluate a batch of items.
   * Returns grouped decisions.
   */
  evaluateBatch(items: MemoryItem[]): {
    keep: RetentionEvaluation[];
    prune: RetentionEvaluation[];
    compress: RetentionEvaluation[];
    archive: RetentionEvaluation[];
  } {
    const result = { keep: [] as RetentionEvaluation[], prune: [] as RetentionEvaluation[], compress: [] as RetentionEvaluation[], archive: [] as RetentionEvaluation[] };

    for (const item of items) {
      const ev = this.evaluate(item);
      result[ev.decision].push(ev);
    }

    return result;
  }

  /**
   * Given a semantic layer that has exceeded maxSemanticItems,
   * return keys to prune to bring it back within capacity.
   */
  selectForPruning(items: MemoryItem[], targetCount: number): string[] {
    if (items.length <= targetCount) return [];

    // Sort by composite keep-worthiness score (ascending = prune first)
    const scored = items.map((item) => {
      const ev = this.evaluate(item);
      const keepWorthiness =
        item.score * 0.4 +
        Math.min(1, item.recallCount / 10) * 0.3 +
        (item.verified ? 0.3 : 0) +
        (ev.decision === "keep" ? 0.2 : 0);
      return { item, keepWorthiness };
    });

    scored.sort((a, b) => a.keepWorthiness - b.keepWorthiness);

    const pruneCount = items.length - targetCount;
    return scored.slice(0, pruneCount).map((e) => e.item.key);
  }

  /** Returns a copy of the active configuration. */
  getConfig(): RetentionPolicyConfig {
    return { ...this.config };
  }
}

/** Default retention policy instance. */
export const defaultRetentionPolicy = new RetentionPolicy();
