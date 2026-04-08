// ============================================================================
// CrashRecovery — unit tests
// ============================================================================

import { describe, it, expect, vi, beforeEach } from "vitest";
import { CrashRecovery } from "./crash-recovery.js";

// ---------------------------------------------------------------------------
// Shared mocks
// ---------------------------------------------------------------------------

vi.mock("./recovery-manager.js", () => {
  return {
    RecoveryManager: vi.fn().mockImplementation(() => ({
      scanStaleSessions: vi.fn().mockResolvedValue([]),
    })),
    formatStaleSessionSummary: vi.fn(),
    filterSessionsByStatus: vi.fn(),
    sortSessionsByTime: vi.fn(),
  };
});

vi.mock("node:fs", () => ({
  existsSync: vi.fn().mockReturnValue(false),
}));

vi.mock("./checkpointer.js", () => ({
  EventSourcedCheckpointer: vi.fn(),
  hashCheckpointContent: vi.fn(),
  resumeFromCheckpoint: vi.fn().mockResolvedValue({
    checkpoint: { id: "cp1", channelValues: { key: "value" } },
    replayEvents: [],
  }),
}));

vi.mock("./durable-event-store.js", () => ({
  JsonlEventStore: vi.fn().mockImplementation(() => ({
    getLatestId: vi.fn().mockResolvedValue(5),
    append: vi.fn(),
    search: vi.fn(),
  })),
}));

// ---------------------------------------------------------------------------
// Import after mocks are set up
// ---------------------------------------------------------------------------

import { RecoveryManager } from "./recovery-manager.js";
import { existsSync } from "node:fs";
import { resumeFromCheckpoint } from "./checkpointer.js";
import type { StaleSession } from "./recovery-manager.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeSession(
  id: string,
  status: "resumable" | "stale" | "corrupt" = "resumable",
  ageMs = 3600_000, // 1 hour ago
): StaleSession {
  return {
    sessionId: id,
    checkpointPath: `/root/.dantecode/checkpoints/${id}/base_state.json`,
    status,
    reason: "Test session",
    timestamp: new Date(Date.now() - ageMs).toISOString(),
    step: 5,
  };
}

// ---------------------------------------------------------------------------
// describe: scan() — no sessions
// ---------------------------------------------------------------------------

