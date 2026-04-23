// packages/core/src/__tests__/plan-act-controller.test.ts
import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  parsePlan,
  formatPlanForDisplay,
  PlanActController,
  buildPlanModeSystemPrompt,
} from "../plan-act-controller.js";
import type { ExecutionStepStatus } from "../plan-act-controller.js";

const SAMPLE_PLAN_TEXT = `
Here's my plan to add the user authentication feature:

1. Create \`packages/api/src/auth.ts\` with JWT validation logic
2. Modify \`packages/api/src/routes.ts\` to add /login and /logout endpoints
3. Update \`packages/frontend/src/login.tsx\` with the login form component
4. Add \`packages/api/src/__tests__/auth.test.ts\` with integration tests
5. Delete the old \`packages/api/src/legacy-auth.ts\` file

Ready to execute. Awaiting approval.
`;

describe("parsePlan", () => {
  it("extracts numbered steps from text", () => {
    const plan = parsePlan(SAMPLE_PLAN_TEXT, "Add user authentication");
    expect(plan.steps.length).toBeGreaterThanOrEqual(5);
  });

  it("sets the goal correctly", () => {
    const plan = parsePlan(SAMPLE_PLAN_TEXT, "Add user authentication");
    expect(plan.goal).toBe("Add user authentication");
  });

  it("detects high-risk steps containing delete/remove", () => {
    const plan = parsePlan(SAMPLE_PLAN_TEXT, "Test");
    const deleteStep = plan.steps.find((s) => /delete/i.test(s.description));
    expect(deleteStep?.risk).toBe("high");
  });

  it("detects medium-risk steps containing create/modify", () => {
    const plan = parsePlan(SAMPLE_PLAN_TEXT, "Test");
    const createStep = plan.steps.find((s) => /create/i.test(s.description));
    expect(createStep?.risk).toBe("medium");
  });

  it("extracts file paths from backticks", () => {
    const plan = parsePlan(SAMPLE_PLAN_TEXT, "Test");
    const filesFound = plan.steps.flatMap((s) => s.affectedFiles ?? []);
    expect(filesFound.some((f) => f.includes("auth.ts"))).toBe(true);
  });

  it("sets hasDestructiveSteps when high-risk steps present", () => {
    const plan = parsePlan(SAMPLE_PLAN_TEXT, "Test");
    expect(plan.hasDestructiveSteps).toBe(true);
  });

  it("returns a plan with an id", () => {
    const plan = parsePlan(SAMPLE_PLAN_TEXT, "Test");
    expect(plan.id).toBeTruthy();
    expect(plan.id.length).toBeGreaterThan(0);
  });

  it("handles empty text gracefully", () => {
    const plan = parsePlan("", "Empty goal");
    expect(plan.steps).toHaveLength(0);
    expect(plan.hasDestructiveSteps).toBe(false);
  });

  it("handles bullet-point lists (- prefix)", () => {
    const text = "- Create the database schema\n- Run migration";
    const plan = parsePlan(text, "Migrate DB");
    expect(plan.steps.length).toBeGreaterThanOrEqual(2);
  });
});

describe("formatPlanForDisplay", () => {
  it("includes the goal in the output", () => {
    const plan = parsePlan(SAMPLE_PLAN_TEXT, "Add user authentication");
    const display = formatPlanForDisplay(plan);
    expect(display).toContain("Add user authentication");
  });

  it("includes step count", () => {
    const plan = parsePlan(SAMPLE_PLAN_TEXT, "Test");
    const display = formatPlanForDisplay(plan);
    expect(display).toContain("Steps:");
  });

  it("shows approval prompt at the end", () => {
    const plan = parsePlan(SAMPLE_PLAN_TEXT, "Test");
    const display = formatPlanForDisplay(plan);
    expect(display).toContain("yes");
    expect(display).toContain("no");
  });
});

