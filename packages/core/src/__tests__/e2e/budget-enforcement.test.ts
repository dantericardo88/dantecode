// ============================================================================
// E2E: Budget Enforcement — Real module instances
// Uses actual TaskComplexityRouter and FleetBudget to verify budget tracking,
// warning thresholds, exhaustion halting, and adaptive routing.
// ============================================================================

import { describe, it, expect, beforeEach } from "vitest";
import {
  TaskComplexityRouter,
  type ComplexitySignals,
  type ComplexityDecision,
} from "../../task-complexity-router.js";
import { FleetBudget } from "../../council/fleet-budget.js";

// Shim: map new ComplexityDecision to a shape compatible with old e2e assertions
function routeTask(
  router: TaskComplexityRouter,
  _taskId: string,
  oldSignals: {
    tokenCount: number;
    fileCount: number;
    reasoningDepth: number;
    securitySensitivity: number;
    hasCodeGeneration: boolean;
    hasMultiFileEdit: boolean;
  },
): { model: { modelId: string; tier: string }; decision: ComplexityDecision } {
  const signals: ComplexitySignals = {
    promptTokens: oldSignals.tokenCount * 10, // scale up for realistic thresholds
    fileCount: oldSignals.fileCount,
    hasReasoning: oldSignals.reasoningDepth > 30,
    hasSecurity: oldSignals.securitySensitivity > 30,
    hasMultiFile: oldSignals.hasMultiFileEdit,
    estimatedOutputTokens: oldSignals.tokenCount * 5,
  };
  const decision = router.classify(signals);
  return {
    model: { modelId: router.getModel(decision.complexity), tier: decision.complexity },
    decision,
  };
}

