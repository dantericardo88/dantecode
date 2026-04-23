// ============================================================================
// Sprint BO-BP — Dim 7 (AutonomySessionReport) + Dim 13 (EnhancedDiffQuality)
// 11 tests covering buildAutonomySessionSummary, record/load, getAutonomyStats,
// analyzeDiffHunks, scoreDiffQuality, recordDiffQualityReport, loadDiffQualityReports
// ============================================================================

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import {
  buildAutonomySessionSummary,
  recordAutonomyReport,
  loadAutonomyReports,
  getAutonomyStats,
  analyzeDiffHunks,
  scoreDiffQuality,
  recordDiffQualityReport,
  loadDiffQualityReports,
} from "@dantecode/core";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeTmpRoot(label: string): string {
  const dir = join(tmpdir(), `dc-test-bo-bp-${label}-${Date.now()}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

const SIMPLE_DIFF = `diff --git a/foo.ts b/foo.ts
index 1234..5678 100644
--- a/foo.ts
+++ b/foo.ts
@@ -1,5 +1,8 @@
 function hello() {
-  console.log("hi");
+  console.log("hello world");
+  // greeting updated
+  return true;
 }
@@ -10,3 +13,6 @@
 export default hello;
+
+it("greets", () => {
+  expect(hello()).toBe(true);
+});
`;

// ─── Sprint BO: AutonomySessionReport tests ──────────────────────────────────

describe("Sprint BO — buildAutonomySessionSummary", () => {
  it("(1) sets autonomyScore correctly: tasksCompleted/attempted * (1 - interventionRate)", () => {
    // turns=20, attempted=5, completed=4, userInterventions=2
    // interventionRate = 2/20 = 0.1
    // autonomyScore = (4/5) * (1 - 0.1) = 0.8 * 0.9 = 0.72
    const entry = buildAutonomySessionSummary("s1", 20, 5, 4, 30, 6, 2);
    expect(entry.interventionRate).toBeCloseTo(0.1);
    expect(entry.autonomyScore).toBeCloseTo(0.72);
  });

  it("(2) returns 0 autonomyScore when tasksAttempted=0", () => {
    const entry = buildAutonomySessionSummary("s2", 10, 0, 0, 5, 1, 1);
    expect(entry.autonomyScore).toBe(0);
  });

  it("(3) populates all fields correctly", () => {
    const entry = buildAutonomySessionSummary(
      "sess-xyz", 15, 3, 3, 22, 4, 0, ["blocker A", "blocker B"],
    );
    expect(entry.sessionId).toBe("sess-xyz");
    expect(entry.totalTurns).toBe(15);
    expect(entry.tasksAttempted).toBe(3);
    expect(entry.tasksCompleted).toBe(3);
    expect(entry.toolCallsTotal).toBe(22);
    expect(entry.filesModified).toBe(4);
    expect(entry.topBlockers).toEqual(["blocker A", "blocker B"]);
    expect(entry.timestamp).toBeTruthy();
  });

  it("(4) clamps topBlockers to 3 entries", () => {
    const entry = buildAutonomySessionSummary(
      "s3", 10, 4, 3, 20, 5, 1,
      ["a", "b", "c", "d", "e"],
    );
    expect(entry.topBlockers).toHaveLength(3);
  });
});

describe("Sprint BO — recordAutonomyReport / loadAutonomyReports", () => {
  let tmpRoot: string;

  beforeEach(() => {
    tmpRoot = makeTmpRoot("autonomy");
  });

  afterEach(() => {
    rmSync(tmpRoot, { recursive: true, force: true });
  });

  it("(5) recordAutonomyReport creates .danteforge/autonomy-session-report.json", () => {
    const entry = buildAutonomySessionSummary("s-write", 10, 3, 3, 15, 4, 0);
    recordAutonomyReport(entry, tmpRoot);
    expect(existsSync(join(tmpRoot, ".danteforge", "autonomy-session-report.json"))).toBe(true);
  });

  it("(6) loadAutonomyReports reads seeded JSONL entries (real file)", () => {
    // Use the actual seeded file from .danteforge
    // Write 2 entries and read them back
    const e1 = buildAutonomySessionSummary("load-1", 20, 5, 4, 30, 6, 2, ["err"]);
    const e2 = buildAutonomySessionSummary("load-2", 10, 2, 2, 14, 3, 0);
    recordAutonomyReport(e1, tmpRoot);
    recordAutonomyReport(e2, tmpRoot);
    const reports = loadAutonomyReports(tmpRoot);
    expect(reports).toHaveLength(2);
    expect(reports[0]!.sessionId).toBe("load-1");
    expect(reports[1]!.sessionId).toBe("load-2");
  });
});

describe("Sprint BO — getAutonomyStats", () => {
  it("(7) returns correct avgAutonomyScore from multiple entries", () => {
    const e1 = buildAutonomySessionSummary("a", 10, 2, 2, 10, 3, 0);
    const e2 = buildAutonomySessionSummary("b", 10, 4, 2, 20, 5, 2);
    // e1: interventionRate=0, autonomyScore=1.0
    // e2: interventionRate=0.2, autonomyScore=(2/4)*(0.8)=0.4
    const stats = getAutonomyStats([e1, e2]);
    expect(stats.avgAutonomyScore).toBeCloseTo((e1.autonomyScore + e2.autonomyScore) / 2);
    expect(stats.totalTasksCompleted).toBe(4);
    expect(stats.totalTasksAttempted).toBe(6);
  });

  it("(8) correctly aggregates topBlockers sorted by frequency", () => {
    const e1 = buildAutonomySessionSummary("x", 10, 2, 2, 10, 3, 0, ["type error", "missing import"]);
    const e2 = buildAutonomySessionSummary("y", 10, 2, 1, 10, 2, 1, ["type error", "timeout"]);
    const e3 = buildAutonomySessionSummary("z", 10, 2, 2, 10, 3, 0, ["type error"]);
    const stats = getAutonomyStats([e1, e2, e3]);
    // "type error" appears 3x, "missing import" 1x, "timeout" 1x
    expect(stats.topBlockers[0]).toBe("type error");
    expect(stats.topBlockers).toContain("missing import");
    expect(stats.topBlockers).toContain("timeout");
  });

  it("(9) returns zeros for empty entries array", () => {
    const stats = getAutonomyStats([]);
    expect(stats.avgAutonomyScore).toBe(0);
    expect(stats.totalTasksCompleted).toBe(0);
    expect(stats.topBlockers).toHaveLength(0);
  });
});

// ─── Sprint BP: EnhancedDiffQualityScorer tests ───────────────────────────────

describe("Sprint BP — analyzeDiffHunks", () => {
  it("(10) returns correct linesAdded/linesRemoved for a simple diff", () => {
    const hunks = analyzeDiffHunks(SIMPLE_DIFF);
    expect(hunks).toHaveLength(2);
    // hunk 0: +3 lines (+console.log, +// greeting, +return true), -1 line
    expect(hunks[0]!.linesAdded).toBe(3);
    expect(hunks[0]!.linesRemoved).toBe(1);
    // hunk 1: +4 lines, -0 lines
    expect(hunks[1]!.linesAdded).toBe(4);
    expect(hunks[1]!.linesRemoved).toBe(0);
  });

  it("(11) detects hasTests when + line contains expect(", () => {
    const hunks = analyzeDiffHunks(SIMPLE_DIFF);
    // Second hunk has it("greets") and expect(hello())
    expect(hunks[1]!.hasTests).toBe(true);
  });

  it("(12) detects hasComments when + line starts with //", () => {
    const hunks = analyzeDiffHunks(SIMPLE_DIFF);
    // First hunk has +  // greeting updated
    expect(hunks[0]!.hasComments).toBe(true);
  });

  it("(13) isRefactor=true when linesAdded <= linesRemoved * 1.2", () => {
    const refactorDiff = `--- a/foo.ts
+++ b/foo.ts
@@ -1,5 +1,5 @@
-function foo() {
-  return 1;
-  return 2;
+function foo() {
+  return 1;
 }
`;
    const hunks = analyzeDiffHunks(refactorDiff);
    expect(hunks[0]!.linesRemoved).toBeGreaterThan(0);
    expect(hunks[0]!.isRefactor).toBe(true);
  });
});

describe("Sprint BP — scoreDiffQuality", () => {
  it("(14) returns overallQuality between 0 and 1", () => {
    const report = scoreDiffQuality(SIMPLE_DIFF);
    expect(report.overallQuality).toBeGreaterThanOrEqual(0);
    expect(report.overallQuality).toBeLessThanOrEqual(1);
  });

  it("(15) hasTests=true when any hunk has test lines", () => {
    const report = scoreDiffQuality(SIMPLE_DIFF);
    expect(report.hasTests).toBe(true);
  });

  it("(16) gives higher overallQuality when tests present vs absent", () => {
    const withTests = scoreDiffQuality(SIMPLE_DIFF);
    const noTestsDiff = `--- a/foo.ts
+++ b/foo.ts
@@ -1,3 +1,4 @@
-const x = 1;
+const x = 2;
+const y = 3;
`;
    const withoutTests = scoreDiffQuality(noTestsDiff);
    expect(withTests.overallQuality).toBeGreaterThan(withoutTests.overallQuality);
  });
});

describe("Sprint BP — recordDiffQualityReport / loadDiffQualityReports", () => {
  let tmpRoot: string;

  beforeEach(() => {
    tmpRoot = makeTmpRoot("diff");
  });

  afterEach(() => {
    rmSync(tmpRoot, { recursive: true, force: true });
  });

  it("(17) recordDiffQualityReport creates .danteforge/diff-quality-report.json", () => {
    const report = scoreDiffQuality(SIMPLE_DIFF);
    recordDiffQualityReport(report, "sess-test", tmpRoot);
    expect(existsSync(join(tmpRoot, ".danteforge", "diff-quality-report.json"))).toBe(true);
  });

  it("(18) loadDiffQualityReports reads and parses JSONL entries", () => {
    const r1 = scoreDiffQuality(SIMPLE_DIFF);
    recordDiffQualityReport(r1, "sess-A", tmpRoot);
    recordDiffQualityReport(r1, "sess-B", tmpRoot);
    const reports = loadDiffQualityReports(tmpRoot);
    expect(reports).toHaveLength(2);
    expect(reports[0]!.sessionId).toBe("sess-A");
    expect(reports[1]!.sessionId).toBe("sess-B");
    expect(reports[0]!.timestamp).toBeTruthy();
    expect(reports[0]!.totalHunks).toBeGreaterThan(0);
  });

  it("(19) loadDiffQualityReports returns empty array for missing file", () => {
    const reports = loadDiffQualityReports(tmpRoot);
    expect(reports).toEqual([]);
  });
});
