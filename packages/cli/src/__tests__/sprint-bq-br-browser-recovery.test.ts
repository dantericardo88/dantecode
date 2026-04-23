// Sprint BQ-BR tests — browser outcome logger (dim 17) + task recovery reporter (dim 15)
import { describe, it, expect } from "vitest";
import { mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";

import {
  recordBrowserOutcome,
  loadBrowserOutcomes,
  getBrowserOutcomeSummary,
  type BrowserOutcomeRecord,
} from "@dantecode/core";

import {
  getTaskRecoveryStats,
  recordTaskRecoveryStats,
  loadTaskRecoveryStats,
  type TaskRecoveryEntry,
} from "@dantecode/core";

function tempDir(): string {
  const dir = join(tmpdir(), `bq-br-test-${randomUUID()}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

function makeOutcome(overrides: Partial<BrowserOutcomeRecord> = {}): BrowserOutcomeRecord {
  return {
    sessionId: randomUUID(),
    taskDescription: "test task",
    urlsVisited: 2,
    screenshotsTaken: 1,
    actionsPerformed: 5,
    succeeded: true,
    durationMs: 3000,
    timestamp: new Date().toISOString(),
    ...overrides,
  };
}

function makeEntry(overrides: Partial<TaskRecoveryEntry> = {}): TaskRecoveryEntry {
  return {
    timestamp: new Date().toISOString(),
    taskId: randomUUID(),
    attempt: 1,
    failureMode: "timeout",
    fixApplied: "retry",
    succeeded: true,
    durationMs: 1500,
    ...overrides,
  };
}

// ─── Sprint BQ — Dim 17: BrowserOutcomeLogger ────────────────────────────────

describe("recordBrowserOutcome", () => {
  it("creates .danteforge/browser-outcome-log.json in the project root", () => {
    const root = tempDir();
    const outcome = makeOutcome();
    recordBrowserOutcome(outcome, root);
    expect(existsSync(join(root, ".danteforge", "browser-outcome-log.json"))).toBe(true);
  });

  it("appends multiple outcomes as separate JSONL lines", () => {
    const root = tempDir();
    recordBrowserOutcome(makeOutcome({ sessionId: "a" }), root);
    recordBrowserOutcome(makeOutcome({ sessionId: "b" }), root);
    const loaded = loadBrowserOutcomes(root);
    expect(loaded).toHaveLength(2);
    expect(loaded[0]!.sessionId).toBe("a");
    expect(loaded[1]!.sessionId).toBe("b");
  });
});

describe("loadBrowserOutcomes", () => {
  it("returns empty array when file does not exist", () => {
    const root = tempDir();
    const result = loadBrowserOutcomes(root);
    expect(result).toEqual([]);
  });

  it("reads and parses JSONL entries correctly", () => {
    const root = tempDir();
    const outcome = makeOutcome({ actionsPerformed: 8, succeeded: false, failureReason: "captcha" });
    recordBrowserOutcome(outcome, root);
    const loaded = loadBrowserOutcomes(root);
    expect(loaded).toHaveLength(1);
    expect(loaded[0]!.actionsPerformed).toBe(8);
    expect(loaded[0]!.succeeded).toBe(false);
    expect(loaded[0]!.failureReason).toBe("captcha");
  });
});

describe("getBrowserOutcomeSummary", () => {
  it("returns zero successRate when no outcomes provided", () => {
    const summary = getBrowserOutcomeSummary([]);
    expect(summary.successRate).toBe(0);
    expect(summary.totalSessions).toBe(0);
    expect(summary.topFailureReasons).toEqual([]);
  });

  it("returns successRate 1.0 when all outcomes succeeded", () => {
    const outcomes = [makeOutcome({ succeeded: true }), makeOutcome({ succeeded: true })];
    const summary = getBrowserOutcomeSummary(outcomes);
    expect(summary.successRate).toBe(1.0);
  });

  it("returns successRate 0.5 for half-success outcomes", () => {
    const outcomes = [
      makeOutcome({ succeeded: true }),
      makeOutcome({ succeeded: false, failureReason: "err" }),
    ];
    const summary = getBrowserOutcomeSummary(outcomes);
    expect(summary.successRate).toBe(0.5);
  });

  it("correctly computes avgActionsPerSession", () => {
    const outcomes = [
      makeOutcome({ actionsPerformed: 4 }),
      makeOutcome({ actionsPerformed: 8 }),
    ];
    const summary = getBrowserOutcomeSummary(outcomes);
    expect(summary.avgActionsPerSession).toBe(6);
  });

  it("correctly computes avgDurationMs", () => {
    const outcomes = [
      makeOutcome({ durationMs: 1000 }),
      makeOutcome({ durationMs: 3000 }),
    ];
    const summary = getBrowserOutcomeSummary(outcomes);
    expect(summary.avgDurationMs).toBe(2000);
  });

  it("collects topFailureReasons from failed entries, sorted by frequency", () => {
    const outcomes = [
      makeOutcome({ succeeded: false, failureReason: "captcha" }),
      makeOutcome({ succeeded: false, failureReason: "timeout" }),
      makeOutcome({ succeeded: false, failureReason: "captcha" }),
      makeOutcome({ succeeded: true }),
    ];
    const summary = getBrowserOutcomeSummary(outcomes);
    expect(summary.topFailureReasons[0]).toBe("captcha");
    expect(summary.topFailureReasons).toContain("timeout");
    expect(summary.topFailureReasons.length).toBeLessThanOrEqual(3);
  });

  it("returns totalSessions equal to number of outcomes provided", () => {
    const outcomes = [makeOutcome(), makeOutcome(), makeOutcome()];
    const summary = getBrowserOutcomeSummary(outcomes);
    expect(summary.totalSessions).toBe(3);
  });
});

// ─── Sprint BR — Dim 15: TaskRecoveryReporter ────────────────────────────────

describe("getTaskRecoveryStats", () => {
  it("returns recoverySuccessRate 0 when no entries", () => {
    const stats = getTaskRecoveryStats([]);
    expect(stats.recoverySuccessRate).toBe(0);
    expect(stats.totalRecoveries).toBe(0);
    expect(stats.successfulRecoveries).toBe(0);
    expect(stats.mostCommonErrors).toEqual([]);
  });

  it("correctly computes recoverySuccessRate from mixed entries", () => {
    const entries = [
      makeEntry({ succeeded: true }),
      makeEntry({ succeeded: true }),
      makeEntry({ succeeded: false }),
      makeEntry({ succeeded: false }),
    ];
    const stats = getTaskRecoveryStats(entries);
    expect(stats.totalRecoveries).toBe(4);
    expect(stats.successfulRecoveries).toBe(2);
    expect(stats.recoverySuccessRate).toBe(0.5);
  });

  it("reports mostCommonErrors sorted by frequency (up to 3)", () => {
    const entries = [
      makeEntry({ failureMode: "timeout", succeeded: false }),
      makeEntry({ failureMode: "timeout", succeeded: false }),
      makeEntry({ failureMode: "parse_error", succeeded: true }),
      makeEntry({ failureMode: "network", succeeded: false }),
    ];
    const stats = getTaskRecoveryStats(entries);
    expect(stats.mostCommonErrors[0]).toBe("timeout");
    expect(stats.mostCommonErrors.length).toBeLessThanOrEqual(3);
  });

  it("computes avgRetriesBeforeSuccess from successful entries' attempt field", () => {
    const entries = [
      makeEntry({ succeeded: true, attempt: 2 }),
      makeEntry({ succeeded: true, attempt: 4 }),
      makeEntry({ succeeded: false, attempt: 10 }),
    ];
    const stats = getTaskRecoveryStats(entries);
    expect(stats.avgRetriesBeforeSuccess).toBe(3); // (2+4)/2
  });

  it("computes avgRecoveryDurationMs from entries with durationMs", () => {
    const entries = [
      makeEntry({ durationMs: 1000 }),
      makeEntry({ durationMs: 3000 }),
    ];
    const stats = getTaskRecoveryStats(entries);
    expect(stats.avgRecoveryDurationMs).toBe(2000);
  });
});

describe("recordTaskRecoveryStats", () => {
  it("creates .danteforge/task-recovery-stats.json", () => {
    const root = tempDir();
    const stats = getTaskRecoveryStats([makeEntry(), makeEntry({ succeeded: false })]);
    recordTaskRecoveryStats(stats, root);
    expect(existsSync(join(root, ".danteforge", "task-recovery-stats.json"))).toBe(true);
  });
});

describe("loadTaskRecoveryStats", () => {
  it("returns empty array when file does not exist", () => {
    const root = tempDir();
    expect(loadTaskRecoveryStats(root)).toEqual([]);
  });

  it("reads and parses entries including timestamp field", () => {
    const root = tempDir();
    const entries = [makeEntry({ succeeded: true }), makeEntry({ succeeded: false })];
    const stats = getTaskRecoveryStats(entries);
    recordTaskRecoveryStats(stats, root);
    const loaded = loadTaskRecoveryStats(root);
    expect(loaded).toHaveLength(1);
    expect(loaded[0]!.totalRecoveries).toBe(2);
    expect(loaded[0]!.successfulRecoveries).toBe(1);
    expect(typeof loaded[0]!.timestamp).toBe("string");
  });
});