describe("PlanActController", () => {
  let controller: PlanActController;

  beforeEach(() => {
    controller = new PlanActController({ alwaysRequireApproval: true });
  });

  it("starts in planning phase", () => {
    expect(controller.phase).toBe("planning");
    expect(controller.plan).toBeNull();
  });

  it("transitions to awaiting_approval after setPlan", () => {
    const plan = parsePlan(SAMPLE_PLAN_TEXT, "Test");
    controller.setPlan(plan);
    expect(controller.phase).toBe("awaiting_approval");
    expect(controller.requiresApproval()).toBe(true);
  });

  it("processApproval('yes') transitions to executing", () => {
    const plan = parsePlan(SAMPLE_PLAN_TEXT, "Test");
    controller.setPlan(plan);
    const result = controller.processApproval("yes");
    expect(result).toBe(true);
    expect(controller.phase).toBe("executing");
    expect(controller.canExecute()).toBe(true);
  });

  it("processApproval('no') transitions to rejected", () => {
    const plan = parsePlan(SAMPLE_PLAN_TEXT, "Test");
    controller.setPlan(plan);
    const result = controller.processApproval("no");
    expect(result).toBe(false);
    expect(controller.phase).toBe("rejected");
  });

  it("accepts multiple approval phrases", () => {
    for (const phrase of ["ok", "proceed", "approve", "go", "confirm", "sure"]) {
      const c = new PlanActController({ alwaysRequireApproval: true });
      c.setPlan(parsePlan(SAMPLE_PLAN_TEXT, "Test"));
      expect(c.processApproval(phrase)).toBe(true);
    }
  });

  it("non-yes/no response keeps phase in awaiting_approval", () => {
    const plan = parsePlan(SAMPLE_PLAN_TEXT, "Test");
    controller.setPlan(plan);
    controller.processApproval("Can you skip step 3?");
    expect(controller.phase).toBe("awaiting_approval");
  });

  it("auto-approves safe small plans when alwaysRequireApproval=false", () => {
    const safeController = new PlanActController({ autoApproveThreshold: 5, alwaysRequireApproval: false });
    const safePlan = parsePlan("1. Update the README file\n2. Fix typo in config.ts", "Fix docs");
    safeController.setPlan(safePlan);
    expect(safeController.phase).toBe("executing");
  });

  it("does not auto-approve destructive plans", () => {
    const safeController = new PlanActController({ autoApproveThreshold: 10, alwaysRequireApproval: false });
    const plan = parsePlan(SAMPLE_PLAN_TEXT, "Test"); // has delete step
    safeController.setPlan(plan);
    expect(safeController.phase).toBe("awaiting_approval");
  });

  it("reset() returns to planning phase", () => {
    const plan = parsePlan(SAMPLE_PLAN_TEXT, "Test");
    controller.setPlan(plan);
    controller.processApproval("yes");
    controller.reset();
    expect(controller.phase).toBe("planning");
    expect(controller.plan).toBeNull();
  });

  it("complete() sets phase to complete", () => {
    const plan = parsePlan(SAMPLE_PLAN_TEXT, "Test");
    controller.setPlan(plan);
    controller.processApproval("yes");
    controller.complete();
    expect(controller.phase).toBe("complete");
  });
});

describe("buildPlanModeSystemPrompt", () => {
  it("includes the goal", () => {
    const prompt = buildPlanModeSystemPrompt("Add authentication");
    expect(prompt).toContain("Add authentication");
  });

  it("instructs model not to execute yet", () => {
    const prompt = buildPlanModeSystemPrompt("Refactor database");
    expect(prompt.toLowerCase()).toContain("plan");
    expect(prompt.toLowerCase()).toContain("not");
  });
});

// ── Sprint 29 — Step tracking, checkpoint, rewind ─────────────────────────────