describe("CrashRecovery.scan — no sessions", () => {
  it("returns empty arrays when no sessions exist", async () => {
    const recovery = new CrashRecovery("/project");
    const result = await recovery.scan();
    expect(result.resumableSessions).toHaveLength(0);
    expect(result.staleSessions).toHaveLength(0);
    expect(result.selectedSession).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// describe: scan() — with sessions
// ---------------------------------------------------------------------------

describe("CrashRecovery.scan — session classification", () => {
  beforeEach(() => {
    vi.mocked(RecoveryManager).mockImplementation(() => ({
      scanStaleSessions: vi.fn().mockResolvedValue([
        makeSession("s1", "resumable", 1_800_000), // 30 min old
        makeSession("s2", "resumable", 7200_000),  // 2 hours old
        makeSession("s3", "stale"),
        makeSession("s4", "corrupt"),
      ]),
    }) as unknown as InstanceType<typeof RecoveryManager>);
  });

  it("separates resumable from stale/corrupt", async () => {
    const recovery = new CrashRecovery("/project");
    const result = await recovery.scan();
    expect(result.resumableSessions).toHaveLength(2);
    expect(result.staleSessions).toHaveLength(2);
  });

  it("selects newest session when policy=newest", async () => {
    const recovery = new CrashRecovery("/project", { autoResumePolicy: "newest" });
    const result = await recovery.scan();
    expect(result.selectedSession?.sessionId).toBe("s1"); // 30 min ago is newer
  });

  it("selects highest-step session when policy=highest_step", async () => {
    vi.mocked(RecoveryManager).mockImplementation(() => ({
      scanStaleSessions: vi.fn().mockResolvedValue([
        { ...makeSession("s1", "resumable"), step: 3 },
        { ...makeSession("s2", "resumable"), step: 10 },
      ]),
    }) as unknown as InstanceType<typeof RecoveryManager>);

    const recovery = new CrashRecovery("/project", { autoResumePolicy: "highest_step" });
    const result = await recovery.scan();
    expect(result.selectedSession?.sessionId).toBe("s2");
  });

  it("returns null selectedSession when policy=none", async () => {
    const recovery = new CrashRecovery("/project", { autoResumePolicy: "none" });
    const result = await recovery.scan();
    expect(result.selectedSession).toBeNull();
  });

  it("excludes sessions older than maxSessionAgeMs", async () => {
    const recovery = new CrashRecovery("/project", {
      maxSessionAgeMs: 3600_000, // 1 hour max
    });
    // s2 is 2 hours old → should be in stale
    const result = await recovery.scan();
    // s1 (30 min) is resumable, s2 (2h) is too old → stale
    expect(result.resumableSessions.map((s) => s.sessionId)).toContain("s1");
    expect(result.staleSessions.map((s) => s.sessionId)).toContain("s2");
  });
});

// ---------------------------------------------------------------------------
// describe: restore()
// ---------------------------------------------------------------------------

describe("CrashRecovery.restore", () => {
  it("returns recovered=false when checkpoint file does not exist", async () => {
    vi.mocked(existsSync).mockReturnValue(false);
    const recovery = new CrashRecovery("/project");
    const result = await recovery.restore("missing-session");
    expect(result.recovered).toBe(false);
    expect(result.message).toContain("not found");
  });

  it("returns recovered=true when checkpoint exists and resumeFromCheckpoint succeeds", async () => {
    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(resumeFromCheckpoint).mockResolvedValue({
      checkpoint: { id: "cp1", channelValues: { key: "val" }, ts: new Date().toISOString() },
      metadata: { source: "input", step: 1, triggerCommand: "test" },
      pendingWrites: [],
      replayEvents: (async function* () {})(),
      replayEventCount: 5,
    } as unknown as Awaited<ReturnType<typeof resumeFromCheckpoint>>);

    const recovery = new CrashRecovery("/project", { silent: true });
    const result = await recovery.restore("my-session");
    expect(result.recovered).toBe(true);
    expect(result.sessionId).toBe("my-session");
    expect(result.eventsReplayed).toBe(5);
  });

  it("returns recovered=false when resumeFromCheckpoint throws", async () => {
    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(resumeFromCheckpoint).mockRejectedValue(new Error("disk read failed"));

    const recovery = new CrashRecovery("/project", { silent: true });
    const result = await recovery.restore("bad-session");
    expect(result.recovered).toBe(false);
    expect(result.message).toContain("disk read failed");
  });
});

// ---------------------------------------------------------------------------
// describe: scanAndRestore()
// ---------------------------------------------------------------------------

describe("CrashRecovery.scanAndRestore", () => {
  it("returns not-recovered when no resumable sessions", async () => {
    vi.mocked(RecoveryManager).mockImplementation(() => ({
      scanStaleSessions: vi.fn().mockResolvedValue([]),
    }) as unknown as InstanceType<typeof RecoveryManager>);

    const recovery = new CrashRecovery("/project");
    const result = await recovery.scanAndRestore();
    expect(result.recovered).toBe(false);
    expect(result.message).toContain("No resumable");
  });

  it("returns not-recovered when policy is none", async () => {
    vi.mocked(RecoveryManager).mockImplementation(() => ({
      scanStaleSessions: vi.fn().mockResolvedValue([makeSession("s1")]),
    }) as unknown as InstanceType<typeof RecoveryManager>);

    const recovery = new CrashRecovery("/project", { autoResumePolicy: "none" });
    const result = await recovery.scanAndRestore();
    expect(result.recovered).toBe(false);
    expect(result.message).toContain("policy=none");
  });
});

// ---------------------------------------------------------------------------
// describe: buildStartupMessage()
// ---------------------------------------------------------------------------

describe("CrashRecovery.buildStartupMessage", () => {
  it("returns null when no resumable sessions", async () => {
    vi.mocked(RecoveryManager).mockImplementation(() => ({
      scanStaleSessions: vi.fn().mockResolvedValue([]),
    }) as unknown as InstanceType<typeof RecoveryManager>);

    const recovery = new CrashRecovery("/project");
    const msg = await recovery.buildStartupMessage();
    expect(msg).toBeNull();
  });

  it("returns a message string when sessions exist", async () => {
    vi.mocked(RecoveryManager).mockImplementation(() => ({
      scanStaleSessions: vi.fn().mockResolvedValue([makeSession("s1")]),
    }) as unknown as InstanceType<typeof RecoveryManager>);

    const recovery = new CrashRecovery("/project");
    const msg = await recovery.buildStartupMessage();
    expect(msg).not.toBeNull();
    expect(msg).toContain("s1");
    expect(msg).toContain("--resume=");
  });
});
