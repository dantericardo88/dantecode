// ============================================================================
// @dantecode/core — Verification Trend Tracker
// Tracks verification scores over time, detects regressions,
// and generates health reports across all verification categories.
// ============================================================================

// ────────────────────────────────────────────────────────────────────────────
// Types
// ────────────────────────────────────────────────────────────────────────────

/** A single data point in the time-series. */
interface DataPoint {
  score: number;
  timestamp: number;
}

/** Trend analysis for a single verification category. */
export interface TrendReport {
  /** Category name (e.g. "correctness", "completeness"). */
  category: string;
  /** Most recent score. */
  current: number;
  /** Average score across the analysis window. */
  average: number;
  /** Direction of the trend. */
  trend: "improving" | "stable" | "degrading";
  /** Number of data points in the analysis window. */
  dataPoints: number;
}

/** Aggregate health report across all tracked categories. */
export interface HealthReport {
  /** Trend reports for each category. */
  categories: TrendReport[];
  /** Overall health status derived from category trends. */
  overallHealth: "healthy" | "warning" | "critical";
  /** Categories currently in regression (score significantly below average). */
  regressions: string[];
}

// ────────────────────────────────────────────────────────────────────────────
// Constants
// ────────────────────────────────────────────────────────────────────────────

const MS_PER_DAY = 86_400_000;
const DEFAULT_WINDOW_DAYS = 7;
const DEFAULT_REGRESSION_THRESHOLD = 5;

// ────────────────────────────────────────────────────────────────────────────
// VerificationTrendTracker
// ────────────────────────────────────────────────────────────────────────────

/**
 * Tracks verification scores over time and detects regressions.
 *
 * Stores time-series data points per category in memory.
 * Provides trend analysis, regression detection, and health reporting.
 */
export class VerificationTrendTracker {
  private data = new Map<string, DataPoint[]>();

  /**
   * Records a score data point for a verification category.
   *
   * @param category - The verification category (e.g. "correctness").
   * @param score - The score value (typically 0-100).
   * @param timestamp - Optional timestamp in ms since epoch (defaults to now).
   */
  record(category: string, score: number, timestamp?: number): void {
    const ts = timestamp ?? Date.now();
    const points = this.data.get(category) ?? [];
    points.push({ score, timestamp: ts });
    this.data.set(category, points);
  }

  /**
   * Analyzes the trend for a category over a time window.
   *
   * Trend direction:
   * - "improving": last 1/3 average > first 1/3 average by >2 points
   * - "degrading": last 1/3 average < first 1/3 average by >2 points
   * - "stable": otherwise
   *
   * @param category - The category to analyze.
   * @param windowDays - Number of days to look back (default: 7).
   * @returns Trend report, or a zero-state report if no data exists.
   */
  getTrend(category: string, windowDays?: number): TrendReport {
    const window = (windowDays ?? DEFAULT_WINDOW_DAYS) * MS_PER_DAY;
    const cutoff = Date.now() - window;
    const allPoints = this.data.get(category) ?? [];
    const points = allPoints.filter((p) => p.timestamp >= cutoff);

    if (points.length === 0) {
      return { category, current: 0, average: 0, trend: "stable", dataPoints: 0 };
    }

    const sorted = [...points].sort((a, b) => a.timestamp - b.timestamp);
    const current = sorted[sorted.length - 1]!.score;
    const average = sorted.reduce((sum, p) => sum + p.score, 0) / sorted.length;

    let trend: "improving" | "stable" | "degrading" = "stable";

    if (sorted.length >= 3) {
      const thirdSize = Math.max(1, Math.floor(sorted.length / 3));
      const firstThird = sorted.slice(0, thirdSize);
      const lastThird = sorted.slice(-thirdSize);

      const firstAvg = firstThird.reduce((s, p) => s + p.score, 0) / firstThird.length;
      const lastAvg = lastThird.reduce((s, p) => s + p.score, 0) / lastThird.length;

      if (lastAvg - firstAvg > 2) {
        trend = "improving";
      } else if (firstAvg - lastAvg > 2) {
        trend = "degrading";
      }
    }

    return {
      category,
      current,
      average: Math.round(average * 100) / 100,
      trend,
      dataPoints: sorted.length,
    };
  }

  /**
   * Detects whether a category is in regression.
   *
   * A regression is detected when the current score is more than
   * `threshold` points below the category average.
   *
   * @param category - The category to check.
   * @param threshold - Points below average to trigger (default: 5).
   * @returns true if the category is in regression.
   */
  detectRegression(category: string, threshold?: number): boolean {
    const t = threshold ?? DEFAULT_REGRESSION_THRESHOLD;
    const report = this.getTrend(category);

    if (report.dataPoints < 2) return false;
    return report.average - report.current > t;
  }

  /**
   * Generates an aggregate health report across all tracked categories.
   *
   * Overall health:
   * - "critical": any category in regression AND degrading
   * - "warning": any category in regression OR degrading
   * - "healthy": no regressions and no degrading trends
   */
  generateHealthReport(): HealthReport {
    const categories: TrendReport[] = [];
    const regressions: string[] = [];

    for (const category of this.data.keys()) {
      const report = this.getTrend(category);
      categories.push(report);

      if (this.detectRegression(category)) {
        regressions.push(category);
      }
    }

    let overallHealth: "healthy" | "warning" | "critical" = "healthy";

    const hasDegrading = categories.some((c) => c.trend === "degrading");
    const hasRegressions = regressions.length > 0;

    if (hasRegressions && hasDegrading) {
      overallHealth = "critical";
    } else if (hasRegressions || hasDegrading) {
      overallHealth = "warning";
    }

    return { categories, overallHealth, regressions };
  }
}