describe("PlanActController — step tracking (Sprint 29)", () => {
  let controller: PlanActController;

  beforeEach(() => {
    controller = new PlanActController({ alwaysRequireApproval: true });
    const plan = parsePlan(SAMPLE_PLAN_TEXT, "Auth feature");
    controller.setPlan(plan);
  });

  it("all steps start as 'pending' after setPlan", () => {
    const statuses = [...controller.stepStatuses.values()];
    expect(statuses.every((s) => s === "pending")).toBe(true);
  });

  it("currentStepIndex is -1 before any advance", () => {
    expect(controller.currentStepIndex).toBe(-1);
    expect(controller.currentStep).toBeNull();
  });

  it("advanceToNextStep returns first step and sets it to 'running'", () => {
    controller.processApproval("yes");
    const step = controller.advanceToNextStep();
    expect(step).not.toBeNull();
    expect(controller.stepStatuses.get(step!.id)).toBe("running");
    expect(controller.currentStepIndex).toBe(0);
  });

  it("advanceToNextStep marks previous step complete before moving", () => {
    controller.processApproval("yes");
    const first = controller.advanceToNextStep();
    const second = controller.advanceToNextStep();
    expect(controller.stepStatuses.get(first!.id)).toBe("complete");
    expect(controller.stepStatuses.get(second!.id)).toBe("running");
  });

  it("markStepComplete sets step to complete", () => {
    controller.processApproval("yes");
    const step = controller.advanceToNextStep()!;
    controller.markStepComplete(step.id);
    expect(controller.stepStatuses.get(step.id)).toBe("complete");
  });

  it("markStepFailed sets step to failed and stores error", () => {
    controller.processApproval("yes");
    const step = controller.advanceToNextStep()!;
    controller.markStepFailed(step.id, "Compilation error");
    expect(controller.stepStatuses.get(step.id)).toBe("failed");
    expect(controller.getStepError(step.id)).toBe("Compilation error");
  });

  it("markStepSkipped sets step to skipped", () => {
    controller.processApproval("yes");
    const step = controller.advanceToNextStep()!;
    controller.markStepSkipped(step.id);
    expect(controller.stepStatuses.get(step.id)).toBe("skipped");
  });

  it("remainingSteps excludes complete and skipped steps", () => {
    controller.processApproval("yes");
    const step = controller.advanceToNextStep()!;
    controller.markStepComplete(step.id);
    const remaining = controller.remainingSteps();
    expect(remaining.every((s) => s.id !== step.id)).toBe(true);
  });

  it("onStepChange callback fires when step status changes", () => {
    const cb = vi.fn<(stepId: string, status: ExecutionStepStatus, error?: string) => void>();
    const c = new PlanActController({ alwaysRequireApproval: true, onStepChange: cb });
    const plan = parsePlan(SAMPLE_PLAN_TEXT, "Test");
    c.setPlan(plan);
    c.processApproval("yes");
    const step = c.advanceToNextStep()!;
    c.markStepComplete(step.id);
    expect(cb).toHaveBeenCalledWith(step.id, "running", undefined);
    expect(cb).toHaveBeenCalledWith(step.id, "complete", undefined);
  });

  it("advanceToNextStep transitions to complete phase when all steps done", () => {
    const plan = parsePlan("1. Read config\n2. Done", "Short task");
    controller.setPlan(plan);
    controller.processApproval("yes");
    controller.advanceToNextStep(); // step 1 running
    controller.advanceToNextStep(); // step 1 complete, step 2 running
    controller.advanceToNextStep(); // step 2 complete, done
    expect(controller.phase).toBe("complete");
  });

  it("formatProgress includes step status icons", () => {
    controller.processApproval("yes");
    const step = controller.advanceToNextStep()!;
    controller.markStepComplete(step.id);
    const progress = controller.formatProgress();
    expect(progress).toContain("✓");
    expect(progress).toContain("Progress:");
  });
});

