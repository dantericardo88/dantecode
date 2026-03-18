import { describe, expect, it, vi } from "vitest";
import { PlanExecutor, areDependenciesMet, getNextExecutableSteps } from "./plan-executor.js";
import type { ExecutionPlan, PlanStep } from "./architect-planner.js";

function makePlan(steps: Partial<PlanStep>[]): ExecutionPlan {
  return {
    goal: "test goal",
    steps: steps.map((s, i) => ({
      id: s.id ?? `step-${i + 1}`,
      description: s.description ?? `Step ${i + 1}`,
      files: s.files ?? [],
      verifyCommand: s.verifyCommand,
      dependencies: s.dependencies,
      status: s.status ?? "pending",
    })),
    createdAt: new Date().toISOString(),
    estimatedComplexity: 0.5,
  };
}

describe("PlanExecutor", () => {
  it("executes all steps in order", async () => {
    const plan = makePlan([
      { description: "Step A" },
      { description: "Step B" },
      { description: "Step C" },
    ]);

    const executeStep = vi.fn().mockImplementation((step: PlanStep) => ({
      stepId: step.id,
      success: true,
      output: "done",
      durationMs: 10,
    }));

    const executor = new PlanExecutor({ executeStep });
    const result = await executor.execute(plan);

    expect(result.allPassed).toBe(true);
    expect(result.results).toHaveLength(3);
    expect(executeStep).toHaveBeenCalledTimes(3);
  });

  it("marks failed steps and continues", async () => {
    const plan = makePlan([
      { description: "Will succeed" },
      { description: "Will fail" },
      { description: "After failure" },
    ]);

    const executeStep = vi.fn().mockImplementation((step: PlanStep) => ({
      stepId: step.id,
      success: step.description !== "Will fail",
      error: step.description === "Will fail" ? "test error" : undefined,
      durationMs: 5,
    }));

    const executor = new PlanExecutor({ executeStep });
    const result = await executor.execute(plan);

    expect(result.allPassed).toBe(false);
    expect(result.results[1]!.success).toBe(false);
    expect(result.results[2]!.success).toBe(true);
  });

  it("skips steps with unmet dependencies", async () => {
    const plan = makePlan([
      { id: "step-1", description: "Will fail" },
      { id: "step-2", description: "Depends on step-1", dependencies: ["step-1"] },
    ]);

    const executeStep = vi.fn().mockImplementation((step: PlanStep) => ({
      stepId: step.id,
      success: step.id !== "step-1",
      error: step.id === "step-1" ? "failed" : undefined,
      durationMs: 5,
    }));

    const executor = new PlanExecutor({ executeStep });
    const result = await executor.execute(plan);

    // step-2 should fail due to unmet deps, not be executed
    expect(result.results[1]!.success).toBe(false);
    expect(result.results[1]!.error).toContain("Unmet dependencies");
    // executeStep only called for step-1 (step-2 was skipped)
    expect(executeStep).toHaveBeenCalledTimes(1);
  });

  it("runs verify command after successful step", async () => {
    const plan = makePlan([{ description: "Build step", verifyCommand: "npm test" }]);

    const executeStep = vi.fn().mockResolvedValue({
      stepId: "step-1",
      success: true,
      durationMs: 10,
    });

    const verifyStep = vi.fn().mockResolvedValue({
      success: true,
      output: "all tests passed",
    });

    const executor = new PlanExecutor({ executeStep, verifyStep });
    const result = await executor.execute(plan);

    expect(verifyStep).toHaveBeenCalledWith("npm test");
    expect(result.allPassed).toBe(true);
  });

  it("marks step as failed when verification fails", async () => {
    const plan = makePlan([{ description: "Build step", verifyCommand: "npm test" }]);

    const executeStep = vi.fn().mockResolvedValue({
      stepId: "step-1",
      success: true,
      durationMs: 10,
    });

    const verifyStep = vi.fn().mockResolvedValue({
      success: false,
      output: "3 tests failed",
    });

    const executor = new PlanExecutor({ executeStep, verifyStep });
    const result = await executor.execute(plan);

    expect(result.allPassed).toBe(false);
    expect(result.results[0]!.error).toContain("Verification failed");
  });

  it("invokes replan on failure and adds new steps", async () => {
    const plan = makePlan([{ description: "Will fail" }]);

    const executeStep = vi
      .fn()
      .mockResolvedValueOnce({ stepId: "step-1", success: false, error: "broken", durationMs: 5 })
      .mockResolvedValueOnce({ stepId: "fix-1", success: true, durationMs: 5 });

    const replan = vi.fn().mockResolvedValue([
      {
        id: "fix-1",
        description: "Fix the issue",
        files: [],
        status: "pending" as const,
      },
    ]);

    const executor = new PlanExecutor({ executeStep, replan });
    const result = await executor.execute(plan);

    expect(replan).toHaveBeenCalledOnce();
    expect(result.replanCount).toBe(1);
    expect(result.results).toHaveLength(2);
    expect(result.results[1]!.success).toBe(true);
  });

  it("limits replan attempts", async () => {
    const plan = makePlan([{ description: "Keeps failing" }]);

    const executeStep = vi.fn().mockResolvedValue({
      stepId: "step-1",
      success: false,
      error: "broken",
      durationMs: 5,
    });

    const replan = vi
      .fn()
      .mockResolvedValue([
        { id: "retry", description: "Retry", files: [], status: "pending" as const },
      ]);

    const executor = new PlanExecutor({ executeStep, replan, maxReplans: 2 });
    const result = await executor.execute(plan);

    // Should only replan 2 times max
    expect(replan).toHaveBeenCalledTimes(2);
    expect(result.replanCount).toBe(2);
  });

  it("calls onStepStart and onStepComplete callbacks", async () => {
    const plan = makePlan([{ description: "Step 1" }]);

    const onStepStart = vi.fn();
    const onStepComplete = vi.fn();
    const executeStep = vi.fn().mockResolvedValue({
      stepId: "step-1",
      success: true,
      durationMs: 5,
    });

    const executor = new PlanExecutor({ executeStep, onStepStart, onStepComplete });
    await executor.execute(plan);

    expect(onStepStart).toHaveBeenCalledOnce();
    expect(onStepComplete).toHaveBeenCalledOnce();
  });

  it("returns total duration", async () => {
    const plan = makePlan([{ description: "Quick step" }]);

    const executeStep = vi.fn().mockResolvedValue({
      stepId: "step-1",
      success: true,
      durationMs: 5,
    });

    const executor = new PlanExecutor({ executeStep });
    const result = await executor.execute(plan);

    expect(result.totalDurationMs).toBeGreaterThanOrEqual(0);
  });

  it("handles empty plan", async () => {
    const plan = makePlan([]);
    const executeStep = vi.fn();

    const executor = new PlanExecutor({ executeStep });
    const result = await executor.execute(plan);

    expect(result.allPassed).toBe(true);
    expect(result.results).toHaveLength(0);
    expect(executeStep).not.toHaveBeenCalled();
  });
});

