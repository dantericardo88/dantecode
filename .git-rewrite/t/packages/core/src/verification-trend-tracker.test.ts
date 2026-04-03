// ============================================================================
// @dantecode/core — Verification Trend Tracker Tests
// ============================================================================

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { VerificationTrendTracker } from "./verification-trend-tracker.js";
import type { VerificationDataPoint } from "./verification-trend-tracker.js";

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

  // ──────────────────────────────────────────────────────────────────────────
  // Disk persistence
  // ──────────────────────────────────────────────────────────────────────────

  describe("disk persistence", () => {
    let testDir: string;
    let persistPath: string;

    beforeEach(() => {
      testDir = join(tmpdir(), `trend-test-${randomUUID().slice(0, 8)}`);
      mkdirSync(testDir, { recursive: true });
      persistPath = join(testDir, "trends.json");
    });

    afterEach(() => {
      try {
        rmSync(testDir, { recursive: true, force: true });
      } catch {
        // cleanup best-effort
      }
    });

    it("record persists to file", () => {
      const t1 = new VerificationTrendTracker({ persistPath });
      t1.record("accuracy", 85, now - 2 * DAY);
      t1.record("accuracy", 90, now - 1 * DAY);

      // New instance from same path should have the data
      const t2 = new VerificationTrendTracker({ persistPath });
      const trend = t2.getTrend("accuracy");
      expect(trend.dataPoints).toBe(2);
      expect(trend.current).toBe(90);
    });

    it("new instance from same path loads existing data", () => {
      const t1 = new VerificationTrendTracker({ persistPath });
      t1.record("completeness", 70, now - 3 * DAY);
      t1.record("completeness", 75, now - 2 * DAY);
      t1.record("completeness", 80, now - 1 * DAY);

      const t2 = new VerificationTrendTracker({ persistPath });
      const trend = t2.getTrend("completeness");
      expect(trend.dataPoints).toBe(3);
      expect(trend.trend).toBe("improving");
    });

    it("generateHealthReport works after restart from disk", () => {
      const t1 = new VerificationTrendTracker({ persistPath });
      // Stable category
      t1.record("quality", 80, now - 3 * DAY);
      t1.record("quality", 81, now - 2 * DAY);
      t1.record("quality", 80, now - 1 * DAY);

      const t2 = new VerificationTrendTracker({ persistPath });
      const report = t2.generateHealthReport();
      expect(report.overallHealth).toBe("healthy");
      expect(report.categories).toHaveLength(1);
      expect(report.categories[0]!.category).toBe("quality");
    });
  });
});

// ════════════════════════════════════════════════════════════════════════════
// Spec (JSONL / async) API tests
// ════════════════════════════════════════════════════════════════════════════

