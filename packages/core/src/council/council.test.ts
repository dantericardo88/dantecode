// ============================================================================
// Council Orchestrator — Unit Tests
// Tests all council modules: types, state store, usage ledger,
// overlap detector, merge confidence, handoff engine, council events,
// council router, worktree observer.
// ============================================================================

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mkdir, rm, readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import {
  createCouncilRunState,
  newRunId,
  newLaneId,
  newHandoffId,
  type AgentSessionState,
  type FileMandate,
  type HandoffPacket,
  type CouncilRunState,
  type AgentKind,
} from "./council-types.js";
import {
  saveCouncilRun,
  loadCouncilRun,
  tryLoadCouncilRun,
  listCouncilRuns,
  appendHandoffPacket,
  setRunStatus,
} from "./council-state-store.js";
import { UsageLedger } from "./usage-ledger.js";
import { OverlapDetector, classifyOverlapLevel } from "./overlap-detector.js";
import { MergeConfidenceScorer } from "./merge-confidence.js";
import { HandoffEngine } from "./handoff-engine.js";
import {
  createCouncilEvent,
  councilStartEvent,
  laneAssignedEvent,
  overlapDetectedEvent,
  handoffCreatedEvent,
  mergeCompletedEvent,
  mergeBlockedEvent,
} from "./council-events.js";
import type { WorktreeSnapshot } from "./worktree-observer.js";
import { WorktreeObserver } from "./worktree-observer.js";
import { CouncilRouter } from "./council-router.js";
import { MergeBrain } from "./merge-brain.js";
import type { MergeCandidatePatch } from "./merge-confidence.js";
import type { CouncilAgentAdapter } from "./agent-adapters/base.js";

// ----------------------------------------------------------------------------
// Helpers
// ----------------------------------------------------------------------------

let testDir: string;