describe("areDependenciesMet", () => {
  it("returns true when no dependencies", () => {
    const step: PlanStep = {
      id: "step-1",
      description: "No deps",
      files: [],
      status: "pending",
    };
    expect(areDependenciesMet(step, new Set())).toBe(true);
  });

  it("returns true when all dependencies completed", () => {
    const step: PlanStep = {
      id: "step-2",
      description: "Has deps",
      files: [],
      status: "pending",
      dependencies: ["step-1"],
    };
    expect(areDependenciesMet(step, new Set(["step-1"]))).toBe(true);
  });

  it("returns false when dependencies not met", () => {
    const step: PlanStep = {
      id: "step-2",
      description: "Has deps",
      files: [],
      status: "pending",
      dependencies: ["step-1"],
    };
    expect(areDependenciesMet(step, new Set())).toBe(false);
  });
});

describe("getNextExecutableSteps", () => {
  it("returns steps with no dependencies when none completed", () => {
    const plan = makePlan([
      { id: "step-1", description: "No deps" },
      { id: "step-2", description: "Has deps", dependencies: ["step-1"] },
    ]);

    const next = getNextExecutableSteps(plan, new Set());
    expect(next).toHaveLength(1);
    expect(next[0]!.id).toBe("step-1");
  });

  it("returns dependent steps after deps are met", () => {
    const plan = makePlan([
      { id: "step-1", description: "First", status: "completed" },
      { id: "step-2", description: "Second", dependencies: ["step-1"] },
    ]);

    const next = getNextExecutableSteps(plan, new Set(["step-1"]));
    expect(next).toHaveLength(1);
    expect(next[0]!.id).toBe("step-2");
  });

  it("excludes already completed or in-progress steps", () => {
    const plan = makePlan([
      { id: "step-1", description: "Done", status: "completed" },
      { id: "step-2", description: "Running", status: "in_progress" },
      { id: "step-3", description: "Pending" },
    ]);

    const next = getNextExecutableSteps(plan, new Set());
    expect(next).toHaveLength(1);
    expect(next[0]!.id).toBe("step-3");
  });
});
