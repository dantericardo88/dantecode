// ============================================================================
// @dantecode/core — Memory Quality Scorer
// Multi-dimensional quality scoring for memory items to drive eviction,
// promotion, and consolidation decisions.
// ============================================================================

// ────────────────────────────────────────────────────────────────────────────
// Types
// ────────────────────────────────────────────────────────────────────────────

/** A memory item enriched with usage metadata for scoring. */
export interface ScoredMemory {
  /** The textual content of the memory. */
  content: string;
  /** Unix timestamp (ms) when the memory was created. */
  createdAt: number;
  /** Unix timestamp (ms) when the memory was last accessed. */
  lastAccessedAt: number;
  /** Total number of times this memory has been accessed. */
  accessCount: number;
  /** An externally-assigned impact score (0-1) reflecting task relevance. */
  impactScore: number;
}

/** Quality score decomposed into four orthogonal dimensions. */
export interface QualityScore {
  /** Relevance of the memory to recent tasks (0-25). */
  relevance: number;
  /** How recently the memory was created/accessed (0-25). */
  freshness: number;
  /** Accuracy proxy based on usage and impact (0-25). */
  accuracy: number;
  /** Utility based on access frequency (0-25). */
  utility: number;
  /** Aggregate score (0-100). */
  total: number;
}

// ────────────────────────────────────────────────────────────────────────────
// Scorer
// ────────────────────────────────────────────────────────────────────────────

/** Eviction threshold: memories scoring below this are candidates for removal. */
const EVICTION_THRESHOLD = 40;

/** Promotion threshold: memories scoring above this are high-value. */
const PROMOTION_THRESHOLD = 80;

/** Maximum age in milliseconds used to normalize freshness (90 days). */
const MAX_AGE_MS = 90 * 24 * 60 * 60 * 1000;

/** Maximum access count used to normalize utility (100 accesses). */
const MAX_ACCESS_COUNT = 100;

/**
 * Deterministic quality scorer for memory items.
 *
 * Each dimension is scored 0-25 and combined into a 0-100 aggregate:
 * - **Relevance** (0-25): derived from `impactScore` (0-1 scaled to 0-25).
 * - **Freshness** (0-25): inverse age of `lastAccessedAt` vs now, capped at 90 days.
 * - **Accuracy** (0-25): blended from `impactScore` and content length heuristic.
 * - **Utility** (0-25): logarithmic scale of `accessCount`, capped at 100.
 */
export class MemoryQualityScorer {
  private readonly nowFn: () => number;

  constructor(options?: { nowFn?: () => number }) {
    this.nowFn = options?.nowFn ?? (() => Date.now());
  }

  /**
   * Score a memory item across four dimensions.
   * Returns an aggregate 0-100 quality score.
   */
  score(memory: ScoredMemory): QualityScore {
    const relevance = this.scoreRelevance(memory);
    const freshness = this.scoreFreshness(memory);
    const accuracy = this.scoreAccuracy(memory);
    const utility = this.scoreUtility(memory);
    const total = relevance + freshness + accuracy + utility;
    return { relevance, freshness, accuracy, utility, total };
  }

  /** True if the memory's aggregate score is below the eviction threshold (40). */
  isEvictionCandidate(qualityScore: QualityScore): boolean {
    return qualityScore.total < EVICTION_THRESHOLD;
  }

  /** True if the memory's aggregate score is above the promotion threshold (80). */
  isPromotionCandidate(qualityScore: QualityScore): boolean {
    return qualityScore.total > PROMOTION_THRESHOLD;
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Dimension scorers (each returns 0-25)
  // ──────────────────────────────────────────────────────────────────────────

  /** Relevance: directly derived from impactScore (0-1 -> 0-25). */
  private scoreRelevance(memory: ScoredMemory): number {
    const clamped = Math.max(0, Math.min(1, memory.impactScore));
    return Math.round(clamped * 25);
  }

  /** Freshness: inverse age of lastAccessedAt, capped at MAX_AGE_MS. */
  private scoreFreshness(memory: ScoredMemory): number {
    const now = this.nowFn();
    const ageMs = Math.max(0, now - memory.lastAccessedAt);
    const ratio = 1 - Math.min(ageMs / MAX_AGE_MS, 1);
    return Math.round(ratio * 25);
  }

  /** Accuracy: blended from impactScore and content richness heuristic. */
  private scoreAccuracy(memory: ScoredMemory): number {
    const impactFactor = Math.max(0, Math.min(1, memory.impactScore));
    // Content length heuristic: short memories (< 20 chars) are lower quality
    const lengthFactor = Math.min(memory.content.length / 200, 1);
    const blended = impactFactor * 0.6 + lengthFactor * 0.4;
    return Math.round(blended * 25);
  }

  /** Utility: logarithmic scale of access count. */
  private scoreUtility(memory: ScoredMemory): number {
    if (memory.accessCount <= 0) return 0;
    const capped = Math.min(memory.accessCount, MAX_ACCESS_COUNT);
    // log scale: log(1+count) / log(1+max) -> 0-1
    const ratio = Math.log(1 + capped) / Math.log(1 + MAX_ACCESS_COUNT);
    return Math.round(ratio * 25);
  }
}