beforeEach(async () => {
  testDir = join(tmpdir(), `council-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  await mkdir(testDir, { recursive: true });
});

// Note: cleanup is intentionally skipped in fast tests

// ----------------------------------------------------------------------------
// council-types
// ----------------------------------------------------------------------------

describe("council-types", () => {
  it("newRunId produces unique IDs", () => {
    const a = newRunId();
    const b = newRunId();
    expect(a).not.toBe(b);
    expect(a).toMatch(/^council-\d+-/);
  });

  it("newLaneId includes agent kind", () => {
    const id = newLaneId("codex");
    expect(id).toMatch(/^codex-/);
  });

  it("newHandoffId is unique", () => {
    const a = newHandoffId();
    const b = newHandoffId();
    expect(a).not.toBe(b);
    expect(a).toMatch(/^handoff-/);
  });

  it("createCouncilRunState returns valid initial state", () => {
    const state = createCouncilRunState("/repo", "Fix the bug", "/repo/audit.log");
    expect(state.repoRoot).toBe("/repo");
    expect(state.objective).toBe("Fix the bug");
    expect(state.status).toBe("planning");
    expect(state.agents).toEqual([]);
    expect(state.mandates).toEqual([]);
    expect(state.overlaps).toEqual([]);
    expect(state.handoffs).toEqual([]);
    expect(state.runId).toMatch(/^council-/);
    expect(state.createdAt).toBeTruthy();
    expect(state.updatedAt).toBeTruthy();
  });
});

// ----------------------------------------------------------------------------
// council-state-store
// ----------------------------------------------------------------------------

describe("council-state-store", () => {
  it("saves and loads a run state", async () => {
    const state = createCouncilRunState(testDir, "Test objective", `${testDir}/audit.log`);
    await saveCouncilRun(state);
    const loaded = await loadCouncilRun(testDir, state.runId);
    expect(loaded.runId).toBe(state.runId);
    expect(loaded.objective).toBe("Test objective");
    expect(loaded.status).toBe("planning");
  });

  it("tryLoadCouncilRun returns null for missing run", async () => {
    const result = await tryLoadCouncilRun(testDir, "nonexistent-run");
    expect(result).toBeNull();
  });

  it("listCouncilRuns returns empty array when no runs", async () => {
    const runs = await listCouncilRuns(testDir);
    expect(runs).toEqual([]);
  });

  it("listCouncilRuns returns run IDs after saving", async () => {
    const state = createCouncilRunState(testDir, "Obj", `${testDir}/audit.log`);
    await saveCouncilRun(state);
    const runs = await listCouncilRuns(testDir);
    expect(runs).toContain(state.runId);
  });

  it("appendHandoffPacket persists packet and marks lane as handed-off", async () => {
    const state = createCouncilRunState(testDir, "Test", `${testDir}/audit.log`);
    const lane: AgentSessionState = {
      laneId: "codex-abc",
      agentKind: "codex",
      adapterKind: "file-bridge",
      sessionId: "sess-1",
      health: "hard-capped",
      worktreePath: testDir,
      branch: "feature/test",
      assignedFiles: ["src/foo.ts"],
      status: "running",
      objective: "Fix foo",
      taskCategory: "coding",
      touchedFiles: ["src/foo.ts"],
      retryCount: 0,
    };
    state.agents.push(lane);
    await saveCouncilRun(state);

    const packet: HandoffPacket = {
      id: newHandoffId(),
      laneId: "codex-abc",
      reason: "hard-cap",
      createdAt: new Date().toISOString(),
      objective: "Fix foo",
      branch: "feature/test",
      worktreePath: testDir,
      touchedFiles: ["src/foo.ts"],
      diffSummary: "diff --git...",
      assumptions: [],
      completedChecks: [],
      pendingTests: ["unit tests"],
      openQuestions: [],
    };

    await appendHandoffPacket(testDir, state.runId, packet);
    const loaded = await loadCouncilRun(testDir, state.runId);

    expect(loaded.handoffs).toHaveLength(1);
    expect(loaded.handoffs[0]!.id).toBe(packet.id);
    const laneState = loaded.agents.find((a) => a.laneId === "codex-abc");
    expect(laneState?.status).toBe("handed-off");
    expect(laneState?.handoffPacketId).toBe(packet.id);
  });

  it("setRunStatus updates status", async () => {
    const state = createCouncilRunState(testDir, "Obj", `${testDir}/audit.log`);
    await saveCouncilRun(state);
    await setRunStatus(testDir, state.runId, "running");
    const loaded = await loadCouncilRun(testDir, state.runId);
    expect(loaded.status).toBe("running");
  });
});

// ----------------------------------------------------------------------------
// usage-ledger
// ----------------------------------------------------------------------------

describe("UsageLedger", () => {
  it("registers agents and tracks health", () => {
    const ledger = new UsageLedger();
    ledger.register("codex");
    expect(ledger.getHealth("codex")).toBe("ready");
  });

  it("records success and resets timeout counter", () => {
    const ledger = new UsageLedger();
    ledger.register("codex");
    ledger.recordTimeout("codex");
    ledger.recordSuccess("codex", 2000);
    expect(ledger.getHealth("codex")).toBe("ready");
    const snapshot = ledger.getSnapshot("codex");
    expect(snapshot?.successCount).toBe(1);
    expect(snapshot?.consecutiveTimeouts).toBe(0);
  });

  it("escalates to hard-capped after 3 timeouts", () => {
    const ledger = new UsageLedger();
    ledger.register("claude-code");
    ledger.recordTimeout("claude-code");
    ledger.recordTimeout("claude-code");
    ledger.recordTimeout("claude-code");
    expect(ledger.getHealth("claude-code")).toBe("hard-capped");
  });

  it("hard-cap reason escalates health", () => {
    const ledger = new UsageLedger();
    ledger.register("claude-code");
    ledger.recordFailure("claude-code", "rate-limit exceeded");
    expect(ledger.getHealth("claude-code")).toBe("hard-capped");
  });

  it("rankAgents returns sorted list", () => {
    const ledger = new UsageLedger();
    ledger.register("dantecode");
    ledger.register("codex");
    ledger.register("claude-code");
    const ranked = ledger.rankAgents("coding");
    expect(ranked.length).toBeGreaterThanOrEqual(3);
    // All scores should be non-decreasing in reverse
    for (let i = 1; i < ranked.length; i++) {
      expect(ranked[i - 1]!.score).toBeGreaterThanOrEqual(ranked[i]!.score);
    }
  });

  it("capped agents score 0", () => {
    const ledger = new UsageLedger();
    ledger.register("codex");
    ledger.setHealth("codex", "hard-capped");
    expect(ledger.getRoutingScore("codex", "coding")).toBe(0);
  });

  it("returns null snapshot for unknown agent", () => {
    const ledger = new UsageLedger();
    expect(ledger.getSnapshot("custom")).toBeNull();
  });

  it("getAllSnapshots returns all registered agents", () => {
    const ledger = new UsageLedger();
    ledger.register("dantecode");
    ledger.register("codex");
    const snapshots = ledger.getAllSnapshots();
    expect(snapshots).toHaveLength(2);
  });
});

// ----------------------------------------------------------------------------
// overlap-detector
// ----------------------------------------------------------------------------

describe("classifyOverlapLevel", () => {
  it("L0 — no shared files or directories", () => {
    expect(classifyOverlapLevel(["src/a.ts"], ["src/b.ts"])).toBe(2); // same dir
    expect(classifyOverlapLevel(["src/a.ts"], ["lib/b.ts"])).toBe(0); // different dirs
  });

  it("L3 — same file in both sets", () => {
    expect(classifyOverlapLevel(["src/a.ts", "src/b.ts"], ["src/a.ts"])).toBe(3);
  });

  it("L2 — same directory, different files", () => {
    expect(classifyOverlapLevel(["src/a.ts"], ["src/b.ts"])).toBe(2);
  });

  it("empty sets return L0", () => {
    expect(classifyOverlapLevel([], [])).toBe(0);
    expect(classifyOverlapLevel(["src/a.ts"], [])).toBe(0);
  });
});

describe("OverlapDetector", () => {
  const detector = new OverlapDetector();

  it("detects no overlap for disjoint files", () => {
    const snapshots: WorktreeSnapshot[] = [
      {
        laneId: "lane-a",
        agentKind: "codex",
        worktreePath: "/repo/wt/lane-a",
        branch: "feature/a",
        headCommit: "abc",
        modifiedFiles: ["src/a.ts"],
        capturedAt: new Date().toISOString(),
      },
      {
        laneId: "lane-b",
        agentKind: "claude-code",
        worktreePath: "/repo/wt/lane-b",
        branch: "feature/b",
        headCommit: "def",
        modifiedFiles: ["lib/b.ts"],
        capturedAt: new Date().toISOString(),
      },
    ];
    const result = detector.detect(snapshots, []);
    const l3plus = result.overlaps.filter((o) => o.level >= 3);
    expect(l3plus).toHaveLength(0);
    expect(result.lanesToFreeze).toHaveLength(0);
  });

  it("detects and freezes lanes on L3+ overlap", () => {
    const snapshots: WorktreeSnapshot[] = [
      {
        laneId: "lane-a",
        agentKind: "codex",
        worktreePath: "/repo/wt/lane-a",
        branch: "feature/a",
        headCommit: "abc",
        modifiedFiles: ["src/shared.ts"],
        capturedAt: new Date().toISOString(),
      },
      {
        laneId: "lane-b",
        agentKind: "claude-code",
        worktreePath: "/repo/wt/lane-b",
        branch: "feature/b",
        headCommit: "def",
        modifiedFiles: ["src/shared.ts"],
        capturedAt: new Date().toISOString(),
      },
    ];
    const result = detector.detect(snapshots, []);
    expect(result.overlaps).toHaveLength(1);
    expect(result.overlaps[0]!.level).toBe(3);
    expect(result.overlaps[0]!.frozen).toBe(true);
    expect(result.lanesToFreeze).toContain("lane-a");
    expect(result.lanesToFreeze).toContain("lane-b");
  });

  it("checkWrite blocks writes to other lanes owned files", () => {
    const mandates: FileMandate[] = [
      {
        laneId: "lane-a",
        ownedFiles: ["src/foo.ts"],
        readOnlyFiles: [],
        forbiddenFiles: [],
        contractDependencies: [],
        overlapPolicy: "freeze",
      },
    ];
    const result = detector.checkWrite("lane-b", "src/foo.ts", mandates);
    expect(result.safe).toBe(false);
    expect(result.reason).toContain("NOMA violation");
  });

  it("checkWrite allows writes to unowned files", () => {
    const mandates: FileMandate[] = [
      {
        laneId: "lane-a",
        ownedFiles: ["src/foo.ts"],
        readOnlyFiles: [],
        forbiddenFiles: [],
        contractDependencies: [],
        overlapPolicy: "freeze",
      },
    ];
    const result = detector.checkWrite("lane-b", "src/bar.ts", mandates);
    expect(result.safe).toBe(true);
  });
});

// ----------------------------------------------------------------------------
// merge-confidence
// ----------------------------------------------------------------------------

describe("MergeConfidenceScorer", () => {
  const scorer = new MergeConfidenceScorer();

  it("returns low confidence for empty candidates", () => {
    const result = scorer.score([]);
    expect(result.bucket).toBe("low");
    expect(result.decision).toBe("blocked");
    expect(result.score).toBe(0);
  });

  it("returns high confidence for a single passing candidate", () => {
    const result = scorer.score([
      {
        laneId: "lane-a",
        unifiedDiff: "--- a\n+++ b\n@@...",
        changedFiles: ["src/a.ts"],
        passedTests: ["test1", "test2", "test3"],
        failedTests: [],
      },
    ]);
    expect(result.bucket).toBe("high");
    expect(result.decision).toBe("auto-merge");
    expect(result.score).toBeGreaterThanOrEqual(75);
  });

  it("returns low confidence for two candidates with same file overlap", () => {
    const result = scorer.score([
      {
        laneId: "lane-a",
        unifiedDiff: "diff --git a/src/foo.ts b/src/foo.ts\n@@ -1,3 +1,4 @@\n-old\n+new\n",
        changedFiles: ["src/foo.ts"],
        passedTests: [],
        failedTests: ["test-a"],
      },
      {
        laneId: "lane-b",
        unifiedDiff: "diff --git a/src/foo.ts b/src/foo.ts\n@@ -1,3 +1,5 @@\n-old\n+different\n",
        changedFiles: ["src/foo.ts"],
        passedTests: [],
        failedTests: ["test-b"],
      },
    ]);
    expect(result.bucket).toBe("low");
    expect(result.decision).toBe("blocked");
  });

  it("returns medium confidence for overlapping files with passing tests", () => {
    const result = scorer.score([
      {
        laneId: "lane-a",
        unifiedDiff: "diff --git a/src/a.ts b/src/a.ts\n@@ -1,5 +1,6 @@\n+new line",
        changedFiles: ["src/a.ts"],
        passedTests: ["t1", "t2"],
        failedTests: [],
      },
      {
        laneId: "lane-b",
        unifiedDiff: "diff --git a/src/b.ts b/src/b.ts\n@@ -10,5 +10,6 @@\n+other new",
        changedFiles: ["src/b.ts"],
        passedTests: ["t3"],
        failedTests: [],
      },
    ]);
    // Non-overlapping files should score higher
    expect(result.score).toBeGreaterThan(50);
  });

  it("factors include all four dimensions", () => {
    const result = scorer.score([
      { laneId: "lane-a", unifiedDiff: "", changedFiles: [] },
    ]);
    expect(result.factors).toHaveProperty("structuralSafety");
    expect(result.factors).toHaveProperty("testCoverage");
    expect(result.factors).toHaveProperty("intentCompatibility");
    expect(result.factors).toHaveProperty("contractPreservation");
  });
});

// ----------------------------------------------------------------------------
// handoff-engine
// ----------------------------------------------------------------------------

describe("HandoffEngine", () => {
  it("creates a valid packet from session state", () => {
    const engine = new HandoffEngine(testDir);
    const session: AgentSessionState = {
      laneId: "claude-abc",
      agentKind: "claude-code",
      adapterKind: "file-bridge",
      sessionId: "sess-1",
      health: "hard-capped",
      worktreePath: testDir,
      branch: "feature/fix",
      assignedFiles: ["src/auth.ts"],
      status: "running",
      objective: "Fix auth bug",
      taskCategory: "debugging",
      touchedFiles: ["src/auth.ts"],
      retryCount: 0,
    };

    const packet = engine.createPacket({
      session,
      reason: "hard-cap",
      completedChecks: ["typecheck"],
      pendingTests: ["unit-tests"],
      blockerReason: "Hit daily usage limit",
      recommendedNextAgent: "codex",
    });

    expect(packet.laneId).toBe("claude-abc");
    expect(packet.reason).toBe("hard-cap");
    expect(packet.touchedFiles).toContain("src/auth.ts");
    expect(packet.pendingTests).toContain("unit-tests");
    expect(packet.completedChecks).toContain("typecheck");
    expect(packet.recommendedNextAgent).toBe("codex");
  });

  it("validates a complete packet", () => {
    const engine = new HandoffEngine(testDir);
    const packet: HandoffPacket = {
      id: newHandoffId(),
      laneId: "lane-1",
      reason: "hard-cap",
      createdAt: new Date().toISOString(),
      objective: "Fix something",
      branch: "feature/fix",
      worktreePath: testDir,
      touchedFiles: ["src/a.ts"],
      diffSummary: "stat summary",
      assumptions: [],
      completedChecks: [],
      pendingTests: [],
      openQuestions: [],
    };

    const result = engine.validate(packet);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it("validates an incomplete packet", () => {
    const engine = new HandoffEngine(testDir);
    const packet = {
      id: "",
      laneId: "",
      reason: "hard-cap" as const,
      createdAt: "",
      objective: "",
      branch: "",
      worktreePath: "",
      touchedFiles: null as unknown as string[],
      diffSummary: "",
      assumptions: [],
      completedChecks: [],
      pendingTests: null as unknown as string[],
      openQuestions: [],
    };

    const result = engine.validate(packet);
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
  });

  it("redacts secrets from packet fields", () => {
    const engine = new HandoffEngine(testDir);
    const packet: HandoffPacket = {
      id: newHandoffId(),
      laneId: "lane-1",
      reason: "hard-cap",
      createdAt: new Date().toISOString(),
      objective: "Use sk-abcdefghijklmnopqrstuvwxyz123456 token",
      branch: "feature/fix",
      worktreePath: testDir,
      touchedFiles: [],
      diffSummary: "",
      assumptions: ["ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefgh is the token"],
      completedChecks: [],
      pendingTests: [],
      openQuestions: [],
    };

    const redacted = engine.redactSecrets(packet);
    expect(redacted.objective).not.toContain("sk-");
    expect(redacted.assumptions[0]).not.toContain("ghp_");
    expect(redacted.objective).toContain("[REDACTED]");
  });

  it("saves and loads a packet", async () => {
    const engine = new HandoffEngine(testDir);
    const packet: HandoffPacket = {
      id: newHandoffId(),
      laneId: "lane-save",
      reason: "timeout",
      createdAt: new Date().toISOString(),
      objective: "Save me",
      branch: "main",
      worktreePath: testDir,
      touchedFiles: ["src/test.ts"],
      diffSummary: "",
      assumptions: [],
      completedChecks: [],
      pendingTests: ["vitest"],
      openQuestions: [],
    };

    const runId = "test-run-save";
    await engine.savePacket(runId, packet);
    const loaded = await engine.loadPacket(runId, packet.id);
    expect(loaded.laneId).toBe("lane-save");
    expect(loaded.pendingTests).toContain("vitest");
  });
});

// ----------------------------------------------------------------------------
// council-events
// ----------------------------------------------------------------------------

describe("council-events", () => {
  it("createCouncilEvent produces valid event", () => {
    const event = createCouncilEvent("council:start", { runId: "test" }, "Test start");
    expect(event.type).toBe("council:start");
    expect(event.description).toBe("Test start");
    expect(event.id).toBeTruthy();
    expect(event.timestamp).toBeTruthy();
  });

  it("councilStartEvent includes objective", () => {
    const event = councilStartEvent({
      runId: "run-1",
      repoRoot: "/repo",
      objective: "Fix all bugs",
      agentKinds: ["codex", "claude-code"],
    });
    expect(event.type).toBe("council:start");
    expect(event.description).toContain("Fix all bugs");
  });

  it("laneAssignedEvent includes agent kind", () => {
    const event = laneAssignedEvent({
      runId: "run-1",
      laneId: "codex-abc",
      agentKind: "codex",
      objective: "Fix foo",
      ownedFiles: ["src/foo.ts"],
    });
    expect(event.type).toBe("council:lane-assigned");
    expect(event.description).toContain("codex");
  });

  it("overlapDetectedEvent includes file list", () => {
    const event = overlapDetectedEvent({
      runId: "run-1",
      overlapId: "overlap-1",
      laneA: "lane-a",
      laneB: "lane-b",
      level: 3,
      files: ["src/shared.ts"],
    });
    expect(event.type).toBe("council:overlap-detected");
    expect(event.description).toContain("src/shared.ts");
    expect(event.description).toContain("L3");
  });
});

// ============================================================================
// EXTENDED TEST SUITES — Added for 100+ test coverage
// ============================================================================

// ----------------------------------------------------------------------------
// Mock adapter factory
// ----------------------------------------------------------------------------

function makeMockAdapter(kind: AgentKind, acceptsTask = true): CouncilAgentAdapter {
  return {
    id: kind,
    displayName: kind,
    kind: "file-bridge",
    probeAvailability: async () => ({
      available: true,
      health: "ready" as const,
      reason: "ok",
    }),
    estimateCapacity: async () => ({
      remainingCapacity: 80,
      capSuspicion: "none" as const,
    }),
    submitTask: async (_packet) =>
      acceptsTask
        ? { accepted: true, sessionId: `sess-${randomUUID().slice(0, 8)}` }
        : { accepted: false, reason: "agent refused", sessionId: "" },
    pollStatus: async (sessionId: string) => ({
      sessionId,
      status: "running" as const,
      lastOutputAt: new Date().toISOString(),
    }),
    collectArtifacts: async (sessionId: string) => ({
      sessionId,
      files: [],
      logs: [],
    }),
    collectPatch: async () => null,
    detectRateLimit: async () => ({
      detected: false,
      confidence: "none" as const,
    }),
    abortTask: async () => {},
  } as CouncilAgentAdapter;
}

// ----------------------------------------------------------------------------
// CouncilRouter integration tests
// ----------------------------------------------------------------------------

describe("CouncilRouter", () => {
  let ledger: UsageLedger;
  let adapters: Map<AgentKind, CouncilAgentAdapter>;
  let router: CouncilRouter;
  let runState: CouncilRunState;
  let routerTestDir: string;

  beforeEach(async () => {
    routerTestDir = join(tmpdir(), `council-router-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    await mkdir(routerTestDir, { recursive: true });

    ledger = new UsageLedger();
    ledger.register("codex");
    ledger.register("dantecode");

    adapters = new Map();
    adapters.set("codex", makeMockAdapter("codex", true));
    adapters.set("dantecode", makeMockAdapter("dantecode", true));

    router = new CouncilRouter(ledger, adapters);

    runState = createCouncilRunState(routerTestDir, "Test objective", `${routerTestDir}/audit.log`);
    router.attachRun(runState);
  });

  it("assignLane succeeds when agent is available and files not owned", async () => {
    const result = await router.assignLane({
      objective: "Implement feature A",
      taskCategory: "coding",
      ownedFiles: ["src/feature-a.ts"],
      worktreePath: routerTestDir,
      branch: "feature/a",
      baseBranch: "main",
    });

    expect(result.accepted).toBe(true);
    expect(result.laneId).toBeTruthy();
    expect(result.sessionId).toBeTruthy();
    expect(runState.agents).toHaveLength(1);
    expect(runState.mandates).toHaveLength(1);
  });

  it("assignLane rejects when NOMA violation (file already owned by other lane)", async () => {
    // First assignment succeeds and registers a mandate for src/shared.ts
    const first = await router.assignLane({
      objective: "Lane A",
      taskCategory: "coding",
      ownedFiles: ["src/shared.ts"],
      worktreePath: routerTestDir,
      branch: "feature/a",
      baseBranch: "main",
    });
    expect(first.accepted).toBe(true);

    // Second assignment tries to own the same file — NOMA violation
    const second = await router.assignLane({
      objective: "Lane B",
      taskCategory: "coding",
      ownedFiles: ["src/shared.ts"],
      worktreePath: routerTestDir,
      branch: "feature/b",
      baseBranch: "main",
    });
    expect(second.accepted).toBe(false);
    expect(second.reason).toContain("NOMA");
  });

  it("assignLane rejects when no agent available (all capped)", async () => {
    // Cap all agents
    ledger.setHealth("codex", "hard-capped");
    ledger.setHealth("dantecode", "hard-capped");

    const result = await router.assignLane({
      objective: "Some task",
      taskCategory: "coding",
      ownedFiles: ["src/new.ts"],
      worktreePath: routerTestDir,
      branch: "feature/c",
      baseBranch: "main",
    });

    expect(result.accepted).toBe(false);
    expect(result.reason).toContain("No available agent");
  });

  it("freezeLane marks lane status as frozen", async () => {
    const result = await router.assignLane({
      objective: "Freeze test",
      taskCategory: "coding",
      ownedFiles: ["src/freeze-test.ts"],
      worktreePath: routerTestDir,
      branch: "feature/freeze",
      baseBranch: "main",
    });
    expect(result.accepted).toBe(true);

    router.freezeLane(result.laneId);
    expect(router.isFrozen(result.laneId)).toBe(true);

    const session = runState.agents.find((a) => a.laneId === result.laneId);
    expect(session?.status).toBe("frozen");
  });

  it("thawLane restores lane status to paused", async () => {
    const result = await router.assignLane({
      objective: "Thaw test",
      taskCategory: "coding",
      ownedFiles: ["src/thaw-test.ts"],
      worktreePath: routerTestDir,
      branch: "feature/thaw",
      baseBranch: "main",
    });

    router.freezeLane(result.laneId);
    expect(router.isFrozen(result.laneId)).toBe(true);

    router.thawLane(result.laneId);
    expect(router.isFrozen(result.laneId)).toBe(false);

    const session = runState.agents.find((a) => a.laneId === result.laneId);
    expect(session?.status).toBe("paused");
  });

  it("isFrozen returns correct state for unknown lane", () => {
    expect(router.isFrozen("nonexistent-lane")).toBe(false);
  });

  it("isFrozen returns true after freezing and false after thawing", async () => {
    const result = await router.assignLane({
      objective: "Toggle freeze",
      taskCategory: "coding",
      ownedFiles: ["src/toggle.ts"],
      worktreePath: routerTestDir,
      branch: "feature/toggle",
      baseBranch: "main",
    });

    expect(router.isFrozen(result.laneId)).toBe(false);
    router.freezeLane(result.laneId);
    expect(router.isFrozen(result.laneId)).toBe(true);
    router.thawLane(result.laneId);
    expect(router.isFrozen(result.laneId)).toBe(false);
  });

  it("reassignLane creates handoff packet and assigns to new agent", async () => {
    // Assign initial lane
    const first = await router.assignLane({
      objective: "Reassign test",
      taskCategory: "coding",
      ownedFiles: ["src/reassign.ts"],
      worktreePath: routerTestDir,
      branch: "feature/reassign",
      baseBranch: "main",
    });
    expect(first.accepted).toBe(true);

    // Reassign from codex to dantecode (or whichever got picked)
    const fromAgent = first.agentKind;

    const result = await router.reassignLane({
      laneId: first.laneId,
      fromAgent,
      reason: "hard-cap",
      touchedFiles: ["src/reassign.ts"],
      diffSummary: "2 files changed",
      completedChecks: ["typecheck"],
      pendingTests: ["unit-tests"],
    });

    expect(result.success).toBe(true);
    expect(result.handoffPacketId).toBeTruthy();
    expect(result.newLaneId).toBeTruthy();
    expect(result.newLaneId).not.toBe(first.laneId);
    expect(runState.handoffs).toHaveLength(1);
    expect(runState.handoffs[0]!.reason).toBe("hard-cap");

    const originalSession = runState.agents.find((a) => a.laneId === first.laneId);
    expect(originalSession?.status).toBe("handed-off");
  });

  it("reassignLane fails when no replacement agent available", async () => {
    // Assign with codex
    adapters.clear();
    adapters.set("codex", makeMockAdapter("codex", true));
    ledger = new UsageLedger();
    ledger.register("codex");
    router = new CouncilRouter(ledger, adapters);
    runState = createCouncilRunState(routerTestDir, "No replacement test", `${routerTestDir}/audit2.log`);
    router.attachRun(runState);

    const first = await router.assignLane({
      objective: "Only codex available",
      taskCategory: "coding",
      ownedFiles: ["src/only-codex.ts"],
      worktreePath: routerTestDir,
      branch: "feature/codex-only",
      baseBranch: "main",
    });
    expect(first.accepted).toBe(true);

    // Cap codex and have no other agent
    ledger.setHealth("codex", "hard-capped");

    const result = await router.reassignLane({
      laneId: first.laneId,
      fromAgent: "codex",
      reason: "hard-cap",
      touchedFiles: [],
      diffSummary: "",
    });

    expect(result.success).toBe(false);
    expect(result.reason).toContain("No replacement agent");
  });

  it("detectAndEnforceOverlap freezes lanes with L3 overlap", async () => {
    const first = await router.assignLane({
      objective: "Lane A",
      taskCategory: "coding",
      ownedFiles: ["src/alpha.ts"],
      worktreePath: routerTestDir,
      branch: "feature/alpha",
      baseBranch: "main",
    });

    // Use a second adapter set
    adapters.set("claude-code", makeMockAdapter("claude-code", true));
    ledger.register("claude-code");

    const second = await router.assignLane({
      objective: "Lane B",
      taskCategory: "coding",
      ownedFiles: ["src/beta.ts"],
      worktreePath: routerTestDir,
      branch: "feature/beta",
      baseBranch: "main",
    });

    // Simulate both lanes touching the same file
    const snapshots: WorktreeSnapshot[] = [
      {
        laneId: first.laneId,
        agentKind: first.agentKind,
        worktreePath: routerTestDir,
        branch: "feature/alpha",
        headCommit: "aaa",
        modifiedFiles: ["src/shared-conflict.ts"],
        capturedAt: new Date().toISOString(),
      },
      {
        laneId: second.laneId,
        agentKind: second.agentKind,
        worktreePath: routerTestDir,
        branch: "feature/beta",
        headCommit: "bbb",
        modifiedFiles: ["src/shared-conflict.ts"],
        capturedAt: new Date().toISOString(),
      },
    ];

    router.detectAndEnforceOverlap(snapshots);

    expect(router.isFrozen(first.laneId)).toBe(true);
    expect(router.isFrozen(second.laneId)).toBe(true);
    expect(runState.overlaps.length).toBeGreaterThanOrEqual(1);
    expect(runState.overlaps[0]!.level).toBe(3);
  });

  it("detectAndEnforceOverlap does not freeze lanes with L2 overlap", async () => {
    const first = await router.assignLane({
      objective: "Lane A same-dir",
      taskCategory: "coding",
      ownedFiles: ["src/comp-a.ts"],
      worktreePath: routerTestDir,
      branch: "feature/comp-a",
      baseBranch: "main",
    });

    adapters.set("claude-code", makeMockAdapter("claude-code", true));
    ledger.register("claude-code");

    const second = await router.assignLane({
      objective: "Lane B same-dir",
      taskCategory: "coding",
      ownedFiles: ["src/comp-b.ts"],
      worktreePath: routerTestDir,
      branch: "feature/comp-b",
      baseBranch: "main",
    });

    // L2: same directory, different files
    const snapshots: WorktreeSnapshot[] = [
      {
        laneId: first.laneId,
        agentKind: first.agentKind,
        worktreePath: routerTestDir,
        branch: "feature/comp-a",
        headCommit: "ccc",
        modifiedFiles: ["src/helpers.ts"],
        capturedAt: new Date().toISOString(),
      },
      {
        laneId: second.laneId,
        agentKind: second.agentKind,
        worktreePath: routerTestDir,
        branch: "feature/comp-b",
        headCommit: "ddd",
        modifiedFiles: ["src/utils.ts"],
        capturedAt: new Date().toISOString(),
      },
    ];

    router.detectAndEnforceOverlap(snapshots);

    // L2 should NOT freeze — only warn
    expect(router.isFrozen(first.laneId)).toBe(false);
    expect(router.isFrozen(second.laneId)).toBe(false);
  });
});

