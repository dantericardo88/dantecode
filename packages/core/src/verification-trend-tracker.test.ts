// ============================================================================
// @dantecode/core — Verification Trend Tracker Tests
// ============================================================================

import { describe, it, expect, beforeEach } from "vitest";
import { VerificationTrendTracker } from "./verification-trend-tracker.js";

describe("VerificationTrendTracker", () => {
  let tracker: VerificationTrendTracker;
  const now = Date.now();
  const DAY = 86_400_000;

  beforeEach(() => {
    tracker = new VerificationTrendTracker();
  });

  // ──────────────────────────────────────────────────────────────────────────
  // Trend detection
  // ──────────────────────────────────────────────────────────────────────────

  describe("getTrend", () => {
    it("detects an improving trend", () => {
      // Scores increasing over time
      tracker.record("correctness", 60, now - 6 * DAY);
      tracker.record("correctness", 65, now - 4 * DAY);
      tracker.record("correctness", 70, now - 2 * DAY);
      tracker.record("correctness", 80, now - 1 * DAY);
      tracker.record("correctness", 85, now);

      const report = tracker.getTrend("correctness");
      expect(report.trend).toBe("improving");
      expect(report.current).toBe(85);
      expect(report.dataPoints).toBe(5);
    });

    it("detects a degrading trend", () => {
      // Scores decreasing over time
      tracker.record("completeness", 90, now - 6 * DAY);
      tracker.record("completeness", 85, now - 4 * DAY);
      tracker.record("completeness", 75, now - 2 * DAY);
      tracker.record("completeness", 70, now - 1 * DAY);
      tracker.record("completeness", 65, now);

      const report = tracker.getTrend("completeness");
      expect(report.trend).toBe("degrading");
      expect(report.current).toBe(65);
    });

    it("detects a stable trend", () => {
      tracker.record("clarity", 80, now - 3 * DAY);
      tracker.record("clarity", 81, now - 2 * DAY);
      tracker.record("clarity", 79, now - 1 * DAY);
      tracker.record("clarity", 80, now);

      const report = tracker.getTrend("clarity");
      expect(report.trend).toBe("stable");
    });

    it("returns zero-state for unknown category", () => {
      const report = tracker.getTrend("nonexistent");
      expect(report.current).toBe(0);
      expect(report.average).toBe(0);
      expect(report.trend).toBe("stable");
      expect(report.dataPoints).toBe(0);
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // Regression detection
  // ──────────────────────────────────────────────────────────────────────────

  describe("detectRegression", () => {
    it("detects regression when current score drops below average by threshold", () => {
      tracker.record("security", 90, now - 3 * DAY);
      tracker.record("security", 88, now - 2 * DAY);
      tracker.record("security", 85, now - 1 * DAY);
      tracker.record("security", 75, now); // 75 is ~10 below avg of ~84.5

      const regressed = tracker.detectRegression("security", 5);
      expect(regressed).toBe(true);
    });

    it("does not detect regression when scores are stable", () => {
      tracker.record("quality", 80, now - 2 * DAY);
      tracker.record("quality", 81, now - 1 * DAY);
      tracker.record("quality", 79, now);

      const regressed = tracker.detectRegression("quality", 5);
      expect(regressed).toBe(false);
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // Health report
  // ──────────────────────────────────────────────────────────────────────────

  describe("generateHealthReport", () => {
    it("reports healthy when all categories are stable", () => {
      tracker.record("a", 80, now - 2 * DAY);
      tracker.record("a", 81, now - 1 * DAY);
      tracker.record("a", 80, now);

      tracker.record("b", 90, now - 2 * DAY);
      tracker.record("b", 91, now - 1 * DAY);
      tracker.record("b", 90, now);

      const report = tracker.generateHealthReport();
      expect(report.overallHealth).toBe("healthy");
      expect(report.regressions).toHaveLength(0);
      expect(report.categories).toHaveLength(2);
    });

    it("reports critical when regression and degrading trend coexist", () => {
      // Category with degrading trend AND regression
      tracker.record("failing", 95, now - 6 * DAY);
      tracker.record("failing", 90, now - 4 * DAY);
      tracker.record("failing", 85, now - 2 * DAY);
      tracker.record("failing", 80, now - 1 * DAY);
      tracker.record("failing", 70, now); // regression: avg ~84, current 70

      const report = tracker.generateHealthReport();
      expect(report.overallHealth).toBe("critical");
      expect(report.regressions).toContain("failing");
    });
  });
});
