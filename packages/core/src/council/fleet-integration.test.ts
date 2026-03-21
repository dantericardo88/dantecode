// ============================================================================
// Council Orchestrator — Fleet Integration Tests
// Tests that FleetBudget, TaskRedistributor, maxNestingDepth, and
// verifyLaneOutput are properly wired into CouncilOrchestrator.
// ============================================================================

import { describe, it, expect, afterEach, vi } from "vitest";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mkdir } from "node:fs/promises";
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
  const dir = join(
    tmpdir(),
    `fleet-int-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );
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
  const state = (
    orchestrator as unknown as { runState: { agents: AgentSessionState[] } }
  ).runState;
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

afterEach(() => {
  for (const o of activeOrchestrators) {
    o.on("error", () => {});
    stopPoll(o);
  }
  activeOrchestrators.length = 0;
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
        budget: { maxTotalTokens: 100, maxTotalCostUsd: 0, maxTokensPerAgent: 0, warningThreshold: 0.8 },
      },
    });
    activeOrchestrators.push(orchestrator);
    orchestrator.on("error", () => {}); // suppress unhandled error

    await orchestrator.start({ objective: "budget exhaustion", agents: ["dantecode"], repoRoot: testDir });
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

    await orchestrator.start({ objective: "budget warning", agents: ["dantecode"], repoRoot: testDir });
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

    await orchestrator.start({ objective: "nesting depth test", agents: ["dantecode"], repoRoot: testDir });

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

  it("TaskRedistributor: redistribution event fires when a completing lane finds idle+busy peers", async () => {
    testDir = await makeTestDir();

    // Three sessions: completing-s1 completes, busy-s2 stays running, idle-s3 is idle.
    // When completing-s1 completes: busyLanes=[busy-s2], idleLanes=[idle-s3]
    // → TaskRedistributor.findRedistribution() is called
    // → IF busy-s2 objective can be decomposed, redistribution event fires.
    const redistributionEvents: Array<{ fromLaneId: string; toLaneId: string; subObjective: string }> = [];

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

    await orchestrator.start({ objective: "redistribution test", agents: ["dantecode", "codex"], repoRoot: testDir });

    const state = (orchestrator as unknown as { runState: { agents: AgentSessionState[] } }).runState;

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
    state!.agents.push({
      laneId: "dantecode-idle-s3",
      agentKind: "dantecode",
      adapterKind: "native-cli",
      sessionId: "idle-s3",
      status: "idle",
      health: "ready",
      worktreePath: testDir,
      branch: "feat/idle",
      assignedFiles: ["src/idle.ts"],
      objective: "Idle agent",
      taskCategory: "coding",
      touchedFiles: [],
      retryCount: 0,
      nestingDepth: 0,
      startedAt: new Date().toISOString(),
      lastProgressAt: new Date().toISOString(),
    });

    const poll = orchestrator as unknown as { pollAllLanes(): Promise<void> };
    await poll.pollAllLanes();
    // completing-s1 (dantecode) → completed → busyLanes=[codex-busy-s2], idleLanes=[dantecode-idle-s3]
    // → findRedistribution called → busy-s2 objective decomposes → redistribution event fired

    expect(redistributionEvents).toHaveLength(1);
    expect(redistributionEvents[0]!.fromLaneId).toBe("codex-busy-s2");
    expect(redistributionEvents[0]!.toLaneId).toBe("dantecode-idle-s3");
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

    await orchestrator.start({ objective: "verify no patch", agents: ["dantecode"], repoRoot: testDir });
    injectSession(orchestrator, "nopatch-s1", { laneId: "dantecode-nopatch-s1", status: "completed" });

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

    const adapter = makeSequencedAdapter(
      [{ status: "completed" }],
      { unifiedDiff: REAL_DIFF, changedFiles: ["src/auth.ts"] },
    );
    const adapters = new Map<AgentKind, CouncilAgentAdapter>([["dantecode", adapter]]);
    const orchestrator = new CouncilOrchestrator(adapters, {
      pollIntervalMs: 999_999,
      maxLaneRetries: 0,
    });
    activeOrchestrators.push(orchestrator);
    orchestrator.on("error", () => {});

    await orchestrator.start({ objective: "verify real patch", agents: ["dantecode"], repoRoot: testDir });
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
    const state = (orchestrator as unknown as { runState: { agents: AgentSessionState[] } }).runState;
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
    orchestrator.on("budget:warning", () => { warningCount.count++; });

    await orchestrator.start({ objective: "warning once", agents: ["dantecode"], repoRoot: testDir });
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
        budget: { maxTotalTokens: 100, maxTotalCostUsd: 0, maxTokensPerAgent: 0, warningThreshold: 0.8 },
      },
    });
    activeOrchestrators.push(orchestrator);
    orchestrator.on("error", () => {});
    orchestrator.on("budget:exhausted", (report) => exhaustedReports.push(report));

    await orchestrator.start({ objective: "exhausted event", agents: ["dantecode"], repoRoot: testDir });
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
        budget: { maxTotalTokens: 10_000, maxTotalCostUsd: 0, maxTokensPerAgent: 50, warningThreshold: 0.99 },
      },
    });
    activeOrchestrators.push(orchestrator);
    orchestrator.on("error", () => {});
    orchestrator.on("budget:agent-limit", (e) => agentLimitEvents.push(e));

    await orchestrator.start({ objective: "agent limit event", agents: ["dantecode"], repoRoot: testDir });
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

    const adapter = makeSequencedAdapter(
      [{ status: "completed" }],
      { unifiedDiff: DIFF_WITH_TEST, changedFiles: ["src/auth.test.ts"] },
    );
    const adapters = new Map<AgentKind, CouncilAgentAdapter>([["dantecode", adapter]]);
    const orchestrator = new CouncilOrchestrator(adapters, {
      pollIntervalMs: 999_999,
      maxLaneRetries: 0,
    });
    activeOrchestrators.push(orchestrator);
    orchestrator.on("error", () => {});
    orchestrator.on("lane:verified", (e) => verifiedEvents.push(e));

    await orchestrator.start({ objective: "lane verified event", agents: ["dantecode"], repoRoot: testDir });
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

    const adapter = makeSequencedAdapter(
      [{ status: "completed" }],
      { unifiedDiff: DIFF_SOURCE_ONLY, changedFiles: ["src/auth.ts"] },
    );
    const adapters = new Map<AgentKind, CouncilAgentAdapter>([["dantecode", adapter]]);
    const orchestrator = new CouncilOrchestrator(adapters, {
      pollIntervalMs: 999_999,
      maxLaneRetries: 0,
    });
    activeOrchestrators.push(orchestrator);
    orchestrator.on("error", () => {});
    orchestrator.on("lane:accepted-with-warning", (e) => warningEvents.push(e));

    await orchestrator.start({ objective: "lane accepted-with-warning", agents: ["dantecode"], repoRoot: testDir });
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

    const adapter = makeSequencedAdapter(
      [{ status: "completed" }],
      { unifiedDiff: DIFF_SOURCE, changedFiles: ["src/gate.ts"] },
    );
    const adapters = new Map<AgentKind, CouncilAgentAdapter>([["dantecode", adapter]]);
    const orchestrator = new CouncilOrchestrator(adapters, {
      pollIntervalMs: 5,
      maxLaneRetries: 0,
    });
    activeOrchestrators.push(orchestrator);
    orchestrator.on("error", () => {});

    // Spy on verifyLaneOutput: synchronously mark the lane as verify-failed
    // (verificationPassed=false, pdseScore=0) before returning the Promise.
    // The synchronous assignment runs before the gate check in merge(), which
    // happens before merge()'s first internal await.
    const runState = (orchestrator as unknown as { runState: { agents: AgentSessionState[] } });
    vi.spyOn(orchestrator, "verifyLaneOutput").mockImplementation(async (laneId: string) => {
      const lane = runState.runState?.agents.find((a) => a.laneId === laneId);
      if (lane) {
        lane.verificationPassed = false;
        lane.pdseScore = 0;
      }
      orchestrator.emit("lane:verify-failed", { laneId, score: 0, findings: ["mocked: no changes"] });
      return { passed: false, score: 0, findings: ["mocked: no changes"] };
    });

    await orchestrator.start({ objective: "gate test: fail", agents: ["dantecode"], repoRoot: testDir });
    injectSession(orchestrator, "gate-s1", { laneId: "dantecode-gate-s1" });

    // watchUntilComplete triggers polling → lane completes → verify spy fires → merge excludes lane
    await orchestrator.watchUntilComplete({ timeoutMs: 5000 });

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

    const adapter = makeSequencedAdapter(
      [{ status: "completed" }],
      { unifiedDiff: DIFF_WITH_TEST, changedFiles: ["src/auth.test.ts"] },
    );
    const adapters = new Map<AgentKind, CouncilAgentAdapter>([["dantecode", adapter]]);
    const orchestrator = new CouncilOrchestrator(adapters, {
      pollIntervalMs: 5,
      maxLaneRetries: 0,
    });
    activeOrchestrators.push(orchestrator);
    orchestrator.on("error", () => {});

    await orchestrator.start({ objective: "gate test: pass", agents: ["dantecode"], repoRoot: testDir });
    injectSession(orchestrator, "gate-pass-s1", { laneId: "dantecode-gate-pass-s1" });

    // Real verifyLaneOutput runs: test file → score=85, passed=true, verificationPassed=true
    await orchestrator.watchUntilComplete({ timeoutMs: 5000 });

    // With 1 valid candidate (test-file patch), merge succeeds → completed
    expect(orchestrator.currentStatus).toBe("completed");

    const synthesis = orchestrator.currentRunState?.finalSynthesis;
    expect(synthesis).toBeDefined();
    expect(synthesis!.candidateLanes).toHaveLength(1);
  });
});
