// packages/core/src/__tests__/task-decomposer.test.ts
// Tests for task-decomposer.ts — pure logic, no mocks needed for buildParallelGroups/hasFileConflict.

import { describe, it, expect, vi } from "vitest";
import { decomposeTask, buildParallelGroups, hasFileConflict } from "../task-decomposer.js";
import type { SubTask } from "../task-decomposer.js";

describe("buildParallelGroups", () => {
  it("no deps: all tasks in one group", () => {
    const tasks: SubTask[] = [
      { id: "t1", description: "task 1" },
      { id: "t2", description: "task 2" },
      { id: "t3", description: "task 3" },
    ];
    const groups = buildParallelGroups(tasks);
    expect(groups).toHaveLength(1);
    expect(groups[0]).toHaveLength(3);
  });

  it("linear A→B→C: 3 sequential groups", () => {
    const tasks: SubTask[] = [
      { id: "A", description: "A", dependsOn: [] },
      { id: "B", description: "B", dependsOn: ["A"] },
      { id: "C", description: "C", dependsOn: ["B"] },
    ];
    const groups = buildParallelGroups(tasks);
    expect(groups).toHaveLength(3);
    expect(groups[0]!.map((t) => t.id)).toEqual(["A"]);
    expect(groups[1]!.map((t) => t.id)).toEqual(["B"]);
    expect(groups[2]!.map((t) => t.id)).toEqual(["C"]);
  });

  it("diamond A→(B,C)→D: 3 groups", () => {
    const tasks: SubTask[] = [
      { id: "A", description: "A" },
      { id: "B", description: "B", dependsOn: ["A"] },
      { id: "C", description: "C", dependsOn: ["A"] },
      { id: "D", description: "D", dependsOn: ["B", "C"] },
    ];
    const groups = buildParallelGroups(tasks);
    expect(groups).toHaveLength(3);
    expect(groups[0]!.map((t) => t.id)).toEqual(["A"]);
    expect(groups[1]!.map((t) => t.id).sort()).toEqual(["B", "C"]);
    expect(groups[2]!.map((t) => t.id)).toEqual(["D"]);
  });

  it("circular dependency: does not infinite-loop, returns at least one group", () => {
    const tasks: SubTask[] = [
      { id: "X", description: "X", dependsOn: ["Y"] },
      { id: "Y", description: "Y", dependsOn: ["X"] },
    ];
    // Must not throw or hang
    const groups = buildParallelGroups(tasks);
    expect(groups).toBeDefined();
    expect(Array.isArray(groups)).toBe(true);
    // The circular dep guard fires (ready.length === 0), so the fallback kicks in
    // returning [[...tasks]] — at minimum one group
    expect(groups.length).toBeGreaterThanOrEqual(1);
  });

  it("priority ordering: higher priority tasks first in group", () => {
    const tasks: SubTask[] = [
      { id: "t1", description: "low", priority: 1 },
      { id: "t2", description: "high", priority: 10 },
      { id: "t3", description: "mid", priority: 5 },
    ];
    const groups = buildParallelGroups(tasks);
    // All tasks in one group (no dependencies), sorted by priority descending
    expect(groups[0]![0]!.id).toBe("t2"); // highest priority first
  });
});

describe("hasFileConflict", () => {
  it("returns true when tasks share a file", () => {
    const a: SubTask = { id: "a", description: "a", affectedFiles: ["src/foo.ts", "src/bar.ts"] };
    const b: SubTask = { id: "b", description: "b", affectedFiles: ["src/baz.ts", "src/bar.ts"] };
    expect(hasFileConflict(a, b)).toBe(true);
  });

  it("returns false when tasks have no overlapping files", () => {
    const a: SubTask = { id: "a", description: "a", affectedFiles: ["src/foo.ts"] };
    const b: SubTask = { id: "b", description: "b", affectedFiles: ["src/bar.ts"] };
    expect(hasFileConflict(a, b)).toBe(false);
  });

  it("returns false when affectedFiles are undefined", () => {
    const a: SubTask = { id: "a", description: "a" };
    const b: SubTask = { id: "b", description: "b" };
    expect(hasFileConflict(a, b)).toBe(false);
  });
});

describe("decomposeTask", () => {
  it("returns single-task fallback when LLM returns invalid JSON", async () => {
    const badLlm = vi.fn().mockResolvedValue("not valid JSON at all");
    const result = await decomposeTask("Build auth system", badLlm);
    expect(result.tasks).toHaveLength(1);
    expect(result.tasks[0]!.description).toContain("Build auth system");
  });

  it("returns single-task fallback when LLM throws", async () => {
    const throwingLlm = vi.fn().mockRejectedValue(new Error("LLM unavailable"));
    const result = await decomposeTask("Build auth system", throwingLlm);
    expect(result.tasks).toHaveLength(1);
  });

  it("returns parsed tasks when LLM returns valid JSON", async () => {
    const goodLlm = vi.fn().mockResolvedValue(
      JSON.stringify([
        { id: "task-1", description: "Setup database", dependsOn: [], priority: 2 },
        { id: "task-2", description: "Create API", dependsOn: ["task-1"], priority: 1 },
      ]),
    );
    const result = await decomposeTask("Build auth system", goodLlm);
    expect(result.tasks).toHaveLength(2);
    expect(result.tasks[0]!.id).toBe("task-1");
    expect(result.parallelGroups.length).toBeGreaterThan(0);
  });

  it("respects maxSubTasks option in prompt", async () => {
    const llm = vi.fn().mockResolvedValue("[]");
    await decomposeTask("Some task", llm, { maxSubTasks: 3 });
    const prompt = llm.mock.calls[0]![0] as string;
    expect(prompt).toContain("3 or fewer");
  });

  it("uses provided strategy in result", async () => {
    const llm = vi.fn().mockResolvedValue("not json");
    const result = await decomposeTask("task", llm, { strategy: "fewest_tasks" });
    expect(result.strategy).toBe("fewest_tasks");
  });

  it("parallelGroups are populated when tasks have no deps", async () => {
    const llm = vi.fn().mockResolvedValue(
      JSON.stringify([
        { id: "t1", description: "Task 1" },
        { id: "t2", description: "Task 2" },
      ]),
    );
    const result = await decomposeTask("Do things", llm);
    expect(result.parallelGroups).toHaveLength(1);
    expect(result.parallelGroups[0]).toHaveLength(2);
  });
});