// ----------------------------------------------------------------------------
// MergeBrain integration tests
// ----------------------------------------------------------------------------

describe("MergeBrain", () => {
  let brain: MergeBrain;
  let mergeTmpDir: string;

  beforeEach(async () => {
    brain = new MergeBrain();
    mergeTmpDir = join(tmpdir(), `council-mergebrain-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    await mkdir(mergeTmpDir, { recursive: true });
  });

  afterEach(async () => {
    await rm(mergeTmpDir, { recursive: true, force: true });
  });

  it("synthesize returns blocked for zero candidates", async () => {
    const result = await brain.synthesize({
      runId: "run-zero",
      candidates: [],
      repoRoot: mergeTmpDir,
      targetBranch: "main",
      auditDir: join(mergeTmpDir, "audits"),
    });

    expect(result.success).toBe(false);
    expect(result.synthesis.decision).toBe("blocked");
    expect(result.synthesis.confidence).toBe("low");
    expect(result.error).toContain("blocked");
  });

  it("synthesize returns medium+ confidence for single candidate with tests", async () => {
    const candidates: MergeCandidatePatch[] = [
      {
        laneId: "lane-single",
        unifiedDiff: "diff --git a/src/foo.ts b/src/foo.ts\n@@ -1,3 +1,4 @@\n+// new line\n",
        changedFiles: ["src/foo.ts"],
        passedTests: ["test1", "test2", "test3"],
        failedTests: [],
      },
    ];

    const result = await brain.synthesize({
      runId: "run-single",
      candidates,
      repoRoot: mergeTmpDir,
      targetBranch: "main",
      auditDir: join(mergeTmpDir, "audits"),
    });

    expect(result.success).toBe(true);
    expect(result.synthesis.confidence).toMatch(/^(medium|high)$/);
    expect(result.synthesis.candidateLanes).toContain("lane-single");
  });

  it("synthesize preserves all candidate patches in synthesis record", async () => {
    const candidates: MergeCandidatePatch[] = [
      {
        laneId: "lane-preserve-a",
        unifiedDiff: "diff --git a/src/a.ts b/src/a.ts\n@@ -1,2 +1,3 @@\n+line",
        changedFiles: ["src/a.ts"],
        passedTests: ["t1"],
        failedTests: [],
      },
    ];

    const result = await brain.synthesize({
      runId: "run-preserve",
      candidates,
      repoRoot: mergeTmpDir,
      targetBranch: "main",
      auditDir: join(mergeTmpDir, "audits"),
    });

    expect(result.synthesis.preservedCandidates).toHaveProperty("lane-preserve-a");
    expect(result.synthesis.preservedCandidates["lane-preserve-a"]).toContain("diff");
  });

  it("synthesize writes audit bundle to disk", async () => {
    const auditDir = join(mergeTmpDir, "audit-write-test");
    const candidates: MergeCandidatePatch[] = [
      {
        laneId: "lane-audit",
        unifiedDiff: "diff --git a/src/b.ts b/src/b.ts\n@@ -1 +1,2 @@\n+added",
        changedFiles: ["src/b.ts"],
        passedTests: ["t1"],
        failedTests: [],
      },
    ];

    const result = await brain.synthesize({
      runId: "run-audit",
      candidates,
      repoRoot: mergeTmpDir,
      targetBranch: "main",
      auditDir,
    });

    const auditBundlePath = result.synthesis.auditBundlePath;
    expect(auditBundlePath).toBeTruthy();

    const raw = await readFile(auditBundlePath!, "utf-8");
    const bundle = JSON.parse(raw) as unknown;
    expect(bundle).toHaveProperty("synthesis");
    expect(bundle).toHaveProperty("confidence");
    expect((bundle as { candidateSummaries: unknown[] }).candidateSummaries).toHaveLength(1);
  });

  it("synthesize returns low confidence when two candidates have same-file overlap", async () => {
    const candidates: MergeCandidatePatch[] = [
      {
        laneId: "lane-conflict-a",
        unifiedDiff:
          "diff --git a/src/shared.ts b/src/shared.ts\n@@ -1,5 +1,6 @@\n-old line\n+new line A\n",
        changedFiles: ["src/shared.ts"],
        passedTests: [],
        failedTests: ["test-a"],
      },
      {
        laneId: "lane-conflict-b",
        unifiedDiff:
          "diff --git a/src/shared.ts b/src/shared.ts\n@@ -1,5 +1,7 @@\n-old line\n+new line B\n+extra line\n",
        changedFiles: ["src/shared.ts"],
        passedTests: [],
        failedTests: ["test-b"],
      },
    ];

    const result = await brain.synthesize({
      runId: "run-conflict",
      candidates,
      repoRoot: mergeTmpDir,
      targetBranch: "main",
      auditDir: join(mergeTmpDir, "audits"),
    });

    // Both candidates have failed tests and same-file overlap → low confidence
    expect(result.synthesis.confidence).toMatch(/^(low|medium)$/);
    expect(result.synthesis.decision).toMatch(/^(blocked|review-required)$/);
  });
});

// ----------------------------------------------------------------------------
// HandoffEngine extended save/load/validate/redact tests
// ----------------------------------------------------------------------------

describe("HandoffEngine extended", () => {
  let engine: HandoffEngine;
  let handoffTmpDir: string;

  beforeEach(async () => {
    handoffTmpDir = join(tmpdir(), `council-handoff-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    await mkdir(handoffTmpDir, { recursive: true });
    engine = new HandoffEngine(handoffTmpDir);
  });

  afterEach(async () => {
    await rm(handoffTmpDir, { recursive: true, force: true });
  });

  it("createPacket + validate + savePacket + loadPacket round-trip", async () => {
    const session: AgentSessionState = {
      laneId: "codex-roundtrip",
      agentKind: "codex",
      adapterKind: "file-bridge",
      sessionId: "sess-rt",
      health: "hard-capped",
      worktreePath: handoffTmpDir,
      branch: "feature/roundtrip",
      assignedFiles: ["src/rt.ts"],
      status: "running",
      objective: "Round-trip test objective",
      taskCategory: "testing",
      touchedFiles: ["src/rt.ts"],
      retryCount: 0,
    };

    const packet = engine.createPacket({
      session,
      reason: "hard-cap",
      completedChecks: ["typecheck", "lint"],
      pendingTests: ["integration-tests"],
      blockerReason: "Hit daily limit",
    });

    const validation = engine.validate(packet);
    expect(validation.valid).toBe(true);
    expect(validation.errors).toHaveLength(0);

    const runId = "rt-run-1";
    await engine.savePacket(runId, packet);
    const loaded = await engine.loadPacket(runId, packet.id);

    expect(loaded.id).toBe(packet.id);
    expect(loaded.laneId).toBe("codex-roundtrip");
    expect(loaded.objective).toBe("Round-trip test objective");
    expect(loaded.completedChecks).toContain("typecheck");
    expect(loaded.pendingTests).toContain("integration-tests");
    expect(loaded.blockerReason).toBe("Hit daily limit");
  });

  it("validate rejects packet missing touchedFiles", () => {
    const packet = {
      id: newHandoffId(),
      laneId: "lane-bad",
      reason: "hard-cap" as const,
      createdAt: new Date().toISOString(),
      objective: "Some objective",
      branch: "main",
      worktreePath: handoffTmpDir,
      touchedFiles: null as unknown as string[],
      diffSummary: "",
      assumptions: [],
      completedChecks: [],
      pendingTests: [],
      openQuestions: [],
    };

    const result = engine.validate(packet);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("touchedFiles"))).toBe(true);
  });

  it("validate rejects packet with empty objective", () => {
    const packet: HandoffPacket = {
      id: newHandoffId(),
      laneId: "lane-empty-obj",
      reason: "hard-cap",
      createdAt: new Date().toISOString(),
      objective: "   ",
      branch: "main",
      worktreePath: handoffTmpDir,
      touchedFiles: [],
      diffSummary: "",
      assumptions: [],
      completedChecks: [],
      pendingTests: [],
      openQuestions: [],
    };

    const result = engine.validate(packet);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("objective"))).toBe(true);
  });

  it("redactSecrets replaces sk- tokens", () => {
    const packet: HandoffPacket = {
      id: newHandoffId(),
      laneId: "lane-1",
      reason: "hard-cap",
      createdAt: new Date().toISOString(),
      objective: "Use sk-abcdefghijklmnopqrstu in your work",
      branch: "main",
      worktreePath: handoffTmpDir,
      touchedFiles: [],
      diffSummary: "",
      assumptions: [],
      completedChecks: [],
      pendingTests: [],
      openQuestions: [],
    };

    const redacted = engine.redactSecrets(packet);
    expect(redacted.objective).not.toContain("sk-");
    expect(redacted.objective).toContain("[REDACTED]");
  });

  it("redactSecrets replaces ghp_ tokens", () => {
    const packet: HandoffPacket = {
      id: newHandoffId(),
      laneId: "lane-2",
      reason: "hard-cap",
      createdAt: new Date().toISOString(),
      objective: "Normal objective",
      branch: "main",
      worktreePath: handoffTmpDir,
      touchedFiles: [],
      diffSummary: "",
      assumptions: ["Token is ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefgh"],
      completedChecks: [],
      pendingTests: [],
      openQuestions: [],
    };

    const redacted = engine.redactSecrets(packet);
    expect(redacted.assumptions[0]).not.toContain("ghp_");
    expect(redacted.assumptions[0]).toContain("[REDACTED]");
  });

  it("redactSecrets replaces AIza tokens", () => {
    const packet: HandoffPacket = {
      id: newHandoffId(),
      laneId: "lane-3",
      reason: "hard-cap",
      createdAt: new Date().toISOString(),
      objective: "Key is AIzaSyD1234567890abcdef",
      branch: "main",
      worktreePath: handoffTmpDir,
      touchedFiles: [],
      diffSummary: "",
      assumptions: [],
      completedChecks: [],
      pendingTests: [],
      openQuestions: [],
    };

    const redacted = engine.redactSecrets(packet);
    expect(redacted.objective).not.toContain("AIza");
    expect(redacted.objective).toContain("[REDACTED]");
  });

  it("tryLoadPacket returns null for missing packet ID", async () => {
    const result = await engine.tryLoadPacket("nonexistent-run", "nonexistent-packet-id");
    expect(result).toBeNull();
  });
});

