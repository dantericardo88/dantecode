// ============================================================================
// @dantecode/core — Verification Trend Tracker
// Tracks verification scores over time, detects regressions,
// and generates health reports across all verification categories.
// ============================================================================

import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

// ────────────────────────────────────────────────────────────────────────────
// Legacy internal types
// ────────────────────────────────────────────────────────────────────────────

/** A single data point in the legacy in-memory time-series. */
interface DataPoint {
  score: number;
  timestamp: number;
}

// ────────────────────────────────────────────────────────────────────────────
// Legacy exported types (kept for backward compat with existing tests/exports)
// ────────────────────────────────────────────────────────────────────────────

/** Trend analysis for a single verification category (legacy API). */
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

/** Aggregate health report across all tracked categories (legacy API). */
export interface HealthReport {
  /** Trend reports for each category. */
  categories: TrendReport[];
  /** Overall health status derived from category trends. */
  overallHealth: "healthy" | "warning" | "critical";
  /** Categories currently in regression (score significantly below average). */
  regressions: string[];
}

// ────────────────────────────────────────────────────────────────────────────
// New (spec) types — JSONL-backed PDSE tracking
// ────────────────────────────────────────────────────────────────────────────

/** A single PDSE verification data point written to the JSONL store. */
export interface VerificationDataPoint {
  timestamp: string; // ISO-8601
  sessionId: string;
  filePath: string;
  pdseScore: number;
  antiStubPassed: boolean;
  constitutionPassed: boolean;
}

/** Regression entry within a PdseTrendReport. */
export interface VerificationRegression {
  filePath: string;
  previousScore: number;
  currentScore: number;
  delta: number;
  detectedAt: string;
}

/** Trend report for PDSE scores (spec API). */
export interface PdseTrendReport {
  period: string;
  dataPoints: number;
  averageScore: number;
  minScore: number;
  maxScore: number;
  trend: "improving" | "stable" | "degrading";
  regressions: VerificationRegression[];
  alerts: string[];
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
 * Supports two usage modes:
 *
 * **Legacy mode** (in-memory + optional JSON persistence):
 *   `new VerificationTrendTracker()` or `new VerificationTrendTracker({ persistPath })`
 *   Uses `record(category, score, timestamp?)`, `getTrend()`, `detectRegression()`,
 *   `generateHealthReport()`.
 *
 * **Spec mode** (JSONL-backed PDSE tracking):
 *   `new VerificationTrendTracker(storePath: string)`
 *   Uses async `record(point)`, `loadPoints()`, `generateReport()`,
 *   `isRegression()`, `getFileAverage()`.
 */
export class VerificationTrendTracker {
  // ── Legacy fields ──────────────────────────────────────────────────────────
  private legacyData = new Map<string, DataPoint[]>();
  private readonly persistPath: string | undefined;

  // ── Spec (JSONL) fields ────────────────────────────────────────────────────
  private readonly storePath: string | undefined;

  constructor(optionsOrStorePath?: string | { persistPath?: string }) {
    if (typeof optionsOrStorePath === "string") {
      // Spec mode: storePath is the JSONL file path
      this.storePath = optionsOrStorePath;
    } else {
      // Legacy mode
      this.persistPath = optionsOrStorePath?.persistPath;
      if (this.persistPath) {
        this._legacyLoadFromDisk(this.persistPath);
      }
    }
  }

  // ══════════════════════════════════════════════════════════════════════════
  // Spec (async JSONL) API
  // ══════════════════════════════════════════════════════════════════════════

  /**
   * Record a new verification data point to the JSONL store.
   * Creates the file and parent directories if they don't exist.
   */
  async record(point: VerificationDataPoint): Promise<void>;
  /** Legacy synchronous record (category + score). */
  record(category: string, score: number, timestamp?: number): void;
  record(
    pointOrCategory: VerificationDataPoint | string,
    score?: number,
    timestamp?: number,
  ): void | Promise<void> {
    if (typeof pointOrCategory === "string") {
      // Legacy path
      const ts = timestamp ?? Date.now();
      const points = this.legacyData.get(pointOrCategory) ?? [];
      points.push({ score: score!, timestamp: ts });
      this.legacyData.set(pointOrCategory, points);
      this._legacyFlushToDisk();
      return;
    }
    // Spec path — async
    return this._appendPoint(pointOrCategory);
  }

  private async _appendPoint(point: VerificationDataPoint): Promise<void> {
    if (!this.storePath) return;
    const dir = dirname(this.storePath);
    mkdirSync(dir, { recursive: true });
    appendFileSync(this.storePath, JSON.stringify(point) + "\n", "utf-8");
  }

  /**
   * Load all data points from the JSONL store (most recent first).
   * @param limitDays - If set, only return points within this many days.
   */
  async loadPoints(limitDays?: number): Promise<VerificationDataPoint[]> {
    if (!this.storePath || !existsSync(this.storePath)) return [];
    const raw = readFileSync(this.storePath, "utf-8");
    const lines = raw.split("\n").filter((l) => l.trim().length > 0);
    let points: VerificationDataPoint[] = [];
    for (const line of lines) {
      try {
        points.push(JSON.parse(line) as VerificationDataPoint);
      } catch {
        // Skip malformed lines
      }
    }
    if (limitDays !== undefined) {
      const cutoff = new Date(Date.now() - limitDays * MS_PER_DAY).toISOString();
      points = points.filter((p) => p.timestamp >= cutoff);
    }
    // Most recent first
    points.sort((a, b) => b.timestamp.localeCompare(a.timestamp));
    return points;
  }