describe("VerificationTrendTracker — async JSONL API", () => {
  let testDir: string;
  let storePath: string;
  let tracker: VerificationTrendTracker;

  const makePoint = (
    filePath: string,
    pdseScore: number,
    offsetMs: number = 0,
  ): VerificationDataPoint => ({
    timestamp: new Date(Date.now() - offsetMs).toISOString(),
    sessionId: randomUUID(),
    filePath,
    pdseScore,
    antiStubPassed: pdseScore >= 70,
    constitutionPassed: pdseScore >= 60,
  });

  const DAY = 86_400_000;

  beforeEach(() => {
    testDir = join(tmpdir(), `jsonl-trend-test-${randomUUID().slice(0, 8)}`);
    mkdirSync(testDir, { recursive: true });
    storePath = join(testDir, ".dantecode", "verification-trends.jsonl");
    tracker = new VerificationTrendTracker(storePath);
  });

  afterEach(() => {
    try {
      rmSync(testDir, { recursive: true, force: true });
    } catch {
      /* best-effort */
    }
  });

  // ── 1. record() appends to the JSONL file ─────────────────────────────────
  it("record() appends a JSON line to the JSONL file", async () => {
    const pt = makePoint("src/auth.ts", 85);
    await tracker.record(pt);

    expect(existsSync(storePath)).toBe(true);
    const raw = readFileSync(storePath, "utf-8");
    const lines = raw.trim().split("\n");
    expect(lines).toHaveLength(1);
    const parsed = JSON.parse(lines[0]!) as VerificationDataPoint;
    expect(parsed.filePath).toBe("src/auth.ts");
    expect(parsed.pdseScore).toBe(85);
  });

  // ── 2. loadPoints() reads all points ──────────────────────────────────────
  it("loadPoints() reads all points from the JSONL file", async () => {
    await tracker.record(makePoint("src/a.ts", 80));
    await tracker.record(makePoint("src/b.ts", 90));
    await tracker.record(makePoint("src/c.ts", 75));

    const points = await tracker.loadPoints();
    expect(points).toHaveLength(3);
    const paths = points.map((p) => p.filePath).sort();
    expect(paths).toEqual(["src/a.ts", "src/b.ts", "src/c.ts"]);
  });

  // ── 3. loadPoints(limitDays) filters by time window ───────────────────────
  it("loadPoints(limitDays) returns only points within the window", async () => {
    // Write directly: create a fresh tracker to get full control
    const oldPoint = makePoint("src/old.ts", 50, 10 * DAY); // 10 days ago
    const newPoint = makePoint("src/new.ts", 85, 1 * DAY); // 1 day ago

    await tracker.record(oldPoint);
    await tracker.record(newPoint);

    const withinWeek = await tracker.loadPoints(7);
    expect(withinWeek).toHaveLength(1);
    expect(withinWeek[0]!.filePath).toBe("src/new.ts");
  });

  // ── 4. generateReport() calculates averageScore ───────────────────────────
  it("generateReport() calculates averageScore correctly", async () => {
    await tracker.record(makePoint("src/x.ts", 80));
    await tracker.record(makePoint("src/y.ts", 90));
    await tracker.record(makePoint("src/z.ts", 70));

    const report = await tracker.generateReport();
    expect(report.dataPoints).toBe(3);
    expect(report.averageScore).toBeCloseTo(80, 1);
    expect(report.minScore).toBe(70);
    expect(report.maxScore).toBe(90);
    expect(report.period).toBe("7d");
  });

  // ── 5. generateReport() detects "degrading" trend ─────────────────────────
  it("generateReport() detects degrading trend", async () => {
    // oldest → newest scores decreasing; oldest points have larger offset
    await tracker.record(makePoint("src/f.ts", 95, 6 * DAY));
    await tracker.record(makePoint("src/f.ts", 90, 5 * DAY));
    await tracker.record(makePoint("src/f.ts", 85, 4 * DAY));
    await tracker.record(makePoint("src/f.ts", 75, 3 * DAY));
    await tracker.record(makePoint("src/f.ts", 65, 2 * DAY));
    await tracker.record(makePoint("src/f.ts", 60, 1 * DAY));
    await tracker.record(makePoint("src/f.ts", 55, 0));

    const report = await tracker.generateReport();
    expect(report.trend).toBe("degrading");
  });

  // ── 6. generateReport() detects "improving" trend ─────────────────────────
  it("generateReport() detects improving trend", async () => {
    // oldest → newest scores increasing
    await tracker.record(makePoint("src/g.ts", 55, 6 * DAY));
    await tracker.record(makePoint("src/g.ts", 60, 5 * DAY));
    await tracker.record(makePoint("src/g.ts", 65, 4 * DAY));
    await tracker.record(makePoint("src/g.ts", 75, 3 * DAY));
    await tracker.record(makePoint("src/g.ts", 85, 2 * DAY));
    await tracker.record(makePoint("src/g.ts", 90, 1 * DAY));
    await tracker.record(makePoint("src/g.ts", 95, 0));

    const report = await tracker.generateReport();
    expect(report.trend).toBe("improving");
  });

  // ── 7. isRegression() returns true for >5 point drop ──────────────────────
  it("isRegression() returns true when new score drops >5 below recent average", async () => {
    // Establish an average around 90
    await tracker.record(makePoint("src/reg.ts", 90, 3 * DAY));
    await tracker.record(makePoint("src/reg.ts", 91, 2 * DAY));
    await tracker.record(makePoint("src/reg.ts", 89, 1 * DAY));

    // New score is 80 — drop of ~10 from avg ~90
    const result = await tracker.isRegression("src/reg.ts", 80);
    expect(result).toBe(true);
  });

  it("isRegression() returns false when score is within acceptable range", async () => {
    await tracker.record(makePoint("src/ok.ts", 85, 2 * DAY));
    await tracker.record(makePoint("src/ok.ts", 87, 1 * DAY));

    const result = await tracker.isRegression("src/ok.ts", 84);
    expect(result).toBe(false);
  });

  it("isRegression() returns false for a file with no prior data", async () => {
    const result = await tracker.isRegression("src/unknown.ts", 70);
    expect(result).toBe(false);
  });

  // ── 8. getFileAverage() returns correct average ───────────────────────────
  it("getFileAverage() returns correct average for a specific file", async () => {
    await tracker.record(makePoint("src/avg.ts", 80));
    await tracker.record(makePoint("src/avg.ts", 90));
    await tracker.record(makePoint("src/other.ts", 50)); // different file — should not affect

    const avg = await tracker.getFileAverage("src/avg.ts");
    expect(avg).toBeCloseTo(85, 1);
  });

  it("getFileAverage() returns null for a file with no data", async () => {
    const avg = await tracker.getFileAverage("src/nowhere.ts");
    expect(avg).toBeNull();
  });

  // ── Regression alert in generateReport ────────────────────────────────────
  it("generateReport() adds alert when regression detected", async () => {
    // Establish high baseline then add a low score
    await tracker.record(makePoint("src/alert.ts", 92, 3 * DAY));
    await tracker.record(makePoint("src/alert.ts", 91, 2 * DAY));
    await tracker.record(makePoint("src/alert.ts", 90, 1 * DAY));
    await tracker.record(makePoint("src/alert.ts", 70, 0)); // drop of ~21

    const report = await tracker.generateReport();
    expect(report.regressions.length).toBeGreaterThan(0);
    expect(report.alerts.length).toBeGreaterThan(0);
    expect(report.alerts[0]).toContain("Regression");
  });

  it("generateReport() adds alert when averageScore < 70", async () => {
    await tracker.record(makePoint("src/low.ts", 50));
    await tracker.record(makePoint("src/low.ts", 60));

    const report = await tracker.generateReport();
    const hasLowAlert = report.alerts.some((a) => a.includes("below"));
    expect(hasLowAlert).toBe(true);
  });

  it("generateReport() returns empty report for store with no data", async () => {
    const emptyTracker = new VerificationTrendTracker(join(testDir, "empty-trends.jsonl"));
    const report = await emptyTracker.generateReport();
    expect(report.dataPoints).toBe(0);
    expect(report.averageScore).toBe(0);
    expect(report.trend).toBe("stable");
    expect(report.regressions).toEqual([]);
    expect(report.alerts).toEqual([]);
  });
});