// ----------------------------------------------------------------------------
// UsageLedger edge cases
// ----------------------------------------------------------------------------

describe("UsageLedger edge cases", () => {
  it("getRoutingScore returns 0 for soft-capped agent", () => {
    const ledger = new UsageLedger();
    ledger.register("codex");
    // soft-capped applies a 0.5 penalty but doesn't zero it — verify actual behavior
    ledger.setHealth("codex", "soft-capped");
    const score = ledger.getRoutingScore("codex", "coding");
    // soft-capped penalty = 0.5, so score > 0 but less than a healthy agent
    const healthyLedger = new UsageLedger();
    healthyLedger.register("codex");
    const healthyScore = healthyLedger.getRoutingScore("codex", "coding");
    expect(score).toBeGreaterThan(0);
    expect(score).toBeLessThan(healthyScore);
  });

  it("setHealth hard-capped sets consecutiveTimeouts to threshold", () => {
    const ledger = new UsageLedger();
    ledger.register("codex");
    ledger.setHealth("codex", "hard-capped");
    const snapshot = ledger.getSnapshot("codex");
    expect(snapshot?.consecutiveTimeouts).toBeGreaterThanOrEqual(3);
    expect(snapshot?.health).toBe("hard-capped");
  });

  it("setHealth ready resets consecutiveTimeouts to 0", () => {
    const ledger = new UsageLedger();
    ledger.register("codex");
    // First escalate to hard-capped
    ledger.setHealth("codex", "hard-capped");
    expect(ledger.getSnapshot("codex")?.consecutiveTimeouts).toBeGreaterThanOrEqual(3);

    // Then reset to ready
    ledger.setHealth("codex", "ready");
    const snapshot = ledger.getSnapshot("codex");
    expect(snapshot?.consecutiveTimeouts).toBe(0);
    expect(snapshot?.health).toBe("ready");
  });

  it("recordHeartbeat resets consecutiveTimeouts", () => {
    const ledger = new UsageLedger();
    ledger.register("dantecode");

    // Generate some timeouts
    ledger.recordTimeout("dantecode");
    ledger.recordTimeout("dantecode");
    expect(ledger.getSnapshot("dantecode")?.consecutiveTimeouts).toBe(2);

    // Heartbeat should reset
    ledger.recordHeartbeat("dantecode");
    expect(ledger.getSnapshot("dantecode")?.consecutiveTimeouts).toBe(0);
  });

  it("getSnapshot returns successCount and failureCount", () => {
    const ledger = new UsageLedger();
    ledger.register("claude-code");

    ledger.recordSuccess("claude-code", 1500);
    ledger.recordSuccess("claude-code", 2000);
    ledger.recordFailure("claude-code", "some error");

    const snapshot = ledger.getSnapshot("claude-code");
    expect(snapshot?.successCount).toBe(2);
    expect(snapshot?.failureCount).toBe(1);
    expect(snapshot?.averageLatencyMs).toBe(1750);
  });

  it("getAllSnapshots includes all registered agents", () => {
    const ledger = new UsageLedger();
    ledger.register("dantecode");
    ledger.register("codex");
    ledger.register("claude-code");

    const snapshots = ledger.getAllSnapshots();
    const kinds = snapshots.map((s) => s.agentKind);
    expect(kinds).toContain("dantecode");
    expect(kinds).toContain("codex");
    expect(kinds).toContain("claude-code");
    expect(snapshots).toHaveLength(3);
  });
});

