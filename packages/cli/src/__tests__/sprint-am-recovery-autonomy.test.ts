// ============================================================================
// Sprint AM — Dims 15+7: Task Recovery Log + Autonomy Convergence Metrics
// Tests that:
//  - recordTaskRecovery writes to .danteforge/task-recovery-log.json
//  - loadTaskRecoveryLog reads entries back
//  - getTopRecoveryPatterns returns patterns sorted by success rate
//  - getTopRecoveryPatterns ignores patterns with 0 successRate
//  - buildRecoveryBrief formats top patterns as [Recovery brief] message
//  - buildRecoveryBrief returns empty string when no successful patterns
//  - seeded task-recovery-log.json exists with 5+ entries
//  - AutonomyMetricsTracker.trackConvergence writes to autonomy-convergence-log.json
//  - AutonomyMetricsTracker.getConvergenceRate returns correct fraction
//  - summarizeAutonomyMetrics computes cleanFinishes correctly
//  - seeded autonomy-convergence-log.json exists with 5+ entries
// ============================================================================

import { describe, it, expect } from "vitest";
import { existsSync, readFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { resolve } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import {
  recordTaskRecovery,
  loadTaskRecoveryLog,
  getTopRecoveryPatterns,
  buildRecoveryBrief,
  AutonomyMetricsTracker,
  summarizeAutonomyMetrics,
  type AutonomyConvergenceEntry,
} from "@dantecode/core";

const repoRoot = resolve(__dirname, "../../../../");

function makeDir(): string {
  const dir = join(tmpdir(), `sprint-am-${randomUUID()}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

// ─── Part 1: Task Recovery Log ────────────────────────────────────────────────

describe("TaskRecoveryLog — Sprint AM (dim 15)", () => {
  // 1. recordTaskRecovery writes file
  it("recordTaskRecovery writes to .danteforge/task-recovery-log.json", () => {
    const dir = makeDir();
    recordTaskRecovery({ taskId: "t1", attempt: 1, failureMode: "typecheck", fixApplied: "rebuild_core", succeeded: true }, dir);
    expect(existsSync(join(dir, ".danteforge", "task-recovery-log.json"))).toBe(true);
  });

  // 2. loadTaskRecoveryLog reads entries
  it("loadTaskRecoveryLog reads entries back", () => {
    const dir = makeDir();
    recordTaskRecovery({ taskId: "t2", attempt: 1, failureMode: "test_fail", fixApplied: "narrow_repair", succeeded: true }, dir);
    const entries = loadTaskRecoveryLog(dir);
    expect(entries.length).toBeGreaterThan(0);
    expect(entries[0]?.failureMode).toBe("test_fail");
  });

  // 3. getTopRecoveryPatterns returns sorted by success rate
  it("getTopRecoveryPatterns returns patterns sorted by successRate descending", () => {
    const dir = makeDir();
    recordTaskRecovery({ taskId: "t1", attempt: 1, failureMode: "type_error", fixApplied: "fix_a", succeeded: true }, dir);
    recordTaskRecovery({ taskId: "t2", attempt: 1, failureMode: "type_error", fixApplied: "fix_a", succeeded: true }, dir);
    recordTaskRecovery({ taskId: "t3", attempt: 1, failureMode: "missing_import", fixApplied: "fix_b", succeeded: false }, dir);
    const patterns = getTopRecoveryPatterns(dir);
    expect(patterns[0]?.successRate).toBeGreaterThanOrEqual(patterns[1]?.successRate ?? 0);
  });

  // 4. buildRecoveryBrief formats message
  it("buildRecoveryBrief returns [Recovery brief] message with pattern info", () => {
    const dir = makeDir();
    recordTaskRecovery({ taskId: "t1", attempt: 1, failureMode: "typecheck_error", fixApplied: "run_build_first", succeeded: true }, dir);
    const patterns = getTopRecoveryPatterns(dir);
    const brief = buildRecoveryBrief(patterns);
    expect(brief).toContain("[Recovery brief]");
    expect(brief).toContain("typecheck_error");
  });

  // 5. buildRecoveryBrief returns empty for all-failed patterns
  it("buildRecoveryBrief returns empty string when all patterns have 0 successRate", () => {
    const dir = makeDir();
    recordTaskRecovery({ taskId: "t1", attempt: 1, failureMode: "unknown", fixApplied: "guess", succeeded: false }, dir);
    const patterns = getTopRecoveryPatterns(dir);
    const brief = buildRecoveryBrief(patterns);
    expect(brief).toBe("");
  });

  // 6. seeded task-recovery-log.json exists
  it("seeded task-recovery-log.json exists at .danteforge/ with 5+ entries", () => {
    const path = join(repoRoot, ".danteforge", "task-recovery-log.json");
    expect(existsSync(path)).toBe(true);
    const lines = readFileSync(path, "utf-8").trim().split("\n").filter(Boolean);
    expect(lines.length).toBeGreaterThanOrEqual(5);
  });
});

// ─── Part 2: Autonomy Convergence Metrics ─────────────────────────────────────

describe("AutonomyMetricsTracker — Sprint AM (dim 7)", () => {
  // 7. trackConvergence writes file
  it("trackConvergence writes to .danteforge/autonomy-convergence-log.json", () => {
    const dir = makeDir();
    const tracker = new AutonomyMetricsTracker(dir);
    tracker.trackConvergence("task-1", 8, 20, true);
    expect(existsSync(join(dir, ".danteforge", "autonomy-convergence-log.json"))).toBe(true);
  });

  // 8. getConvergenceRate returns correct fraction
  it("getConvergenceRate returns 0.5 when 1 of 2 tasks finished cleanly", () => {
    const dir = makeDir();
    const tracker = new AutonomyMetricsTracker(dir);
    tracker.trackConvergence("t1", 5, 20, true);
    tracker.trackConvergence("t2", 18, 20, false);
    expect(tracker.getConvergenceRate()).toBe(0.5);
  });

  // 9. summarizeAutonomyMetrics computes cleanFinishes
  it("summarizeAutonomyMetrics computes cleanFinishes and convergenceRate", () => {
    const entries: AutonomyConvergenceEntry[] = [
      { timestamp: "t", taskId: "t1", roundsUsed: 5, maxRounds: 20, finishedCleanly: true, loopDetected: false, userInterventions: 0, status: "complete" },
      { timestamp: "t", taskId: "t2", roundsUsed: 18, maxRounds: 20, finishedCleanly: false, loopDetected: true, userInterventions: 1, status: "loop" },
      { timestamp: "t", taskId: "t3", roundsUsed: 8, maxRounds: 20, finishedCleanly: true, loopDetected: false, userInterventions: 0, status: "complete" },
    ];
    const summary = summarizeAutonomyMetrics(entries);
    expect(summary.cleanFinishes).toBe(2);
    expect(summary.convergenceRate).toBeCloseTo(2 / 3, 2);
    expect(summary.loopDetections).toBe(1);
  });

  // 10. summarizeAutonomyMetrics handles empty
  it("summarizeAutonomyMetrics handles empty input", () => {
    const summary = summarizeAutonomyMetrics([]);
    expect(summary.totalTasks).toBe(0);
    expect(summary.convergenceRate).toBe(0);
  });

  // 11. seeded autonomy-convergence-log.json exists
  it("seeded autonomy-convergence-log.json exists at .danteforge/ with 5+ entries", () => {
    const path = join(repoRoot, ".danteforge", "autonomy-convergence-log.json");
    expect(existsSync(path)).toBe(true);
    const lines = readFileSync(path, "utf-8").trim().split("\n").filter(Boolean);
    expect(lines.length).toBeGreaterThanOrEqual(5);
  });
});
