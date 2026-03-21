// ============================================================================
// Council Orchestrator — Fleet Integration Tests
// Tests that FleetBudget, TaskRedistributor, maxNestingDepth, and
// verifyLaneOutput are properly wired into CouncilOrchestrator.
// ============================================================================

import { describe, it, expect, afterEach, vi } from "vitest";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mkdir, rm } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import type { AgentSessionState, AgentKind } from "./council-types.js";
import type { CouncilAgentAdapter } from "./agent-adapters/base.js";
import { CouncilOrchestrator } from "./council-orchestrator.js";
import type { FleetBudgetReport } from "./fleet-budget.js";

// ----------------------------------------------------------------------------
// Test helpers
// ----------------------------------------------------------------------------

let testDir: string;

async function makeTestDir(): Promise<string> {
  const dir = join(tmpdir(), `fleet-int-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  await mkdir(dir, { recursive: true });
  return dir;
}

/**
 * Minimal adapter that sequences through a list of status responses.
 * Optional `tokensUsed` / `costUsd` are injected into each pollStatus result.
 */
function makeSequencedAdapter(
  responses: Array<{
    status: "running" | "completed" | "failed" | "aborted";
    tokensUsed?: number;
    costUsd?: number;
  }>,
  opts: {
    unifiedDiff?: string;
    changedFiles?: string[];
  } = {},
): CouncilAgentAdapter {
  let idx = 0;
  return {
    id: "dantecode",
    displayName: "Mock",
    kind: "native-cli",
    probeAvailability: async () => ({ available: true, health: "ready" as const }),
    estimateCapacity: async () => ({ remainingCapacity: 100, capSuspicion: "none" as const }),
    submitTask: async () => ({ sessionId: randomUUID().slice(0, 12), accepted: true }),
    pollStatus: async (sessionId: string) => {
      const r = responses[idx] ?? responses[responses.length - 1]!;
      if (idx < responses.length - 1) idx++;
      return {
        sessionId,
        status: r.status,
        tokensUsed: r.tokensUsed,
        costUsd: r.costUsd,
      };
    },
    collectArtifacts: async (sessionId: string) => ({ sessionId, files: [], logs: [] }),
    collectPatch: async (sessionId: string) => {
      if (!opts.unifiedDiff) return null;
      return {
        sessionId,
        unifiedDiff: opts.unifiedDiff,
        changedFiles: opts.changedFiles ?? ["src/test.ts"],
      };
    },
    detectRateLimit: async () => ({ detected: false, confidence: "none" as const }),
    abortTask: async () => {},
  };
}

/** Inject a running session directly into an orchestrator's run state (bypasses router). */
function injectSession(
  orchestrator: CouncilOrchestrator,
  sessionId: string,
  opts: {
    laneId?: string;
    status?: AgentSessionState["status"];
    assignedFiles?: string[];
    nestingDepth?: number;
  } = {},
): void {
  const state = (orchestrator as unknown as { runState: { agents: AgentSessionState[] } }).runState;
  state!.agents.push({
    laneId: opts.laneId ?? `dantecode-${sessionId}`,
    agentKind: "dantecode",
    adapterKind: "native-cli",
    sessionId,
    status: opts.status ?? "running",
    health: "ready",
    worktreePath: testDir,
    branch: "feat/test",
    assignedFiles: opts.assignedFiles ?? ["src/test.ts"],
    objective: "Fleet integration test objective",
    taskCategory: "coding",
    touchedFiles: [],
    retryCount: 0,
    nestingDepth: opts.nestingDepth ?? 0,
    startedAt: new Date().toISOString(),
    lastProgressAt: new Date().toISOString(),
  });
}

/** Stop poll timer on an orchestrator (cleanup helper). */
function stopPoll(orchestrator: CouncilOrchestrator): void {
  const oc = orchestrator as unknown as { pollTimer: ReturnType<typeof setInterval> | null };
  if (oc.pollTimer) {
    clearInterval(oc.pollTimer);
    oc.pollTimer = null;
  }
}

// Shared active-orchestrator tracking for cleanup
const activeOrchestrators: CouncilOrchestrator[] = [];

afterEach(async () => {
  for (const o of activeOrchestrators) {
    o.on("error", () => {});
    stopPoll(o);
  }
  activeOrchestrators.length = 0;
  // Clean up temp directories to avoid leaving debris on disk
  if (testDir) {
    await rm(testDir, { recursive: true, force: true }).catch(() => {});
    testDir = "";
  }
});

// ----------------------------------------------------------------------------
// Tests
// ----------------------------------------------------------------------------

describe("CouncilOrchestrator — Fleet Integration", () => {
  it("FleetBudget: budget exhaustion triggers orchestrator.fail()", async () => {
    testDir = await makeTestDir();

    // Budget limit: 100 tokens total. Adapter will report 200 tokens used.
    const adapter = makeSequencedAdapter([
      { status: "running", tokensUsed: 200, costUsd: 0.01 },
      { status: "running", tokensUsed: 200, costUsd: 0.01 },
    ]);
    const adapters = new Map<AgentKind, CouncilAgentAdapter>([["dantecode", adapter]]);
    const orchestrator = new CouncilOrchestrator(adapters, {
      pollIntervalMs: 999_999,
      maxLaneRetries: 0,
      councilConfig: {
        budget: {
          maxTotalTokens: 100,
          maxTotalCostUsd: 0,
          maxTokensPerAgent: 0,
          warningThreshold: 0.8,
        },
      },
    });
    activeOrchestrators.push(orchestrator);
    orchestrator.on("error", () => {}); // suppress unhandled error

    await orchestrator.start({
      objective: "budget exhaustion",
      agents: ["dantecode"],
      repoRoot: testDir,
    });
    injectSession(orchestrator, "budget-s1");

    // Run one poll cycle — budget is exceeded → orchestrator fails
    const poll = orchestrator as unknown as { pollAllLanes(): Promise<void> };
    await poll.pollAllLanes();

    expect(orchestrator.currentStatus).toBe("failed");
  });

  it("FleetBudget: budget warning event fires when threshold crossed", async () => {
    testDir = await makeTestDir();

    const warningReports: FleetBudgetReport[] = [];

    // Budget: 1000 tokens, 80% warn threshold → fires at 800 tokens
    const adapter = makeSequencedAdapter([
      { status: "running", tokensUsed: 850, costUsd: 0 },
      { status: "completed", tokensUsed: 850, costUsd: 0 },
    ]);
    const adapters = new Map<AgentKind, CouncilAgentAdapter>([["dantecode", adapter]]);
    const orchestrator = new CouncilOrchestrator(adapters, {
      pollIntervalMs: 999_999,
      maxLaneRetries: 0,
      councilConfig: {
        budget: {
          maxTotalTokens: 1000,
          maxTotalCostUsd: 0,
          maxTokensPerAgent: 0,
          warningThreshold: 0.8,
        },
      },
    });
    activeOrchestrators.push(orchestrator);
    orchestrator.on("error", () => {});
    orchestrator.on("budget:warning", (report) => warningReports.push(report));

    await orchestrator.start({
      objective: "budget warning",
      agents: ["dantecode"],
      repoRoot: testDir,
    });
    injectSession(orchestrator, "warn-s1");

    const poll = orchestrator as unknown as { pollAllLanes(): Promise<void> };
    await poll.pollAllLanes(); // tokensUsed=850 → crosses 80% → fires warning

    expect(warningReports).toHaveLength(1);
    expect(warningReports[0]!.totalTokens).toBe(850);
    expect(warningReports[0]!.budgetRemaining).toBe(150);
    // Orchestrator should NOT be failed (budget not exhausted, just warned)
    expect(orchestrator.currentStatus).toBe("running");
  });

  it("maxNestingDepth: assignLane throws when depth >= maxNestingDepth", async () => {
    testDir = await makeTestDir();

    const adapter = makeSequencedAdapter([{ status: "running" }]);
    const adapters = new Map<AgentKind, CouncilAgentAdapter>([["dantecode", adapter]]);
    const orchestrator = new CouncilOrchestrator(adapters, {
      pollIntervalMs: 999_999,
      councilConfig: { maxNestingDepth: 1 },
    });
    activeOrchestrators.push(orchestrator);
    orchestrator.on("error", () => {});

    await orchestrator.start({
      objective: "nesting depth test",
      agents: ["dantecode"],
      repoRoot: testDir,
    });

    // Depth 0 is allowed (0 < 1)
    await expect(
      orchestrator.assignLane({
        objective: "sub-agent depth 0",
        taskCategory: "coding",
        ownedFiles: [],
        worktreePath: testDir,
        branch: "feat/depth-0",
        baseBranch: "main",
        nestingDepth: 0,
      }),
    ).resolves.toBeDefined();

    // Depth 1 equals maxNestingDepth=1 → should throw
    await expect(
      orchestrator.assignLane({
        objective: "sub-agent depth 1",
        taskCategory: "coding",
        ownedFiles: [],
        worktreePath: testDir,
        branch: "feat/depth-1",
        baseBranch: "main",
        nestingDepth: 1,
      }),
    ).rejects.toThrow(/maxNestingDepth/);
  });

  it("TaskRedistributor: redistribution event fires when a completing lane finds busy peers", async () => {
    testDir = await makeTestDir();

    // Two sessions: completing-s1 completes, busy-s2 stays running.
    // When completing-s1 completes: busyLanes=[busy-s2]
    // → TaskRedistributor.findRedistribution() is called with completing lane as the "available" agent
    // → IF busy-s2 objective can be decomposed, a new lane is spawned and redistribution event fires.
    const redistributionEvents: Array<{
      fromLaneId: string;
      toLaneId: string;
      subObjective: string;
    }> = [];

    // Two adapters: one completes immediately ("dantecode"), one stays running ("codex")
    const completingAdapter: CouncilAgentAdapter = {
      id: "dantecode",
      displayName: "Completing",
      kind: "native-cli",
      probeAvailability: async () => ({ available: true, health: "ready" as const }),
      estimateCapacity: async () => ({ remainingCapacity: 100, capSuspicion: "none" as const }),
      submitTask: async () => ({ sessionId: randomUUID().slice(0, 12), accepted: true }),
      pollStatus: async (sessionId: string) => ({ sessionId, status: "completed" as const }),
      collectArtifacts: async (sessionId: string) => ({ sessionId, files: [], logs: [] }),
      collectPatch: async () => null,
      detectRateLimit: async () => ({ detected: false, confidence: "none" as const }),
      abortTask: async () => {},
    };
    const runningAdapter: CouncilAgentAdapter = {
      id: "codex",
      displayName: "Running",
      kind: "native-cli",
      probeAvailability: async () => ({ available: true, health: "ready" as const }),
      estimateCapacity: async () => ({ remainingCapacity: 100, capSuspicion: "none" as const }),
      submitTask: async () => ({ sessionId: randomUUID().slice(0, 12), accepted: true }),
      pollStatus: async (sessionId: string) => ({ sessionId, status: "running" as const }),
      collectArtifacts: async (sessionId: string) => ({ sessionId, files: [], logs: [] }),
      collectPatch: async () => null,
      detectRateLimit: async () => ({ detected: false, confidence: "none" as const }),
      abortTask: async () => {},
    };

    const adapters = new Map<AgentKind, CouncilAgentAdapter>([
      ["dantecode", completingAdapter],
      ["codex", runningAdapter],
    ]);
    const orchestrator = new CouncilOrchestrator(adapters, {
      pollIntervalMs: 999_999,
      maxLaneRetries: 0,
    });
    activeOrchestrators.push(orchestrator);
    orchestrator.on("error", () => {});
    orchestrator.on("redistribution", (e) => redistributionEvents.push(e));

    await orchestrator.start({
      objective: "redistribution test",
      agents: ["dantecode", "codex"],
      repoRoot: testDir,
    });

    const state = (orchestrator as unknown as { runState: { agents: AgentSessionState[] } })
      .runState;

    // Manually inject sessions with specific agent kinds and statuses
    state!.agents.push({
      laneId: "dantecode-completing-s1",
      agentKind: "dantecode",
      adapterKind: "native-cli",
      sessionId: "completing-s1",
      status: "running",
      health: "ready",
      worktreePath: testDir,
      branch: "feat/completing",
      assignedFiles: ["src/completing.ts"],
      objective: "Implement auth module",
      taskCategory: "coding",
      touchedFiles: [],
      retryCount: 0,
      nestingDepth: 0,
      startedAt: new Date().toISOString(),
      lastProgressAt: new Date().toISOString(),
    });
    state!.agents.push({
      laneId: "codex-busy-s2",
      agentKind: "codex",
      adapterKind: "native-cli",
      sessionId: "busy-s2",
      status: "running",
      health: "ready",
      worktreePath: testDir,
      branch: "feat/busy",
      assignedFiles: ["src/busy.ts"],
      // Decomposable objective: "and then" triggers split
      objective: "Implement feature A and then refactor module B and also add unit tests",
      taskCategory: "coding",
      touchedFiles: [],
      retryCount: 0,
      nestingDepth: 0,
      startedAt: new Date(Date.now() - 200_000).toISOString(), // 200s ago → high priority
      lastProgressAt: new Date().toISOString(),
    });
    const poll = orchestrator as unknown as { pollAllLanes(): Promise<void> };
    await poll.pollAllLanes();
    // completing-s1 (dantecode) → completed → busyLanes=[codex-busy-s2]
    // → findRedistribution called with completing lane as the "available" agent
    // → busy-s2 objective decomposes → new lane spawned → redistribution event fired

    expect(redistributionEvents).toHaveLength(1);
    expect(redistributionEvents[0]!.fromLaneId).toBe("codex-busy-s2");
    // toLaneId is now the newly spawned lane's ID (not a pre-injected idle session)
    expect(redistributionEvents[0]!.toLaneId).toBeTruthy();
    expect(redistributionEvents[0]!.toLaneId).not.toBe("dantecode-completing-s1");
    expect(redistributionEvents[0]!.subObjective).toBeTruthy();
  });

  it("verifyLaneOutput: lane with no patch returns passed=false and score=0", async () => {
    testDir = await makeTestDir();

    // Adapter returns null from collectPatch (no patch available)
    const adapter = makeSequencedAdapter([{ status: "completed" }]);
    const adapters = new Map<AgentKind, CouncilAgentAdapter>([["dantecode", adapter]]);
    const orchestrator = new CouncilOrchestrator(adapters, {
      pollIntervalMs: 999_999,
      maxLaneRetries: 0,
    });
    activeOrchestrators.push(orchestrator);
    orchestrator.on("error", () => {});

    await orchestrator.start({
      objective: "verify no patch",
      agents: ["dantecode"],
      repoRoot: testDir,
    });
    injectSession(orchestrator, "nopatch-s1", {
      laneId: "dantecode-nopatch-s1",
      status: "completed",
    });

    const result = await orchestrator.verifyLaneOutput("dantecode-nopatch-s1");

    expect(result.passed).toBe(false);
    expect(result.score).toBe(0);
    expect(result.findings.some((f) => /no patch/i.test(f))).toBe(true);
  });

  it("verifyLaneOutput: lane not found returns passed=false and score=0", async () => {
    testDir = await makeTestDir();

    const adapters = new Map<AgentKind, CouncilAgentAdapter>();
    const orchestrator = new CouncilOrchestrator(adapters, { pollIntervalMs: 999_999 });
    activeOrchestrators.push(orchestrator);
    orchestrator.on("error", () => {});

    await orchestrator.start({ objective: "verify not found", agents: [], repoRoot: testDir });

    const result = await orchestrator.verifyLaneOutput("nonexistent-lane");

    expect(result.passed).toBe(false);
    expect(result.score).toBe(0);
    expect(result.findings.some((f) => /not found|no adapter/i.test(f))).toBe(true);
  });

  it("verifyLaneOutput: lane with a real patch returns structured verdict", async () => {
    testDir = await makeTestDir();

    const REAL_DIFF = [
      "diff --git a/src/auth.ts b/src/auth.ts",
      "index abc1234..def5678 100644",
      "--- a/src/auth.ts",
      "+++ b/src/auth.ts",
      "@@ -1,3 +1,8 @@",
      "+export function authenticate(token: string): boolean {",
      "+  if (!token) return false;",
      "+  return token.startsWith('Bearer ');",
      "+}",
      "+",
      " export const AUTH_VERSION = '1.0';",
    ].join("\n");

    const adapter = makeSequencedAdapter([{ status: "completed" }], {
      unifiedDiff: REAL_DIFF,
      changedFiles: ["src/auth.ts"],
    });
    const adapters = new Map<AgentKind, CouncilAgentAdapter>([["dantecode", adapter]]);
    const orchestrator = new CouncilOrchestrator(adapters, {
      pollIntervalMs: 999_999,
      maxLaneRetries: 0,
    });
    activeOrchestrators.push(orchestrator);
    orchestrator.on("error", () => {});

    await orchestrator.start({
      objective: "verify real patch",
      agents: ["dantecode"],
      repoRoot: testDir,
    });
    injectSession(orchestrator, "patch-s1", { laneId: "dantecode-patch-s1", status: "completed" });

    const result = await orchestrator.verifyLaneOutput("dantecode-patch-s1");

    // Score should be a number in [0, 1]
    expect(result.score).toBeGreaterThanOrEqual(0);
    expect(result.score).toBeLessThanOrEqual(1);
    // Findings array should always be non-empty
    expect(result.findings.length).toBeGreaterThan(0);
    // passed is a boolean
    expect(typeof result.passed).toBe("boolean");
    // The lane's pdseScore should be updated
    const state = (orchestrator as unknown as { runState: { agents: AgentSessionState[] } })
      .runState;
    const lane = state!.agents.find((a) => a.laneId === "dantecode-patch-s1");
    expect(lane?.pdseScore).toBeDefined();
    expect(lane?.verificationPassed).toBe(result.passed);
  });

  it("budget:warning event fires exactly once even with multiple poll cycles past threshold", async () => {
    testDir = await makeTestDir();

    const warningCount = { count: 0 };

    // Budget: 1000 tokens, warn at 80% (800). Adapter always reports 900 tokens.
    const adapter = makeSequencedAdapter([
      { status: "running", tokensUsed: 900, costUsd: 0 },
      { status: "running", tokensUsed: 900, costUsd: 0 },
      { status: "running", tokensUsed: 900, costUsd: 0 },
      { status: "completed", tokensUsed: 900, costUsd: 0 },
    ]);
    const adapters = new Map<AgentKind, CouncilAgentAdapter>([["dantecode", adapter]]);
    const orchestrator = new CouncilOrchestrator(adapters, {
      pollIntervalMs: 999_999,
      maxLaneRetries: 0,
      councilConfig: {
        budget: {
          maxTotalTokens: 1000,
          maxTotalCostUsd: 0,
          maxTokensPerAgent: 0,
          warningThreshold: 0.8,
        },
      },
    });
    activeOrchestrators.push(orchestrator);
    orchestrator.on("error", () => {});
    orchestrator.on("budget:warning", () => {
      warningCount.count++;
    });

    await orchestrator.start({
      objective: "warning once",
      agents: ["dantecode"],
      repoRoot: testDir,
    });
    injectSession(orchestrator, "warn-once-s1");

    const poll = orchestrator as unknown as { pollAllLanes(): Promise<void> };
    // Run 3 poll cycles — warning should only fire on the first crossing
    await poll.pollAllLanes();
    await poll.pollAllLanes();
    await poll.pollAllLanes();

    expect(warningCount.count).toBe(1);
  });

  it("budget:exhausted event fires before orchestrator transitions to failed", async () => {
    testDir = await makeTestDir();

    const exhaustedReports: FleetBudgetReport[] = [];

    const adapter = makeSequencedAdapter([{ status: "running", tokensUsed: 200, costUsd: 0.01 }]);
    const adapters = new Map<AgentKind, CouncilAgentAdapter>([["dantecode", adapter]]);
    const orchestrator = new CouncilOrchestrator(adapters, {
      pollIntervalMs: 999_999,
      maxLaneRetries: 0,
      councilConfig: {
        budget: {
          maxTotalTokens: 100,
          maxTotalCostUsd: 0,
          maxTokensPerAgent: 0,
          warningThreshold: 0.8,
        },
      },
    });
    activeOrchestrators.push(orchestrator);
    orchestrator.on("error", () => {});
    orchestrator.on("budget:exhausted", (report) => exhaustedReports.push(report));

    await orchestrator.start({
      objective: "exhausted event",
      agents: ["dantecode"],
      repoRoot: testDir,
    });
    injectSession(orchestrator, "exhaust-s1");

    const poll = orchestrator as unknown as { pollAllLanes(): Promise<void> };
    await poll.pollAllLanes();

    expect(exhaustedReports).toHaveLength(1);
    expect(exhaustedReports[0]!.totalTokens).toBeGreaterThan(0);
    expect(orchestrator.currentStatus).toBe("failed");
  });

  it("budget:agent-limit event fires when per-agent token cap is exceeded", async () => {
    testDir = await makeTestDir();

    const agentLimitEvents: Array<{ agentId: string; report: FleetBudgetReport }> = [];

    // per-agent cap: 50 tokens; adapter reports 100 → cap exceeded
    const adapter = makeSequencedAdapter([{ status: "running", tokensUsed: 100, costUsd: 0 }]);
    const adapters = new Map<AgentKind, CouncilAgentAdapter>([["dantecode", adapter]]);
    const orchestrator = new CouncilOrchestrator(adapters, {
      pollIntervalMs: 999_999,
      maxLaneRetries: 0,
      councilConfig: {
        budget: {
          maxTotalTokens: 10_000,
          maxTotalCostUsd: 0,
          maxTokensPerAgent: 50,
          warningThreshold: 0.99,
        },
      },
    });
    activeOrchestrators.push(orchestrator);
    orchestrator.on("error", () => {});
    orchestrator.on("budget:agent-limit", (e) => agentLimitEvents.push(e));

    await orchestrator.start({
      objective: "agent limit event",
      agents: ["dantecode"],
      repoRoot: testDir,
    });
    injectSession(orchestrator, "limit-s1", { laneId: "dantecode-limit-s1" });

    const poll = orchestrator as unknown as { pollAllLanes(): Promise<void> };
    await poll.pollAllLanes();

    expect(agentLimitEvents.length).toBeGreaterThanOrEqual(1);
    expect(agentLimitEvents[0]!.agentId).toBe("dantecode-limit-s1");
  });

  it("lane:verified event fires automatically after lane completes (with test file)", async () => {
    testDir = await makeTestDir();

    const verifiedEvents: Array<{ laneId: string; pdseScore: number }> = [];

    const DIFF_WITH_TEST = [
      "diff --git a/src/auth.test.ts b/src/auth.test.ts",
      "index 0000000..abc1234 100644",
      "--- /dev/null",
      "+++ b/src/auth.test.ts",
      "@@ -0,0 +1,4 @@",
      "+import { authenticate } from './auth.js';",
      "+it('works', () => {",
      "+  expect(authenticate('Bearer x')).toBe(true);",
      "+});",
    ].join("\n");

    const adapter = makeSequencedAdapter([{ status: "completed" }], {
      unifiedDiff: DIFF_WITH_TEST,
      changedFiles: ["src/auth.test.ts"],
    });
    const adapters = new Map<AgentKind, CouncilAgentAdapter>([["dantecode", adapter]]);
    const orchestrator = new CouncilOrchestrator(adapters, {
      pollIntervalMs: 999_999,
      maxLaneRetries: 0,
    });
    activeOrchestrators.push(orchestrator);
    orchestrator.on("error", () => {});
    orchestrator.on("lane:verified", (e) => verifiedEvents.push(e));

    await orchestrator.start({
      objective: "lane verified event",
      agents: ["dantecode"],
      repoRoot: testDir,
    });
    injectSession(orchestrator, "verify-s1", { laneId: "dantecode-verify-s1" });

    const poll = orchestrator as unknown as { pollAllLanes(): Promise<void> };
    await poll.pollAllLanes();
    // verifyLaneOutput is fire-and-forget (void) — allow it to settle
    await new Promise((r) => setTimeout(r, 50));

    expect(verifiedEvents.length).toBeGreaterThanOrEqual(1);
    expect(verifiedEvents[0]!.pdseScore).toBeGreaterThanOrEqual(70);
  });

  it("lane:accepted-with-warning fires when patch has no test files", async () => {
    testDir = await makeTestDir();

    const warningEvents: Array<{ laneId: string; pdseScore: number }> = [];

    const DIFF_SOURCE_ONLY = [
      "diff --git a/src/auth.ts b/src/auth.ts",
      "index 0000000..abc1234 100644",
      "--- /dev/null",
      "+++ b/src/auth.ts",
      "@@ -0,0 +1,3 @@",
      "+export function authenticate(token: string): boolean {",
      "+  return token.startsWith('Bearer ');",
      "+}",
    ].join("\n");

    const adapter = makeSequencedAdapter([{ status: "completed" }], {
      unifiedDiff: DIFF_SOURCE_ONLY,
      changedFiles: ["src/auth.ts"],
    });
    const adapters = new Map<AgentKind, CouncilAgentAdapter>([["dantecode", adapter]]);
    const orchestrator = new CouncilOrchestrator(adapters, {
      pollIntervalMs: 999_999,
      maxLaneRetries: 0,
    });
    activeOrchestrators.push(orchestrator);
    orchestrator.on("error", () => {});
    orchestrator.on("lane:accepted-with-warning", (e) => warningEvents.push(e));

    await orchestrator.start({
      objective: "lane accepted-with-warning",
      agents: ["dantecode"],
      repoRoot: testDir,
    });
    injectSession(orchestrator, "warn-s1", { laneId: "dantecode-warn-s1" });

    const poll = orchestrator as unknown as { pollAllLanes(): Promise<void> };
    await poll.pollAllLanes();
    await new Promise((r) => setTimeout(r, 50));

    expect(warningEvents.length).toBeGreaterThanOrEqual(1);
    expect(warningEvents[0]!.pdseScore).toBeLessThan(70);
  });

  it("FleetDashboard: draw() called on lane:completed event (event wire verification)", async () => {
    testDir = await makeTestDir();

    // This test verifies the orchestrator emits "lane:completed" which the
    // FleetDashboard subscriber in council.ts can consume. We validate the
    // event payload matches the expected type.
    const completedEvents: Array<{ laneId: string; agentKind: string; sessionId: string }> = [];

    const adapter = makeSequencedAdapter([{ status: "completed" }]);
    const adapters = new Map<AgentKind, CouncilAgentAdapter>([["dantecode", adapter]]);
    const orchestrator = new CouncilOrchestrator(adapters, {
      pollIntervalMs: 999_999,
      maxLaneRetries: 0,
    });
    activeOrchestrators.push(orchestrator);
    orchestrator.on("error", () => {});

    // Simulate FleetDashboard event subscription (the actual FleetDashboard.draw()
    // is a CLI side-effect; here we capture the event payload instead).
    orchestrator.on("lane:completed", (e) => {
      completedEvents.push(e);
      // Verify event shape matches what FleetDashboard.updateLane expects
      expect(typeof e.laneId).toBe("string");
      expect(typeof e.agentKind).toBe("string");
      expect(typeof e.sessionId).toBe("string");
    });

    await orchestrator.start({
      objective: "dashboard wire test",
      agents: ["dantecode"],
      repoRoot: testDir,
    });
    injectSession(orchestrator, "dash-s1", { laneId: "dantecode-dash-s1" });

    const poll = orchestrator as unknown as { pollAllLanes(): Promise<void> };
    await poll.pollAllLanes();

    expect(completedEvents).toHaveLength(1);
    expect(completedEvents[0]!.laneId).toBe("dantecode-dash-s1");
  });

  it("verifyLaneOutput gate: lane with passed=false and score=0 is excluded from merge candidates → orchestrator fails", async () => {
    testDir = await makeTestDir();

    // Adapter reports "completed" but collectPatch returns a real diff.
    // We spy on verifyLaneOutput to simulate a lane that produced zero changes
    // (e.g. the agent ran but wrote nothing), forcing passed=false and score=0.
    const DIFF_SOURCE = [
      "diff --git a/src/gate.ts b/src/gate.ts",
      "--- /dev/null",
      "+++ b/src/gate.ts",
      "@@ -0,0 +1,1 @@",
      "+export const x = 1;",
    ].join("\n");

    const adapter = makeSequencedAdapter([{ status: "completed" }], {
      unifiedDiff: DIFF_SOURCE,
      changedFiles: ["src/gate.ts"],
    });
    const adapters = new Map<AgentKind, CouncilAgentAdapter>([["dantecode", adapter]]);
    const orchestrator = new CouncilOrchestrator(adapters, {
      pollIntervalMs: 999_999, // prevent automatic poll — we drive manually
      maxLaneRetries: 0,
    });
    activeOrchestrators.push(orchestrator);
    orchestrator.on("error", () => {});

    // Spy on verifyLaneOutput: synchronously mark the lane as verify-failed
    // (verificationPassed=false, pdseScore=0) before returning the Promise.
    // The synchronous assignment runs before the gate check in merge(), which
    // happens before merge()'s first internal await.
    const runState = orchestrator as unknown as { runState: { agents: AgentSessionState[] } };
    vi.spyOn(orchestrator, "verifyLaneOutput").mockImplementation(async (laneId: string) => {
      const lane = runState.runState?.agents.find((a) => a.laneId === laneId);
      if (lane) {
        lane.verificationPassed = false;
        lane.pdseScore = 0;
      }
      orchestrator.emit("lane:verify-failed", {
        laneId,
        score: 0,
        findings: ["mocked: no changes"],
      });
      return { passed: false, score: 0, findings: ["mocked: no changes"] };
    });

    await orchestrator.start({
      objective: "gate test: fail",
      agents: ["dantecode"],
      repoRoot: testDir,
    });
    injectSession(orchestrator, "gate-s1", { laneId: "dantecode-gate-s1" });

    // Drive poll manually and wait for state machine to settle via watchUntilComplete.
    // Using pollIntervalMs:999_999 prevents timer races under parallel test load.
    const poll = orchestrator as unknown as { pollAllLanes(): Promise<void> };
    const watchPromise = orchestrator.watchUntilComplete({ timeoutMs: 5000 });
    await poll.pollAllLanes(); // lane completes → spy fires → allTerminal → merge() → fail()
    await watchPromise; // resolves once state transitions to "failed"

    // With 0 valid candidates, orchestrator should fail (not complete)
    expect(orchestrator.currentStatus).toBe("failed");

    vi.restoreAllMocks();
  });

  it("verifyLaneOutput gate: lane with passed=true is included in merge candidates → orchestrator completes", async () => {
    testDir = await makeTestDir();

    // Adapter provides a patch with test files → verifyLaneOutput returns score=85 (passes threshold)
    const DIFF_WITH_TEST = [
      "diff --git a/src/auth.test.ts b/src/auth.test.ts",
      "index 0000000..abc1234 100644",
      "--- /dev/null",
      "+++ b/src/auth.test.ts",
      "@@ -0,0 +1,4 @@",
      "+import { authenticate } from './auth.js';",
      "+it('works', () => {",
      "+  expect(authenticate('Bearer x')).toBe(true);",
      "+});",
    ].join("\n");

    const adapter = makeSequencedAdapter([{ status: "completed" }], {
      unifiedDiff: DIFF_WITH_TEST,
      changedFiles: ["src/auth.test.ts"],
    });
    const adapters = new Map<AgentKind, CouncilAgentAdapter>([["dantecode", adapter]]);
    const orchestrator = new CouncilOrchestrator(adapters, {
      pollIntervalMs: 999_999, // prevent automatic poll — we drive manually
      maxLaneRetries: 0,
    });
    activeOrchestrators.push(orchestrator);
    orchestrator.on("error", () => {});

    await orchestrator.start({
      objective: "gate test: pass",
      agents: ["dantecode"],
      repoRoot: testDir,
    });
    injectSession(orchestrator, "gate-pass-s1", { laneId: "dantecode-gate-pass-s1" });

    // Drive poll manually and wait for state machine to settle via watchUntilComplete.
    // Real verifyLaneOutput runs: test file → score=85, passed=true, verificationPassed=true
    const poll = orchestrator as unknown as { pollAllLanes(): Promise<void> };
    const watchPromise = orchestrator.watchUntilComplete({ timeoutMs: 5000 });
    await poll.pollAllLanes(); // lane completes → verifyLaneOutput → allTerminal → merge() → complete()
    await watchPromise; // resolves once state transitions to "completed"

    // With 1 valid candidate (test-file patch), merge succeeds → completed
    expect(orchestrator.currentStatus).toBe("completed");

    const synthesis = orchestrator.currentRunState?.finalSynthesis;
    expect(synthesis).toBeDefined();
    expect(synthesis!.candidateLanes).toHaveLength(1);
  });

  it("budget:agent-limit fires exactly once even with multiple polls past cap", async () => {
    testDir = await makeTestDir();

    const agentLimitEvents: Array<{ agentId: string; report: FleetBudgetReport }> = [];

    // Per-agent cap: 50 tokens. Adapter always reports 100 (> 50) every poll.
    const adapter = makeSequencedAdapter([
      { status: "running", tokensUsed: 100, costUsd: 0 },
      { status: "running", tokensUsed: 100, costUsd: 0 },
      { status: "running", tokensUsed: 100, costUsd: 0 },
    ]);
    const adapters = new Map<AgentKind, CouncilAgentAdapter>([["dantecode", adapter]]);
    const orchestrator = new CouncilOrchestrator(adapters, {
      pollIntervalMs: 999_999,
      maxLaneRetries: 0,
      councilConfig: {
        budget: {
          maxTotalTokens: 10_000,
          maxTotalCostUsd: 0,
          maxTokensPerAgent: 50,
          warningThreshold: 0.99,
        },
      },
    });
    activeOrchestrators.push(orchestrator);
    orchestrator.on("error", () => {});
    orchestrator.on("budget:agent-limit", (e) => agentLimitEvents.push(e));

    await orchestrator.start({ objective: "cap dedup", agents: ["dantecode"], repoRoot: testDir });
    injectSession(orchestrator, "cap-s1", { laneId: "dantecode-cap-s1" });

    // Spy on abortTask to verify the lane is actually signalled to stop
    const abortSpy = vi.spyOn(adapter, "abortTask");

    const poll = orchestrator as unknown as { pollAllLanes(): Promise<void> };
    // Three poll cycles — event should fire only once; abort should be called exactly once
    await poll.pollAllLanes();
    await poll.pollAllLanes();
    await poll.pollAllLanes();

    expect(agentLimitEvents).toHaveLength(1);
    expect(agentLimitEvents[0]!.agentId).toBe("dantecode-cap-s1");
    // abortTask must have been called exactly once (on first breach, not on subsequent polls)
    expect(abortSpy).toHaveBeenCalledTimes(1);
    // Lane should have been stopped on first breach
    const state = (orchestrator as unknown as { runState: { agents: AgentSessionState[] } })
      .runState;
    const lane = state!.agents.find((a) => a.laneId === "dantecode-cap-s1");
    expect(lane?.status).toBe("failed");
  });

  it("redistribution: completing lane triggers new lane spawn (no idle injection needed)", async () => {
    testDir = await makeTestDir();

    const redistributionEvents: Array<{
      fromLaneId: string;
      toLaneId: string;
      subObjective: string;
    }> = [];

    // completing adapter (dantecode) → returns "completed"
    // running adapter (codex) → stays "running" with decomposable objective
    const completingAdapter: CouncilAgentAdapter = {
      id: "dantecode",
      displayName: "Completing",
      kind: "native-cli",
      probeAvailability: async () => ({ available: true, health: "ready" as const }),
      estimateCapacity: async () => ({ remainingCapacity: 100, capSuspicion: "none" as const }),
      submitTask: async () => ({ sessionId: randomUUID().slice(0, 12), accepted: true }),
      pollStatus: async (sessionId: string) => ({ sessionId, status: "completed" as const }),
      collectArtifacts: async (sessionId: string) => ({ sessionId, files: [], logs: [] }),
      collectPatch: async () => null,
      detectRateLimit: async () => ({ detected: false, confidence: "none" as const }),
      abortTask: async () => {},
    };
    const runningAdapter: CouncilAgentAdapter = {
      id: "codex",
      displayName: "Running",
      kind: "native-cli",
      probeAvailability: async () => ({ available: true, health: "ready" as const }),
      estimateCapacity: async () => ({ remainingCapacity: 100, capSuspicion: "none" as const }),
      submitTask: async () => ({ sessionId: randomUUID().slice(0, 12), accepted: true }),
      pollStatus: async (sessionId: string) => ({ sessionId, status: "running" as const }),
      collectArtifacts: async (sessionId: string) => ({ sessionId, files: [], logs: [] }),
      collectPatch: async () => null,
      detectRateLimit: async () => ({ detected: false, confidence: "none" as const }),
      abortTask: async () => {},
    };

    const adapters = new Map<AgentKind, CouncilAgentAdapter>([
      ["dantecode", completingAdapter],
      ["codex", runningAdapter],
    ]);
    const orchestrator = new CouncilOrchestrator(adapters, {
      pollIntervalMs: 999_999,
      maxLaneRetries: 0,
    });
    activeOrchestrators.push(orchestrator);
    orchestrator.on("error", () => {});
    orchestrator.on("redistribution", (e) => redistributionEvents.push(e));

    await orchestrator.start({
      objective: "redistribution new-lane test",
      agents: ["dantecode", "codex"],
      repoRoot: testDir,
    });

    const state = (orchestrator as unknown as { runState: { agents: AgentSessionState[] } })
      .runState;
    const initialCount = state!.agents.length;

    // Inject completing lane and a busy lane with decomposable objective
    state!.agents.push({
      laneId: "dantecode-completing",
      agentKind: "dantecode",
      adapterKind: "native-cli",
      sessionId: "completing-new",
      status: "running",
      health: "ready",
      worktreePath: testDir,
      branch: "feat/completing-new",
      assignedFiles: ["src/auth.ts"],
      objective: "Implement auth module",
      taskCategory: "coding",
      touchedFiles: [],
      retryCount: 0,
      nestingDepth: 0,
      startedAt: new Date().toISOString(),
      lastProgressAt: new Date().toISOString(),
    });
    state!.agents.push({
      laneId: "codex-busy",
      agentKind: "codex",
      adapterKind: "native-cli",
      sessionId: "busy-new",
      status: "running",
      health: "ready",
      worktreePath: testDir,
      branch: "feat/busy-new",
      assignedFiles: ["src/server.ts"],
      objective: "Implement feature A and then refactor module B and also add unit tests",
      taskCategory: "coding",
      touchedFiles: [],
      retryCount: 0,
      nestingDepth: 0,
      startedAt: new Date(Date.now() - 200_000).toISOString(),
      lastProgressAt: new Date().toISOString(),
    });

    const poll = orchestrator as unknown as { pollAllLanes(): Promise<void> };
    await poll.pollAllLanes();

    // Redistribution should have fired and a new lane spawned
    expect(redistributionEvents).toHaveLength(1);
    expect(redistributionEvents[0]!.fromLaneId).toBe("codex-busy");
    expect(redistributionEvents[0]!.toLaneId).not.toBe("dantecode-completing");
    expect(redistributionEvents[0]!.subObjective).toBeTruthy();
    // New lane was added to runState
    expect(state!.agents.length).toBeGreaterThan(initialCount + 2);
  });

  it("verifyLaneOutput results are set on the session synchronously after pollAllLanes (await not void)", async () => {
    testDir = await makeTestDir();

    // Source-only patch → score = 55, passed = false (below 70 threshold).
    // If verifyLaneOutput were still fire-and-forget, the session might not have pdseScore
    // set by the time we check synchronously after pollAllLanes() returns.
    const DIFF_SOURCE_ONLY = [
      "diff --git a/src/auth.ts b/src/auth.ts",
      "index 0000000..abc1234 100644",
      "--- /dev/null",
      "+++ b/src/auth.ts",
      "@@ -0,0 +1,3 @@",
      "+export function authenticate(token: string): boolean {",
      "+  return token.startsWith('Bearer ');",
      "+}",
    ].join("\n");

    const adapter = makeSequencedAdapter([{ status: "completed" }], {
      unifiedDiff: DIFF_SOURCE_ONLY,
      changedFiles: ["src/auth.ts"],
    });
    const adapters = new Map<AgentKind, CouncilAgentAdapter>([["dantecode", adapter]]);
    const orchestrator = new CouncilOrchestrator(adapters, {
      pollIntervalMs: 999_999,
      maxLaneRetries: 0,
    });
    activeOrchestrators.push(orchestrator);
    orchestrator.on("error", () => {});

    await orchestrator.start({
      objective: "await pdse verify",
      agents: ["dantecode"],
      repoRoot: testDir,
    });
    injectSession(orchestrator, "pdse-s1", { laneId: "dantecode-pdse-s1" });

    const poll = orchestrator as unknown as { pollAllLanes(): Promise<void> };
    await poll.pollAllLanes(); // completes → verifyLaneOutput awaited → pdseScore set

    // Verify results are present immediately (no timeout needed — verifyLaneOutput is awaited)
    const state = (orchestrator as unknown as { runState: { agents: AgentSessionState[] } })
      .runState;
    const lane = state!.agents.find((a) => a.laneId === "dantecode-pdse-s1");

    expect(lane?.pdseScore).toBe(55);
    expect(lane?.verificationPassed).toBe(false);
  });

  it("pollAllLanes: orchestrator fails after MAX_POLL_ITERATIONS to prevent infinite deadlock", async () => {
    testDir = await makeTestDir();

    // Adapter always returns "running" — simulates a lane that never terminates.
    const adapter = makeSequencedAdapter([{ status: "running" }]);
    const adapters = new Map<AgentKind, CouncilAgentAdapter>([["dantecode", adapter]]);
    const orchestrator = new CouncilOrchestrator(adapters, {
      pollIntervalMs: 999_999,
      maxLaneRetries: 0,
    });
    activeOrchestrators.push(orchestrator);
    orchestrator.on("error", () => {});

    await orchestrator.start({
      objective: "infinite poll test",
      agents: ["dantecode"],
      repoRoot: testDir,
    });
    injectSession(orchestrator, "infinite-s1");

    // Bypass 10_000 actual iterations by pre-setting _pollCount to 9_999.
    // The next call to pollAllLanes() will increment to 10_000 and trigger fail().
    const oc = orchestrator as unknown as { _pollCount: number };
    oc._pollCount = 9_999;

    const poll = orchestrator as unknown as { pollAllLanes(): Promise<void> };
    await poll.pollAllLanes();

    expect(orchestrator.currentStatus).toBe("failed");
  });

  it("maxNestingDepth: redistribution of sublane blocked when depth >= maxNestingDepth", async () => {
    testDir = await makeTestDir();

    const redistributionEvents: Array<{
      fromLaneId: string;
      toLaneId: string;
      subObjective: string;
    }> = [];

    // maxNestingDepth=1 means: only depth=0 lanes allowed; sublanes (depth=1) must be blocked.
    // When the completing lane (nestingDepth=0) triggers redistribution, it tries to spawn
    // assignLane({ nestingDepth: 1 }), which should be blocked by the guard.
    const completingAdapter: CouncilAgentAdapter = {
      id: "dantecode",
      displayName: "Completing",
      kind: "native-cli",
      probeAvailability: async () => ({ available: true, health: "ready" as const }),
      estimateCapacity: async () => ({ remainingCapacity: 100, capSuspicion: "none" as const }),
      submitTask: async () => ({ sessionId: randomUUID().slice(0, 12), accepted: true }),
      pollStatus: async (sessionId: string) => ({ sessionId, status: "completed" as const }),
      collectArtifacts: async (sessionId: string) => ({ sessionId, files: [], logs: [] }),
      collectPatch: async () => null,
      detectRateLimit: async () => ({ detected: false, confidence: "none" as const }),
      abortTask: async () => {},
    };
    const runningAdapter: CouncilAgentAdapter = {
      id: "codex",
      displayName: "Running",
      kind: "native-cli",
      probeAvailability: async () => ({ available: true, health: "ready" as const }),
      estimateCapacity: async () => ({ remainingCapacity: 100, capSuspicion: "none" as const }),
      submitTask: async () => ({ sessionId: randomUUID().slice(0, 12), accepted: true }),
      pollStatus: async (sessionId: string) => ({ sessionId, status: "running" as const }),
      collectArtifacts: async (sessionId: string) => ({ sessionId, files: [], logs: [] }),
      collectPatch: async () => null,
      detectRateLimit: async () => ({ detected: false, confidence: "none" as const }),
      abortTask: async () => {},
    };

    const adapters = new Map<AgentKind, CouncilAgentAdapter>([
      ["dantecode", completingAdapter],
      ["codex", runningAdapter],
    ]);
    const orchestrator = new CouncilOrchestrator(adapters, {
      pollIntervalMs: 999_999,
      maxLaneRetries: 0,
      councilConfig: { maxNestingDepth: 1 },
    });
    activeOrchestrators.push(orchestrator);
    orchestrator.on("error", () => {});
    orchestrator.on("redistribution", (e) => redistributionEvents.push(e));

    await orchestrator.start({
      objective: "nesting redistribution block test",
      agents: ["dantecode", "codex"],
      repoRoot: testDir,
    });

    const state = (orchestrator as unknown as { runState: { agents: AgentSessionState[] } })
      .runState;
    // Completing lane at depth=0 (root)
    state!.agents.push({
      laneId: "dantecode-completing-nest",
      agentKind: "dantecode",
      adapterKind: "native-cli",
      sessionId: "completing-nest",
      status: "running",
      health: "ready",
      worktreePath: testDir,
      branch: "feat/completing-nest",
      assignedFiles: ["src/auth.ts"],
      objective: "Implement auth module",
      taskCategory: "coding",
      touchedFiles: [],
      retryCount: 0,
      nestingDepth: 0,
      startedAt: new Date().toISOString(),
      lastProgressAt: new Date().toISOString(),
    });
    // Busy lane with decomposable objective — redistribution would try depth=1 sublane
    state!.agents.push({
      laneId: "codex-busy-nest",
      agentKind: "codex",
      adapterKind: "native-cli",
      sessionId: "busy-nest",
      status: "running",
      health: "ready",
      worktreePath: testDir,
      branch: "feat/busy-nest",
      assignedFiles: ["src/server.ts"],
      objective: "Implement feature A and then refactor module B and also add unit tests",
      taskCategory: "coding",
      touchedFiles: [],
      retryCount: 0,
      nestingDepth: 0,
      startedAt: new Date(Date.now() - 200_000).toISOString(),
      lastProgressAt: new Date().toISOString(),
    });

    const poll = orchestrator as unknown as { pollAllLanes(): Promise<void> };
    await poll.pollAllLanes();

    // Redistribution tried nestingDepth=1 → maxNestingDepth=1 guard blocked it (1>=1)
    // → assignLane throws → catch emits error + returns null → no redistribution event fired
    expect(redistributionEvents).toHaveLength(0);
    // Orchestrator should still be running (the best-effort failure is not fatal)
    expect(orchestrator.currentStatus).toBe("running");
  });

  it("budget:exhausted fires exactly once even across multiple polls (_budgetExhaustFired guard)", async () => {
    testDir = await makeTestDir();

    const exhaustedEvents: FleetBudgetReport[] = [];

    // Fleet cap: 50 tokens. Adapter always reports 100 tokens — exceeds limit on first poll.
    const adapter = makeSequencedAdapter([
      { status: "running", tokensUsed: 100, costUsd: 0 },
      { status: "running", tokensUsed: 100, costUsd: 0 },
      { status: "running", tokensUsed: 100, costUsd: 0 },
    ]);
    const adapters = new Map<AgentKind, CouncilAgentAdapter>([["dantecode", adapter]]);
    const orchestrator = new CouncilOrchestrator(adapters, {
      pollIntervalMs: 999_999,
      maxLaneRetries: 0,
      councilConfig: {
        budget: {
          maxTotalTokens: 50,
          maxTotalCostUsd: 0,
          maxTokensPerAgent: 0,
          warningThreshold: 0.99,
        },
      },
    });
    activeOrchestrators.push(orchestrator);
    orchestrator.on("error", () => {});
    orchestrator.on("budget:exhausted", (r) => exhaustedEvents.push(r));

    await orchestrator.start({
      objective: "exhaust dedup",
      agents: ["dantecode"],
      repoRoot: testDir,
    });
    injectSession(orchestrator, "exhaust-s1", { laneId: "dantecode-exhaust-s1" });

    const poll = orchestrator as unknown as { pollAllLanes(): Promise<void> };
    // First poll exhausts the fleet budget and triggers fail()
    await poll.pollAllLanes();
    // Subsequent polls must NOT re-emit budget:exhausted (_budgetExhaustFired guards this)
    await poll.pollAllLanes();
    await poll.pollAllLanes();

    expect(exhaustedEvents).toHaveLength(1);
    // fail() was called on first exhaustion — orchestrator is now in "failed" state
    expect(orchestrator.currentStatus).toBe("failed");
  });

  it("verifyLaneOutput: score=0 when changedFiles includes a forbiddenFile (NOMA pre-merge gate)", async () => {
    testDir = await makeTestDir();

    const verifyFailedEvents: Array<{ laneId: string; score: number; findings: string[] }> = [];

    // Adapter returns a patch touching one legitimate file and one forbidden file
    const adapter = makeSequencedAdapter([{ status: "completed" }], {
      unifiedDiff: [
        "diff --git a/src/auth.ts b/src/auth.ts",
        "--- /dev/null",
        "+++ b/src/auth.ts",
        "@@ -0,0 +1 @@",
        "+export const token = 'x';",
      ].join("\n"),
      changedFiles: ["src/secrets.ts", "src/auth.ts"],
    });
    const adapters = new Map<AgentKind, CouncilAgentAdapter>([["dantecode", adapter]]);
    const orchestrator = new CouncilOrchestrator(adapters, {
      pollIntervalMs: 999_999,
      maxLaneRetries: 0,
    });
    activeOrchestrators.push(orchestrator);
    orchestrator.on("error", () => {});
    orchestrator.on("lane:verify-failed", (e) => verifyFailedEvents.push(e));

    await orchestrator.start({ objective: "noma test", agents: ["dantecode"], repoRoot: testDir });
    injectSession(orchestrator, "noma-s1", { laneId: "dantecode-noma-s1" });

    // Inject a NOMA mandate: src/secrets.ts is a forbidden file for this lane
    type MandateShape = {
      laneId: string;
      ownedFiles: string[];
      readOnlyFiles: string[];
      forbiddenFiles: string[];
      contractDependencies: string[];
      overlapPolicy: string;
    };
    const runState = (
      orchestrator as unknown as {
        runState: { agents: AgentSessionState[]; mandates: MandateShape[] };
      }
    ).runState;
    runState!.mandates.push({
      laneId: "dantecode-noma-s1",
      ownedFiles: ["src/auth.ts"],
      readOnlyFiles: [],
      forbiddenFiles: ["src/secrets.ts"],
      contractDependencies: [],
      overlapPolicy: "freeze",
    });

    const poll = orchestrator as unknown as { pollAllLanes(): Promise<void> };
    await poll.pollAllLanes();

    const lane = runState!.agents.find((a) => a.laneId === "dantecode-noma-s1");
    // Lane must score 0 — NOMA violation overrides all scoring heuristics
    expect(lane?.pdseScore).toBe(0);
    expect(lane?.verificationPassed).toBe(false);
    // lane:verify-failed event must be emitted with NOMA-specific findings
    expect(verifyFailedEvents).toHaveLength(1);
    expect(verifyFailedEvents[0]!.laneId).toBe("dantecode-noma-s1");
    expect(verifyFailedEvents[0]!.findings.some((f) => f.includes("NOMA violation"))).toBe(true);
    expect(verifyFailedEvents[0]!.findings.some((f) => f.includes("src/secrets.ts"))).toBe(true);
  });

  it("verifyLaneOutput: score=0 and no TypeError when unifiedDiff is non-string (type guard)", async () => {
    testDir = await makeTestDir();

    const verifyFailedEvents: Array<{ laneId: string; score: number; findings: string[] }> = [];

    // Adapter returns a truthy non-string unifiedDiff — simulates a badly-typed adapter response
    const badDiff = Buffer.from("fake diff content") as unknown as string;
    const adapter = makeSequencedAdapter([{ status: "completed" }], {
      unifiedDiff: badDiff,
      changedFiles: ["src/x.ts"],
    });
    const adapters = new Map<AgentKind, CouncilAgentAdapter>([["dantecode", adapter]]);
    const orchestrator = new CouncilOrchestrator(adapters, {
      pollIntervalMs: 999_999,
      maxLaneRetries: 0,
    });
    activeOrchestrators.push(orchestrator);
    orchestrator.on("error", () => {});
    orchestrator.on("lane:verify-failed", (e) => verifyFailedEvents.push(e));

    await orchestrator.start({
      objective: "type guard test",
      agents: ["dantecode"],
      repoRoot: testDir,
    });
    injectSession(orchestrator, "tg-s1", { laneId: "dantecode-tg-s1" });

    // Must not throw TypeError despite non-string unifiedDiff — the type guard catches it
    const poll = orchestrator as unknown as { pollAllLanes(): Promise<void> };
    await poll.pollAllLanes();

    const state = (orchestrator as unknown as { runState: { agents: AgentSessionState[] } })
      .runState;
    const lane = state!.agents.find((a) => a.laneId === "dantecode-tg-s1");
    // pdseScore must be 0 (not undefined) — proves type guard fired and set the score
    expect(lane?.pdseScore).toBe(0);
    expect(lane?.verificationPassed).toBe(false);
    expect(verifyFailedEvents).toHaveLength(1);
  });
});
