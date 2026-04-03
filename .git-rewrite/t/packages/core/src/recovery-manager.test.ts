/**
 * recovery-manager.test.ts
 *
 * Tests for RecoveryManager - stale session detection and validation.
 * Wave 2 Task 2.4: 25 tests covering scan, validate, and utilities.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomBytes } from "node:crypto";
import {
  RecoveryManager,
  formatStaleSessionSummary,
  filterSessionsByStatus,
  sortSessionsByTime,
} from "./recovery-manager.js";
import type { StaleSession } from "./recovery-manager.js";
import type { Checkpoint } from "./checkpointer.js";
import { JsonlEventStore } from "./durable-event-store.js";

// ---------------------------------------------------------------------------
// Test Helpers
// ---------------------------------------------------------------------------

function createTestDir(): string {
  const dir = join(tmpdir(), `recovery-manager-test-${randomBytes(4).toString("hex")}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

function createCheckpointDir(baseDir: string, sessionId: string): string {
  const dir = join(baseDir, ".dantecode", "checkpoints", sessionId);
  mkdirSync(dir, { recursive: true });
  return dir;
}

function writeCheckpoint(checkpointDir: string, checkpoint: Checkpoint): void {
  const data = JSON.stringify({ checkpoint, metadata: { source: "test", step: 1 } }, null, 2);
  writeFileSync(join(checkpointDir, "base_state.json"), data, "utf-8");
}

function createValidCheckpoint(sessionId: string, overrides?: Partial<Checkpoint>): Checkpoint {
  return {
    v: 1,
    id: `ckpt-${sessionId}`,
    ts: new Date().toISOString(),
    step: 1,
    channelValues: { state: "active" },
    channelVersions: { state: 1 },
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests: scanStaleSessions - Basic Detection (10 tests)
// ---------------------------------------------------------------------------

describe("RecoveryManager.scanStaleSessions", () => {
  let testDir: string;

  beforeEach(() => {
    testDir = createTestDir();
  });

  afterEach(() => {
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
  });

  it("should return empty array when checkpoints directory does not exist", async () => {
    const manager = new RecoveryManager({ projectRoot: testDir });
    const sessions = await manager.scanStaleSessions();
    expect(sessions).toEqual([]);
  });

  it("should detect a single resumable session", async () => {
    const sessionId = "session-001";
    const checkpointDir = createCheckpointDir(testDir, sessionId);
    const checkpoint = createValidCheckpoint(sessionId);
    writeCheckpoint(checkpointDir, checkpoint);

    // Create event log
    const eventsDir = join(testDir, ".dantecode", "events");
    mkdirSync(eventsDir, { recursive: true });
    writeFileSync(join(eventsDir, `${sessionId}.jsonl`), "", "utf-8");

    const manager = new RecoveryManager({ projectRoot: testDir });
    const sessions = await manager.scanStaleSessions();

    expect(sessions).toHaveLength(1);
    expect(sessions[0]?.sessionId).toBe(sessionId);
    expect(sessions[0]?.status).toBe("resumable");
    expect(sessions[0]?.reason).toBe("All checks passed");
  });

  it("should classify session as stale when event log is missing", async () => {
    const sessionId = "session-002";
    const checkpointDir = createCheckpointDir(testDir, sessionId);
    const checkpoint = createValidCheckpoint(sessionId);
    writeCheckpoint(checkpointDir, checkpoint);

    const manager = new RecoveryManager({ projectRoot: testDir });
    const sessions = await manager.scanStaleSessions();

    expect(sessions).toHaveLength(1);
    expect(sessions[0]?.status).toBe("stale");
    expect(sessions[0]?.reason).toBe("Event log missing");
  });

  it("should classify session as corrupt when base_state.json is missing", async () => {
    const sessionId = "session-003";
    createCheckpointDir(testDir, sessionId);
    // Don't write checkpoint file

    const manager = new RecoveryManager({ projectRoot: testDir });
    const sessions = await manager.scanStaleSessions();

    expect(sessions).toHaveLength(1);
    expect(sessions[0]?.status).toBe("corrupt");
    expect(sessions[0]?.reason).toBe("Missing base_state.json");
  });

  it("should classify session as corrupt when checkpoint JSON is invalid", async () => {
    const sessionId = "session-004";
    const checkpointDir = createCheckpointDir(testDir, sessionId);
    writeFileSync(join(checkpointDir, "base_state.json"), "{ invalid json", "utf-8");

    const manager = new RecoveryManager({ projectRoot: testDir });
    const sessions = await manager.scanStaleSessions();

    expect(sessions).toHaveLength(1);
    expect(sessions[0]?.status).toBe("corrupt");
    expect(sessions[0]?.reason).toContain("Failed to parse checkpoint");
  });

  it("should classify session as corrupt when checkpoint structure is invalid", async () => {
    const sessionId = "session-005";
    const checkpointDir = createCheckpointDir(testDir, sessionId);
    writeFileSync(
      join(checkpointDir, "base_state.json"),
      JSON.stringify({ checkpoint: { id: null } }),
      "utf-8",
    );

    const manager = new RecoveryManager({ projectRoot: testDir });
    const sessions = await manager.scanStaleSessions();

    expect(sessions).toHaveLength(1);
    expect(sessions[0]?.status).toBe("corrupt");
    expect(sessions[0]?.reason).toBe("Invalid checkpoint structure");
  });

  it("should detect multiple sessions", async () => {
    // Create 3 sessions
    for (let i = 1; i <= 3; i++) {
      const sessionId = `session-00${i}`;
      const checkpointDir = createCheckpointDir(testDir, sessionId);
      const checkpoint = createValidCheckpoint(sessionId);
      writeCheckpoint(checkpointDir, checkpoint);
    }

    // Create event logs for all
    const eventsDir = join(testDir, ".dantecode", "events");
    mkdirSync(eventsDir, { recursive: true });
    for (let i = 1; i <= 3; i++) {
      writeFileSync(join(eventsDir, `session-00${i}.jsonl`), "", "utf-8");
    }

    const manager = new RecoveryManager({ projectRoot: testDir });
    const sessions = await manager.scanStaleSessions();

    expect(sessions).toHaveLength(3);
    expect(sessions.every((s) => s.status === "resumable")).toBe(true);
  });

  it("should extract checkpoint metadata (eventId, worktreeRef, step)", async () => {
    const sessionId = "session-006";
    const checkpointDir = createCheckpointDir(testDir, sessionId);
    const checkpoint = createValidCheckpoint(sessionId, {
      eventId: 42,
      worktreeRef: "refs/heads/feature-branch",
      gitSnapshotHash: "abc123def456",
      step: 5,
    });
    writeCheckpoint(checkpointDir, checkpoint);

    // Create event log
    const eventsDir = join(testDir, ".dantecode", "events");
    mkdirSync(eventsDir, { recursive: true });
    writeFileSync(join(eventsDir, `${sessionId}.jsonl`), "", "utf-8");

    const manager = new RecoveryManager({ projectRoot: testDir });
    const sessions = await manager.scanStaleSessions();

    expect(sessions).toHaveLength(1);
    expect(sessions[0]?.lastEventId).toBe(42);
    expect(sessions[0]?.worktreeRef).toBe("refs/heads/feature-branch");
    expect(sessions[0]?.gitSnapshotHash).toBe("abc123def456");
    expect(sessions[0]?.step).toBe(5);
  });

  it("should skip non-directory entries in checkpoints folder", async () => {
    const checkpointsDir = join(testDir, ".dantecode", "checkpoints");
    mkdirSync(checkpointsDir, { recursive: true });

    // Create a file in checkpoints dir (should be ignored)
    writeFileSync(join(checkpointsDir, "README.txt"), "test", "utf-8");

    // Create a valid session
    const sessionId = "session-007";
    const checkpointDir = createCheckpointDir(testDir, sessionId);
    const checkpoint = createValidCheckpoint(sessionId);
    writeCheckpoint(checkpointDir, checkpoint);

    const eventsDir = join(testDir, ".dantecode", "events");
    mkdirSync(eventsDir, { recursive: true });
    writeFileSync(join(eventsDir, `${sessionId}.jsonl`), "", "utf-8");

    const manager = new RecoveryManager({ projectRoot: testDir });
    const sessions = await manager.scanStaleSessions();

    expect(sessions).toHaveLength(1);
    expect(sessions[0]?.sessionId).toBe(sessionId);
  });

  it("should handle empty checkpoints directory", async () => {
    const checkpointsDir = join(testDir, ".dantecode", "checkpoints");
    mkdirSync(checkpointsDir, { recursive: true });

    const manager = new RecoveryManager({ projectRoot: testDir });
    const sessions = await manager.scanStaleSessions();

    expect(sessions).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Tests: validateCheckpoint - Validation Logic (8 tests)
// ---------------------------------------------------------------------------

describe("RecoveryManager.validateCheckpoint", () => {
  let testDir: string;

  beforeEach(() => {
    testDir = createTestDir();
  });

  afterEach(() => {
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
  });

  it("should validate a well-formed checkpoint", async () => {
    const manager = new RecoveryManager({ projectRoot: testDir });
    const checkpoint = createValidCheckpoint("session-001");

    const isValid = await manager.validateCheckpoint(checkpoint);
    expect(isValid).toBe(true);
  });

  it("should reject checkpoint with missing id", async () => {
    const manager = new RecoveryManager({ projectRoot: testDir });
    const checkpoint = createValidCheckpoint("session-001");
    // @ts-expect-error - Testing invalid state
    checkpoint.id = null;

    const isValid = await manager.validateCheckpoint(checkpoint);
    expect(isValid).toBe(false);
  });

  it("should reject checkpoint with missing channelValues", async () => {
    const manager = new RecoveryManager({ projectRoot: testDir });
    const checkpoint = createValidCheckpoint("session-001");
    // @ts-expect-error - Testing invalid state
    checkpoint.channelValues = null;

    const isValid = await manager.validateCheckpoint(checkpoint);
    expect(isValid).toBe(false);
  });

  it("should reject checkpoint with empty channelValues", async () => {
    const manager = new RecoveryManager({ projectRoot: testDir });
    const checkpoint = createValidCheckpoint("session-001");
    checkpoint.channelValues = {};

    const isValid = await manager.validateCheckpoint(checkpoint);
    expect(isValid).toBe(false);
  });

  it("should accept checkpoint without worktreeRef", async () => {
    const manager = new RecoveryManager({ projectRoot: testDir });
    const checkpoint = createValidCheckpoint("session-001");
    checkpoint.worktreeRef = undefined;

    const isValid = await manager.validateCheckpoint(checkpoint);
    expect(isValid).toBe(true);
  });

  it("should accept checkpoint without gitSnapshotHash", async () => {
    const manager = new RecoveryManager({ projectRoot: testDir });
    const checkpoint = createValidCheckpoint("session-001");
    checkpoint.gitSnapshotHash = undefined;

    const isValid = await manager.validateCheckpoint(checkpoint);
    expect(isValid).toBe(true);
  });

  it("should handle null checkpoint gracefully", async () => {
    const manager = new RecoveryManager({ projectRoot: testDir });
    // @ts-expect-error - Testing invalid input
    const isValid = await manager.validateCheckpoint(null);
    expect(isValid).toBe(false);
  });

  it("should handle undefined checkpoint gracefully", async () => {
    const manager = new RecoveryManager({ projectRoot: testDir });
    // @ts-expect-error - Testing invalid input
    const isValid = await manager.validateCheckpoint(undefined);
    expect(isValid).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Tests: validateEventLog (2 tests)
// ---------------------------------------------------------------------------

describe("RecoveryManager.validateEventLog", () => {
  let testDir: string;

  beforeEach(() => {
    testDir = createTestDir();
  });

  afterEach(() => {
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
  });

  it("should validate event log with events", async () => {
    const sessionId = "session-001";
    const eventsDir = join(testDir, ".dantecode", "events");
    mkdirSync(eventsDir, { recursive: true });

    const store = new JsonlEventStore(sessionId, eventsDir);
    await store.append({
      at: new Date().toISOString(),
      kind: "run.task.classified",
      taskId: "task-001",
      payload: { test: true },
    });

    const manager = new RecoveryManager({ projectRoot: testDir });
    const isValid = await manager.validateEventLog(store);

    expect(isValid).toBe(true);
  });

  it("should reject empty event log", async () => {
    const sessionId = "session-002";
    const eventsDir = join(testDir, ".dantecode", "events");
    mkdirSync(eventsDir, { recursive: true });

    const store = new JsonlEventStore(sessionId, eventsDir);

    const manager = new RecoveryManager({ projectRoot: testDir });
    const isValid = await manager.validateEventLog(store);

    expect(isValid).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Tests: offerRecovery and getters (3 tests)
// ---------------------------------------------------------------------------

describe("RecoveryManager.offerRecovery", () => {
  let testDir: string;

  beforeEach(() => {
    testDir = createTestDir();
  });

  afterEach(() => {
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
  });

  it("should be a no-op that completes successfully", async () => {
    const manager = new RecoveryManager({ projectRoot: testDir });
    const sessions: StaleSession[] = [
      {
        sessionId: "session-001",
        checkpointPath: "/path/to/checkpoint",
        status: "stale",
        reason: "Test",
      },
    ];

    await expect(manager.offerRecovery(sessions)).resolves.toBeUndefined();
  });

  it("should return checkpoints directory path", () => {
    const manager = new RecoveryManager({ projectRoot: testDir });
    const dir = manager.getCheckpointsDir();
    expect(dir).toContain(".dantecode");
    expect(dir).toContain("checkpoints");
  });

  it("should return events directory path", () => {
    const manager = new RecoveryManager({ projectRoot: testDir });
    const dir = manager.getEventsDir();
    expect(dir).toContain(".dantecode");
    expect(dir).toContain("events");
  });
});

// ---------------------------------------------------------------------------
// Tests: Utility Functions (2 tests)
// ---------------------------------------------------------------------------

describe("Utility functions", () => {
  it("should format stale session summary", () => {
    const session: StaleSession = {
      sessionId: "session-001",
      checkpointPath: "/path/to/checkpoint",
      status: "resumable",
      reason: "All checks passed",
      timestamp: "2026-03-28T10:00:00.000Z",
      step: 5,
      lastEventId: 42,
      worktreeRef: "refs/heads/feature",
      gitSnapshotHash: "abc123def456",
    };

    const summary = formatStaleSessionSummary(session);

    expect(summary).toContain("session-001");
    expect(summary).toContain("RESUMABLE");
    expect(summary).toContain("All checks passed");
    expect(summary).toContain("2026-03-28T10:00:00.000Z");
    expect(summary).toContain("Step:    5");
    expect(summary).toContain("Events:  42");
    expect(summary).toContain("refs/heads/feature");
    expect(summary).toContain("abc123de"); // First 8 chars of hash
  });

  it("should filter sessions by status", () => {
    const sessions: StaleSession[] = [
      {
        sessionId: "s1",
        checkpointPath: "/path/1",
        status: "resumable",
      },
      {
        sessionId: "s2",
        checkpointPath: "/path/2",
        status: "stale",
      },
      {
        sessionId: "s3",
        checkpointPath: "/path/3",
        status: "resumable",
      },
      {
        sessionId: "s4",
        checkpointPath: "/path/4",
        status: "corrupt",
      },
    ];

    const resumable = filterSessionsByStatus(sessions, "resumable");
    expect(resumable).toHaveLength(2);
    expect(resumable[0]?.sessionId).toBe("s1");
    expect(resumable[1]?.sessionId).toBe("s3");

    const stale = filterSessionsByStatus(sessions, "stale");
    expect(stale).toHaveLength(1);
    expect(stale[0]?.sessionId).toBe("s2");

    const corrupt = filterSessionsByStatus(sessions, "corrupt");
    expect(corrupt).toHaveLength(1);
    expect(corrupt[0]?.sessionId).toBe("s4");
  });
});

// ---------------------------------------------------------------------------
// Tests: sortSessionsByTime (1 test)
// ---------------------------------------------------------------------------

describe("sortSessionsByTime", () => {
  it("should sort sessions by timestamp newest first", () => {
    const sessions: StaleSession[] = [
      {
        sessionId: "s1",
        checkpointPath: "/path/1",
        status: "resumable",
        timestamp: "2026-03-28T10:00:00.000Z",
      },
      {
        sessionId: "s2",
        checkpointPath: "/path/2",
        status: "resumable",
        timestamp: "2026-03-28T12:00:00.000Z",
      },
      {
        sessionId: "s3",
        checkpointPath: "/path/3",
        status: "resumable",
        timestamp: "2026-03-28T08:00:00.000Z",
      },
    ];

    const sorted = sortSessionsByTime(sessions);

    expect(sorted[0]?.sessionId).toBe("s2"); // 12:00 (newest)
    expect(sorted[1]?.sessionId).toBe("s1"); // 10:00
    expect(sorted[2]?.sessionId).toBe("s3"); // 08:00 (oldest)
  });
});
