// ============================================================================
// @dantecode/memory-engine — Scoring Policy
// Computes quality scores for MemoryItems based on multiple signals.
// ============================================================================

import type { MemoryItem, ScoringPolicyConfig } from "../types.js";

const DEFAULT_CONFIG: ScoringPolicyConfig = {
  recencyWeight: 0.3,
  recallWeight: 0.35,
  verifiedWeight: 0.2,
  sourceWeight: 0.15,
};

/** Trusted source prefixes that indicate high-quality origin. */
const TRUSTED_SOURCE_PREFIXES = ["danteforge", "verified", "autoforge", "user"];

/**
 * Scoring Policy computes a composite quality score (0–1) for a MemoryItem.
 *
 * Signals:
 * - Recency: recently accessed items score higher
 * - Recall frequency: often-recalled items are more valuable
 * - Verified status: DanteForge-verified items get a significant boost
 * - Source quality: items from trusted sources score higher
 */
export class ScoringPolicy {
  private readonly config: ScoringPolicyConfig;

  constructor(config: Partial<ScoringPolicyConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Compute a composite quality score for a MemoryItem.
   * Does NOT mutate the item.
   */
  score(item: MemoryItem): number {
    return (
      this.recencyScore(item) * this.config.recencyWeight +
      this.recallScore(item) * this.config.recallWeight +
      this.verifiedScore(item) * this.config.verifiedWeight +
      this.sourceScore(item) * this.config.sourceWeight
    );
  }

  /**
   * Update the score field of a MemoryItem in-place.
   */
  applyScore(item: MemoryItem): MemoryItem {
    return { ...item, score: this.score(item) };
  }

  /**
   * Batch-score a list of items.
   */
  scoreMany(items: MemoryItem[]): MemoryItem[] {
    return items.map((item) => this.applyScore(item));
  }

  // --------------------------------------------------------------------------
  // Individual signal scores (0–1)
  // --------------------------------------------------------------------------

  /** Recency score: 1.0 if just accessed, decays over 90 days. */
  recencyScore(item: MemoryItem): number {
    const ageDays = (Date.now() - new Date(item.lastAccessedAt).getTime()) / (1000 * 60 * 60 * 24);
    // Exponential decay: half-life ~14 days
    return Math.exp(-ageDays / 14);
  }

  /** Recall score: 1.0 at 20+ recalls, 0 at 0. */
  recallScore(item: MemoryItem): number {
    return Math.min(1, item.recallCount / 20);
  }

  /** Verified score: 1.0 if verified, 0.2 if not. */
  verifiedScore(item: MemoryItem): number {
    return item.verified ? 1.0 : 0.2;
  }

  /** Source quality score: higher for trusted sources. */
  sourceScore(item: MemoryItem): number {
    if (!item.source) return 0.3;
    const src = item.source.toLowerCase();
    for (const prefix of TRUSTED_SOURCE_PREFIXES) {
      if (src.startsWith(prefix)) return 1.0;
    }
    return 0.5;
  }

  /** Returns a copy of the active configuration. */
  getConfig(): ScoringPolicyConfig {
    return { ...this.config };
  }
}

/** Default scoring policy instance. */
export const defaultScoringPolicy = new ScoringPolicy();
