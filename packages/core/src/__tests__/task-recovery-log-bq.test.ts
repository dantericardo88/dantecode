import { describe, it, expect } from "vitest";
import {
  getRecoveryStats,
  groupByFailureMode,
  type TaskRecoveryEntry,
} from "../task-recovery-log.js";

function makeEntry(
  overrides: Partial<TaskRecoveryEntry> & { failureMode: string; succeeded: boolean },
): TaskRecoveryEntry {
  return {
    timestamp: new Date().toISOString(),
    taskId: "task-" + Math.random().toString(36).slice(2),
    attempt: 1,
    fixApplied: "retry",
    durationMs: 500,
    ...overrides,
  };
}

describe("groupByFailureMode", () => {
  it("returns empty object for no entries", () => {
    expect(groupByFailureMode([])).toEqual({});
  });

  it("counts each failure mode", () => {
    const entries: TaskRecoveryEntry[] = [
      makeEntry({ failureMode: "timeout", succeeded: false }),
      makeEntry({ failureMode: "timeout", succeeded: false }),
      makeEntry({ failureMode: "syntax-error", succeeded: true }),
    ];
    const result = groupByFailureMode(entries);
    expect(result["timeout"]).toBe(2);
    expect(result["syntax-error"]).toBe(1);
  });

  it("handles single entry", () => {
    const entries: TaskRecoveryEntry[] = [
      makeEntry({ failureMode: "network-error", succeeded: false }),
    ];
    const result = groupByFailureMode(entries);
    expect(result["network-error"]).toBe(1);
  });
});

describe("getRecoveryStats", () => {
  it("returns zeroed stats for empty entries", () => {
    const stats = getRecoveryStats([]);
    expect(stats.totalAttempts).toBe(0);
    expect(stats.successRate).toBe(0);
    expect(stats.avgAttemptsBeforeSuccess).toBe(0);
    expect(stats.mostCommonFailureMode).toBe("");
    expect(stats.recentTrend).toBe("stable");
  });

  it("computes successRate correctly", () => {
    const entries: TaskRecoveryEntry[] = [
      makeEntry({ failureMode: "timeout", succeeded: true }),
      makeEntry({ failureMode: "timeout", succeeded: false }),
      makeEntry({ failureMode: "timeout", succeeded: false }),
      makeEntry({ failureMode: "timeout", succeeded: true }),
    ];
    const stats = getRecoveryStats(entries);
    expect(stats.successRate).toBeCloseTo(0.5);
  });

  it("identifies mostCommonFailureMode", () => {
    const entries: TaskRecoveryEntry[] = [
      makeEntry({ failureMode: "timeout", succeeded: false }),
      makeEntry({ failureMode: "timeout", succeeded: false }),
      makeEntry({ failureMode: "syntax-error", succeeded: false }),
    ];
    const stats = getRecoveryStats(entries);
    expect(stats.mostCommonFailureMode).toBe("timeout");
  });

  it("computes avgAttemptsBeforeSuccess from successful entries", () => {
    const entries: TaskRecoveryEntry[] = [
      makeEntry({ failureMode: "timeout", succeeded: true, attempt: 2 }),
      makeEntry({ failureMode: "timeout", succeeded: true, attempt: 4 }),
      makeEntry({ failureMode: "timeout", succeeded: false, attempt: 1 }),
    ];
    const stats = getRecoveryStats(entries);
    expect(stats.avgAttemptsBeforeSuccess).toBeCloseTo(3); // (2+4)/2
  });

  it("detects improving trend when recent success rate improves by >= 0.1", () => {
    const base = new Date("2026-01-01T00:00:00Z").getTime();
    // prior 5: all failed → 0.0
    const prior5: TaskRecoveryEntry[] = Array.from({ length: 5 }, (_, i) =>
      makeEntry({ failureMode: "err", succeeded: false, timestamp: new Date(base + i * 1000).toISOString() }),
    );
    // last 5: all succeeded → 1.0
    const last5: TaskRecoveryEntry[] = Array.from({ length: 5 }, (_, i) =>
      makeEntry({ failureMode: "err", succeeded: true, timestamp: new Date(base + (i + 5) * 1000).toISOString() }),
    );
    const stats = getRecoveryStats([...prior5, ...last5]);
    expect(stats.recentTrend).toBe("improving");
  });

  it("detects declining trend when recent success rate drops by >= 0.1", () => {
    const base = new Date("2026-01-01T00:00:00Z").getTime();
    // prior 5: all succeeded → 1.0
    const prior5: TaskRecoveryEntry[] = Array.from({ length: 5 }, (_, i) =>
      makeEntry({ failureMode: "err", succeeded: true, timestamp: new Date(base + i * 1000).toISOString() }),
    );
    // last 5: all failed → 0.0
    const last5: TaskRecoveryEntry[] = Array.from({ length: 5 }, (_, i) =>
      makeEntry({ failureMode: "err", succeeded: false, timestamp: new Date(base + (i + 5) * 1000).toISOString() }),
    );
    const stats = getRecoveryStats([...prior5, ...last5]);
    expect(stats.recentTrend).toBe("declining");
  });

  it("returns stable trend when difference is within threshold", () => {
    const base = new Date("2026-01-01T00:00:00Z").getTime();
    // prior 5: 3 success → 0.6
    const prior5: TaskRecoveryEntry[] = [
      makeEntry({ failureMode: "err", succeeded: true, timestamp: new Date(base).toISOString() }),
      makeEntry({ failureMode: "err", succeeded: true, timestamp: new Date(base + 1000).toISOString() }),
      makeEntry({ failureMode: "err", succeeded: true, timestamp: new Date(base + 2000).toISOString() }),
      makeEntry({ failureMode: "err", succeeded: false, timestamp: new Date(base + 3000).toISOString() }),
      makeEntry({ failureMode: "err", succeeded: false, timestamp: new Date(base + 4000).toISOString() }),
    ];
    // last 5: 3 success → 0.6
    const last5: TaskRecoveryEntry[] = [
      makeEntry({ failureMode: "err", succeeded: true, timestamp: new Date(base + 5000).toISOString() }),
      makeEntry({ failureMode: "err", succeeded: true, timestamp: new Date(base + 6000).toISOString() }),
      makeEntry({ failureMode: "err", succeeded: true, timestamp: new Date(base + 7000).toISOString() }),
      makeEntry({ failureMode: "err", succeeded: false, timestamp: new Date(base + 8000).toISOString() }),
      makeEntry({ failureMode: "err", succeeded: false, timestamp: new Date(base + 9000).toISOString() }),
    ];
    const stats = getRecoveryStats([...prior5, ...last5]);
    expect(stats.recentTrend).toBe("stable");
  });

  it("totalAttempts equals entries length", () => {
    const entries = [
      makeEntry({ failureMode: "x", succeeded: true }),
      makeEntry({ failureMode: "y", succeeded: false }),
      makeEntry({ failureMode: "z", succeeded: true }),
    ];
    const stats = getRecoveryStats(entries);
    expect(stats.totalAttempts).toBe(3);
  });
});