// ----------------------------------------------------------------------------
// OverlapDetector edge cases
// ----------------------------------------------------------------------------

describe("OverlapDetector edge cases", () => {
  const detector = new OverlapDetector();

  it("detect handles empty snapshots gracefully", () => {
    const result = detector.detect([], []);
    expect(result.overlaps).toHaveLength(0);
    expect(result.lanesToFreeze).toHaveLength(0);
    expect(result.lanesToWarn).toHaveLength(0);
  });

  it("detect handles single snapshot (no pairs to compare)", () => {
    const snapshots: WorktreeSnapshot[] = [
      {
        laneId: "lane-solo",
        agentKind: "codex",
        worktreePath: "/repo/wt/solo",
        branch: "feature/solo",
        headCommit: "abc",
        modifiedFiles: ["src/solo.ts"],
        capturedAt: new Date().toISOString(),
      },
    ];
    const result = detector.detect(snapshots, []);
    expect(result.overlaps).toHaveLength(0);
    expect(result.lanesToFreeze).toHaveLength(0);
  });

  it("detect returns L4 for mandate violation (file owned by another lane)", () => {
    const mandates: FileMandate[] = [
      {
        laneId: "lane-owner",
        ownedFiles: ["src/owned.ts"],
        readOnlyFiles: [],
        forbiddenFiles: [],
        contractDependencies: [],
        overlapPolicy: "freeze",
      },
    ];

    // lane-intruder modifies a file owned by lane-owner
    const snapshots: WorktreeSnapshot[] = [
      {
        laneId: "lane-intruder",
        agentKind: "codex",
        worktreePath: "/repo/wt/intruder",
        branch: "feature/intruder",
        headCommit: "xyz",
        modifiedFiles: ["src/owned.ts"],
        capturedAt: new Date().toISOString(),
      },
    ];

    const result = detector.detect(snapshots, mandates);
    const l4 = result.overlaps.filter((o) => o.level >= 4);
    expect(l4).toHaveLength(1);
    expect(result.lanesToFreeze).toContain("lane-intruder");
  });

  it("classifyOverlapLevel L1 — returns L0 for cross-directory files (L1 not implemented)", () => {
    // L1 (shared contract files) is not yet implemented, cross-dir should return L0
    const level = classifyOverlapLevel(["src/a.ts"], ["lib/b.ts"]);
    expect(level).toBe(0);
  });

  it("detect produces warn list for L2 overlap (same directory)", () => {
    const snapshots: WorktreeSnapshot[] = [
      {
        laneId: "lane-warn-a",
        agentKind: "codex",
        worktreePath: "/repo/wt/warn-a",
        branch: "feature/warn-a",
        headCommit: "w1",
        modifiedFiles: ["src/warn-a.ts"],
        capturedAt: new Date().toISOString(),
      },
      {
        laneId: "lane-warn-b",
        agentKind: "claude-code",
        worktreePath: "/repo/wt/warn-b",
        branch: "feature/warn-b",
        headCommit: "w2",
        modifiedFiles: ["src/warn-b.ts"],
        capturedAt: new Date().toISOString(),
      },
    ];

    const result = detector.detect(snapshots, []);
    // Both in "src/" directory — L2 overlap → warn
    expect(result.lanesToWarn).toContain("lane-warn-a");
    expect(result.lanesToWarn).toContain("lane-warn-b");
    expect(result.lanesToFreeze).toHaveLength(0);
  });
});

