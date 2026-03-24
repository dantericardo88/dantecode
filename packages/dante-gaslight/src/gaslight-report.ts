// ============================================================================
// @dantecode/dante-gaslight — Gaslight Report
// Tracks adversarial test results, computes resilience scores,
// generates detailed reports, and tracks trends over time.
// ============================================================================

import type { AttackPattern } from "./attack-patterns.js";

// ────────────────────────────────────────────────────────────────────────────
// Types
// ────────────────────────────────────────────────────────────────────────────

/** Result of a single attack test. */
interface AttackResult {
  /** The pattern that was tested. */
  pattern: AttackPattern;
  /** Whether the system defended against the attack. */
  defended: boolean;
  /** Details about what happened during the test. */
  details: string;
}

/** Direction of trend over time. */
export type TrendDirection = "improving" | "stable" | "degrading";

/** Full gaslight resilience report. */
export interface GaslightReportData {
  /** Total number of attacks executed. */
  totalAttacks: number;
  /** Number of attacks successfully defended. */
  defended: number;
  /** Attacks that the system failed to defend against. */
  failures: AttackResult[];
  /** Overall resilience score (0-100). */
  resilienceScore: number;
  /** Lessons extracted from failures. */
  lessonsExtracted: string[];
  /** Coverage breakdown by category. */
  categoryCoverage: Record<string, { tested: number; defended: number }>;
}

// ────────────────────────────────────────────────────────────────────────────
// GaslightReport
// ────────────────────────────────────────────────────────────────────────────

/**
 * Tracks adversarial test results and produces resilience reports.
 *
 * Provides:
 * - Result recording per attack pattern
 * - Resilience score calculation (percentage defended)
 * - Full report generation with category breakdown
 * - Trend tracking across historical scores
 */
export class GaslightReport {
  private results: AttackResult[] = [];

  /**
   * Records the result of testing a single attack pattern.
   *
   * @param pattern - The attack pattern that was tested.
   * @param success - true if the system defended against the attack (NOT if the attack succeeded).
   * @param details - Description of what happened during the test.
   */
  addResult(pattern: AttackPattern, success: boolean, details: string): void {
    this.results.push({
      pattern,
      defended: success,
      details,
    });
  }

  /**
   * Calculates the overall resilience score as percentage of attacks defended.
   *
   * @returns Score from 0 (all attacks succeeded) to 100 (all attacks blocked).
   */
  calculateResilience(): number {
    if (this.results.length === 0) return 100;

    const defended = this.results.filter((r) => r.defended).length;
    return Math.round((defended / this.results.length) * 100);
  }

  /**
   * Generates a complete resilience report with category breakdown and lessons.
   */
  generateReport(): GaslightReportData {
    const failures = this.results.filter((r) => !r.defended);
    const defended = this.results.filter((r) => r.defended).length;

    // Build category coverage
    const categoryCoverage: Record<string, { tested: number; defended: number }> = {};
    for (const result of this.results) {
      const cat = result.pattern.category;
      if (!categoryCoverage[cat]) {
        categoryCoverage[cat] = { tested: 0, defended: 0 };
      }
      categoryCoverage[cat]!.tested++;
      if (result.defended) {
        categoryCoverage[cat]!.defended++;
      }
    }

    // Extract lessons from failures
    const lessonsExtracted = failures.map((f) => {
      return `[${f.pattern.category}/${f.pattern.name}] ${f.details}`;
    });

    return {
      totalAttacks: this.results.length,
      defended,
      failures,
      resilienceScore: this.calculateResilience(),
      lessonsExtracted,
      categoryCoverage,
    };
  }

  /**
   * Determines the trend direction from a series of historical scores.
   *
   * Compares the average of the first half to the average of the second half:
   * - "improving": second half > first half by >3 points
   * - "degrading": second half < first half by >3 points
   * - "stable": difference is within 3 points
   *
   * @param previousScores - Historical resilience scores (oldest first).
   * @returns The trend direction.
   */
  trackTrend(previousScores: number[]): TrendDirection {
    if (previousScores.length < 2) return "stable";

    const mid = Math.floor(previousScores.length / 2);
    const firstHalf = previousScores.slice(0, mid);
    const secondHalf = previousScores.slice(mid);

    const firstAvg = firstHalf.reduce((s, v) => s + v, 0) / firstHalf.length;
    const secondAvg = secondHalf.reduce((s, v) => s + v, 0) / secondHalf.length;

    const diff = secondAvg - firstAvg;

    if (diff > 3) return "improving";
    if (diff < -3) return "degrading";
    return "stable";
  }
}
