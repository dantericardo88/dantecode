// ============================================================================
// @dantecode/core — SubAgentManager Tests
// 35 unit tests covering spawn, parallel, lifecycle, delegation, and stats.
// ============================================================================

import { describe, it, expect, beforeEach } from "vitest";
import { SubAgentManager } from "./subagent-manager.js";

// ----------------------------------------------------------------------------
// Helpers
// ----------------------------------------------------------------------------

function makeManager(overrides: ConstructorParameters<typeof SubAgentManager>[0] = {}) {
  return new SubAgentManager({ maxConcurrency: 4, maxDepth: 3, defaultMaxRounds: 50, ...overrides });
}

// ----------------------------------------------------------------------------
// Test Suite
// ----------------------------------------------------------------------------

describe("SubAgentManager", () => {
  let manager: SubAgentManager;

  beforeEach(() => {
    manager = makeManager();
  });

  // --------------------------------------------------------------------------
  // 1. Constructor defaults
  // --------------------------------------------------------------------------
  it("applies default options when constructed with no arguments", () => {
    const m = new SubAgentManager();
    // Default maxDepth=3 → validateDepthLimit(3) is true, (4) is false
    expect(m.validateDepthLimit(3)).toBe(true);
    expect(m.validateDepthLimit(4)).toBe(false);
    // Default maxRounds=50: spawn a task, inspect the resulting agent config
    const task = m.spawn("test prompt");
    const agent = m.getAgent(task.agentId)!;
    expect(agent.maxRounds).toBe(50);
  });

  // --------------------------------------------------------------------------
  // 2. spawn() creates task with "pending" status
  // --------------------------------------------------------------------------
  it("spawn() creates a task with status 'pending'", () => {
    const task = manager.spawn("Refactor auth module");
    expect(task.status).toBe("pending");
    expect(task.prompt).toBe("Refactor auth module");
    expect(task.rounds).toBe(0);
    expect(task.result).toBeUndefined();
    expect(task.error).toBeUndefined();
  });

  // --------------------------------------------------------------------------
  // 3. spawn() enforces maxDepth limit
  // --------------------------------------------------------------------------
  it("spawn() throws when depth exceeds maxDepth", () => {
    // maxDepth=1 means only root-level (depth 0) spawns are allowed
    const shallow = makeManager({ maxDepth: 1 });

    // Root spawn at depth 0 — OK
    const parent = shallow.spawn("parent task");

    // Child at depth 1 — OK (depth 1 === maxDepth 1)
    const child = shallow.spawn("child task", { parentId: parent.agentId });
    expect(child.status).toBe("pending");

    // Grandchild at depth 2 — should throw
    expect(() => {
      shallow.spawn("grandchild task", { parentId: child.agentId });
    }).toThrow(/maxDepth/);
  });

  // --------------------------------------------------------------------------
  // 4. spawn() generates unique IDs
  // --------------------------------------------------------------------------
  it("spawn() generates unique task and agent IDs", () => {
    const t1 = manager.spawn("task one");
    const t2 = manager.spawn("task two");
    expect(t1.id).not.toBe(t2.id);
    expect(t1.agentId).not.toBe(t2.agentId);
  });

  // --------------------------------------------------------------------------
  // 5. spawnParallel() creates multiple tasks
  // --------------------------------------------------------------------------
  it("spawnParallel() returns one task per prompt", () => {
    const prompts = ["search docs", "write tests", "update config"];
    const tasks = manager.spawnParallel(prompts);
    expect(tasks).toHaveLength(3);
    tasks.forEach((t, i) => {
      expect(t.prompt).toBe(prompts[i]);
      expect(t.status).toBe("pending");
    });
  });

  // --------------------------------------------------------------------------
  // 6. spawnParallel() respects maxConcurrency
  // --------------------------------------------------------------------------
  it("spawnParallel() throws when prompts exceed maxConcurrency", () => {
    const limited = makeManager({ maxConcurrency: 2 });
    expect(() => {
      limited.spawnParallel(["a", "b", "c"]);
    }).toThrow(/maxConcurrency/);
  });

  // --------------------------------------------------------------------------
  // 7. completeTask() sets status and result
  // --------------------------------------------------------------------------
  it("completeTask() transitions task to 'completed' with result", () => {
    const task = manager.spawn("write report");
    manager.completeTask(task.id, "Report written.");
    const updated = manager.getTask(task.id)!;
    expect(updated.status).toBe("completed");
    expect(updated.result).toBe("Report written.");
  });

  // --------------------------------------------------------------------------
  // 8. failTask() sets status and error
  // --------------------------------------------------------------------------
  it("failTask() transitions task to 'failed' with error message", () => {
    const task = manager.spawn("build project");
    manager.failTask(task.id, "TypeScript compilation error.");
    const updated = manager.getTask(task.id)!;
    expect(updated.status).toBe("failed");
    expect(updated.error).toBe("TypeScript compilation error.");
  });

  // --------------------------------------------------------------------------
  // 9. cancelTask() sets status
  // --------------------------------------------------------------------------
  it("cancelTask() transitions task to 'cancelled'", () => {
    const task = manager.spawn("long running task");
    manager.cancelTask(task.id);
    expect(manager.getTask(task.id)!.status).toBe("cancelled");
  });

  // --------------------------------------------------------------------------
  // 10. getTask() returns task by ID
  // --------------------------------------------------------------------------
  it("getTask() returns the correct task for a known ID", () => {
    const task = manager.spawn("fetch data");
    const retrieved = manager.getTask(task.id);
    expect(retrieved).toBeDefined();
    expect(retrieved!.id).toBe(task.id);
    expect(retrieved!.prompt).toBe("fetch data");
  });

  // --------------------------------------------------------------------------
  // 11. getTask() returns undefined for unknown ID
  // --------------------------------------------------------------------------
  it("getTask() returns undefined for an unknown task ID", () => {
    expect(manager.getTask("non-existent-id")).toBeUndefined();
  });

  // --------------------------------------------------------------------------
  // 12. getAgent() returns agent config
  // --------------------------------------------------------------------------
  it("getAgent() returns the agent config for the spawned task", () => {
    const task = manager.spawn("analyze codebase", {
      name: "code-analyzer",
      tools: ["Read", "Grep"],
    });
    const agent = manager.getAgent(task.agentId);
    expect(agent).toBeDefined();
    expect(agent!.name).toBe("code-analyzer");
    expect(agent!.tools).toEqual(["Read", "Grep"]);
    expect(agent!.id).toBe(task.agentId);
  });

  // --------------------------------------------------------------------------
  // 13. listTasks() returns all tasks
  // --------------------------------------------------------------------------
  it("listTasks() returns all tasks when called without a filter", () => {
    manager.spawn("task A");
    manager.spawn("task B");
    manager.spawn("task C");
    expect(manager.listTasks()).toHaveLength(3);
  });

  // --------------------------------------------------------------------------
  // 14. listTasks() filters by status
  // --------------------------------------------------------------------------
  it("listTasks(status) returns only tasks matching that status", () => {
    const t1 = manager.spawn("task 1");
    const t2 = manager.spawn("task 2");
    manager.spawn("task 3");
    manager.completeTask(t1.id, "done");
    manager.failTask(t2.id, "err");

    expect(manager.listTasks("completed")).toHaveLength(1);
    expect(manager.listTasks("failed")).toHaveLength(1);
    expect(manager.listTasks("pending")).toHaveLength(1);
    expect(manager.listTasks("running")).toHaveLength(0);
  });

  // --------------------------------------------------------------------------
  // 15. mergeResults() combines outputs
  // --------------------------------------------------------------------------
  it("mergeResults() concatenates outputs from completed tasks", () => {
    const t1 = manager.spawn("step 1");
    const t2 = manager.spawn("step 2");
    manager.completeTask(t1.id, "Step 1 output.");
    manager.completeTask(t2.id, "Step 2 output.");

    const merged = manager.mergeResults([t1.id, t2.id]);
    expect(merged.combinedOutput).toContain("Step 1 output.");
    expect(merged.combinedOutput).toContain("Step 2 output.");
  });

  // --------------------------------------------------------------------------
  // 16. mergeResults() counts successes and failures
  // --------------------------------------------------------------------------
  it("mergeResults() accurately counts successes and failures", () => {
    const t1 = manager.spawn("success task");
    const t2 = manager.spawn("failure task");
    const t3 = manager.spawn("another success");
    manager.completeTask(t1.id, "ok");
    manager.failTask(t2.id, "oops");
    manager.completeTask(t3.id, "also ok");

    const merged = manager.mergeResults([t1.id, t2.id, t3.id]);
    expect(merged.successCount).toBe(2);
    expect(merged.failureCount).toBe(1);
    expect(merged.results).toHaveLength(3);
  });

  // --------------------------------------------------------------------------
  // 17. shouldDelegate() returns true for complex task at low depth
  // --------------------------------------------------------------------------
  it("shouldDelegate() returns true for a complex task at a shallow depth", () => {
    // complexity=0.9 (> 0.7), depth=0 (< 3), no running tasks
    expect(manager.shouldDelegate(0.9, 0)).toBe(true);
  });

  // --------------------------------------------------------------------------
  // 18. shouldDelegate() returns false at max depth
  // --------------------------------------------------------------------------
  it("shouldDelegate() returns false when at maxDepth", () => {
    // depth 3 + 1 = 4 exceeds maxDepth 3
    expect(manager.shouldDelegate(0.9, 3)).toBe(false);
  });

  // --------------------------------------------------------------------------
  // 19. shouldDelegate() returns false for simple task
  // --------------------------------------------------------------------------
  it("shouldDelegate() returns false for a low-complexity task", () => {
    // complexity=0.5 (< 0.7)
    expect(manager.shouldDelegate(0.5, 0)).toBe(false);
  });

  // --------------------------------------------------------------------------
  // 20. validateDepthLimit() true within limit
  // --------------------------------------------------------------------------
  it("validateDepthLimit() returns true for depth within bounds", () => {
    expect(manager.validateDepthLimit(0)).toBe(true);
    expect(manager.validateDepthLimit(1)).toBe(true);
    expect(manager.validateDepthLimit(3)).toBe(true);
  });

  // --------------------------------------------------------------------------
  // 21. validateDepthLimit() false at limit exceeded
  // --------------------------------------------------------------------------
  it("validateDepthLimit() returns false when depth exceeds maxDepth", () => {
    expect(manager.validateDepthLimit(4)).toBe(false);
    expect(manager.validateDepthLimit(100)).toBe(false);
  });

  // --------------------------------------------------------------------------
  // 22. getStats() counts correctly
  // --------------------------------------------------------------------------
  it("getStats() returns accurate counts for all status buckets", () => {
    const t1 = manager.spawn("a");
    const t2 = manager.spawn("b");
    const t3 = manager.spawn("c");
    manager.spawn("d");
    manager.completeTask(t1.id, "done");
    manager.failTask(t2.id, "err");
    manager.cancelTask(t3.id);
    // t4 stays pending

    const stats = manager.getStats();
    expect(stats.total).toBe(4);
    expect(stats.completed).toBe(1);
    expect(stats.failed).toBe(1);
    expect(stats.cancelled).toBe(1);
    expect(stats.pending).toBe(1);
    expect(stats.running).toBe(0);
  });

  // --------------------------------------------------------------------------
  // 23. clear() resets all state
  // --------------------------------------------------------------------------
  it("clear() removes all agents and tasks", () => {
    manager.spawn("task 1");
    manager.spawn("task 2");
    expect(manager.listTasks()).toHaveLength(2);
    manager.clear();
    expect(manager.listTasks()).toHaveLength(0);
    expect(manager.getStats().total).toBe(0);
  });

  // --------------------------------------------------------------------------
  // 24. spawn() with worktreeIsolation option
  // --------------------------------------------------------------------------
  it("spawn() stores worktreeIsolation in agent config", () => {
    const task = manager.spawn("isolated work", { worktreeIsolation: true });
    const agent = manager.getAgent(task.agentId)!;
    expect(agent.worktreeIsolation).toBe(true);
  });

  // --------------------------------------------------------------------------
  // 25. spawn() with custom maxRounds
  // --------------------------------------------------------------------------
  it("spawn() stores custom maxRounds in agent config", () => {
    const task = manager.spawn("long task", { maxRounds: 100 });
    const agent = manager.getAgent(task.agentId)!;
    expect(agent.maxRounds).toBe(100);
  });

  // --------------------------------------------------------------------------
  // 26. spawn() sets parentId
  // --------------------------------------------------------------------------
  it("spawn() propagates parentId into agent config", () => {
    const parent = manager.spawn("parent");
    const child = manager.spawn("child", { parentId: parent.agentId });
    const childAgent = manager.getAgent(child.agentId)!;
    expect(childAgent.parentId).toBe(parent.agentId);
  });

  // --------------------------------------------------------------------------
  // 27. spawnParallel() with empty array
  // --------------------------------------------------------------------------
  it("spawnParallel() returns an empty array when given no prompts", () => {
    const tasks = manager.spawnParallel([]);
    expect(tasks).toEqual([]);
  });

  // --------------------------------------------------------------------------
  // 28. mergeResults() with mixed results
  // --------------------------------------------------------------------------
  it("mergeResults() includes error strings for failed tasks in combinedOutput", () => {
    const t1 = manager.spawn("ok task");
    const t2 = manager.spawn("bad task");
    manager.completeTask(t1.id, "all good");
    manager.failTask(t2.id, "catastrophic failure");

    const merged = manager.mergeResults([t1.id, t2.id]);
    expect(merged.combinedOutput).toContain("all good");
    expect(merged.combinedOutput).toContain("catastrophic failure");
    expect(merged.combinedOutput).toContain("ERROR");
  });

  // --------------------------------------------------------------------------
  // 29. completeTask() sets completedAt timestamp
  // --------------------------------------------------------------------------
  it("completeTask() sets a valid ISO-8601 completedAt timestamp", () => {
    const task = manager.spawn("timed task");
    const before = Date.now();
    manager.completeTask(task.id, "result");
    const after = Date.now();

    const updated = manager.getTask(task.id)!;
    expect(updated.completedAt).toBeDefined();
    const ts = new Date(updated.completedAt!).getTime();
    expect(ts).toBeGreaterThanOrEqual(before);
    expect(ts).toBeLessThanOrEqual(after);
  });

  // --------------------------------------------------------------------------
  // 30. Edge: operations on unknown task IDs are no-ops
  // --------------------------------------------------------------------------
  it("completeTask() is a no-op for an unknown task ID", () => {
    expect(() => manager.completeTask("ghost-id", "result")).not.toThrow();
  });

  it("failTask() is a no-op for an unknown task ID", () => {
    expect(() => manager.failTask("ghost-id", "error")).not.toThrow();
  });

  it("cancelTask() is a no-op for an unknown task ID", () => {
    expect(() => manager.cancelTask("ghost-id")).not.toThrow();
  });

  // --------------------------------------------------------------------------
  // 31. Edge: cancelTask() does not override a completed task
  // --------------------------------------------------------------------------
  it("cancelTask() does not change status of an already-completed task", () => {
    const task = manager.spawn("done task");
    manager.completeTask(task.id, "done");
    manager.cancelTask(task.id);
    expect(manager.getTask(task.id)!.status).toBe("completed");
  });

  // --------------------------------------------------------------------------
  // 32. Edge: cancelTask() does not override a failed task
  // --------------------------------------------------------------------------
  it("cancelTask() does not change status of an already-failed task", () => {
    const task = manager.spawn("fail task");
    manager.failTask(task.id, "err");
    manager.cancelTask(task.id);
    expect(manager.getTask(task.id)!.status).toBe("failed");
  });

  // --------------------------------------------------------------------------
  // 33. Edge: mergeResults() with empty task ID list
  // --------------------------------------------------------------------------
  it("mergeResults() returns empty MergedResult for an empty ID list", () => {
    const merged = manager.mergeResults([]);
    expect(merged.results).toHaveLength(0);
    expect(merged.successCount).toBe(0);
    expect(merged.failureCount).toBe(0);
    expect(merged.combinedOutput).toBe("");
  });

  // --------------------------------------------------------------------------
  // 34. Edge: mergeResults() skips pending/running/cancelled tasks
  // --------------------------------------------------------------------------
  it("mergeResults() skips tasks that are not in a terminal state", () => {
    const t1 = manager.spawn("pending task");
    const t2 = manager.spawn("cancel task");
    const t3 = manager.spawn("done task");
    manager.cancelTask(t2.id);
    manager.completeTask(t3.id, "done");

    const merged = manager.mergeResults([t1.id, t2.id, t3.id]);
    // Only the completed task should appear
    expect(merged.results).toHaveLength(1);
    expect(merged.successCount).toBe(1);
    expect(merged.failureCount).toBe(0);
  });

  // --------------------------------------------------------------------------
  // 35. Edge: getStats() after clear() returns all-zero counts
  // --------------------------------------------------------------------------
  it("getStats() returns all-zero counts after clear()", () => {
    manager.spawn("x");
    manager.spawn("y");
    manager.clear();
    const stats = manager.getStats();
    expect(stats.total).toBe(0);
    expect(stats.pending).toBe(0);
    expect(stats.running).toBe(0);
    expect(stats.completed).toBe(0);
    expect(stats.failed).toBe(0);
    expect(stats.cancelled).toBe(0);
  });

  // --------------------------------------------------------------------------
  // 36. Critic integration
  // --------------------------------------------------------------------------

  it("deriveCriticOpinions() converts completed and failed tasks into critic verdicts", () => {
    const good = manager.spawn("deploy review");
    const risky = manager.spawn("rollback review");
    const broken = manager.spawn("incident review");

    manager.completeTask(good.id, "Deployment looks solid and verified.");
    manager.completeTask(risky.id, "Warning: rollback steps need proof before merge.");
    manager.failTask(broken.id, "Health-check evidence missing.");

    const opinions = manager.deriveCriticOpinions([good.id, risky.id, broken.id]);

    expect(opinions).toHaveLength(3);
    expect(opinions.find((opinion) => opinion.agentId === good.agentId)?.verdict).toBe("pass");
    expect(opinions.find((opinion) => opinion.agentId === risky.agentId)?.verdict).toBe("warn");
    expect(opinions.find((opinion) => opinion.agentId === broken.agentId)?.verdict).toBe("fail");
  });

  it("debateResults() feeds derived critic opinions into the consensus helper", () => {
    const verified = manager.spawn("verified lane");
    const failed = manager.spawn("failed lane");

    manager.completeTask(verified.id, "Everything passed with evidence.");
    manager.failTask(failed.id, "Missing rollback validation.");

    const debate = manager.debateResults([verified.id, failed.id], "Release plan output");

    expect(debate.consensus).toBe("fail");
    expect(debate.blockingFindings).toContain("Missing rollback validation.");
  });
});