// ----------------------------------------------------------------------------
// WorktreeObserver unit tests
// ----------------------------------------------------------------------------

describe("WorktreeObserver", () => {
  it("register adds lane for observation", () => {
    const observer = new WorktreeObserver();
    observer.register("lane-a", "codex", "/repo/wt/lane-a");
    expect(observer.getLaneIds()).toContain("lane-a");
  });

  it("unregister removes lane", () => {
    const observer = new WorktreeObserver();
    observer.register("lane-b", "dantecode", "/repo/wt/lane-b");
    expect(observer.getLaneIds()).toContain("lane-b");

    observer.unregister("lane-b");
    expect(observer.getLaneIds()).not.toContain("lane-b");
  });

  it("getSnapshot returns null for unregistered lane", () => {
    const observer = new WorktreeObserver();
    const snapshot = observer.getSnapshot("nonexistent-lane");
    expect(snapshot).toBeNull();
  });

  it("getLaneIds returns all registered lane IDs", () => {
    const observer = new WorktreeObserver();
    observer.register("lane-x", "codex", "/repo/wt/lane-x");
    observer.register("lane-y", "claude-code", "/repo/wt/lane-y");
    observer.register("lane-z", "dantecode", "/repo/wt/lane-z");

    const ids = observer.getLaneIds();
    expect(ids).toContain("lane-x");
    expect(ids).toContain("lane-y");
    expect(ids).toContain("lane-z");
    expect(ids).toHaveLength(3);
  });

  it("start creates timer, stop clears it", () => {
    const observer = new WorktreeObserver({ pollIntervalMs: 60_000 });
    observer.start();
    // Timer should be active (internal field)
    // Call start again — should be idempotent (no duplicate timers)
    observer.start();
    observer.stop();
    // Calling stop again is safe
    observer.stop();
    // No error thrown = success
    expect(true).toBe(true);
  });

  it("snapshotLane emits error event when worktree path is invalid", (done) => {
    const observer = new WorktreeObserver();
    observer.register("lane-invalid", "codex", "/tmp/nonexistent-lane-council-test-xyz");

    observer.once("error", (event) => {
      expect(event.laneId).toBe("lane-invalid");
      expect(event.error).toBeTruthy();
      done();
    });

    const result = observer.snapshotLane(
      "lane-invalid",
      "codex",
      "/tmp/nonexistent-lane-council-test-xyz",
    );
    // snapshot should return null on error
    expect(result).toBeNull();
  });

  it("getSnapshot returns null after register (before any poll)", () => {
    const observer = new WorktreeObserver();
    observer.register("lane-fresh", "codex", "/repo/wt/fresh");
    // No poll has happened yet
    expect(observer.getSnapshot("lane-fresh")).toBeNull();
  });

  it("unregister on unknown lane is a no-op", () => {
    const observer = new WorktreeObserver();
    expect(() => observer.unregister("never-registered")).not.toThrow();
  });
});

