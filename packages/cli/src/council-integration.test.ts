// ============================================================================
// @dantecode/cli — Council Orchestrator Integration Tests
// Tests the real CouncilOrchestrator state machine lifecycle using
// in-process stub adapters and, for the E2E smoke test, a real git repo
// with a DanteCodeAdapter mock executor.
// ============================================================================

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mkdir, rm } from "node:fs/promises";
import { writeFileSync } from "node:fs";
import { execSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import {
  CouncilOrchestrator,
  tryLoadCouncilRun,
  DanteCodeAdapter,
} from "@dantecode/core";
import type {
  CouncilAgentAdapter,
  AgentKind,
  AdapterPatch,
  LaneAssignmentRequest,
  SelfLaneExecutor,
} from "@dantecode/core";

// ---------------------------------------------------------------------------
// Minimal unified diff — gives MergeBrain a truthy unifiedDiff so the single-
// candidate short-circuit path returns success: true instead of "blocked".
// ---------------------------------------------------------------------------
const STUB_DIFF = `--- a/src/stub.ts\n+++ b/src/stub.ts\n@@ -1,3 +1,3 @@\n-const x = 1;\n+const x = 2;\n export {};\n`;

// ---------------------------------------------------------------------------
// Stub adapter factory
// ---------------------------------------------------------------------------

/**
 * Minimal stub adapter — accepts a poll response and an optional patch override.
 * When `patch` is supplied, collectPatch() returns it (enables the merge path).
 */
function makeStubAdapter(
  kind: AgentKind,
  pollResponse: "running" | "completed" | "failed" = "running",
  patch?: Pick<AdapterPatch, "unifiedDiff" | "changedFiles">,
): CouncilAgentAdapter {
  return {
    id: kind,
    displayName: `Stub(${kind})`,
    kind: "file-bridge",
    probeAvailability: async () => ({ available: true, health: "ready" as const }),
    estimateCapacity: async () => ({
      remainingCapacity: 80,
      capSuspicion: "none" as const,
    }),
    submitTask: async () => ({
      sessionId: randomUUID().slice(0, 8),
      accepted: true,
    }),
    pollStatus: async (sessionId: string) => ({
      sessionId,
      status: pollResponse,
    }),
    collectArtifacts: async (sessionId: string) => ({
      sessionId,
      files: [],
      logs: [],
    }),
    collectPatch: async (sessionId: string): Promise<AdapterPatch | null> => {
      if (!patch) return null;
      return { sessionId, ...patch };
    },
    detectRateLimit: async () => ({ detected: false, confidence: "none" as const }),
    abortTask: async () => {},
  };
}

// ---------------------------------------------------------------------------
// Helper to build a LaneAssignmentRequest pointing at a tmp dir
// ---------------------------------------------------------------------------
function makeAssignLaneRequest(
  worktreePath: string,
  overrides?: Partial<LaneAssignmentRequest>,
): LaneAssignmentRequest {
  return {
    preferredAgent: "dantecode",
    objective: "Integration test lane",
    worktreePath,
    branch: `feat/integ-${Date.now()}`,
    baseBranch: "main",
    taskCategory: "coding",
    ownedFiles: [],
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("CouncilOrchestrator integration", () => {
  let testDir: string;
  let orchestrator: CouncilOrchestrator;

  beforeEach(async () => {
    testDir = join(
      tmpdir(),
      `council-integ-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    );
    await mkdir(testDir, { recursive: true });
  });

  afterEach(async () => {
    if (orchestrator) {
      try {
        orchestrator.on("error", () => {});
        if (
          orchestrator.currentStatus !== "completed" &&
          orchestrator.currentStatus !== "failed"
        ) {
          await orchestrator.fail("test cleanup");
        }
      } catch { /* ignore */ }
    }
    // maxRetries/retryDelay handles Windows EBUSY from recently-released file locks
    await rm(testDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  });

  // -------------------------------------------------------------------------
  // Test 1: persistence
  // -------------------------------------------------------------------------
  it("start() persists state.json and tryLoadCouncilRun reads it back", async () => {
    const adapters = new Map<AgentKind, CouncilAgentAdapter>([
      ["dantecode", makeStubAdapter("dantecode", "running")],
    ]);
    orchestrator = new CouncilOrchestrator(adapters, { pollIntervalMs: 999_999 });
    orchestrator.on("error", () => {});

    const runId = await orchestrator.start({
      objective: "Integration test: persistence",
      agents: ["dantecode"],
      repoRoot: testDir,
    });

    expect(runId).toBeTruthy();
    expect(orchestrator.currentStatus).toBe("running");

    const loaded = await tryLoadCouncilRun(testDir, runId);
    expect(loaded).not.toBeNull();
    expect(loaded!.runId).toBe(runId);
    expect(loaded!.objective).toBe("Integration test: persistence");
    // State is persisted during the planning phase (before transition to running),
    // so the on-disk status is "planning" even though currentStatus is "running".
    expect(loaded!.status).toBe("planning");
  });

  // -------------------------------------------------------------------------
  // Test 2: timeout — use assignLane() (public API) instead of state injection
  // -------------------------------------------------------------------------
  it("watchUntilComplete rejects with timeout error when no lanes complete", async () => {
    const adapters = new Map<AgentKind, CouncilAgentAdapter>([
      ["dantecode", makeStubAdapter("dantecode", "running")],
    ]);
    orchestrator = new CouncilOrchestrator(adapters, { pollIntervalMs: 1 });
    orchestrator.on("error", () => {});

    await orchestrator.start({
      objective: "Integration test: timeout",
      agents: ["dantecode"],
      repoRoot: testDir,
    });

    // Register watcher first, then assign lane — consistent pattern across all tests
    const watchPromise = orchestrator.watchUntilComplete({ timeoutMs: 150 });

    // Use the public assignLane() API — no state injection hacks
    const laneResult = await orchestrator.assignLane(
      makeAssignLaneRequest(testDir, { objective: "timeout lane" }),
    );
    expect(laneResult.accepted).toBe(true);

    // Lane never completes (stub always returns "running") → timeout fires
    await expect(watchPromise).rejects.toThrow(/timed out/i);

    expect(orchestrator.currentStatus).toBe("failed");
  });

  // -------------------------------------------------------------------------
  // Test 3: completed path — use assignLane() + STUB_DIFF for a truthy patch
  //         so MergeBrain short-circuits (1 candidate) → success → "completed"
  // -------------------------------------------------------------------------
  it("reaches 'completed' when adapter returns completed with a non-empty patch", async () => {
    const adapters = new Map<AgentKind, CouncilAgentAdapter>([
      [
        "dantecode",
        makeStubAdapter("dantecode", "completed", {
          unifiedDiff: STUB_DIFF,
          changedFiles: ["src/stub.ts"],
        }),
      ],
    ]);
    orchestrator = new CouncilOrchestrator(adapters, { pollIntervalMs: 1 });
    orchestrator.on("error", () => {});

    await orchestrator.start({
      objective: "Integration test: full cycle",
      agents: ["dantecode"],
      repoRoot: testDir,
    });

    // Register watcher BEFORE assigning lane — prevents race where lanes:all-terminal
    // fires before watchUntilComplete registers its listener (poll runs every 1ms).
    const watchPromise = orchestrator.watchUntilComplete({ timeoutMs: 3_000 });

    const laneResult = await orchestrator.assignLane(
      makeAssignLaneRequest(testDir, { objective: "full-cycle lane" }),
    );
    expect(laneResult.accepted).toBe(true);

    // Lane completes immediately → MergeBrain (1 candidate, truthy diff) → success → complete()
    await watchPromise;
    expect(orchestrator.currentStatus).toBe("completed");
  });

  // -------------------------------------------------------------------------
  // Test 4: transitions — idle → planning → running during start()
  // -------------------------------------------------------------------------
  it("emits state:transition events idle → planning → running during start()", async () => {
    const transitions: Array<{ from: string; to: string }> = [];
    const adapters = new Map<AgentKind, CouncilAgentAdapter>([
      ["dantecode", makeStubAdapter("dantecode", "running")],
    ]);
    orchestrator = new CouncilOrchestrator(adapters, { pollIntervalMs: 999_999 });
    orchestrator.on("error", () => {});
    orchestrator.on("state:transition", ({ from, to }) =>
      transitions.push({ from, to }),
    );

    expect(orchestrator.currentStatus).toBe("idle");

    await orchestrator.start({
      objective: "Integration test: transitions",
      agents: ["dantecode"],
      repoRoot: testDir,
    });

    expect(transitions).toHaveLength(2);
    expect(transitions[0]).toEqual({ from: "idle", to: "planning" });
    expect(transitions[1]).toEqual({ from: "planning", to: "running" });
    expect(orchestrator.currentStatus).toBe("running");
  });

  // -------------------------------------------------------------------------
  // Test 5: E2E smoke — real git repo + DanteCodeAdapter with mock executor
  //         verifies the full pipeline: submitTask → pollStatus → merge → complete
  // -------------------------------------------------------------------------
  it("E2E smoke: DanteCodeAdapter with mock executor reaches 'completed'", async () => {
    // Set up a minimal git repo so DanteCodeAdapter.collectPatch() can run git diff
    execSync("git init", { cwd: testDir, stdio: "pipe" });
    execSync("git config user.email \"test@example.com\"", { cwd: testDir, stdio: "pipe" });
    execSync("git config user.name \"Test\"", { cwd: testDir, stdio: "pipe" });
    execSync("git commit --allow-empty -m \"init\"", { cwd: testDir, stdio: "pipe" });

    // Stage a file so git diff HEAD returns a non-empty diff (truthy unifiedDiff)
    writeFileSync(join(testDir, "smoke.ts"), "export const x = 1;\n");
    execSync("git add smoke.ts", { cwd: testDir, stdio: "pipe" });

    // Mock executor — completes instantly, reports one touched file
    const mockExecutor: SelfLaneExecutor = async () => ({
      output: "smoke test done",
      touchedFiles: ["smoke.ts"],
      success: true,
    });

    const dcAdapter = new DanteCodeAdapter({ executor: mockExecutor });
    const adapters = new Map<AgentKind, CouncilAgentAdapter>([["dantecode", dcAdapter]]);
    orchestrator = new CouncilOrchestrator(adapters, { pollIntervalMs: 5 });
    orchestrator.on("error", () => {});

    await orchestrator.start({
      objective: "E2E smoke test",
      agents: ["dantecode"],
      repoRoot: testDir,
    });

    // Register watcher BEFORE assigning lane to prevent the race where the fast
    // mock executor finishes before watchUntilComplete registers its listener.
    const watchPromise = orchestrator.watchUntilComplete({ timeoutMs: 5_000 });

    // assignLane() submits the task to DanteCodeAdapter — executor runs in background
    const laneResult = await orchestrator.assignLane(
      makeAssignLaneRequest(testDir, {
        objective: "E2E lane",
        branch: "feat/e2e-smoke",
      }),
    );
    expect(laneResult.accepted).toBe(true);

    // watchUntilComplete: polls every 5ms → executor finishes → "completed" lane →
    // MergeBrain gets non-empty diff from git diff HEAD → success → complete()
    await watchPromise;
    expect(orchestrator.currentStatus).toBe("completed");
  }, 8_000);
});
