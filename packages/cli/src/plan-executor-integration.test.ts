import { describe, it, expect } from "vitest";
import { PlanExecutor } from "@dantecode/core";
import type { PlanStep, ExecutionPlan, StepExecutionResult } from "@dantecode/core";

describe("plan-executor-integration", () => {
  function makePlan(steps: Partial<PlanStep>[]): ExecutionPlan {
    return {
      goal: "Test plan",
      steps: steps.map((s, i) => ({
        id: `step-${i + 1}`,
        description: s.description ?? `Step ${i + 1}`,
        files: s.files ?? [],
        verifyCommand: s.verifyCommand,
        dependencies: s.dependencies,
        status: "pending" as const,
        ...s,
      })),
      createdAt: new Date().toISOString(),
      estimatedComplexity: 0.5,
    };
  }

  it("executes steps sequentially with callbacks", async () => {
    const executedSteps: string[] = [];
    const completedSteps: string[] = [];

    const executor = new PlanExecutor({
      executeStep: async (step: PlanStep): Promise<StepExecutionResult> => {
        executedSteps.push(step.id);
        return { stepId: step.id, success: true, output: "ok", durationMs: 10 };
      },
      onStepStart: (_step) => { /* noop */ },
      onStepComplete: (step) => { completedSteps.push(step.id); },
    });

    const plan = makePlan([
      { description: "Create file" },
      { description: "Run tests" },
    ]);

    const result = await executor.execute(plan);
    expect(result.allPassed).toBe(true);
    expect(executedSteps).toEqual(["step-1", "step-2"]);
    expect(completedSteps).toEqual(["step-1", "step-2"]);
    expect(result.results).toHaveLength(2);
  });

  it("skips steps with unmet dependencies", async () => {
    const executor = new PlanExecutor({
      executeStep: async (step: PlanStep): Promise<StepExecutionResult> => {
        // Step 1 fails
        if (step.id === "step-1") {
          return { stepId: step.id, success: false, error: "build failed", durationMs: 5 };
        }
        return { stepId: step.id, success: true, durationMs: 5 };
      },
    });

    const plan = makePlan([
      { description: "Build" },
      { description: "Deploy", dependencies: ["step-1"] },
    ]);

    const result = await executor.execute(plan);
    expect(result.allPassed).toBe(false);
    // Step 2 should fail due to unmet dependency
    expect(result.results[1]!.success).toBe(false);
    expect(result.results[1]!.error).toContain("Unmet dependencies");
  });

  it("calls verifyStep when verifyCommand is provided", async () => {
    const verifiedCommands: string[] = [];

    const executor = new PlanExecutor({
      executeStep: async (step): Promise<StepExecutionResult> => {
        return { stepId: step.id, success: true, durationMs: 5 };
      },
      verifyStep: async (cmd) => {
        verifiedCommands.push(cmd);
        return { success: true, output: "tests pass" };
      },
    });

    const plan = makePlan([
      { description: "Write tests", verifyCommand: "npm test" },
      { description: "No verify" },
    ]);

    const result = await executor.execute(plan);
    expect(result.allPassed).toBe(true);
    expect(verifiedCommands).toEqual(["npm test"]);
  });

  it("attempts replan on failure when replan function provided", async () => {
    let replanCalled = false;

    const executor = new PlanExecutor({
      executeStep: async (step): Promise<StepExecutionResult> => {
        if (step.id === "step-1" && !replanCalled) {
          return { stepId: step.id, success: false, error: "first attempt failed", durationMs: 5 };
        }
        return { stepId: step.id, success: true, durationMs: 5 };
      },
      replan: async (_failedStep, _error, _plan) => {
        replanCalled = true;
        return [
          { id: "step-1b", description: "Alternative approach", files: [], status: "pending" as const },
        ];
      },
    });

    const plan = makePlan([{ description: "Original step" }]);
    const result = await executor.execute(plan);
    expect(replanCalled).toBe(true);
    expect(result.replanCount).toBe(1);
  });

  it("tracks total duration", async () => {
    const executor = new PlanExecutor({
      executeStep: async (step): Promise<StepExecutionResult> => {
        return { stepId: step.id, success: true, durationMs: 10 };
      },
    });

    const plan = makePlan([{ description: "Quick step" }]);
    const result = await executor.execute(plan);
    expect(result.totalDurationMs).toBeGreaterThanOrEqual(0);
    expect(result.results).toHaveLength(1);
  });

  it("updates step status during execution", async () => {
    const statuses: string[] = [];

    const executor = new PlanExecutor({
      executeStep: async (step): Promise<StepExecutionResult> => {
        statuses.push(`${step.id}:${step.status}`);
        return { stepId: step.id, success: true, durationMs: 5 };
      },
      onStepStart: (step) => { statuses.push(`start:${step.id}:${step.status}`); },
      onStepComplete: (step) => { statuses.push(`end:${step.id}:${step.status}`); },
    });

    const plan = makePlan([{ description: "Step A" }]);
    await executor.execute(plan);

    expect(statuses).toContain("start:step-1:in_progress");
    expect(statuses).toContain("end:step-1:completed");
  });
});