describe("E2E: Budget Enforcement (real modules)", () => {
  let router: TaskComplexityRouter;
  let budget: FleetBudget;

  // Track routing decisions manually (shim replaces old logRoutingDecision)
  let decisions: ComplexityDecision[];

  beforeEach(() => {
    router = new TaskComplexityRouter({
      simpleModel: "mini",
      standardModel: "standard",
      complexModel: "opus",
    });
    decisions = [];
  });

  it("routes simple tasks to cheap models and tracks budget consumption", () => {
    budget = new FleetBudget({
      maxTotalTokens: 50_000,
      warningThreshold: 0.8,
    });

    // Run 5 simple tasks, each consuming 2000 tokens
    for (let i = 0; i < 5; i++) {
      const { model, decision } = routeTask(router, `simple-${i}`, {
        tokenCount: 10,
        fileCount: 1,
        reasoningDepth: 0,
        securitySensitivity: 0,
        hasCodeGeneration: false,
        hasMultiFileEdit: false,
      });
      decisions.push(decision);

      expect(model.modelId).toBe("mini");
      expect(decision.complexity).toBe("simple");

      // Record cumulative tokens for agent
      const allowed = budget.record(`agent-${i}`, 2000, 0.6);
      expect(allowed).toBe(true);
    }

    // Verify budget tracking
    const report = budget.report();
    expect(report.totalTokens).toBe(10_000); // 5 * 2000
    expect(report.budgetRemaining).toBe(40_000);
    expect(report.perAgent).toHaveLength(5);
    expect(budget.isExhausted()).toBe(false);
    expect(budget.isWarning()).toBe(false);

    // Verify all routing decisions logged
    expect(decisions).toHaveLength(5);
  });

  it("FleetBudget warns at threshold and tracks per-agent usage", () => {
    budget = new FleetBudget({
      maxTotalTokens: 10_000,
      warningThreshold: 0.8,
    });

    // Agent A uses 5000 tokens
    budget.record("agent-a", 5000, 1.5);
    expect(budget.isWarning()).toBe(false);
    expect(budget.isExhausted()).toBe(false);

    // Agent B pushes past 80% warning threshold (5000 + 3500 = 8500 = 85%)
    budget.record("agent-b", 3500, 1.05);
    expect(budget.isWarning()).toBe(true);
    expect(budget.isExhausted()).toBe(false);

    // Verify per-agent breakdown
    const report = budget.report();
    expect(report.totalTokens).toBe(8500);

    const agentA = report.perAgent.find((a) => a.agentId === "agent-a");
    expect(agentA).toBeDefined();
    expect(agentA!.tokens).toBe(5000);
    expect(agentA!.pctOfTotal).toBe(59); // 5000/8500 * 100 rounded

    const agentB = report.perAgent.find((a) => a.agentId === "agent-b");
    expect(agentB).toBeDefined();
    expect(agentB!.tokens).toBe(3500);

    // Both agents can still continue
    expect(budget.canContinue("agent-a")).toBe(true);
    expect(budget.canContinue("agent-b")).toBe(true);
  });

  it("budget exhaustion halts further allocation", () => {
    budget = new FleetBudget({
      maxTotalTokens: 5000,
      maxTokensPerAgent: 3000,
      warningThreshold: 0.8,
    });

    // Agent uses 2500 tokens (within both limits)
    let allowed = budget.record("agent-main", 2500, 0.75);
    expect(allowed).toBe(true);
    expect(budget.canContinue("agent-main")).toBe(true);

    // Another agent uses 2600 tokens (pushes total to 5100, exceeding fleet limit)
    allowed = budget.record("agent-helper", 2600, 0.78);
    expect(allowed).toBe(false);
    expect(budget.isExhausted()).toBe(true);

    // Neither agent can continue once fleet budget is exhausted
    expect(budget.canContinue("agent-main")).toBe(false);
    expect(budget.canContinue("agent-helper")).toBe(false);

    // Report shows budget remaining = 0
    const report = budget.report();
    expect(report.budgetRemaining).toBe(0);
    expect(report.totalTokens).toBe(5100);
  });

  it("per-agent limit enforcement independent of fleet limit", () => {
    budget = new FleetBudget({
      maxTotalTokens: 100_000, // High fleet limit
      maxTokensPerAgent: 5000, // Low per-agent limit
      warningThreshold: 0.8,
    });

    // Agent hits per-agent limit
    const allowed = budget.record("greedy-agent", 5000, 1.5);
    expect(allowed).toBe(false); // Per-agent limit hit
    expect(budget.isExhausted()).toBe(false); // Fleet budget is fine

    // Other agents can still work
    expect(budget.canContinue("new-agent")).toBe(true);
    expect(budget.canContinue("greedy-agent")).toBe(false);

    // Remaining for greedy agent is 0
    const remaining = budget.remainingForAgent("greedy-agent");
    expect(remaining.tokens).toBe(0);

    // Remaining for new agent is full per-agent allowance
    const newRemaining = budget.remainingForAgent("new-agent");
    expect(newRemaining.tokens).toBe(5000);
  });

  it("full pipeline: route tasks -> track budget -> adapt as budget depletes", () => {
    budget = new FleetBudget({
      maxTotalTokens: 15_000,
      warningThreshold: 0.7,
    });

    const tasksCompleted: string[] = [];

    // Simulate a pipeline of tasks with varying complexity
    const taskSequence = [
      {
        id: "t1",
        signals: {
          tokenCount: 10,
          fileCount: 1,
          reasoningDepth: 5,
          securitySensitivity: 0,
          hasCodeGeneration: false,
          hasMultiFileEdit: false,
        },
        tokensUsed: 3000,
      },
      {
        id: "t2",
        signals: {
          tokenCount: 500,
          fileCount: 5,
          reasoningDepth: 40,
          securitySensitivity: 20,
          hasCodeGeneration: true,
          hasMultiFileEdit: false,
        },
        tokensUsed: 5000,
      },
      {
        id: "t3",
        signals: {
          tokenCount: 2000,
          fileCount: 10,
          reasoningDepth: 70,
          securitySensitivity: 50,
          hasCodeGeneration: true,
          hasMultiFileEdit: true,
        },
        tokensUsed: 4000,
      },
      {
        id: "t4",
        signals: {
          tokenCount: 100,
          fileCount: 2,
          reasoningDepth: 10,
          securitySensitivity: 0,
          hasCodeGeneration: false,
          hasMultiFileEdit: false,
        },
        tokensUsed: 4000,
      },
    ] as const;

    let cumulativeTokens = 0;
    for (const task of taskSequence) {
      // Route the task
      const { model, decision } = routeTask(router, task.id, task.signals);
      decisions.push(decision);
      expect(model).toBeDefined();
      expect(decision.complexity).toBeDefined();

      // Track budget
      cumulativeTokens += task.tokensUsed;
      const allowed = budget.record("pipeline-agent", cumulativeTokens, 0);

      if (!allowed) {
        // Budget exhausted, stop processing
        break;
      }

      tasksCompleted.push(task.id);
    }

    // Tasks t1, t2, t3 complete (3000+5000+4000 = 12000, within 15000)
    // t4 would push to 16000, exceeding budget
    expect(tasksCompleted).toEqual(["t1", "t2", "t3"]);

    // Verify budget was warned before exhaustion
    // After t3: 12000/15000 = 80% > 70% threshold
    expect(budget.isWarning()).toBe(true);

    // Verify routing decisions capture the complexity gradient
    expect(decisions).toHaveLength(4); // All 4 were routed, even if t4 wasn't completed
    expect(decisions[0]!.complexity).toBe("simple");
    expect(decisions[2]!.complexity).toBe("complex");

    // After budget exhaustion, fleet budget shows correct state
    const report = budget.report();
    expect(report.totalTokens).toBeGreaterThanOrEqual(12000);
  });

  it("reset clears all budget state for new sessions", () => {
    budget = new FleetBudget({
      maxTotalTokens: 1000,
      warningThreshold: 0.5,
    });

    // Exhaust budget
    budget.record("agent", 1000, 0.3);
    expect(budget.isExhausted()).toBe(true);
    expect(budget.isWarning()).toBe(true);

    // Reset
    budget.reset();
    expect(budget.isExhausted()).toBe(false);
    expect(budget.isWarning()).toBe(false);
    expect(budget.canContinue("agent")).toBe(true);

    const report = budget.report();
    expect(report.totalTokens).toBe(0);
    expect(report.totalCost).toBe(0);
    expect(report.perAgent).toHaveLength(0);
    expect(report.budgetRemaining).toBe(1000);
  });
});