  /**
   * Generate a trend report for the given period.
   * @param periodDays - Look-back window in days. Defaults to 7.
   */
  async generateReport(periodDays?: number): Promise<PdseTrendReport> {
    const days = periodDays ?? DEFAULT_WINDOW_DAYS;
    const points = await this.loadPoints(days);
    const period = `${days}d`;
    const alerts: string[] = [];
    const regressions: VerificationRegression[] = [];

    if (points.length === 0) {
      return {
        period,
        dataPoints: 0,
        averageScore: 0,
        minScore: 0,
        maxScore: 0,
        trend: "stable",
        regressions: [],
        alerts: [],
      };
    }

    const scores = points.map((p) => p.pdseScore);
    const averageScore = scores.reduce((s, v) => s + v, 0) / scores.length;
    const minScore = Math.min(...scores);
    const maxScore = Math.max(...scores);

    // Trend: use last-25% vs first-25%
    const quarterSize = Math.max(1, Math.floor(points.length / 4));
    // points is sorted newest-first; oldest = end of array
    const oldestQuarter = points.slice(-quarterSize).map((p) => p.pdseScore);
    const newestQuarter = points.slice(0, quarterSize).map((p) => p.pdseScore);
    const oldAvg = oldestQuarter.reduce((s, v) => s + v, 0) / oldestQuarter.length;
    const newAvg = newestQuarter.reduce((s, v) => s + v, 0) / newestQuarter.length;

    let trend: "improving" | "stable" | "degrading" = "stable";
    if (newAvg - oldAvg > 2) trend = "improving";
    else if (oldAvg - newAvg > 2) trend = "degrading";

    // Per-file regression detection
    const fileMap = new Map<string, VerificationDataPoint[]>();
    for (const p of points) {
      const arr = fileMap.get(p.filePath) ?? [];
      arr.push(p);
      fileMap.set(p.filePath, arr);
    }
    for (const [filePath, pts] of fileMap) {
      // pts is newest-first; sort oldest first for avg computation
      const sorted = [...pts].sort((a, b) => a.timestamp.localeCompare(b.timestamp));
      if (sorted.length < 2) continue;
      // Compare most recent score to average of all but most recent
      const allButLast = sorted.slice(0, -1);
      const prevAvg = allButLast.reduce((s, p) => s + p.pdseScore, 0) / allButLast.length;
      const latest = sorted[sorted.length - 1]!;
      const delta = latest.pdseScore - prevAvg;
      if (delta < -DEFAULT_REGRESSION_THRESHOLD) {
        regressions.push({
          filePath,
          previousScore: Math.round(prevAvg * 100) / 100,
          currentScore: latest.pdseScore,
          delta: Math.round(delta * 100) / 100,
          detectedAt: latest.timestamp,
        });
      }
    }

    if (regressions.length > 0) {
      alerts.push(
        `Regression detected in ${regressions.length} file(s): ${regressions.map((r) => r.filePath).join(", ")}`,
      );
    }
    if (averageScore < 70) {
      alerts.push(
        `Average PDSE score (${averageScore.toFixed(1)}) is below the 70-point threshold`,
      );
    }

    return {
      period,
      dataPoints: points.length,
      averageScore: Math.round(averageScore * 100) / 100,
      minScore,
      maxScore,
      trend,
      regressions,
      alerts,
    };
  }

  /**
   * Check if a new score represents a regression (>5 point drop) vs recent average.
   * @param filePath - File to check.
   * @param newScore - The new score being compared.
   */
  async isRegression(filePath: string, newScore: number): Promise<boolean> {
    const avg = await this.getFileAverage(filePath);
    if (avg === null) return false;
    return avg - newScore > DEFAULT_REGRESSION_THRESHOLD;
  }

  /**
   * Get the recent average PDSE score for a specific file.
   * @param filePath - The file path to filter by.
   * @param limitDays - Look-back window. Defaults to 7.
   * @returns Average score, or null if no data exists for the file.
   */
  async getFileAverage(filePath: string, limitDays?: number): Promise<number | null> {
    const points = await this.loadPoints(limitDays);
    const filePoints = points.filter((p) => p.filePath === filePath);
    if (filePoints.length === 0) return null;
    const avg = filePoints.reduce((s, p) => s + p.pdseScore, 0) / filePoints.length;
    return Math.round(avg * 100) / 100;
  }

  // ══════════════════════════════════════════════════════════════════════════
  // Legacy (synchronous, in-memory) API
  // ══════════════════════════════════════════════════════════════════════════

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
    const allPoints = this.legacyData.get(category) ?? [];
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

    for (const category of this.legacyData.keys()) {
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

  // ──────────────────────────────────────────────────────────────────────────
  // Legacy disk persistence
  // ──────────────────────────────────────────────────────────────────────────

  private _legacyFlushToDisk(): void {
    if (!this.persistPath) return;
    try {
      const dir = dirname(this.persistPath);
      mkdirSync(dir, { recursive: true });
      const obj: Record<string, DataPoint[]> = {};
      for (const [k, v] of this.legacyData) {
        obj[k] = v;
      }
      writeFileSync(this.persistPath, JSON.stringify(obj), "utf-8");
    } catch {
      // Non-fatal
    }
  }

  private _legacyLoadFromDisk(path: string): void {
    try {
      if (!existsSync(path)) return;
      const raw = readFileSync(path, "utf-8");
      const obj = JSON.parse(raw) as Record<string, DataPoint[]>;
      for (const [k, v] of Object.entries(obj)) {
        if (Array.isArray(v)) {
          this.legacyData.set(k, v);
        }
      }
    } catch {
      // Non-fatal
    }
  }
}
