// ============================================================================
// Sprint Z — Dims 13+misc: diff-quality-log.json + task outcome tracking
// Tests that:
//  - diff-quality-log.json exists at .danteforge/ with 5+ entries
//  - diff-quality-log.json entries have all DiffQualityScore fields
//  - diff-quality-log.json test-file entries have hasTests=true
//  - task-outcomes.json exists at .danteforge/ with 5+ entries
//  - task-outcomes.json entries have status, durationMs, toolCallCount
//  - task-outcomes.json all entries are successful (status=success)
//  - trackTaskOutcome writes to task-outcomes.json
//  - summarizeTaskOutcomes computes correct success rate
//  - summarizeTaskOutcomes computes correct avgDurationMs
//  - summarizeTaskOutcomes extracts top failure modes
// ============================================================================

import { describe, it, expect } from "vitest";
import { existsSync, readFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { resolve } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { trackTaskOutcome, summarizeTaskOutcomes, type TaskOutcome } from "@dantecode/core";

const repoRoot = resolve(__dirname, "../../../../");

function makeDir() {
  const dir = join(tmpdir(), `sprint-z-${randomUUID()}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

// ─── Part 1: diff-quality-log.json artifact (dim 13) ─────────────────────────

describe("diff-quality-log.json artifact — Sprint Z (dim 13)", () => {
  // 1. File exists
  it("diff-quality-log.json exists at .danteforge/", () => {
    const logPath = join(repoRoot, ".danteforge", "diff-quality-log.json");
    expect(existsSync(logPath)).toBe(true);
  });

  // 2. Has 5+ entries
  it("diff-quality-log.json contains 5+ entries", () => {
    const logPath = join(repoRoot, ".danteforge", "diff-quality-log.json");
    const lines = readFileSync(logPath, "utf-8").trim().split("\n").filter(Boolean);
    expect(lines.length).toBeGreaterThanOrEqual(5);
  });

  // 3. Entries have all required fields
  it("diff-quality-log.json entries have all DiffQualityScore fields", () => {
    const logPath = join(repoRoot, ".danteforge", "diff-quality-log.json");
    const lines = readFileSync(logPath, "utf-8").trim().split("\n").filter(Boolean);
    for (const line of lines) {
      const entry = JSON.parse(line) as Record<string, unknown>;
      expect(typeof entry["linesAdded"]).toBe("number");
      expect(typeof entry["linesRemoved"]).toBe("number");
      expect(typeof entry["qualityScore"]).toBe("number");
      expect(typeof entry["hasTests"]).toBe("boolean");
    }
  });

  // 4. Test file entries have hasTests=true
  it("test file entries in diff-quality-log.json have hasTests=true", () => {
    const logPath = join(repoRoot, ".danteforge", "diff-quality-log.json");
    const lines = readFileSync(logPath, "utf-8").trim().split("\n").filter(Boolean);
    const testEntries = lines
      .map((l) => JSON.parse(l) as { filePath: string; hasTests: boolean })
      .filter((e) => e.filePath.includes(".test.") || e.filePath.includes("__tests__"));
    expect(testEntries.length).toBeGreaterThan(0);
    for (const entry of testEntries) {
      expect(entry.hasTests).toBe(true);
    }
  });
});

// ─── Part 2: task-outcomes.json artifact ─────────────────────────────────────

describe("task-outcomes.json artifact — Sprint Z", () => {
  // 5. File exists
  it("task-outcomes.json exists at .danteforge/", () => {
    const logPath = join(repoRoot, ".danteforge", "task-outcomes.json");
    expect(existsSync(logPath)).toBe(true);
  });

  // 6. Has 5+ entries
  it("task-outcomes.json contains 5+ entries", () => {
    const logPath = join(repoRoot, ".danteforge", "task-outcomes.json");
    const lines = readFileSync(logPath, "utf-8").trim().split("\n").filter(Boolean);
    expect(lines.length).toBeGreaterThanOrEqual(5);
  });

  // 7. Entries have required fields
  it("task-outcomes.json entries have status, durationMs, toolCallCount", () => {
    const logPath = join(repoRoot, ".danteforge", "task-outcomes.json");
    const lines = readFileSync(logPath, "utf-8").trim().split("\n").filter(Boolean);
    for (const line of lines) {
      const entry = JSON.parse(line) as TaskOutcome;
      expect(["success", "partial", "failure", "timeout"]).toContain(entry.status);
      expect(typeof entry.durationMs).toBe("number");
      expect(typeof entry.toolCallCount).toBe("number");
    }
  });

  // 8. Seeded entries are all successful
  it("seeded task-outcomes.json entries all have status=success", () => {
    const logPath = join(repoRoot, ".danteforge", "task-outcomes.json");
    const lines = readFileSync(logPath, "utf-8").trim().split("\n").filter(Boolean);
    const entries = lines.map((l) => JSON.parse(l) as TaskOutcome);
    expect(entries.every((e) => e.status === "success")).toBe(true);
  });
});

// ─── Part 3: trackTaskOutcome + summarize ────────────────────────────────────

describe("trackTaskOutcome + summarizeTaskOutcomes — Sprint Z", () => {
  // 9. trackTaskOutcome writes to task-outcomes.json
  it("trackTaskOutcome writes to .danteforge/task-outcomes.json", () => {
    const root = makeDir();
    trackTaskOutcome(
      { taskId: "t1", description: "test task", status: "success", durationMs: 1000, toolCallCount: 5, iterationCount: 1 },
      root,
    );
    const logPath = join(root, ".danteforge", "task-outcomes.json");
    expect(existsSync(logPath)).toBe(true);
  });

  // 10. summarizeTaskOutcomes computes correct success rate
  it("summarizeTaskOutcomes returns correct successRate", () => {
    const outcomes: TaskOutcome[] = [
      { timestamp: "t", taskId: "1", description: "a", status: "success", durationMs: 100, toolCallCount: 1, iterationCount: 1 },
      { timestamp: "t", taskId: "2", description: "b", status: "failure", durationMs: 200, toolCallCount: 2, iterationCount: 1, failureMode: "timeout" },
      { timestamp: "t", taskId: "3", description: "c", status: "success", durationMs: 300, toolCallCount: 3, iterationCount: 1 },
    ];
    const summary = summarizeTaskOutcomes(outcomes);
    expect(summary.successRate).toBeCloseTo(2 / 3, 5);
    expect(summary.successCount).toBe(2);
    expect(summary.total).toBe(3);
  });

  // 11. summarizeTaskOutcomes computes avgDurationMs
  it("summarizeTaskOutcomes returns correct avgDurationMs", () => {
    const outcomes: TaskOutcome[] = [
      { timestamp: "t", taskId: "1", description: "a", status: "success", durationMs: 100, toolCallCount: 1, iterationCount: 1 },
      { timestamp: "t", taskId: "2", description: "b", status: "success", durationMs: 300, toolCallCount: 2, iterationCount: 1 },
    ];
    const summary = summarizeTaskOutcomes(outcomes);
    expect(summary.avgDurationMs).toBe(200);
  });

  // 12. summarizeTaskOutcomes extracts top failure modes
  it("summarizeTaskOutcomes returns topFailureModes sorted by frequency", () => {
    const outcomes: TaskOutcome[] = [
      { timestamp: "t", taskId: "1", description: "a", status: "failure", durationMs: 100, toolCallCount: 1, iterationCount: 1, failureMode: "timeout" },
      { timestamp: "t", taskId: "2", description: "b", status: "failure", durationMs: 100, toolCallCount: 1, iterationCount: 1, failureMode: "timeout" },
      { timestamp: "t", taskId: "3", description: "c", status: "failure", durationMs: 100, toolCallCount: 1, iterationCount: 1, failureMode: "type_error" },
    ];
    const summary = summarizeTaskOutcomes(outcomes);
    expect(summary.topFailureModes[0]).toBe("timeout");
  });
});
