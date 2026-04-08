// ============================================================================
// @dantecode/core — ConvergenceController
//
// Tracks PDSE score history across iterations and decides whether the agent
// is converging toward a solution, stuck flat, or diverging.
//
// Devin pattern: score every attempt, detect trend, act on decline.
// OpenHands pattern: rolling window, slope-based decision.
//
// Decisions:
//   "continue"      — score is improving or insufficient data
//   "reduce_scope"  — flat for N rounds (no progress, try smaller target)
//   "escalate"      — declining or stuck with no improvement ceiling
// ============================================================================

// ----------------------------------------------------------------------------
// Types
// ----------------------------------------------------------------------------

/** PDSE score observation for a single iteration. */
export interface ScoreObservation {
  /** PDSE score 0-100. */
  score: number;
  /** ISO-8601 timestamp. */
  timestamp: string;
  /** Iteration/round number. */
  round: number;
  /** Whether verification passed at this score. */
  passed: boolean;
}

/** Trend direction. */
export type ScoreTrend = "improving" | "flat" | "declining" | "insufficient_data";

/** The controller's decision for the current state. */
export interface ConvergenceDecision {
  /** What the agent-loop should do. */
  action: "continue" | "reduce_scope" | "escalate";
  /** Computed trend over the observation window. */
  trend: ScoreTrend;
  /** Current score (most recent observation). */
  currentScore: number;
  /** Best score seen in this session. */
  bestScore: number;
  /** Human-readable explanation. */
  reason: string;
  /** Recommended strategy given current trend. */
  recommendedStrategy: "standard" | "reduced_scope" | "minimal";
  /** Slope of score trend (positive = improving). */
  slope: number;
}

/** Configuration. */
export interface ConvergenceControllerOptions {
  /**
   * Window of most-recent observations used for trend analysis.
   * Default: 5 (matches OpenHands rolling window).
   */
  windowSize?: number;
  /**
   * Minimum slope considered "improving" (score units per round).
   * Default: 2.0 (must gain 2 PDSE points per round to count as improving).
   */
  improvingSlope?: number;
  /**
   * Minimum slope considered "declining" (negative value).
   * Default: -3.0 (losing 3+ PDSE points per round = declining).
   */
  decliningSlope?: number;
  /**
   * Number of flat rounds (|slope| < improvingSlope) before scope reduction.
   * Default: 3.
   */
  flatRoundsBeforeScopeReduce?: number;
  /**
   * Number of declining rounds before escalation.
   * Default: 2.
   */
  decliningRoundsBeforeEscalate?: number;
  /**
   * PDSE score threshold above which verification is "passing".
   * Default: 75.
   */
  passingThreshold?: number;
}

// ----------------------------------------------------------------------------
// ConvergenceController
// ----------------------------------------------------------------------------

export class ConvergenceController {
  private readonly windowSize: number;
  private readonly improvingSlope: number;
  private readonly decliningSlope: number;
  private readonly flatRoundsBeforeScopeReduce: number;
  private readonly decliningRoundsBeforeEscalate: number;
  private readonly passingThreshold: number;

  private observations: ScoreObservation[] = [];

  constructor(options: ConvergenceControllerOptions = {}) {
    this.windowSize = options.windowSize ?? 5;
    this.improvingSlope = options.improvingSlope ?? 2.0;
    this.decliningSlope = options.decliningSlope ?? -3.0;
    this.flatRoundsBeforeScopeReduce = options.flatRoundsBeforeScopeReduce ?? 3;
    this.decliningRoundsBeforeEscalate = options.decliningRoundsBeforeEscalate ?? 2;
    this.passingThreshold = options.passingThreshold ?? 75;
  }

  /**
   * Records a new PDSE score observation.
   * Call this after each verification pass (pass or fail).
   */
  record(score: number, round: number, passed: boolean): void {
    this.observations.push({
      score,
      timestamp: new Date().toISOString(),
      round,
      passed,
    });
  }

