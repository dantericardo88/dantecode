// ============================================================================
// E2E: Council Lifecycle — spawn -> assign -> detect overlap -> merge -> verify
// ============================================================================

import { describe, it, expect, beforeEach } from "vitest";
import { CouncilResilience } from "../../council/council-resilience.js";

describe("E2E: Council Lifecycle", () => {
  let resilience: CouncilResilience;

  beforeEach(() => {
    resilience = new CouncilResilience();
  });

  it("spawns council, assigns tasks, and completes all lanes", () => {
    // Step 1: Spawn agents
    const agents = ["agent-a", "agent-b", "agent-c"];
    const tasks = ["task-1", "task-2", "task-3", "task-4", "task-5", "task-6"];

    // Step 2: Verify no agents are stale at start
    const now = Date.now();
    for (const agent of agents) {
      expect(resilience.detectStaleAgent(agent, now, 60_000)).toBe(false);
    }

    // Step 3: All tasks complete
    const report = resilience.recoverPartialCompletion(tasks, tasks);
    expect(report.completionPercentage).toBe(100);
    expect(report.canContinue).toBe(true);
    expect(report.pending).toHaveLength(0);
  });

  it("detects stale agent and redistributes its tasks", () => {
    const agents = ["agent-a", "agent-b", "agent-c"];

    // Agent-b goes stale (no output for 5 minutes)
    const fiveMinutesAgo = Date.now() - 5 * 60_000;
    expect(resilience.detectStaleAgent("agent-b", fiveMinutesAgo, 60_000)).toBe(true);

    // Redistribute agent-b's tasks to remaining agents
    const agentBTasks = ["t3", "t4"];
    const remaining = agents.filter((a) => a !== "agent-b");
    const plan = resilience.handleAgentFailure("agent-b", agentBTasks, remaining);

    expect(plan.reassignments).toHaveLength(2);
    expect(plan.unassignable).toHaveLength(0);
    expect(plan.reassignments[0]!.toAgent).toBe("agent-a");
    expect(plan.reassignments[1]!.toAgent).toBe("agent-c");
  });

  it("handles complete council failure with partial recovery", () => {
    const allTasks = ["t1", "t2", "t3", "t4", "t5"];
    const completedTasks = ["t1"]; // Only 1 of 5 completed

    // Council times out
    const thirtyMinAgo = Date.now() - 30 * 60_000;
    expect(resilience.monitorCouncilTimeout(thirtyMinAgo, 15 * 60_000)).toBe(true);

    // Partial recovery check
    const report = resilience.recoverPartialCompletion(completedTasks, allTasks);
    expect(report.completionPercentage).toBe(20);
    expect(report.canContinue).toBe(false); // Below 25% threshold
    expect(report.pending).toEqual(["t2", "t3", "t4", "t5"]);
  });

  it("council succeeds with redistribution after single agent failure", () => {
    // Agent-a fails, its tasks get redistributed
    const plan = resilience.handleAgentFailure(
      "agent-a",
      ["t1", "t2"],
      ["agent-b", "agent-c"],
    );
    expect(plan.reassignments).toHaveLength(2);

    // After redistribution, all tasks eventually complete
    const allTasks = ["t1", "t2", "t3", "t4", "t5", "t6"];
    const report = resilience.recoverPartialCompletion(allTasks, allTasks);
    expect(report.completionPercentage).toBe(100);
    expect(report.canContinue).toBe(true);

    // No timeout
    const recentStart = Date.now() - 5 * 60_000;
    expect(resilience.monitorCouncilTimeout(recentStart, 30 * 60_000)).toBe(false);
  });
});