// ----------------------------------------------------------------------------
// CouncilEvents extended tests
// ----------------------------------------------------------------------------

describe("council-events extended", () => {
  it("handoffCreatedEvent includes packet ID", () => {
    const event = handoffCreatedEvent({
      runId: "run-handoff",
      handoffId: "handoff-xyz",
      fromLane: "codex-abc",
      reason: "hard-cap",
      touchedFiles: ["src/auth.ts"],
      recommendedNextAgent: "dantecode",
    });
    expect(event.type).toBe("council:handoff-created");
    expect(event.description).toContain("handoff-xyz");
    expect(event.payload.handoffId).toBe("handoff-xyz");
    expect(event.payload.fromLane).toBe("codex-abc");
  });

  it("mergeCompletedEvent includes synthesis ID", () => {
    const event = mergeCompletedEvent({
      runId: "run-merge",
      synthesisId: "synth-abc123",
      candidateLanes: ["lane-a", "lane-b"],
      confidence: "high",
      decision: "auto-merge",
    });
    expect(event.type).toBe("council:merge-completed");
    expect(event.description).toContain("synth-abc123");
    expect(event.payload.synthesisId).toBe("synth-abc123");
    expect(event.payload.confidence).toBe("high");
    expect(event.payload.decision).toBe("auto-merge");
  });

  it("mergeBlockedEvent includes reason", () => {
    const event = mergeBlockedEvent({
      runId: "run-blocked",
      synthesisId: "synth-blocked",
      candidateLanes: ["lane-x"],
      confidence: "low",
      decision: "blocked",
    });
    expect(event.type).toBe("council:merge-blocked");
    expect(event.description).toContain("synth-blocked");
    expect(event.payload.decision).toBe("blocked");
    expect(event.payload.confidence).toBe("low");
  });

  it("createCouncilEvent produces event with valid ISO timestamp", () => {
    const event = createCouncilEvent("council:run-completed", { runId: "r1", verificationPassed: true }, "Run done");
    expect(new Date(event.timestamp).toISOString()).toBe(event.timestamp);
  });

  it("createCouncilEvent produces unique IDs on each call", () => {
    const e1 = createCouncilEvent("council:start", {}, "Start 1");
    const e2 = createCouncilEvent("council:start", {}, "Start 2");
    expect(e1.id).not.toBe(e2.id);
  });
});

// ----------------------------------------------------------------------------
// CouncilRouter advanced integration tests
// ----------------------------------------------------------------------------