  /**
   * Evaluates the current trend and returns a convergence decision.
   * Computes consecutive flat/declining rounds directly from observation history,
   * so calling evaluate() once after N records produces the correct result.
   */
  evaluate(): ConvergenceDecision {
    if (this.observations.length === 0) {
      return this.makeDecision("continue", "insufficient_data", 0, 0, "No observations yet", "standard");
    }

    const window = this.observations.slice(-this.windowSize);
    const currentScore = window[window.length - 1]!.score;
    const bestScore = Math.max(...this.observations.map((o) => o.score));

    // Always pass if we've crossed the threshold
    if (currentScore >= this.passingThreshold) {
      return this.makeDecision("continue", "improving", currentScore, bestScore, `Score ${currentScore} >= passing threshold ${this.passingThreshold}`, "standard");
    }

    if (window.length < 2) {
      return this.makeDecision("continue", "insufficient_data", currentScore, bestScore, "Insufficient data for trend analysis", "standard");
    }

    const slope = computeSlope(window);
    const overallTrend = this.classifyTrend(slope);

    // Compute consecutive flat/declining rounds from the tail of the observation
    // history using overlapping sub-windows of size 2. This lets a single call
    // to evaluate() after N records produce the same result as N repeated calls.
    const consecutiveFlatRounds = this.countConsecutiveTailRounds("flat");
    const consecutiveDecliningRounds = this.countConsecutiveTailRounds("declining");

    // Escalate if declining consistently
    if (consecutiveDecliningRounds >= this.decliningRoundsBeforeEscalate) {
      return this.makeDecision(
        "escalate",
        "declining",
        currentScore,
        bestScore,
        `Score declining for ${consecutiveDecliningRounds} consecutive rounds (slope=${slope.toFixed(1)}/round, best was ${bestScore})`,
        "minimal",
      );
    }

    // Scope reduce if flat for too long
    if (consecutiveFlatRounds >= this.flatRoundsBeforeScopeReduce) {
      const strategy = consecutiveFlatRounds >= this.flatRoundsBeforeScopeReduce * 2 ? "minimal" : "reduced_scope";
      return this.makeDecision(
        "reduce_scope",
        "flat",
        currentScore,
        bestScore,
        `Score flat for ${consecutiveFlatRounds} rounds (slope=${slope.toFixed(1)}/round, stuck at ~${currentScore})`,
        strategy,
      );
    }

    // Otherwise continue
    return this.makeDecision(
      "continue",
      overallTrend,
      currentScore,
      bestScore,
      `Trend: ${overallTrend} (slope=${slope.toFixed(1)}/round, current=${currentScore}, best=${bestScore})`,
      "standard",
    );
  }

  /**
   * Counts consecutive tail rounds of a given trend type by scanning the
   * observation history from the end, using pairs of adjacent observations.
   */
  private countConsecutiveTailRounds(targetTrend: "flat" | "declining"): number {
    if (this.observations.length < 2) return 0;

    let count = 0;
    // Walk backwards through pairs: [i-1, i]
    for (let i = this.observations.length - 1; i >= 1; i--) {
      const pair = [this.observations[i - 1]!, this.observations[i]!];
      const pairSlope = computeSlope(pair);
      const pairTrend = this.classifyTrend(pairSlope);
      if (pairTrend === targetTrend) {
        count++;
      } else {
        break;
      }
    }
    return count;
  }

  /** Returns all observations. */
  getObservations(): ScoreObservation[] {
    return [...this.observations];
  }

  /** Returns the current best score. */
  getBestScore(): number {
    if (this.observations.length === 0) return 0;
    return Math.max(...this.observations.map((o) => o.score));
  }

  /** Returns the current score (most recent). */
  getCurrentScore(): number {
    if (this.observations.length === 0) return 0;
    return this.observations[this.observations.length - 1]!.score;
  }

  /** Returns whether the most recent observation passed. */
  isPassing(): boolean {
    if (this.observations.length === 0) return false;
    return this.observations[this.observations.length - 1]!.passed;
  }

  reset(): void {
    this.observations = [];
  }

  // --------------------------------------------------------------------------
  // Private helpers
  // --------------------------------------------------------------------------

  private classifyTrend(slope: number): ScoreTrend {
    if (slope >= this.improvingSlope) return "improving";
    if (slope <= this.decliningSlope) return "declining";
    return "flat";
  }

  private makeDecision(
    action: "continue" | "reduce_scope" | "escalate",
    trend: ScoreTrend,
    currentScore: number,
    bestScore: number,
    reason: string,
    strategy: "standard" | "reduced_scope" | "minimal",
  ): ConvergenceDecision {
    return { action, trend, currentScore, bestScore, reason, recommendedStrategy: strategy, slope: this.observations.length >= 2 ? computeSlope(this.observations.slice(-this.windowSize)) : 0 };
  }
}

// ----------------------------------------------------------------------------
// Helpers
// ----------------------------------------------------------------------------

/**
 * Computes the least-squares slope of the score series.
 * Returns score units per round (positive = improving).
 */
export function computeSlope(observations: ScoreObservation[]): number {
  if (observations.length < 2) return 0;

  const n = observations.length;
  // Use index (0..n-1) as x, score as y
  let sumX = 0;
  let sumY = 0;
  let sumXY = 0;
  let sumX2 = 0;

  for (let i = 0; i < n; i++) {
    const x = i;
    const y = observations[i]!.score;
    sumX += x;
    sumY += y;
    sumXY += x * y;
    sumX2 += x * x;
  }

  const denominator = n * sumX2 - sumX * sumX;
  if (denominator === 0) return 0;

  return (n * sumXY - sumX * sumY) / denominator;
}
