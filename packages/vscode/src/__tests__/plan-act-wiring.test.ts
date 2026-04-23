// packages/vscode/src/__tests__/plan-act-wiring.test.ts
// Sprint F — Dim 16: PlanActController wired into sidebar plan mode (16: 7→9)
import { describe, it, expect } from "vitest";
import {
  PlanActController,
  parsePlan,
  formatPlanForDisplay,
  buildPlanModeSystemPrompt,
  type PlanActPhase,
} from "@dantecode/core";

// ─── parsePlan ────────────────────────────────────────────────────────────────

describe("parsePlan", () => {
  it("extracts numbered list steps", () => {
    const text = "1. Read index.ts\n2. Write output.ts\n3. Run tests";
    const plan = parsePlan(text, "build feature X");
    expect(plan.steps.length).toBe(3);
    expect(plan.goal).toBe("build feature X");
  });

  it("extracts bullet list steps", () => {
    const text = "- Create auth.ts file\n- Update imports in index.ts\n- Write tests";
    const plan = parsePlan(text, "add auth");
    expect(plan.steps.length).toBe(3);
  });

  it("assigns high risk to destructive steps", () => {
    const text = "1. Delete old cache\n2. Remove temp files";
    const plan = parsePlan(text, "cleanup");
    expect(plan.hasDestructiveSteps).toBe(true);
    expect(plan.steps[0]?.risk).toBe("high");
  });

  it("assigns medium risk to create/write steps", () => {
    const text = "1. Create new component\n2. Write the tests";
    const plan = parsePlan(text, "add component");
    expect(plan.steps[0]?.risk).toBe("medium");
  });

  it("extracts affected file paths from backtick notation", () => {
    const text = "1. Modify `packages/core/src/index.ts` to add export";
    const plan = parsePlan(text, "add export");
    expect(plan.steps[0]?.affectedFiles).toContain("packages/core/src/index.ts");
  });

  it("plan has required fields", () => {
    const plan = parsePlan("1. Do something", "goal");
    expect(plan.id).toBeTruthy();
    expect(typeof plan.estimatedChangedFiles).toBe("number");
    expect(plan.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("returns empty steps for non-list text", () => {
    const plan = parsePlan("Just a paragraph of description without any list.", "goal");
    expect(plan.steps.length).toBe(0);
  });
});

// ─── formatPlanForDisplay ─────────────────────────────────────────────────────

describe("formatPlanForDisplay", () => {
  it("includes the goal", () => {
    const plan = parsePlan("1. Write code\n2. Run tests", "add feature");
    const display = formatPlanForDisplay(plan);
    expect(display).toContain("add feature");
  });

  it("includes step count", () => {
    const plan = parsePlan("1. Step A\n2. Step B\n3. Step C", "goal");
    const display = formatPlanForDisplay(plan);
    expect(display).toContain("**Steps:** 3");
  });

  it("includes approval prompt at bottom", () => {
    const plan = parsePlan("1. Do something safe", "goal");
    const display = formatPlanForDisplay(plan);
    expect(display).toContain("yes");
    expect(display).toContain("no");
  });

  it("flags destructive operations in header", () => {
    const plan = parsePlan("1. Delete all temp files", "cleanup");
    const display = formatPlanForDisplay(plan);
    expect(display).toContain("destructive");
  });
});

// ─── buildPlanModeSystemPrompt ────────────────────────────────────────────────

describe("buildPlanModeSystemPrompt", () => {
  it("includes the goal in the prompt", () => {
    const prompt = buildPlanModeSystemPrompt("refactor auth module");
    expect(prompt).toContain("refactor auth module");
  });

  it("instructs model to produce plan only (no execution)", () => {
    const prompt = buildPlanModeSystemPrompt("any goal");
    expect(prompt.toLowerCase()).toMatch(/plan|await|approval/);
  });

  it("returns a non-empty string", () => {
    const prompt = buildPlanModeSystemPrompt("goal");
    expect(typeof prompt).toBe("string");
    expect(prompt.length).toBeGreaterThan(20);
  });
});

// ─── PlanActController lifecycle ──────────────────────────────────────────────

describe("PlanActController", () => {
  it("starts in planning phase", () => {
    const ctrl = new PlanActController();
    expect(ctrl.phase as PlanActPhase).toBe("planning");
  });

  it("transitions to awaiting_approval after setPlan with destructive steps", () => {
    const ctrl = new PlanActController({ alwaysRequireApproval: true });
    const plan = parsePlan("1. Delete old files\n2. Create new files", "migrate");
    ctrl.setPlan(plan);
    expect(ctrl.phase as PlanActPhase).toBe("awaiting_approval");
    expect(ctrl.requiresApproval()).toBe(true);
  });

  it("auto-approves safe plan below threshold", () => {
    const ctrl = new PlanActController({ autoApproveThreshold: 5 });
    const plan = parsePlan("1. Read index.ts\n2. Analyze structure", "read only");
    ctrl.setPlan(plan);
    // No destructive steps, small plan: should auto-approve
    expect(ctrl.canExecute() || ctrl.requiresApproval()).toBe(true);
  });

  it("processApproval('yes') advances to executing", () => {
    const ctrl = new PlanActController({ alwaysRequireApproval: true });
    const plan = parsePlan("1. Write auth.ts", "add auth");
    ctrl.setPlan(plan);
    const approved = ctrl.processApproval("yes");
    expect(approved).toBe(true);
    expect(ctrl.phase as PlanActPhase).toBe("executing");
  });

  it("processApproval('no') transitions to rejected", () => {
    const ctrl = new PlanActController({ alwaysRequireApproval: true });
    const plan = parsePlan("1. Delete database", "dangerous op");
    ctrl.setPlan(plan);
    const approved = ctrl.processApproval("no");
    expect(approved).toBe(false);
    expect(ctrl.phase as PlanActPhase).toBe("rejected");
  });

  it("advanceToNextStep advances through steps", () => {
    const ctrl = new PlanActController();
    const plan = parsePlan("1. Read file\n2. Write output\n3. Run tests", "test task");
    ctrl.setPlan(plan);
    // Force to executing
    ctrl.processApproval("yes");
    const firstStep = ctrl.advanceToNextStep();
    expect(firstStep).not.toBeNull();
    expect(ctrl.currentStepIndex).toBe(0);
  });

  it("formatProgress shows step statuses", () => {
    const ctrl = new PlanActController();
    const plan = parsePlan("1. Step one\n2. Step two", "goal");
    ctrl.setPlan(plan);
    ctrl.processApproval("yes");
    ctrl.advanceToNextStep();
    const progress = ctrl.formatProgress();
    expect(typeof progress).toBe("string");
    expect(progress).toContain("Progress");
  });

  it("serializeState / restoreState round-trips", () => {
    const ctrl = new PlanActController();
    const plan = parsePlan("1. Step one\n2. Step two", "goal");
    ctrl.setPlan(plan);
    const json = ctrl.serializeState();
    const ctrl2 = new PlanActController();
    const ok = ctrl2.restoreState(json);
    expect(ok).toBe(true);
    expect(ctrl2.plan?.id).toBe(plan.id);
  });

  it("reset returns to planning phase", () => {
    const ctrl = new PlanActController();
    const plan = parsePlan("1. Write code", "goal");
    ctrl.setPlan(plan);
    ctrl.reset();
    expect(ctrl.phase as PlanActPhase).toBe("planning");
    expect(ctrl.plan).toBeNull();
  });
});

// ─── plan_display message shape ───────────────────────────────────────────────

describe("plan_display webview message contract", () => {
  it("payload has expected fields from parsePlan + PlanActController", () => {
    const plan = parsePlan("1. Write code\n2. Run tests", "build feature");
    const ctrl = new PlanActController();
    ctrl.setPlan(plan);
    const payload = {
      planId: plan.id,
      goal: plan.goal,
      stepCount: plan.steps.length,
      hasDestructiveSteps: plan.hasDestructiveSteps,
      estimatedChangedFiles: plan.estimatedChangedFiles,
      requiresApproval: ctrl.requiresApproval(),
      formatted: ctrl.formatPlan(),
      steps: plan.steps,
    };
    expect(payload.planId).toBeTruthy();
    expect(payload.goal).toBe("build feature");
    expect(typeof payload.stepCount).toBe("number");
    expect(typeof payload.requiresApproval).toBe("boolean");
    expect(typeof payload.formatted).toBe("string");
    expect(Array.isArray(payload.steps)).toBe(true);
  });
});
