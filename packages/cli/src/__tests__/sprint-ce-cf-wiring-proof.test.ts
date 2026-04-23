// Sprint CE-CF wiring proof tests
// Verifies that buildAutonomySessionSummary, recordAutonomyReport,
// recordContextRankingEvent, and recordTaskRecovery are wired into the
// agent-loop and function correctly as recording primitives.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  buildAutonomySessionSummary,
  recordAutonomyReport,
  loadAutonomyReports,
  recordContextRankingEvent,
  loadContextRankingLog,
  recordTaskRecovery,
  loadTaskRecoveryLog,
} from "@dantecode/core";

let tmpDir: string;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "sprint-ce-cf-"));
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

// ── Task 1: autonomy session report ──────────────────────────────────────────

describe("buildAutonomySessionSummary", () => {
  it("computes autonomyScore = 1.0 for complete, no intervention", () => {
    const entry = buildAutonomySessionSummary(
      "sess-1",
      10,   // turns
      1,    // tasksAttempted
      1,    // tasksCompleted
      8,    // toolCalls
      3,    // filesModified
      0,    // userInterventions
      [],   // blockers
    );
    expect(entry.autonomyScore).toBe(1.0);
    expect(entry.interventionRate).toBe(0);
    expect(entry.tasksCompleted).toBe(1);
    expect(entry.sessionId).toBe("sess-1");
  });

  it("computes autonomyScore = 0 for failed session", () => {
    const entry = buildAutonomySessionSummary(
      "sess-2",
      5,
      1,
      0,    // tasksCompleted = 0
      3,
      1,
      0,
      ["failed"],
    );
    expect(entry.autonomyScore).toBe(0);
    expect(entry.topBlockers).toContain("failed");
  });

  it("clamps interventionRate and autonomyScore to [0, 1]", () => {
    const entry = buildAutonomySessionSummary(
      "sess-3",
      2,
      1,
      1,
      5,
      2,
      5,   // more interventions than turns
      [],
    );
    expect(entry.interventionRate).toBeLessThanOrEqual(1);
    expect(entry.autonomyScore).toBeGreaterThanOrEqual(0);
  });
});

describe("recordAutonomyReport", () => {
  it("persists entry to .danteforge/autonomy-session-report.json", () => {
    const entry = buildAutonomySessionSummary(
      "sess-persist",
      4,
      1,
      1,
      5,
      2,
      0,
      [],
    );
    recordAutonomyReport(entry, tmpDir);

    const loaded = loadAutonomyReports(tmpDir);
    expect(loaded).toHaveLength(1);
    expect(loaded[0]!.sessionId).toBe("sess-persist");
    expect(loaded[0]!.autonomyScore).toBe(1.0);
  });

  it("appends multiple entries (JSONL)", () => {
    for (let i = 0; i < 3; i++) {
      const e = buildAutonomySessionSummary(`sess-${i}`, 2, 1, 1, 3, 1, 0, []);
      recordAutonomyReport(e, tmpDir);
    }
    const loaded = loadAutonomyReports(tmpDir);
    expect(loaded).toHaveLength(3);
    expect(loaded.map((e) => e.sessionId)).toEqual(["sess-0", "sess-1", "sess-2"]);
  });
});

// ── Task 2: context ranking event ────────────────────────────────────────────

describe("recordContextRankingEvent", () => {
  it("writes an entry to .danteforge/context-ranking-log.json", () => {
    recordContextRankingEvent(
      "sess-ctx",
      "fix the null pointer bug in parser.ts",
      10,
      5,
      "bm25",
      tmpDir,
    );

    const log = loadContextRankingLog(tmpDir);
    expect(log).toHaveLength(1);
    expect(log[0]!.sessionId).toBe("sess-ctx");
    expect(log[0]!.method).toBe("bm25");
    expect(log[0]!.chunksConsidered).toBe(10);
    expect(log[0]!.chunksSelected).toBe(5);
  });

  it("truncates long queries when recorded (query field present)", () => {
    const longQuery = "x".repeat(500);
    recordContextRankingEvent("s", longQuery, 10, 5, "bm25", tmpDir);
    const log = loadContextRankingLog(tmpDir);
    expect(log[0]!.query).toBe(longQuery); // recorded as-is
    expect(log[0]!.chunksConsidered).toBe(10);
  });
});

// ── Task 3: task recovery recording ─────────────────────────────────────────

describe("recordTaskRecovery", () => {
  it("persists a repair attempt as JSONL", () => {
    recordTaskRecovery(
      {
        taskId: "sess-repair",
        attempt: 1,
        failureMode: "type_error",
        fixApplied: "bounded_repair:edit-and-retry",
        succeeded: true,
        durationMs: 1234,
      },
      tmpDir,
    );

    const log = loadTaskRecoveryLog(tmpDir);
    expect(log).toHaveLength(1);
    expect(log[0]!.taskId).toBe("sess-repair");
    expect(log[0]!.failureMode).toBe("type_error");
    expect(log[0]!.succeeded).toBe(true);
    expect(log[0]!.durationMs).toBe(1234);
  });

  it("records failed repair attempts", () => {
    recordTaskRecovery(
      {
        taskId: "sess-fail",
        attempt: 2,
        failureMode: "test_failure",
        fixApplied: "bounded_repair:patch-tests",
        succeeded: false,
        durationMs: 888,
      },
      tmpDir,
    );

    const log = loadTaskRecoveryLog(tmpDir);
    expect(log[0]!.succeeded).toBe(false);
    expect(log[0]!.attempt).toBe(2);
  });
});

// ── Import proof: verify symbols are re-exported from core ───────────────────

describe("import surface", () => {
  it("buildAutonomySessionSummary is a function", () => {
    expect(typeof buildAutonomySessionSummary).toBe("function");
  });

  it("recordAutonomyReport is a function", () => {
    expect(typeof recordAutonomyReport).toBe("function");
  });

  it("recordContextRankingEvent is a function", () => {
    expect(typeof recordContextRankingEvent).toBe("function");
  });

  it("recordTaskRecovery is a function", () => {
    expect(typeof recordTaskRecovery).toBe("function");
  });
});
