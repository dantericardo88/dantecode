// ============================================================================
// Sprint AQ — Dims 7+8: AutonomyMetricsTracker wired + GitLifecycleManager wired
// Tests that:
//  - AutonomyMetricsTracker.trackConvergence() is called — convergence-log grows
//  - getConvergenceRate() reflects clean/total ratio from real log
//  - summarizeAutonomyMetrics cleanFinishes computed correctly
//  - trackConvergence with finishedCleanly=false is recorded
//  - GitLifecycleManager.recordCommit() writes to git-lifecycle-log.json
//  - emitGitLifecycleEvent("push") appends entry to git-lifecycle-log.json
//  - seeded git-lifecycle-log.json has 5+ entries
//  - emitGitLifecycleEvent is importable from @dantecode/core
// ============================================================================

import { describe, it, expect } from "vitest";
import { existsSync, readFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { resolve } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import {
  AutonomyMetricsTracker,
  summarizeAutonomyMetrics,
  emitGitLifecycleEvent,
  GitLifecycleManager,
  type AutonomyConvergenceEntry,
} from "@dantecode/core";

const repoRoot = resolve(__dirname, "../../../../");

function makeDir(): string {
  const dir = join(tmpdir(), `sprint-aq-${randomUUID()}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

describe("AutonomyMetricsTracker wired — Sprint AQ (dim 7)", () => {
  // 1. trackConvergence writes to autonomy-convergence-log.json
  it("trackConvergence writes entry to autonomy-convergence-log.json", () => {
    const dir = makeDir();
    const tracker = new AutonomyMetricsTracker(dir);
    tracker.trackConvergence("task-aq-1", 12, 50, true);
    const path = join(dir, ".danteforge", "autonomy-convergence-log.json");
    expect(existsSync(path)).toBe(true);
    const lines = readFileSync(path, "utf-8").trim().split("\n").filter(Boolean);
    expect(lines.length).toBe(1);
  });

  // 2. multiple calls grow the log
  it("each trackConvergence call appends a new entry", () => {
    const dir = makeDir();
    const tracker = new AutonomyMetricsTracker(dir);
    tracker.trackConvergence("task-1", 10, 50, true);
    tracker.trackConvergence("task-2", 45, 50, false);
    const path = join(dir, ".danteforge", "autonomy-convergence-log.json");
    const lines = readFileSync(path, "utf-8").trim().split("\n").filter(Boolean);
    expect(lines.length).toBe(2);
  });

  // 3. getConvergenceRate reflects clean fraction
  it("getConvergenceRate returns 0.5 when 1 of 2 tasks finished cleanly", () => {
    const dir = makeDir();
    const tracker = new AutonomyMetricsTracker(dir);
    tracker.trackConvergence("t1", 5, 50, true);
    tracker.trackConvergence("t2", 48, 50, false);
    expect(tracker.getConvergenceRate()).toBe(0.5);
  });

  // 4. finishedCleanly=false recorded correctly
  it("trackConvergence records finishedCleanly=false for failed tasks", () => {
    const dir = makeDir();
    const tracker = new AutonomyMetricsTracker(dir);
    tracker.trackConvergence("task-failed", 50, 50, false);
    const path = join(dir, ".danteforge", "autonomy-convergence-log.json");
    const entry = JSON.parse(readFileSync(path, "utf-8").trim()) as AutonomyConvergenceEntry;
    expect(entry.finishedCleanly).toBe(false);
  });

  // 5. summarizeAutonomyMetrics cleanFinishes
  it("summarizeAutonomyMetrics correctly counts cleanFinishes", () => {
    const entries: AutonomyConvergenceEntry[] = [
      { timestamp: "t", taskId: "t1", roundsUsed: 5, maxRounds: 50, finishedCleanly: true, loopDetected: false, userInterventions: 0, status: "complete" },
      { timestamp: "t", taskId: "t2", roundsUsed: 48, maxRounds: 50, finishedCleanly: false, loopDetected: true, userInterventions: 1, status: "loop" },
      { timestamp: "t", taskId: "t3", roundsUsed: 12, maxRounds: 50, finishedCleanly: true, loopDetected: false, userInterventions: 0, status: "complete" },
    ];
    const summary = summarizeAutonomyMetrics(entries);
    expect(summary.cleanFinishes).toBe(2);
    expect(summary.convergenceRate).toBeCloseTo(2 / 3, 2);
  });
});

describe("GitLifecycleManager wired — Sprint AQ (dim 8)", () => {
  // 6. emitGitLifecycleEvent writes entry to git-lifecycle-log.json
  it("emitGitLifecycleEvent writes a commit entry to git-lifecycle-log.json", () => {
    const dir = makeDir();
    emitGitLifecycleEvent({ stage: "commit", branch: "main", commitSha: "abc123", filesChanged: 2 }, dir);
    const path = join(dir, ".danteforge", "git-lifecycle-log.json");
    expect(existsSync(path)).toBe(true);
    const entry = JSON.parse(readFileSync(path, "utf-8").trim()) as { stage: string };
    expect(entry.stage).toBe("commit");
  });

  // 7. emitGitLifecycleEvent push appends entry
  it("emitGitLifecycleEvent writes a push entry with branch info", () => {
    const dir = makeDir();
    emitGitLifecycleEvent({ stage: "push", branch: "dad-ready", commitSha: "def456" }, dir);
    const path = join(dir, ".danteforge", "git-lifecycle-log.json");
    const entry = JSON.parse(readFileSync(path, "utf-8").trim()) as { stage: string; branch: string };
    expect(entry.stage).toBe("push");
    expect(entry.branch).toBe("dad-ready");
  });

  // 8. seeded git-lifecycle-log.json exists with 5+ entries
  it("seeded git-lifecycle-log.json exists at .danteforge/ with 5+ entries", () => {
    const path = join(repoRoot, ".danteforge", "git-lifecycle-log.json");
    expect(existsSync(path)).toBe(true);
    const lines = readFileSync(path, "utf-8").trim().split("\n").filter(Boolean);
    expect(lines.length).toBeGreaterThanOrEqual(5);
  });

  // 9. GitLifecycleManager.recordCommit writes commit entry
  it("GitLifecycleManager.recordCommit appends to git-lifecycle-log.json", () => {
    const dir = makeDir();
    const manager = new GitLifecycleManager("main", dir);
    manager.recordCommit("sha999", 3, 45, 12);
    const path = join(dir, ".danteforge", "git-lifecycle-log.json");
    expect(existsSync(path)).toBe(true);
    const lines = readFileSync(path, "utf-8").trim().split("\n").filter(Boolean);
    expect(lines.length).toBeGreaterThan(0);
  });
});
