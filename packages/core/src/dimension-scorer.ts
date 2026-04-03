// ============================================================================
// @dantecode/core — Dimension Scorer
// Abstract base class for multi-dimensional quality scoring (4 dimensions,
// each 0-25, total 0-100). Eliminates duplicated clamping/scoring logic
// across MemoryQualityScorer, SearchQualityScorer, and SkillQualityScorer.
// ============================================================================

// ────────────────────────────────────────────────────────────────────────────
// Types
// ────────────────────────────────────────────────────────────────────────────

/** Decomposed quality score with named dimensions and aggregate total. */
export interface DimensionScore {
  dimensions: Record<string, number>;
  total: number;
}

/** Options shared by all dimension scorers. */
export interface DimensionScorerOptions {
  nowFn?: () => number;
}

// ────────────────────────────────────────────────────────────────────────────
// Abstract Base Class
// ────────────────────────────────────────────────────────────────────────────

/**
 * Abstract base for 4-dimension quality scorers.
 *
 * Subclasses implement `scoreDimensions()` (returns four 0-25 values) and
 * `dimensionNames()` (returns the four dimension labels). The base class
 * provides deterministic aggregation via `computeDimensions()`, threshold
 * checks, and a `clamp25` helper that maps a 0-1 ratio to the 0-25 integer
 * range.
 *
 * Subclasses typically override `score()` to return their own domain-specific
 * score type, calling `scoreDimensions()` internally for the raw values.
 */
export abstract class DimensionScorer<TInput> {
  protected nowFn: () => number;

  constructor(options?: DimensionScorerOptions) {
    this.nowFn = options?.nowFn ?? (() => Date.now());
  }

  /** Subclasses implement: return exactly 4 scores, each 0-25. */
  protected abstract scoreDimensions(input: TInput): [number, number, number, number];

  /** Subclasses implement: return the 4 dimension names. */
  protected abstract dimensionNames(): [string, string, string, string];

  /**
   * Compute a generic DimensionScore from the four dimensions.
   * Subclasses may call this or call `scoreDimensions()` directly to build
   * their own domain-specific return type.
   */
  computeDimensions(input: TInput): DimensionScore {
    const [d1, d2, d3, d4] = this.scoreDimensions(input);
    const names = this.dimensionNames();
    const dimensions: Record<string, number> = {};
    dimensions[names[0]] = d1;
    dimensions[names[1]] = d2;
    dimensions[names[2]] = d3;
    dimensions[names[3]] = d4;
    const total = d1 + d2 + d3 + d4;
    return { dimensions, total };
  }

  /** True if the aggregate score is below the given threshold. */
  isBelow(scored: { total: number }, threshold: number): boolean {
    return scored.total < threshold;
  }

  /** True if the aggregate score is above the given threshold. */
  isAbove(scored: { total: number }, threshold: number): boolean {
    return scored.total > threshold;
  }

  /** Clamp a 0-1 ratio to the 0-25 integer range. */
  protected clamp25(ratio: number): number {
    return Math.round(Math.max(0, Math.min(1, ratio)) * 25);
  }
}
