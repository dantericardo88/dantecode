// ============================================================================
// @dantecode/core - Plan Executor (PEOR Cycle)
// Plan → Execute → Observe → Re-plan. Executes architect plans step by step.
// ============================================================================

import type { ExecutionPlan, PlanStep } from "./architect-planner.js";

export interface StepExecutionResult {
  stepId: string;
  success: boolean;
  output?: string;
  error?: string;
  durationMs: number;
}

export interface PlanExecutionResult {
  plan: ExecutionPlan;
  results: StepExecutionResult[];
  totalDurationMs: number;
  allPassed: boolean;
  replanCount: number;
}

export interface PlanExecutorOptions {
  executeStep: (step: PlanStep, plan: ExecutionPlan) => Promise<StepExecutionResult>;
  verifyStep?: (command: string) => Promise<{ success: boolean; output: string }>;
  replan?: (failedStep: PlanStep, error: string, plan: ExecutionPlan) => Promise<PlanStep[] | null>;
  maxReplans?: number;
  onStepStart?: (step: PlanStep) => void;
  onStepComplete?: (step: PlanStep, result: StepExecutionResult) => void;
}

/**
 * Executes an architect plan step by step with PEOR cycle support.
 * If a step fails and a replan function is provided, attempts mid-flight re-planning.
 */
export class PlanExecutor {
  private readonly executeStep: PlanExecutorOptions["executeStep"];
  private readonly verifyStep: PlanExecutorOptions["verifyStep"];
  private readonly replan: PlanExecutorOptions["replan"];
  private readonly maxReplans: number;
  private readonly onStepStart: PlanExecutorOptions["onStepStart"];
  private readonly onStepComplete: PlanExecutorOptions["onStepComplete"];

  constructor(options: PlanExecutorOptions) {
    this.executeStep = options.executeStep;
    this.verifyStep = options.verifyStep;
    this.replan = options.replan;
    this.maxReplans = options.maxReplans ?? 3;
    this.onStepStart = options.onStepStart;
    this.onStepComplete = options.onStepComplete;
  }

  async execute(plan: ExecutionPlan): Promise<PlanExecutionResult> {
    const results: StepExecutionResult[] = [];
    const startTime = Date.now();
    let replanCount = 0;
    let steps = [...plan.steps];

    for (let i = 0; i < steps.length; i++) {
      const step = steps[i]!;

      // Check dependencies
      if (step.dependencies?.length) {
        const unmet = step.dependencies.filter((depId) => {
          const depResult = results.find(
            (r) => r.stepId === depId || r.stepId === `step-${depId}`,
          );
          return !depResult?.success;
        });

        if (unmet.length > 0) {
          const result: StepExecutionResult = {
            stepId: step.id,
            success: false,
            error: `Unmet dependencies: ${unmet.join(", ")}`,
            durationMs: 0,
          };
          step.status = "failed";
          step.error = result.error;
          results.push(result);
          continue;
        }
      }

      // Execute
      step.status = "in_progress";
      this.onStepStart?.(step);

      const result = await this.executeStep(step, plan);
      results.push(result);

      // Verify if command provided
      if (result.success && step.verifyCommand && this.verifyStep) {
        const verification = await this.verifyStep(step.verifyCommand);
        if (!verification.success) {
          result.success = false;
          result.error = `Verification failed: ${verification.output}`;
        }
      }

      if (result.success) {
        step.status = "completed";
      } else {
        step.status = "failed";
        step.error = result.error;

        // PEOR: Attempt re-plan if available
        if (this.replan && replanCount < this.maxReplans) {
          const newSteps = await this.replan(step, result.error ?? "unknown error", plan);
          if (newSteps && newSteps.length > 0) {
            replanCount++;
            // Replace remaining steps with re-planned ones
            steps = [...steps.slice(0, i + 1), ...newSteps];
            plan.steps = steps;
          }
        }
      }

      this.onStepComplete?.(step, result);
    }

    return {
      plan,
      results,
      totalDurationMs: Date.now() - startTime,
      allPassed: results.every((r) => r.success),
      replanCount,
    };
  }
}

/**
 * Check if a step's dependencies are all completed successfully.
 */
export function areDependenciesMet(
  step: PlanStep,
  completedSteps: Set<string>,
): boolean {
  if (!step.dependencies?.length) return true;
  return step.dependencies.every(
    (dep) => completedSteps.has(dep) || completedSteps.has(`step-${dep}`),
  );
}

/**
 * Get the next executable steps (those with all dependencies met).
 */
export function getNextExecutableSteps(
  plan: ExecutionPlan,
  completedSteps: Set<string>,
): PlanStep[] {
  return plan.steps.filter(
    (step) => step.status === "pending" && areDependenciesMet(step, completedSteps),
  );
}