describe("PlanActController — rewind (Sprint 29)", () => {
  it("rewindToStep resets that step and all subsequent to pending", () => {
    const controller = new PlanActController({ alwaysRequireApproval: true });
    const plan = parsePlan(SAMPLE_PLAN_TEXT, "Test");
    controller.setPlan(plan);
    controller.processApproval("yes");

    const steps = [...plan.steps];
    controller.advanceToNextStep(); // step 0 running
    controller.markStepComplete(steps[0]!.id);
    controller.advanceToNextStep(); // step 1 running
    controller.markStepComplete(steps[1]!.id);

    // Rewind to step 0
    const result = controller.rewindToStep(steps[0]!.id);
    expect(result).toBe(true);
    expect(controller.stepStatuses.get(steps[0]!.id)).toBe("pending");
    expect(controller.stepStatuses.get(steps[1]!.id)).toBe("pending");
  });

  it("rewindToStep returns false for unknown stepId", () => {
    const controller = new PlanActController();
    const plan = parsePlan(SAMPLE_PLAN_TEXT, "Test");
    controller.setPlan(plan);
    expect(controller.rewindToStep("nonexistent")).toBe(false);
  });

  it("rewindToStep on completed plan sets phase back to executing", () => {
    const controller = new PlanActController();
    const plan = parsePlan("1. Read\n2. Write", "Test");
    controller.setPlan(plan); // auto-approved (no destructive steps)
    const steps = [...plan.steps];
    controller.advanceToNextStep();
    controller.advanceToNextStep();
    controller.advanceToNextStep(); // complete
    expect(controller.phase).toBe("complete");
    controller.rewindToStep(steps[0]!.id);
    expect(controller.phase).toBe("executing");
  });
});

describe("PlanActController — checkpoint/resume (Sprint 29)", () => {
  it("serializeState returns a JSON string", () => {
    const controller = new PlanActController({ alwaysRequireApproval: true });
    const plan = parsePlan(SAMPLE_PLAN_TEXT, "Test");
    controller.setPlan(plan);
    const json = controller.serializeState();
    expect(() => JSON.parse(json)).not.toThrow();
  });

  it("restoreState re-creates phase and step statuses", () => {
    const c1 = new PlanActController({ alwaysRequireApproval: true });
    const plan = parsePlan(SAMPLE_PLAN_TEXT, "Restore test");
    c1.setPlan(plan);
    c1.processApproval("yes");
    const step = c1.advanceToNextStep()!;
    c1.markStepComplete(step.id);

    const json = c1.serializeState();

    const c2 = new PlanActController();
    const ok = c2.restoreState(json);
    expect(ok).toBe(true);
    expect(c2.phase).toBe("executing");
    expect(c2.stepStatuses.get(step.id)).toBe("complete");
    expect(c2.plan?.goal).toBe("Restore test");
  });

  it("restoreState returns false for invalid JSON", () => {
    const c = new PlanActController();
    expect(c.restoreState("not-json")).toBe(false);
  });

  it("restoreState preserves step error messages", () => {
    const c1 = new PlanActController({ alwaysRequireApproval: true });
    c1.setPlan(parsePlan(SAMPLE_PLAN_TEXT, "Test"));
    c1.processApproval("yes");
    const step = c1.advanceToNextStep()!;
    c1.markStepFailed(step.id, "TypeScript compile error");
    const json = c1.serializeState();

    const c2 = new PlanActController();
    c2.restoreState(json);
    expect(c2.getStepError(step.id)).toBe("TypeScript compile error");
  });

  it("reset() clears all step state", () => {
    const c = new PlanActController({ alwaysRequireApproval: true });
    c.setPlan(parsePlan(SAMPLE_PLAN_TEXT, "Test"));
    c.processApproval("yes");
    c.advanceToNextStep();
    c.reset();
    expect(c.stepStatuses.size).toBe(0);
    expect(c.currentStepIndex).toBe(-1);
    expect(c.phase).toBe("planning");
  });
});
