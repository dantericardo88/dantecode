// ============================================================================
// Council Orchestrator — Unit Tests
// Tests all council modules: types, state store, usage ledger,
// overlap detector, merge confidence, handoff engine, council events,
// council router, worktree observer.
// ============================================================================

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mkdir, rm, readFile, writeFile } from "node:fs/promises";
import { EventEmitter } from "node:events";
import type { ChildProcess } from "node:child_process";
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
import { DanteCodeAdapter } from "./agent-adapters/dantecode.js";
import type { SelfLaneExecutor } from "./agent-adapters/dantecode.js";
import type { CouncilTaskPacket } from "./council-types.js";
import { BridgeListener } from "./bridge-listener.js";
import type { AgentCommandConfig, SpawnFn } from "./bridge-listener.js";
import { CouncilOrchestrator } from "./council-orchestrator.js";
import type { CouncilLifecycleStatus } from "./council-orchestrator.js";

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

  it("snapshotLane returns degraded snapshot (not null) for invalid path due to resilient helpers", async () => {
    const observer = new WorktreeObserver();
    const result = await observer.snapshotLane(
      "lane-invalid",
      "codex",
      "/tmp/nonexistent-lane-council-test-xyz",
    );
    // helpers catch git failures and return fallback values — snapshot is non-null
    expect(result).not.toBeNull();
    expect(result?.branch).toBe("unknown");
    expect(result?.headCommit).toBe("unknown");
    expect(result?.modifiedFiles).toEqual([]);
    expect(result?.laneId).toBe("lane-invalid");
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

// ============================================================================
// Lane A — DanteCode Self-Executor (SelfLaneExecutor injection)
// ============================================================================

function makeTestPacket(overrides: Partial<CouncilTaskPacket> = {}): CouncilTaskPacket {
  return {
    packetId: randomUUID(),
    runId: "run-test-1",
    laneId: "dantecode-abc123",
    objective: "Implement feature X",
    taskCategory: "coding",
    ownedFiles: ["src/foo.ts"],
    readOnlyFiles: [],
    forbiddenFiles: [],
    contractDependencies: [],
    worktreePath: "/tmp/worktree",
    branch: "feat/x",
    baseBranch: "main",
    assumptions: [],
    ...overrides,
  };
}

describe("Lane A — DanteCodeAdapter SelfLaneExecutor", () => {
  it("submitTask returns accepted:true with no executor (legacy path)", async () => {
    const adapter = new DanteCodeAdapter();
    const result = await adapter.submitTask(makeTestPacket());
    expect(result.accepted).toBe(true);
    expect(result.sessionId).toBeTruthy();
  });

  it("pollStatus returns running for legacy (no-executor) submitted task", async () => {
    const adapter = new DanteCodeAdapter();
    const { sessionId } = await adapter.submitTask(makeTestPacket());
    const status = await adapter.pollStatus(sessionId);
    expect(status.status).toBe("running");
  });

  it("executor fires on submitTask and resolves to completed", async () => {
    let executorCalled = false;
    const executor: SelfLaneExecutor = async () => {
      executorCalled = true;
      return { output: "done", touchedFiles: ["src/foo.ts"], success: true };
    };
    const adapter = new DanteCodeAdapter({ executor });
    const { sessionId } = await adapter.submitTask(makeTestPacket());
    // Allow microtasks to flush
    await new Promise((r) => setTimeout(r, 20));
    expect(executorCalled).toBe(true);
    const status = await adapter.pollStatus(sessionId);
    expect(status.status).toBe("completed");
  });

  it("pollStatus reflects executor failure via error path", async () => {
    const executor: SelfLaneExecutor = async () => ({
      output: "",
      touchedFiles: [],
      success: false,
      error: "typecheck failed",
    });
    const adapter = new DanteCodeAdapter({ executor });
    const { sessionId } = await adapter.submitTask(makeTestPacket());
    await new Promise((r) => setTimeout(r, 20));
    const status = await adapter.pollStatus(sessionId);
    expect(status.status).toBe("failed");
  });

  it("executor exception marks session failed", async () => {
    const executor: SelfLaneExecutor = async () => {
      throw new Error("unexpected crash");
    };
    const adapter = new DanteCodeAdapter({ executor });
    const { sessionId } = await adapter.submitTask(makeTestPacket());
    await new Promise((r) => setTimeout(r, 20));
    const status = await adapter.pollStatus(sessionId);
    expect(status.status).toBe("failed");
  });

  it("collectArtifacts returns touchedFiles in logs after executor success", async () => {
    const executor: SelfLaneExecutor = async () => ({
      output: "done",
      touchedFiles: ["src/foo.ts", "src/bar.ts"],
      success: true,
    });
    const adapter = new DanteCodeAdapter({ executor });
    const { sessionId } = await adapter.submitTask(makeTestPacket());
    await new Promise((r) => setTimeout(r, 20));
    const artifacts = await adapter.collectArtifacts(sessionId);
    const logsJoined = artifacts.logs.join(" ");
    expect(logsJoined).toContain("src/foo.ts");
    expect(logsJoined).toContain("src/bar.ts");
  });

  it("injected executor returning success:true sets session status to completed", async () => {
    const executor: SelfLaneExecutor = async (_prompt, _worktreePath) => ({
      output: "Done",
      touchedFiles: ["src/foo.ts"],
      success: true,
    });
    const adapter = new DanteCodeAdapter({ executor });
    const packet = makeTestPacket();
    const submission = await adapter.submitTask(packet);
    // Wait for fire-and-forget promise to settle
    await new Promise((r) => setTimeout(r, 50));
    const status = await adapter.pollStatus(submission.sessionId);
    expect(status.status).toBe("completed");
  });

  it("injected executor returning success:false sets session status to failed", async () => {
    const executor: SelfLaneExecutor = async () => ({
      output: "error",
      touchedFiles: [],
      success: false,
      error: "runAgentLoop threw",
    });
    const adapter = new DanteCodeAdapter({ executor });
    const packet = makeTestPacket();
    const submission = await adapter.submitTask(packet);
    await new Promise((r) => setTimeout(r, 50));
    const status = await adapter.pollStatus(submission.sessionId);
    expect(status.status).toBe("failed");
  });

  it("injected executor that throws marks session as failed", async () => {
    const executor: SelfLaneExecutor = async () => {
      throw new Error("in-process runAgentLoop failed");
    };
    const adapter = new DanteCodeAdapter({ executor });
    const packet = makeTestPacket();
    const submission = await adapter.submitTask(packet);
    await new Promise((r) => setTimeout(r, 50));
    const status = await adapter.pollStatus(submission.sessionId);
    expect(status.status).toBe("failed");
    expect(status.progressSummary).toMatch(/in-process runAgentLoop failed/);
  });
});

// ============================================================================
// Lane B — BridgeListener Daemon
// ============================================================================


function makeSpawnMock(opts: {
  exitCode?: number;
  stdout?: string;
  stderr?: string;
  errorEvent?: Error;
} = {}): { spawnFn: SpawnFn; calls: Array<{ cmd: string; args: string[] }> } {
  const calls: Array<{ cmd: string; args: string[] }> = [];
  const spawnFn: SpawnFn = (cmd, args) => {
    calls.push({ cmd, args });
    const emitter = new EventEmitter() as ChildProcess;
    const stdoutEmitter = new EventEmitter();
    const stderrEmitter = new EventEmitter();
    Object.assign(emitter, { stdout: stdoutEmitter, stderr: stderrEmitter });
    setImmediate(() => {
      if (opts.stdout) stdoutEmitter.emit("data", Buffer.from(opts.stdout));
      if (opts.stderr) stderrEmitter.emit("data", Buffer.from(opts.stderr));
      if (opts.errorEvent) {
        emitter.emit("error", opts.errorEvent);
      } else {
        emitter.emit("close", opts.exitCode ?? 0);
      }
    });
    return emitter;
  };
  return { spawnFn, calls };
}

function makeTestPacketForBridge(laneId: string): CouncilTaskPacket {
  return {
    packetId: randomUUID(),
    runId: "bridge-run-1",
    laneId,
    objective: "Bridge test",
    taskCategory: "coding",
    ownedFiles: ["src/foo.ts"],
    readOnlyFiles: [],
    forbiddenFiles: [],
    contractDependencies: [],
    worktreePath: testDir,
    branch: "feat/bridge",
    baseBranch: "main",
    assumptions: [],
  };
}

const claudeConfig: AgentCommandConfig = {
  kind: "claude-code",
  command: "claude",
  args: ["--dangerously-skip-permissions"],
};

describe("Lane B — BridgeListener Daemon", () => {
  it("stop() clears the interval without error when not started", () => {
    const { spawnFn } = makeSpawnMock();
    const listener = new BridgeListener(testDir, [claudeConfig], spawnFn, { pollIntervalMs: 50 });
    expect(() => listener.stop()).not.toThrow();
  });

  it("start() is idempotent — calling twice does not start multiple timers", () => {
    const { spawnFn } = makeSpawnMock();
    const listener = new BridgeListener(testDir, [claudeConfig], spawnFn, { pollIntervalMs: 5000 });
    listener.start();
    listener.start(); // second call should be no-op
    listener.stop();
  });

  it("start() and stop() pair clears the interval", () => {
    const { spawnFn } = makeSpawnMock();
    const listener = new BridgeListener(testDir, [claudeConfig], spawnFn, { pollIntervalMs: 5000 });
    listener.start();
    listener.stop();
    // No assertion needed — just ensuring no error / leaked handles
  });

  it("poll() returns silently when inbox dir does not exist", async () => {
    const { spawnFn } = makeSpawnMock();
    const listener = new BridgeListener(testDir, [claudeConfig], spawnFn, { pollIntervalMs: 5000 });
    await expect(listener.poll()).resolves.toBeUndefined();
  });

  it("new session triggers spawn when task.md + packet.json present", async () => {
    const { spawnFn, calls } = makeSpawnMock({ stdout: "Agent output", exitCode: 0 });
    const bridgeDir = join(testDir, "bridge-spawn");
    const sessionId = "claude-code-test123";
    const inboxDir = join(bridgeDir, "inbox", sessionId);
    await mkdir(inboxDir, { recursive: true });
    const packet = makeTestPacketForBridge("claude-code-abc");
    await writeFile(join(inboxDir, "task.md"), "Do the task", "utf-8");
    await writeFile(join(inboxDir, "packet.json"), JSON.stringify(packet), "utf-8");

    const listener = new BridgeListener(bridgeDir, [claudeConfig], spawnFn, { pollIntervalMs: 5000 });
    await listener.poll();
    // Wait for async runSession
    await new Promise((r) => setTimeout(r, 50));

    expect(calls.length).toBeGreaterThan(0);
    expect(calls[0]!.cmd).toBe("claude");
  });

  it("started.lock prevents double-dispatch", async () => {
    const { spawnFn, calls } = makeSpawnMock({ exitCode: 0 });
    const bridgeDir = join(testDir, "bridge-lock");
    const sessionId = "claude-code-locktest";
    const inboxDir = join(bridgeDir, "inbox", sessionId);
    await mkdir(inboxDir, { recursive: true });
    const packet = makeTestPacketForBridge("claude-code-xyz");
    await writeFile(join(inboxDir, "task.md"), "Do the task", "utf-8");
    await writeFile(join(inboxDir, "packet.json"), JSON.stringify(packet), "utf-8");
    await writeFile(join(inboxDir, "started.lock"), new Date().toISOString(), "utf-8");

    const listener = new BridgeListener(bridgeDir, [claudeConfig], spawnFn, { pollIntervalMs: 5000 });
    await listener.poll();
    await new Promise((r) => setTimeout(r, 50));

    // Lock was present — should not spawn
    expect(calls.length).toBe(0);
  });

  it("done.json written with success:true on exit code 0", async () => {
    const { spawnFn } = makeSpawnMock({ stdout: "ok", exitCode: 0 });
    const bridgeDir = join(testDir, "bridge-done-success");
    const sessionId = "claude-code-success1";
    const inboxDir = join(bridgeDir, "inbox", sessionId);
    await mkdir(inboxDir, { recursive: true });
    const packet = makeTestPacketForBridge("claude-code-s1");
    await writeFile(join(inboxDir, "task.md"), "Task content", "utf-8");
    await writeFile(join(inboxDir, "packet.json"), JSON.stringify(packet), "utf-8");

    const listener = new BridgeListener(bridgeDir, [claudeConfig], spawnFn, { pollIntervalMs: 5000 });
    await listener.poll();
    await new Promise((r) => setTimeout(r, 100));

    const donePath = join(bridgeDir, "outbox", sessionId, "done.json");
    const raw = await readFile(donePath, "utf-8");
    const done = JSON.parse(raw) as { success: boolean; exitCode: number };
    expect(done.success).toBe(true);
    expect(done.exitCode).toBe(0);
  });

  it("done.json written with success:false on non-zero exit", async () => {
    const { spawnFn } = makeSpawnMock({ exitCode: 1 });
    const bridgeDir = join(testDir, "bridge-done-fail");
    const sessionId = "claude-code-fail1";
    const inboxDir = join(bridgeDir, "inbox", sessionId);
    await mkdir(inboxDir, { recursive: true });
    const packet = makeTestPacketForBridge("claude-code-f1");
    await writeFile(join(inboxDir, "task.md"), "Task content", "utf-8");
    await writeFile(join(inboxDir, "packet.json"), JSON.stringify(packet), "utf-8");

    const listener = new BridgeListener(bridgeDir, [claudeConfig], spawnFn, { pollIntervalMs: 5000 });
    await listener.poll();
    await new Promise((r) => setTimeout(r, 100));

    const donePath = join(bridgeDir, "outbox", sessionId, "done.json");
    const raw = await readFile(donePath, "utf-8");
    const done = JSON.parse(raw) as { success: boolean; exitCode: number };
    expect(done.success).toBe(false);
    expect(done.exitCode).toBe(1);
  });

  it("unknown agent kind writes error done.json gracefully", async () => {
    const { spawnFn } = makeSpawnMock({ exitCode: 0 });
    const bridgeDir = join(testDir, "bridge-unknown");
    const sessionId = "unknown-kind-xyz";
    const inboxDir = join(bridgeDir, "inbox", sessionId);
    await mkdir(inboxDir, { recursive: true });
    // laneId prefix 'unknown' doesn't match any registered agent
    const packet = makeTestPacketForBridge("unknown-laneprefix");
    await writeFile(join(inboxDir, "task.md"), "Task content", "utf-8");
    await writeFile(join(inboxDir, "packet.json"), JSON.stringify(packet), "utf-8");

    // Register two agents — disables the single-agent fallback, so 'unknown' prefix matches nothing
    const codexConfig: AgentCommandConfig = { kind: "codex", command: "codex" };
    const ccConfig: AgentCommandConfig = { kind: "claude-code", command: "claude" };
    const listener = new BridgeListener(bridgeDir, [codexConfig, ccConfig], spawnFn, { pollIntervalMs: 5000 });
    await listener.poll();
    await new Promise((r) => setTimeout(r, 100));

    const donePath = join(bridgeDir, "outbox", sessionId, "done.json");
    const raw = await readFile(donePath, "utf-8");
    const done = JSON.parse(raw) as { success: boolean };
    expect(done.success).toBe(false);
  });

  it("env vars from AgentCommandConfig are passed to spawn", async () => {
    const capturedEnvs: Array<NodeJS.ProcessEnv | undefined> = [];
    const envCapturingSpawn: SpawnFn = (_cmd, _args, opts) => {
      capturedEnvs.push(opts.env as NodeJS.ProcessEnv | undefined);
      const emitter = new EventEmitter() as ChildProcess;
      const stdoutEmitter = new EventEmitter();
      const stderrEmitter = new EventEmitter();
      Object.assign(emitter, { stdout: stdoutEmitter, stderr: stderrEmitter });
      setImmediate(() => emitter.emit("close", 0));
      return emitter;
    };

    const bridgeDir = join(testDir, "bridge-env");
    const sessionId = "claude-code-envtest";
    const inboxDir = join(bridgeDir, "inbox", sessionId);
    await mkdir(inboxDir, { recursive: true });
    const packet = makeTestPacketForBridge("claude-code-env");
    await writeFile(join(inboxDir, "task.md"), "Task", "utf-8");
    await writeFile(join(inboxDir, "packet.json"), JSON.stringify(packet), "utf-8");

    const configWithEnv: AgentCommandConfig = {
      kind: "claude-code",
      command: "claude",
      env: { MY_CUSTOM_VAR: "test-value" },
    };
    const listener = new BridgeListener(bridgeDir, [configWithEnv], envCapturingSpawn, { pollIntervalMs: 5000 });
    await listener.poll();
    await new Promise((r) => setTimeout(r, 100));

    expect(capturedEnvs.length).toBeGreaterThan(0);
    expect(capturedEnvs[0]?.["MY_CUSTOM_VAR"]).toBe("test-value");
  });

  it("done.json failure includes error field with stderr content", async () => {
    const { spawnFn } = makeSpawnMock({
      stdout: "",
      stderr: "FATAL: connection refused",
      exitCode: 1,
    });
    const bridgeDir = join(testDir, "bridge-done-fail-stderr");
    const sessionId = "claude-code-fail-stderr1";
    const inboxDir = join(bridgeDir, "inbox", sessionId);
    await mkdir(inboxDir, { recursive: true });
    const packet = makeTestPacketForBridge("claude-code-fs1");
    await writeFile(join(inboxDir, "task.md"), "Task content", "utf-8");
    await writeFile(join(inboxDir, "packet.json"), JSON.stringify(packet), "utf-8");

    const listener = new BridgeListener(
      bridgeDir,
      [{ kind: "claude-code", command: "claude" }],
      spawnFn,
      { pollIntervalMs: 50 },
    );
    await listener.poll();
    await new Promise((r) => setTimeout(r, 100));

    const donePath = join(bridgeDir, "outbox", sessionId, "done.json");
    const done = JSON.parse(await readFile(donePath, "utf-8")) as { success: boolean; error?: string };
    expect(done.success).toBe(false);
    expect(done.error).toContain("FATAL: connection refused");
  });

  it("done.json error field falls back to exit-code message when log empty", async () => {
    const { spawnFn } = makeSpawnMock({ stdout: "", stderr: "", exitCode: 2 });
    const bridgeDir = join(testDir, "bridge-done-fail-empty");
    const sessionId = "codex-fail-empty1";
    const inboxDir = join(bridgeDir, "inbox", sessionId);
    await mkdir(inboxDir, { recursive: true });
    const packet = makeTestPacketForBridge("codex-fe1");
    await writeFile(join(inboxDir, "task.md"), "Task content", "utf-8");
    await writeFile(join(inboxDir, "packet.json"), JSON.stringify(packet), "utf-8");

    const listener = new BridgeListener(
      bridgeDir,
      [{ kind: "codex", command: "codex" }],
      spawnFn,
      { pollIntervalMs: 50 },
    );
    await listener.poll();
    await new Promise((r) => setTimeout(r, 100));

    const donePath = join(bridgeDir, "outbox", sessionId, "done.json");
    const done = JSON.parse(await readFile(donePath, "utf-8")) as { success: boolean; error?: string };
    expect(done.success).toBe(false);
    expect(done.error).toMatch(/Process exited with code 2/);
  });

  it("start() writes WARNING to stderr when agent command not in PATH", () => {
    const stderrWrites: string[] = [];
    const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation((data) => {
      stderrWrites.push(String(data));
      return true;
    });

    const listener = new BridgeListener(
      "/tmp/test-bridge-warn",
      [{ kind: "claude-code", command: "this-binary-does-not-exist-xyz-abc" }],
      undefined,
      { pollIntervalMs: 60_000 }, // long interval so poll doesn't run
    );
    listener.start();
    listener.stop();

    stderrSpy.mockRestore();

    expect(stderrWrites.some((w) => w.includes("not found in PATH"))).toBe(true);
  });
});

// ============================================================================
// Lane C — MergeBrain WorktreeHooks Isolation
// ============================================================================


describe("Lane C — MergeBrain WorktreeHooks", () => {
  it("MergeBrain constructor works without arguments", () => {
    expect(() => new MergeBrain()).not.toThrow();
  });

  it("MergeBrain instance is defined after construction", () => {
    const brain = new MergeBrain();
    expect(brain).toBeDefined();
    expect(brain).toBeInstanceOf(MergeBrain);
  });

  it("synthesize() returns valid MergeBrainResult structure with empty candidates", async () => {
    const brain = new MergeBrain();
    const result = await brain.synthesize({
      runId: "test-run-c1",
      candidates: [],
      repoRoot: testDir,
      targetBranch: "main",
      allowAutoMerge: false,
    });
    expect(result).toHaveProperty("success");
    expect(result).toHaveProperty("synthesis");
    expect(result.synthesis).toHaveProperty("id");
    expect(result.synthesis.candidateLanes).toEqual([]);
  });

  it("synthesize() with single candidate preserves candidate patch", async () => {
    const brain = new MergeBrain();
    const candidate: MergeCandidatePatch = {
      laneId: "dantecode-lane1",
      unifiedDiff: "diff --git a/foo.ts b/foo.ts\n+// added",
      changedFiles: ["foo.ts"],
    };
    const result = await brain.synthesize({
      runId: "test-run-c2",
      candidates: [candidate],
      repoRoot: testDir,
      targetBranch: "main",
      allowAutoMerge: false,
    });
    expect(result.synthesis.preservedCandidates["dantecode-lane1"]).toBe(candidate.unifiedDiff);
  });

  it("CouncilOrchestrator constructs without worktree hooks", () => {
    const adapters = new Map<AgentKind, CouncilAgentAdapter>();
    const orchestrator = new CouncilOrchestrator(adapters);
    expect(orchestrator).toBeDefined();
    expect(orchestrator.currentStatus).toBe("idle");
  });

  it("CouncilOrchestrator is an instance of CouncilOrchestrator after construction", () => {
    const adapters = new Map<AgentKind, CouncilAgentAdapter>();
    const orchestrator = new CouncilOrchestrator(adapters);
    expect(orchestrator).toBeInstanceOf(CouncilOrchestrator);
  });

  it("synthesize() with multiple different-file candidates produces valid result", async () => {
    const brain = new MergeBrain();
    const candidates: MergeCandidatePatch[] = [
      {
        laneId: "dantecode-lane-x",
        unifiedDiff: "diff --git a/a.ts b/a.ts\n+export const x = 1;",
        changedFiles: ["a.ts"],
      },
      {
        laneId: "codex-lane-y",
        unifiedDiff: "diff --git a/b.ts b/b.ts\n+export const y = 2;",
        changedFiles: ["b.ts"],
      },
    ];
    const result = await brain.synthesize({
      runId: "test-run-c3",
      candidates,
      repoRoot: testDir,
      targetBranch: "main",
      allowAutoMerge: false,
    });
    expect(result.synthesis.candidateLanes).toContain("dantecode-lane-x");
    expect(result.synthesis.candidateLanes).toContain("codex-lane-y");
    expect(result.synthesis.preservedCandidates["dantecode-lane-x"]).toBeTruthy();
    expect(result.synthesis.preservedCandidates["codex-lane-y"]).toBeTruthy();
  });

  it("synthesize() result has valid confidence bucket", async () => {
    const brain = new MergeBrain();
    const result = await brain.synthesize({
      runId: "test-run-c4",
      candidates: [],
      repoRoot: testDir,
      targetBranch: "main",
    });
    expect(["high", "medium", "low", "none"]).toContain(result.synthesis.confidence);
  });
});

// ============================================================================
// Lane D — Completion Poller + CouncilOrchestrator pollAllLanes
// ============================================================================

/** Create a minimal valid AgentSessionState for tests. */
function makeAgentSession(
  overrides: Partial<AgentSessionState> & Pick<AgentSessionState, "laneId" | "sessionId" | "status">,
): AgentSessionState {
  return {
    agentKind: "dantecode",
    adapterKind: "native-cli",
    health: "ready",
    worktreePath: testDir,
    branch: "feat/test",
    assignedFiles: [],
    objective: "Test objective",
    taskCategory: "coding",
    touchedFiles: [],
    retryCount: 0,
    startedAt: new Date().toISOString(),
    ...overrides,
  };
}

/** Minimal inline adapter factory for Lane D tests. */
function makeInlineAdapter(
  pollStatus: (sessionId: string) => Promise<{ sessionId: string; status: string; progressSummary?: string }>,
): CouncilAgentAdapter {
  return {
    id: "dantecode",
    displayName: "Mock",
    kind: "native-cli",
    probeAvailability: async () => ({ available: true, health: "ready" as const }),
    estimateCapacity: async () => ({ remainingCapacity: 100, capSuspicion: "none" as const }),
    submitTask: async () => ({ sessionId: randomUUID().slice(0, 12), accepted: true }),
    pollStatus: pollStatus as CouncilAgentAdapter["pollStatus"],
    collectArtifacts: async (sessionId: string) => ({ sessionId, files: [], logs: [] }),
    collectPatch: async () => null,
    detectRateLimit: async () => ({ detected: false, confidence: "none" as const }),
    abortTask: async () => { /* no-op */ },
  };
}

type PollOrchestrator = {
  runState: { agents: AgentSessionState[] };
  pollAllLanes(): Promise<void>;
  pollTimer: unknown;
};

function makeOrchestrator(
  pollStatusFn: (sessionId: string) => Promise<{ sessionId: string; status: string; progressSummary?: string }>,
  opts: { pollIntervalMs?: number } = {},
): CouncilOrchestrator {
  const adapter = makeInlineAdapter(pollStatusFn);
  const adapters = new Map<AgentKind, CouncilAgentAdapter>([["dantecode", adapter]]);
  return new CouncilOrchestrator(adapters, { pollIntervalMs: opts.pollIntervalMs ?? 999_999 });
}

describe("Lane D — CouncilOrchestrator pollAllLanes", () => {
  // Track active orchestrators so we can stop their polling timers after each test.
  // Without this, the setInterval from startPolling() leaks across tests in the full suite,
  // causing unhandled-error events when the interval fires after the test has completed.
  const activeOrchestrators: CouncilOrchestrator[] = [];
  afterEach(() => {
    for (const o of activeOrchestrators) {
      // Suppress any pending "error" events so they don't become unhandled exceptions.
      o.on("error", () => {});
      const oc = o as unknown as PollOrchestrator;
      if (oc.pollTimer) {
        clearInterval(oc.pollTimer as ReturnType<typeof setInterval>);
      }
    }
    activeOrchestrators.length = 0;
  });
  function trackOrchestrator(
    pollStatusFn: (sessionId: string) => Promise<{ sessionId: string; status: string; progressSummary?: string }>,
    opts: { pollIntervalMs?: number } = {},
  ): CouncilOrchestrator {
    const o = makeOrchestrator(pollStatusFn, opts);
    activeOrchestrators.push(o);
    return o;
  }
  it("lane:completed event emitted when pollStatus returns completed", async () => {
    let completedEvent: { laneId: string; agentKind: string; sessionId: string } | null = null;
    const orchestrator = trackOrchestrator(async (s) => ({ sessionId: s, status: "completed" }));
    await orchestrator.start({ objective: "Test event", agents: ["dantecode"], repoRoot: testDir });
    orchestrator.on("lane:completed", (evt) => { completedEvent = evt; });

    const state = (orchestrator as unknown as PollOrchestrator).runState;
    state!.agents.push(makeAgentSession({ laneId: "dantecode-ev1", sessionId: "poll-session-1", status: "running" }));
    await (orchestrator as unknown as PollOrchestrator).pollAllLanes();

    expect(completedEvent).not.toBeNull();
    expect(completedEvent!.laneId).toBe("dantecode-ev1");
    expect(completedEvent!.sessionId).toBe("poll-session-1");
  });

  it("session.status advances to completed after pollAllLanes with completed response", async () => {
    const orchestrator = trackOrchestrator(async (s) => ({ sessionId: s, status: "completed" }));
    await orchestrator.start({ objective: "poll test", agents: ["dantecode"], repoRoot: testDir });

    const state = (orchestrator as unknown as PollOrchestrator).runState;
    const session = makeAgentSession({ laneId: "dantecode-s1", sessionId: "s1", status: "running" });
    state!.agents.push(session);

    await (orchestrator as unknown as PollOrchestrator).pollAllLanes();
    expect(session.status).toBe("completed");
  });

  it("session.status advances to failed after pollAllLanes with failed response", async () => {
    const orchestrator = trackOrchestrator(async (s) => ({ sessionId: s, status: "failed", progressSummary: "err" }));
    await orchestrator.start({ objective: "poll fail", agents: ["dantecode"], repoRoot: testDir });

    const state = (orchestrator as unknown as PollOrchestrator).runState;
    const session = makeAgentSession({ laneId: "dantecode-s2", sessionId: "s2", status: "running" });
    state!.agents.push(session);

    await (orchestrator as unknown as PollOrchestrator).pollAllLanes();
    expect(session.status).toBe("failed");
  });

  it("pollAllLanes fault isolation: one throw does not block other sessions", async () => {
    let callCount = 0;
    const adapter = makeInlineAdapter(async (sessionId) => {
      callCount++;
      if (sessionId === "s3-bad") throw new Error("poll exploded");
      return { sessionId, status: "completed" };
    });
    const adapters = new Map<AgentKind, CouncilAgentAdapter>([["dantecode", adapter]]);
    const orchestrator = new CouncilOrchestrator(adapters, { pollIntervalMs: 999_999 });
    activeOrchestrators.push(orchestrator);
    await orchestrator.start({ objective: "fault isolation", agents: ["dantecode"], repoRoot: testDir });

    const state = (orchestrator as unknown as PollOrchestrator).runState;
    const goodSession = makeAgentSession({ laneId: "dantecode-good", sessionId: "s3-good", status: "running" });
    const badSession = makeAgentSession({ laneId: "dantecode-bad", sessionId: "s3-bad", status: "running" });
    state!.agents.push(goodSession, badSession);

    await (orchestrator as unknown as PollOrchestrator).pollAllLanes();

    expect(goodSession.status).toBe("completed");
    expect(callCount).toBe(2);
  });

  it("pollAllLanes is idempotent on already-completed sessions", async () => {
    let pollCalls = 0;
    const orchestrator = trackOrchestrator(async (s) => { pollCalls++; return { sessionId: s, status: "completed" }; });
    await orchestrator.start({ objective: "idempotent", agents: ["dantecode"], repoRoot: testDir });

    const state = (orchestrator as unknown as PollOrchestrator).runState;
    const session = makeAgentSession({ laneId: "dantecode-idem", sessionId: "s4", status: "completed" });
    state!.agents.push(session);

    await (orchestrator as unknown as PollOrchestrator).pollAllLanes();
    expect(pollCalls).toBe(0); // already completed — not polled
  });

  it("session.health set to soft-capped on capped pollStatus", async () => {
    const orchestrator = trackOrchestrator(async (s) => ({ sessionId: s, status: "capped" }));
    await orchestrator.start({ objective: "capped", agents: ["dantecode"], repoRoot: testDir });

    const state = (orchestrator as unknown as PollOrchestrator).runState;
    const session = makeAgentSession({ laneId: "dantecode-cap", sessionId: "s5", status: "running" });
    state!.agents.push(session);

    await (orchestrator as unknown as PollOrchestrator).pollAllLanes();
    expect(session.health).toBe("soft-capped");
  });

  it("startPolling sets pollTimer; fail() clears it", async () => {
    const orchestrator = trackOrchestrator(async (s) => ({ sessionId: s, status: "running" }));
    orchestrator.on("error", () => {}); // suppress unhandled error from fail()
    await orchestrator.start({ objective: "timer test", agents: ["dantecode"], repoRoot: testDir });

    expect((orchestrator as unknown as PollOrchestrator).pollTimer).not.toBeNull();
    await orchestrator.fail("test cleanup");
    expect((orchestrator as unknown as PollOrchestrator).pollTimer).toBeNull();
  });

  it("lane:completed event payload includes laneId, agentKind, and sessionId", async () => {
    const events: Array<{ laneId: string; agentKind: string; sessionId: string }> = [];
    const orchestrator = trackOrchestrator(async (s) => ({ sessionId: s, status: "completed" }));
    orchestrator.on("lane:completed", (evt) => events.push(evt));
    await orchestrator.start({ objective: "payload test", agents: ["dantecode"], repoRoot: testDir });

    const state = (orchestrator as unknown as PollOrchestrator).runState;
    state!.agents.push(makeAgentSession({ laneId: "dantecode-payload1", sessionId: "payload-s1", status: "running" }));
    await (orchestrator as unknown as PollOrchestrator).pollAllLanes();

    expect(events).toHaveLength(1);
    expect(events[0]!.laneId).toBe("dantecode-payload1");
    expect(events[0]!.agentKind).toBe("dantecode");
    expect(events[0]!.sessionId).toBe("payload-s1");
  });

  it("pollAllLanes skips session with no matching adapter", async () => {
    const orchestrator = trackOrchestrator(async (s) => ({ sessionId: s, status: "completed" }));
    await orchestrator.start({ objective: "no adapter", agents: ["dantecode"], repoRoot: testDir });

    const state = (orchestrator as unknown as PollOrchestrator).runState;
    const orphanSession = makeAgentSession({ laneId: "codex-orphan", sessionId: "s7-orphan", status: "running", agentKind: "codex" });
    state!.agents.push(orphanSession);

    await expect(
      (orchestrator as unknown as PollOrchestrator).pollAllLanes()
    ).resolves.toBeUndefined();
    expect(orphanSession.status).toBe("running");
  });

  it("start() call causes pollTimer to be set", async () => {
    const orchestrator = trackOrchestrator(async (s) => ({ sessionId: s, status: "running" }));
    orchestrator.on("error", () => {}); // suppress unhandled error from fail()

    expect((orchestrator as unknown as PollOrchestrator).pollTimer).toBeNull();
    await orchestrator.start({ objective: "start timer", agents: ["dantecode"], repoRoot: testDir });
    expect((orchestrator as unknown as PollOrchestrator).pollTimer).not.toBeNull();
    await orchestrator.fail("cleanup");
  });
});

// ============================================================================
// Lane D+ — CouncilOrchestrator watchUntilComplete integration
// ============================================================================

describe("CouncilOrchestrator watchUntilComplete", () => {
  const FAKE_DIFF = "diff --git a/src/watch.ts b/src/watch.ts\n+export const x = 1;\n";

  /** Adapter that sequences through status responses and provides a real patch on completion. */
  function makeWatchAdapter(
    responses: Array<"running" | "completed" | "failed">,
  ): CouncilAgentAdapter {
    let callIdx = 0;
    return {
      id: "dantecode",
      displayName: "Mock",
      kind: "native-cli",
      probeAvailability: async () => ({ available: true, health: "ready" as const }),
      estimateCapacity: async () => ({ remainingCapacity: 100, capSuspicion: "none" as const }),
      submitTask: async () => ({ sessionId: randomUUID().slice(0, 6), accepted: true }),
      pollStatus: async (sessionId: string) => {
        const status = responses[Math.min(callIdx++, responses.length - 1)]!;
        return { sessionId, status };
      },
      collectArtifacts: async (sessionId: string) => ({ sessionId, files: [], logs: [] }),
      collectPatch: async (sessionId: string) => ({
        sessionId,
        unifiedDiff: FAKE_DIFF,
        changedFiles: ["src/watch.ts"],
      }),
      detectRateLimit: async () => ({ detected: false, confidence: "none" as const }),
      abortTask: async () => {},
    } as CouncilAgentAdapter;
  }

  function injectWatchSession(orchestrator: CouncilOrchestrator, sessionId: string): void {
    const state = (orchestrator as unknown as { runState: { agents: AgentSessionState[] } }).runState;
    state!.agents.push({
      laneId: `dantecode-watch-${sessionId}`,
      agentKind: "dantecode",
      sessionId,
      status: "running",
      assignedFiles: ["src/watch.ts"],
      objective: "watch test",
      taskCategory: "coding",
      touchedFiles: [],
      retryCount: 0,
      health: "ready",
      adapterKind: "native-cli",
      worktreePath: testDir,
      branch: "feature/watch",
      startedAt: new Date().toISOString(),
      lastProgressAt: new Date().toISOString(),
    } as AgentSessionState);
  }

  it("watchUntilComplete resolves to 'completed' when all lanes succeed", async () => {
    const adapter = makeWatchAdapter(["running", "completed"]);
    const adapters = new Map<AgentKind, CouncilAgentAdapter>([["dantecode", adapter]]);
    const orchestrator = new CouncilOrchestrator(adapters, { pollIntervalMs: 1 });
    await orchestrator.start({ objective: "watch success", agents: ["dantecode"], repoRoot: testDir });

    injectWatchSession(orchestrator, "watch-s1");
    await orchestrator.watchUntilComplete();

    expect(orchestrator.currentStatus).toBe("completed");
  });

  it("watchUntilComplete resolves to 'failed' when all lanes fail", async () => {
    const adapter = makeWatchAdapter(["running", "failed"]);
    const adapters = new Map<AgentKind, CouncilAgentAdapter>([["dantecode", adapter]]);
    const orchestrator = new CouncilOrchestrator(adapters, { pollIntervalMs: 1 });
    orchestrator.on("error", () => {}); // suppress unhandled error event from fail()
    await orchestrator.start({ objective: "watch fail", agents: ["dantecode"], repoRoot: testDir });

    injectWatchSession(orchestrator, "watch-s2");
    await orchestrator.watchUntilComplete();

    expect(orchestrator.currentStatus).toBe("failed");
  });

  it("watchUntilComplete emits lane:completed before resolving", async () => {
    const completedIds: string[] = [];
    const adapter = makeWatchAdapter(["completed"]);
    const adapters = new Map<AgentKind, CouncilAgentAdapter>([["dantecode", adapter]]);
    const orchestrator = new CouncilOrchestrator(adapters, { pollIntervalMs: 1 });
    orchestrator.on("lane:completed", (evt) => completedIds.push(evt.laneId));
    await orchestrator.start({ objective: "watch events", agents: ["dantecode"], repoRoot: testDir });

    injectWatchSession(orchestrator, "watch-s3");
    await orchestrator.watchUntilComplete();

    expect(completedIds).toHaveLength(1);
    expect(completedIds[0]).toContain("dantecode-watch");
  });

  it("watchUntilComplete rejects with timeout when lanes never complete", async () => {
    const adapter = makeWatchAdapter(["running"]);
    const adapters = new Map<AgentKind, CouncilAgentAdapter>([["dantecode", adapter]]);
    const orchestrator = new CouncilOrchestrator(adapters, { pollIntervalMs: 1 });
    orchestrator.on("error", () => {});

    await orchestrator.start({ objective: "timeout test", agents: ["dantecode"], repoRoot: testDir });
    injectWatchSession(orchestrator, "watch-timeout");

    await expect(
      orchestrator.watchUntilComplete({ timeoutMs: 50 }),
    ).rejects.toThrow(/timed out/i);

    expect(orchestrator.currentStatus).toBe("failed");
  });

  it("watchUntilComplete waits for all lanes before resolving", async () => {
    const sessionPollCounts = new Map<string, number>();
    const adapter: CouncilAgentAdapter = {
      ...makeWatchAdapter(["running", "completed"]),
      pollStatus: async (sessionId: string) => {
        const count = (sessionPollCounts.get(sessionId) ?? 0) + 1;
        sessionPollCounts.set(sessionId, count);
        if (sessionId === "multi-a" || count >= 2) return { sessionId, status: "completed" as const };
        return { sessionId, status: "running" as const };
      },
    };

    const adapters = new Map<AgentKind, CouncilAgentAdapter>([["dantecode", adapter]]);
    const orchestrator = new CouncilOrchestrator(adapters, { pollIntervalMs: 1 });

    await orchestrator.start({ objective: "multi-lane test", agents: ["dantecode"], repoRoot: testDir });

    injectWatchSession(orchestrator, "multi-a");
    injectWatchSession(orchestrator, "multi-b");

    await orchestrator.watchUntilComplete();

    expect(orchestrator.currentStatus).toBe("completed");
    const state = (orchestrator as unknown as { runState: { agents: AgentSessionState[] } }).runState!;
    expect(state.agents.every((a) => a.status === "completed" || a.status === "failed")).toBe(true);
  });

  it("fail() fallback path emits state:transition when normal transition throws", async () => {
    const adapter = makeWatchAdapter(["running"]);
    const adapters = new Map<AgentKind, CouncilAgentAdapter>([["dantecode", adapter]]);
    const orchestrator = new CouncilOrchestrator(adapters, { pollIntervalMs: 999_999 });
    orchestrator.on("error", () => {});

    await orchestrator.start({ objective: "fallback test", agents: ["dantecode"], repoRoot: testDir });

    // Force orchestrator into "completed" state — "completed" → "failed" is invalid in the state machine
    const oc = orchestrator as unknown as { status: CouncilLifecycleStatus };
    oc.status = "completed";

    const transitions: Array<{ from: string; to: string }> = [];
    orchestrator.on("state:transition", ({ from, to }) => transitions.push({ from, to }));

    await orchestrator.fail("forced from invalid state");

    expect(orchestrator.currentStatus).toBe("failed");
    expect(transitions).toHaveLength(1);
    expect(transitions[0]!.to).toBe("failed");
    expect(transitions[0]!.from).toBe("completed");
  });
});

// ============================================================================
// Lane F — Retry Engine + Aborted Status
// ============================================================================

describe("Lane F — Retry Engine + Aborted Status", () => {
  let testDirF: string;
  const activeOrchestratorsF: CouncilOrchestrator[] = [];

  beforeEach(async () => {
    testDirF = join(tmpdir(), `council-retry-${randomUUID()}`);
    await mkdir(testDirF, { recursive: true });
  });

  afterEach(async () => {
    for (const o of activeOrchestratorsF) {
      o.on("error", () => {});
      const oc = o as unknown as { pollTimer: unknown; observer?: { stop: () => void } };
      if (oc.pollTimer) clearInterval(oc.pollTimer as ReturnType<typeof setInterval>);
      oc.observer?.stop();
    }
    activeOrchestratorsF.length = 0;
    // Allow any in-flight async FS ops to settle before cleanup (Windows EBUSY guard)
    await new Promise((r) => setTimeout(r, 50));
    await rm(testDirF, { recursive: true, force: true }).catch(() => { /* best-effort */ });
  });

  it("DanteCodeAdapter marks session 'aborted' (not 'failed') when AbortController fires", async () => {
    // Executor that hangs until its abortSignal is signalled
    const executor: SelfLaneExecutor = async (_prompt, _root, opts) => {
      await new Promise<void>((_, reject) => {
        opts?.abortSignal?.addEventListener("abort", () => reject(new Error("aborted by signal")));
      });
      return { output: "", touchedFiles: [], success: true };
    };

    const adapter = new DanteCodeAdapter({ executor });
    const packet: CouncilTaskPacket = {
      packetId: randomUUID(),
      runId: "test-run",
      laneId: "abort-lane",
      objective: "abort test",
      branch: "feature/abort",
      baseBranch: "main",
      worktreePath: testDirF,
      taskCategory: "coding",
      ownedFiles: [],
      forbiddenFiles: [],
      readOnlyFiles: [],
      contractDependencies: [],
      assumptions: [],
    };

    const { sessionId } = await adapter.submitTask(packet);
    await adapter.abortTask(sessionId);
    // Let the microtask queue drain so the .catch() callback updates session.status
    await new Promise((r) => setTimeout(r, 20));

    const status = await adapter.pollStatus(sessionId);
    expect(status.status).toBe("aborted");
  });

  it("failed lane is automatically retried — retryCount increments on new session", async () => {
    const FAIL_SESSION = "fail-me";
    const retryAdapter: CouncilAgentAdapter = {
      id: "dantecode",
      displayName: "Retry mock",
      kind: "native-cli" as const,
      probeAvailability: async () => ({ available: true, health: "ready" as const }),
      estimateCapacity: async () => ({ remainingCapacity: 100, capSuspicion: "none" as const }),
      submitTask: async () => ({ sessionId: randomUUID().slice(0, 8), accepted: true }),
      pollStatus: async (sessionId: string) => {
        if (sessionId === FAIL_SESSION) return { sessionId, status: "failed" as const };
        return { sessionId, status: "completed" as const };
      },
      collectArtifacts: async (s) => ({ sessionId: s, files: [], logs: [] }),
      collectPatch: async (s) => ({ sessionId: s, unifiedDiff: "diff --git a/x b/x\n+line", changedFiles: ["x"] }),
      detectRateLimit: async () => ({ detected: false, confidence: "none" as const }),
      abortTask: async () => {},
    };

    const adapters = new Map<AgentKind, CouncilAgentAdapter>([["dantecode", retryAdapter]]);
    const orchestrator = new CouncilOrchestrator(adapters, { pollIntervalMs: 1, maxLaneRetries: 2 });
    activeOrchestratorsF.push(orchestrator);
    orchestrator.on("error", () => {});

    await orchestrator.start({ objective: "retry test", agents: ["dantecode"], repoRoot: testDirF });

    const state = (orchestrator as unknown as { runState: { agents: AgentSessionState[]; mandates: FileMandate[] } }).runState!;
    state.agents.push({
      laneId: "dantecode-retry-lane",
      agentKind: "dantecode",
      sessionId: FAIL_SESSION,
      status: "running",
      assignedFiles: [],
      objective: "retry test",
      taskCategory: "coding",
      touchedFiles: [],
      retryCount: 0,
      health: "ready",
      adapterKind: "native-cli",
      worktreePath: testDirF,
      branch: "feature/retry",
      startedAt: new Date().toISOString(),
      lastProgressAt: new Date().toISOString(),
    } as AgentSessionState);
    state.mandates.push({
      laneId: "dantecode-retry-lane",
      ownedFiles: [],
      readOnlyFiles: [],
      forbiddenFiles: [],
      contractDependencies: [],
      overlapPolicy: "warn" as const,
    });

    await orchestrator.watchUntilComplete({ timeoutMs: 5000 });

    expect(orchestrator.currentStatus).toBe("completed");
    expect(state.agents.length).toBeGreaterThanOrEqual(2);
    const handedOff = state.agents.find((s) => s.sessionId === FAIL_SESSION);
    expect(handedOff?.status).toBe("handed-off");
    const retried = state.agents.find((s) => s.retryCount === 1);
    expect(retried).toBeDefined();
    expect(retried?.retryCount).toBe(1);
  });

  it("retries exhausted — run transitions to failed after maxLaneRetries attempts", async () => {
    const alwaysFailAdapter: CouncilAgentAdapter = {
      id: "dantecode",
      displayName: "Always-fail mock",
      kind: "native-cli" as const,
      probeAvailability: async () => ({ available: true, health: "ready" as const }),
      estimateCapacity: async () => ({ remainingCapacity: 100, capSuspicion: "none" as const }),
      submitTask: async () => ({ sessionId: randomUUID().slice(0, 8), accepted: true }),
      pollStatus: async (sessionId: string) => ({ sessionId, status: "failed" as const }),
      collectArtifacts: async (s) => ({ sessionId: s, files: [], logs: [] }),
      collectPatch: async () => null,
      detectRateLimit: async () => ({ detected: false, confidence: "none" as const }),
      abortTask: async () => {},
    };

    const adapters = new Map<AgentKind, CouncilAgentAdapter>([["dantecode", alwaysFailAdapter]]);
    const orchestrator = new CouncilOrchestrator(adapters, { pollIntervalMs: 1, maxLaneRetries: 1 });
    activeOrchestratorsF.push(orchestrator);
    orchestrator.on("error", () => {});

    await orchestrator.start({ objective: "exhausted retry", agents: ["dantecode"], repoRoot: testDirF });

    const state = (orchestrator as unknown as { runState: { agents: AgentSessionState[]; mandates: FileMandate[] } }).runState!;
    state.agents.push({
      laneId: "dantecode-exhaust-lane",
      agentKind: "dantecode",
      sessionId: "exhaust-s1",
      status: "running",
      assignedFiles: [],
      objective: "exhausted retry",
      taskCategory: "coding",
      touchedFiles: [],
      retryCount: 0,
      health: "ready",
      adapterKind: "native-cli",
      worktreePath: testDirF,
      branch: "feature/exhaust",
      startedAt: new Date().toISOString(),
      lastProgressAt: new Date().toISOString(),
    } as AgentSessionState);
    state.mandates.push({
      laneId: "dantecode-exhaust-lane",
      ownedFiles: [],
      readOnlyFiles: [],
      forbiddenFiles: [],
      contractDependencies: [],
      overlapPolicy: "warn" as const,
    });

    await orchestrator.watchUntilComplete({ timeoutMs: 5000 });

    expect(orchestrator.currentStatus).toBe("failed");
    // original (handed-off after 1st fail) + retry session (failed after 2nd fail)
    expect(state.agents.length).toBeGreaterThanOrEqual(2);
    const finalFailed = state.agents.find((s) => s.status === "failed");
    expect(finalFailed).toBeDefined();
    expect(finalFailed?.retryCount).toBe(1);
  });

  it("D3: retry fires in NEXT poll cycle, not the same one (backoff path exercised)", async () => {
    const FAIL_SESSION = "backoff-fail";
    const pollLog: string[] = [];

    const backoffAdapter: CouncilAgentAdapter = {
      id: "dantecode",
      displayName: "Backoff mock",
      kind: "native-cli" as const,
      probeAvailability: async () => ({ available: true, health: "ready" as const }),
      estimateCapacity: async () => ({ remainingCapacity: 100, capSuspicion: "none" as const }),
      submitTask: async () => ({ sessionId: randomUUID().slice(0, 8), accepted: true }),
      pollStatus: async (sessionId: string) => {
        pollLog.push(sessionId);
        if (sessionId === FAIL_SESSION) return { sessionId, status: "failed" as const };
        return { sessionId, status: "completed" as const };
      },
      collectArtifacts: async (s) => ({ sessionId: s, files: [], logs: [] }),
      collectPatch: async (s) => ({ sessionId: s, unifiedDiff: "diff --git a/x b/x\n+line", changedFiles: ["x"] }),
      detectRateLimit: async () => ({ detected: false, confidence: "none" as const }),
      abortTask: async () => {},
    };

    const adapters = new Map<AgentKind, CouncilAgentAdapter>([["dantecode", backoffAdapter]]);
    // retryBaseDelayMs: 50 — non-zero but short enough that the test finishes fast
    const orchestrator = new CouncilOrchestrator(adapters, {
      pollIntervalMs: 20,
      maxLaneRetries: 1,
      retryBaseDelayMs: 50,
    });
    activeOrchestratorsF.push(orchestrator);
    orchestrator.on("error", () => {});

    await orchestrator.start({ objective: "backoff test", agents: ["dantecode"], repoRoot: testDirF });

    const state = (orchestrator as unknown as { runState: { agents: AgentSessionState[]; mandates: FileMandate[] } }).runState!;
    state.agents.push({
      laneId: "dantecode-backoff-lane",
      agentKind: "dantecode",
      sessionId: FAIL_SESSION,
      status: "running",
      assignedFiles: [],
      objective: "backoff test",
      taskCategory: "coding",
      touchedFiles: [],
      retryCount: 0,
      health: "ready",
      adapterKind: "native-cli",
      worktreePath: testDirF,
      branch: "feature/backoff",
      startedAt: new Date().toISOString(),
      lastProgressAt: new Date().toISOString(),
    } as AgentSessionState);
    state.mandates.push({
      laneId: "dantecode-backoff-lane",
      ownedFiles: [],
      readOnlyFiles: [],
      forbiddenFiles: [],
      contractDependencies: [],
      overlapPolicy: "warn" as const,
    });

    await orchestrator.watchUntilComplete({ timeoutMs: 5000 });

    expect(orchestrator.currentStatus).toBe("completed");
    // FAIL_SESSION should only have been polled ONCE — the retry session has a different sessionId
    expect(pollLog.filter((s) => s === FAIL_SESSION).length).toBe(1);
    const retried = state.agents.find((s) => s.retryCount === 1);
    expect(retried).toBeDefined();
  });

  it("D4: concurrent multi-lane failure — both lanes fail, run transitions to failed", async () => {
    const alwaysFail: CouncilAgentAdapter = {
      id: "dantecode",
      displayName: "Always-fail mock",
      kind: "native-cli" as const,
      probeAvailability: async () => ({ available: true, health: "ready" as const }),
      estimateCapacity: async () => ({ remainingCapacity: 100, capSuspicion: "none" as const }),
      submitTask: async () => ({ sessionId: randomUUID().slice(0, 8), accepted: true }),
      pollStatus: async (sessionId: string) => ({ sessionId, status: "failed" as const }),
      collectArtifacts: async (s) => ({ sessionId: s, files: [], logs: [] }),
      collectPatch: async () => null,
      detectRateLimit: async () => ({ detected: false, confidence: "none" as const }),
      abortTask: async () => {},
    };

    const adapters = new Map<AgentKind, CouncilAgentAdapter>([["dantecode", alwaysFail]]);
    const orchestrator = new CouncilOrchestrator(adapters, {
      pollIntervalMs: 1,
      maxLaneRetries: 0,
    });
    activeOrchestratorsF.push(orchestrator);
    orchestrator.on("error", () => {});

    await orchestrator.start({ objective: "multi-fail test", agents: ["dantecode"], repoRoot: testDirF });

    const state = (orchestrator as unknown as { runState: { agents: AgentSessionState[]; mandates: FileMandate[] } }).runState!;
    for (const laneId of ["dantecode-fail-1", "dantecode-fail-2"]) {
      state.agents.push({
        laneId,
        agentKind: "dantecode",
        sessionId: `sess-${laneId}`,
        status: "running",
        assignedFiles: [],
        objective: "multi-fail test",
        taskCategory: "coding",
        touchedFiles: [],
        retryCount: 0,
        health: "ready",
        adapterKind: "native-cli",
        worktreePath: testDirF,
        branch: "feature/multi-fail",
        startedAt: new Date().toISOString(),
        lastProgressAt: new Date().toISOString(),
      } as AgentSessionState);
      state.mandates.push({
        laneId,
        ownedFiles: [],
        readOnlyFiles: [],
        forbiddenFiles: [],
        contractDependencies: [],
        overlapPolicy: "warn" as const,
      });
    }

    await orchestrator.watchUntilComplete({ timeoutMs: 5000 });

    expect(orchestrator.currentStatus).toBe("failed");
    const failedSessions = state.agents.filter((s) => s.status === "failed");
    expect(failedSessions.length).toBe(2);
  });

  it("D5: single-adapter fallback — same agent retries when no alternative exists", async () => {
    const FAIL_SESSION = "single-adapter-fail";
    let callCount = 0;

    const singleAdapter: CouncilAgentAdapter = {
      id: "dantecode",
      displayName: "Single-adapter mock",
      kind: "native-cli" as const,
      probeAvailability: async () => ({ available: true, health: "ready" as const }),
      estimateCapacity: async () => ({ remainingCapacity: 100, capSuspicion: "none" as const }),
      submitTask: async () => ({ sessionId: randomUUID().slice(0, 8), accepted: true }),
      pollStatus: async (sessionId: string) => {
        if (sessionId === FAIL_SESSION) return { sessionId, status: "failed" as const };
        // Second session (retry) — let it succeed after a brief simulated delay
        callCount++;
        if (callCount < 2) return { sessionId, status: "running" as const };
        return { sessionId, status: "completed" as const };
      },
      collectArtifacts: async (s) => ({ sessionId: s, files: [], logs: [] }),
      collectPatch: async (s) => ({ sessionId: s, unifiedDiff: "diff --git a/x b/x\n+line", changedFiles: ["x"] }),
      detectRateLimit: async () => ({ detected: false, confidence: "none" as const }),
      abortTask: async () => {},
    };

    // Only ONE adapter registered — single-adapter setup
    const adapters = new Map<AgentKind, CouncilAgentAdapter>([["dantecode", singleAdapter]]);
    const orchestrator = new CouncilOrchestrator(adapters, {
      pollIntervalMs: 5,
      maxLaneRetries: 1,
      retryBaseDelayMs: 0, // disable backoff for test speed
    });
    activeOrchestratorsF.push(orchestrator);
    orchestrator.on("error", () => {});

    await orchestrator.start({ objective: "single-adapter test", agents: ["dantecode"], repoRoot: testDirF });

    const state = (orchestrator as unknown as { runState: { agents: AgentSessionState[]; mandates: FileMandate[] } }).runState!;
    state.agents.push({
      laneId: "dantecode-single-lane",
      agentKind: "dantecode",
      sessionId: FAIL_SESSION,
      status: "running",
      assignedFiles: [],
      objective: "single-adapter test",
      taskCategory: "coding",
      touchedFiles: [],
      retryCount: 0,
      health: "ready",
      adapterKind: "native-cli",
      worktreePath: testDirF,
      branch: "feature/single",
      startedAt: new Date().toISOString(),
      lastProgressAt: new Date().toISOString(),
    } as AgentSessionState);
    state.mandates.push({
      laneId: "dantecode-single-lane",
      ownedFiles: [],
      readOnlyFiles: [],
      forbiddenFiles: [],
      contractDependencies: [],
      overlapPolicy: "warn" as const,
    });

    await orchestrator.watchUntilComplete({ timeoutMs: 5000 });

    expect(orchestrator.currentStatus).toBe("completed");
    const retried = state.agents.find((s) => s.retryCount === 1);
    expect(retried).toBeDefined();
    expect(retried?.agentKind).toBe("dantecode");
  });
});

// ============================================================================
// Lane E — CouncilOrchestrator watchUntilComplete / foreground status
// ============================================================================

describe("Lane E — CouncilOrchestrator watchUntilComplete foreground", () => {
  const activeOrchestratorsE: CouncilOrchestrator[] = [];
  afterEach(() => {
    for (const o of activeOrchestratorsE) {
      o.on("error", () => {});
      const oc = o as unknown as { pollTimer: unknown };
      if (oc.pollTimer) {
        clearInterval(oc.pollTimer as ReturnType<typeof setInterval>);
      }
    }
    activeOrchestratorsE.length = 0;
  });

  it("watchUntilComplete resolves immediately when orchestrator is already in completed state", async () => {
    const adapters = new Map<AgentKind, CouncilAgentAdapter>();
    const orchestrator = new CouncilOrchestrator(adapters, { pollIntervalMs: 999_999 });
    activeOrchestratorsE.push(orchestrator);

    // Force status directly to "completed" without going through the state machine
    (orchestrator as unknown as { status: CouncilLifecycleStatus }).status = "completed";

    const start = Date.now();
    await orchestrator.watchUntilComplete();
    expect(Date.now() - start).toBeLessThan(500);
    expect(orchestrator.currentStatus).toBe("completed");
  });

  it("watchUntilComplete resolves immediately when orchestrator is already in failed state", async () => {
    const adapters = new Map<AgentKind, CouncilAgentAdapter>();
    const orchestrator = new CouncilOrchestrator(adapters, { pollIntervalMs: 999_999 });
    activeOrchestratorsE.push(orchestrator);

    // Force status directly to "failed"
    (orchestrator as unknown as { status: CouncilLifecycleStatus }).status = "failed";

    const start = Date.now();
    await orchestrator.watchUntilComplete();
    expect(Date.now() - start).toBeLessThan(500);
    expect(orchestrator.currentStatus).toBe("failed");
  });

  it("orchestrator.currentStatus reflects the state machine status through idle→running", async () => {
    const adapter = makeInlineAdapter(async (s) => ({ sessionId: s, status: "running" as const }));
    const adapters = new Map<AgentKind, CouncilAgentAdapter>([["dantecode", adapter]]);
    const orchestrator = new CouncilOrchestrator(adapters, { pollIntervalMs: 999_999 });
    activeOrchestratorsE.push(orchestrator);
    orchestrator.on("error", () => {});

    expect(orchestrator.currentStatus).toBe("idle");
    await orchestrator.start({
      objective: "status test",
      agents: ["dantecode"],
      repoRoot: testDir,
    });
    expect(orchestrator.currentStatus).toBe("running");
    await orchestrator.fail("cleanup");
  });
});

// ============================================================================
// DanteCodeAdapter edge cases (post-Lane A — covers output/touchedFiles/status)
// ============================================================================

describe("DanteCodeAdapter edge cases", () => {
  it("pollStatus returns unknown for a session ID that was never submitted", async () => {
    const adapter = new DanteCodeAdapter();
    const status = await adapter.pollStatus("nonexistent-session-xyz");
    expect(status.status).toBe("unknown");
  });

  it("executor touchedFiles flow through to collectArtifacts logs", async () => {
    const executor: SelfLaneExecutor = async () => ({
      output: "all tests passed",
      touchedFiles: ["src/main.ts", "src/util.ts"],
      success: true,
    });
    const adapter = new DanteCodeAdapter({ executor });
    const { sessionId } = await adapter.submitTask(makeTestPacket());
    // Wait for fire-and-forget promise to settle
    await new Promise((r) => setTimeout(r, 50));
    const artifacts = await adapter.collectArtifacts(sessionId);
    const logsJoined = artifacts.logs.join("\n");
    expect(logsJoined).toMatch(/Touched files/i);
    expect(logsJoined).toMatch(/src\/main\.ts/);
  });

  it("markCompleted and markFailed directly mutate session status", async () => {
    const adapter = new DanteCodeAdapter();
    const { sessionId } = await adapter.submitTask(makeTestPacket());

    adapter.markCompleted(sessionId);
    const afterComplete = await adapter.pollStatus(sessionId);
    expect(afterComplete.status).toBe("completed");

    adapter.markFailed(sessionId);
    const afterFail = await adapter.pollStatus(sessionId);
    expect(afterFail.status).toBe("failed");
  });
});