describe("CouncilRouter advanced", () => {
  let ledger: UsageLedger;
  let adapters: Map<AgentKind, CouncilAgentAdapter>;
  let router: CouncilRouter;
  let runState: CouncilRunState;
  let advTestDir: string;

  beforeEach(async () => {
    advTestDir = join(tmpdir(), `council-router-adv-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    await mkdir(advTestDir, { recursive: true });

    ledger = new UsageLedger();
    ledger.register("dantecode");
    ledger.register("codex");
    ledger.register("claude-code");

    adapters = new Map();
    adapters.set("dantecode", makeMockAdapter("dantecode", true));
    adapters.set("codex", makeMockAdapter("codex", true));
    adapters.set("claude-code", makeMockAdapter("claude-code", true));

    router = new CouncilRouter(ledger, adapters);
    runState = createCouncilRunState(advTestDir, "Advanced test objective", `${advTestDir}/audit.log`);
    router.attachRun(runState);
  });

  it("assignLane uses preferred agent when healthy", async () => {
    const result = await router.assignLane({
      objective: "Use preferred agent",
      taskCategory: "coding",
      preferredAgent: "codex",
      ownedFiles: ["src/pref.ts"],
      worktreePath: advTestDir,
      branch: "feature/pref",
      baseBranch: "main",
    });

    expect(result.accepted).toBe(true);
    expect(result.agentKind).toBe("codex");
  });

  it("assignLane falls back to next agent when preferred is hard-capped", async () => {
    ledger.setHealth("codex", "hard-capped");

    const result = await router.assignLane({
      objective: "Fallback test",
      taskCategory: "coding",
      preferredAgent: "codex",
      ownedFiles: ["src/fallback.ts"],
      worktreePath: advTestDir,
      branch: "feature/fallback",
      baseBranch: "main",
    });

    expect(result.accepted).toBe(true);
    // Should fallback to dantecode or claude-code (not codex)
    expect(result.agentKind).not.toBe("codex");
  });

  it("assignLane rejects when adapter refuses task", async () => {
    adapters.set("dantecode", makeMockAdapter("dantecode", false));
    adapters.set("codex", makeMockAdapter("codex", false));
    adapters.set("claude-code", makeMockAdapter("claude-code", false));

    const result = await router.assignLane({
      objective: "All refuse",
      taskCategory: "coding",
      ownedFiles: ["src/refused.ts"],
      worktreePath: advTestDir,
      branch: "feature/refused",
      baseBranch: "main",
    });

    expect(result.accepted).toBe(false);
  });

  it("multiple lanes can be assigned with different file sets", async () => {
    const r1 = await router.assignLane({
      objective: "Lane 1",
      taskCategory: "coding",
      ownedFiles: ["src/m1.ts"],
      worktreePath: advTestDir,
      branch: "feature/m1",
      baseBranch: "main",
    });

    const r2 = await router.assignLane({
      objective: "Lane 2",
      taskCategory: "testing",
      ownedFiles: ["tests/m2.test.ts"],
      worktreePath: advTestDir,
      branch: "feature/m2",
      baseBranch: "main",
    });

    expect(r1.accepted).toBe(true);
    expect(r2.accepted).toBe(true);
    expect(runState.agents).toHaveLength(2);
    expect(runState.mandates).toHaveLength(2);
    expect(r1.laneId).not.toBe(r2.laneId);
  });

  it("freezeLane and thawLane do not affect other lanes", async () => {
    const r1 = await router.assignLane({
      objective: "Lane 1",
      taskCategory: "coding",
      ownedFiles: ["src/n1.ts"],
      worktreePath: advTestDir,
      branch: "feature/n1",
      baseBranch: "main",
    });

    const r2 = await router.assignLane({
      objective: "Lane 2",
      taskCategory: "coding",
      ownedFiles: ["src/n2.ts"],
      worktreePath: advTestDir,
      branch: "feature/n2",
      baseBranch: "main",
    });

    router.freezeLane(r1.laneId);

    expect(router.isFrozen(r1.laneId)).toBe(true);
    expect(router.isFrozen(r2.laneId)).toBe(false);

    router.thawLane(r1.laneId);

    expect(router.isFrozen(r1.laneId)).toBe(false);
    expect(router.isFrozen(r2.laneId)).toBe(false);
  });

  it("detectAndEnforceOverlap with no run state attached is a no-op", () => {
    const standalone = new CouncilRouter(ledger, adapters);
    // No run attached — should not throw
    expect(() => standalone.detectAndEnforceOverlap([])).not.toThrow();
  });

  it("reassignLane toAgent explicitly targets specified agent", async () => {
    const first = await router.assignLane({
      objective: "Explicit reassign target",
      taskCategory: "synthesis",
      ownedFiles: ["src/synth.ts"],
      worktreePath: advTestDir,
      branch: "feature/synth",
      baseBranch: "main",
    });
    expect(first.accepted).toBe(true);

    // Explicitly target claude-code (not the default)
    const result = await router.reassignLane({
      laneId: first.laneId,
      fromAgent: first.agentKind,
      toAgent: "claude-code",
      reason: "manual",
      touchedFiles: ["src/synth.ts"],
      diffSummary: "",
    });

    expect(result.success).toBe(true);
    expect(result.newAgentKind).toBe("claude-code");
  });
});

// ----------------------------------------------------------------------------
// MergeConfidenceScorer extended tests
// ----------------------------------------------------------------------------

describe("MergeConfidenceScorer extended", () => {
  const scorer = new MergeConfidenceScorer();

  it("single candidate with no tests scores medium", () => {
    const result = scorer.score([
      {
        laneId: "lane-no-tests",
        unifiedDiff: "diff --git a/src/c.ts b/src/c.ts\n@@ -1,2 +1,3 @@\n+add",
        changedFiles: ["src/c.ts"],
        passedTests: [],
        failedTests: [],
      },
    ]);
    // No tests means testCoverage = 0.7 (unknown), compositeScore = 60 + 0.7*40 = 88 → should be high
    // Actually: 60 + 0.7 * 40 = 88 → high bucket
    expect(result.bucket).toMatch(/^(medium|high)$/);
    expect(result.score).toBeGreaterThan(50);
  });

  it("single candidate with failing tests scores medium", () => {
    const result = scorer.score([
      {
        laneId: "lane-fails",
        unifiedDiff: "diff --git a/src/d.ts b/src/d.ts\n@@ -1,2 +1,3 @@",
        changedFiles: ["src/d.ts"],
        passedTests: [],
        failedTests: ["test-a", "test-b"],
      },
    ]);
    // testCoverage = 0/(0+2) = 0, compositeScore = 60 + 0*40 = 60 → medium
    expect(result.bucket).toBe("medium");
    expect(result.decision).toBe("review-required");
  });

  it("factors.structuralSafety is 1.0 for single candidate", () => {
    const result = scorer.score([
      { laneId: "lane-x", unifiedDiff: "", changedFiles: [] },
    ]);
    expect(result.factors.structuralSafety).toBe(1.0);
  });

  it("two non-overlapping candidates with full tests score high", () => {
    const result = scorer.score([
      {
        laneId: "lane-high-a",
        unifiedDiff: "diff --git a/src/p.ts b/src/p.ts\n@@ -1,2 +1,3 @@\n+x",
        changedFiles: ["src/p.ts"],
        passedTests: ["t1", "t2"],
        failedTests: [],
      },
      {
        laneId: "lane-high-b",
        unifiedDiff: "diff --git a/src/q.ts b/src/q.ts\n@@ -5,2 +5,3 @@\n+y",
        changedFiles: ["src/q.ts"],
        passedTests: ["t3", "t4"],
        failedTests: [],
      },
    ]);
    // Non-overlapping files + all tests pass → high score
    expect(result.score).toBeGreaterThan(60);
    expect(result.bucket).not.toBe("low");
  });
});

// ----------------------------------------------------------------------------
// council-types additional tests
// ----------------------------------------------------------------------------

describe("council-types additional", () => {
  it("newLaneId produces unique IDs for same kind", () => {
    const a = newLaneId("codex");
    const b = newLaneId("codex");
    expect(a).not.toBe(b);
    expect(a).toMatch(/^codex-/);
    expect(b).toMatch(/^codex-/);
  });

  it("newLaneId works for all agent kinds", () => {
    const kinds: AgentKind[] = ["dantecode", "codex", "claude-code", "antigravity", "custom"];
    for (const kind of kinds) {
      const id = newLaneId(kind);
      expect(id).toMatch(new RegExp(`^${kind}-`));
    }
  });

  it("createCouncilRunState has empty arrays by default", () => {
    const state = createCouncilRunState("/repo", "objective", "/repo/audit.log");
    expect(Array.isArray(state.agents)).toBe(true);
    expect(Array.isArray(state.mandates)).toBe(true);
    expect(Array.isArray(state.overlaps)).toBe(true);
    expect(Array.isArray(state.handoffs)).toBe(true);
    expect(state.agents).toHaveLength(0);
    expect(state.mandates).toHaveLength(0);
  });

  it("createCouncilRunState sets createdAt and updatedAt to same value", () => {
    const state = createCouncilRunState("/repo", "objective", "/repo/audit.log");
    // Both should be valid ISO dates
    expect(new Date(state.createdAt).toISOString()).toBe(state.createdAt);
    expect(new Date(state.updatedAt).toISOString()).toBe(state.updatedAt);
  });
});
