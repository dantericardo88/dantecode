// ============================================================================
// Sprint BJ — dim 16: planSmartContextBudget wiring tests
// ============================================================================

import { describe, it, expect, vi } from "vitest";

// ─── VS Code Mock ─────────────────────────────────────────────────────────────

vi.mock("vscode", () => ({
  Uri: {
    file: (path: string) => ({ fsPath: path, toString: () => `file://${path}` }),
  },
  workspace: {
    fs: {
      readFile: vi.fn(async () => new Uint8Array(Buffer.from("mock file content"))),
      writeFile: vi.fn(async () => undefined),
      delete: vi.fn(async () => undefined),
    },
    workspaceFolders: [{ uri: { fsPath: "/workspace" } }],
  },
  window: {
    showTextDocument: vi.fn(async () => undefined),
    showInformationMessage: vi.fn(async () => "Cancel"),
  },
}));

// Mock child_process for git operations
vi.mock("node:child_process", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:child_process")>();
  return {
    ...actual,
    execFile: vi.fn((_cmd: string, _args: string[], _opts: unknown, cb: (err: null, result: { stdout: string; stderr: string }) => void) => {
      cb(null, { stdout: "abc123sha\n", stderr: "" });
    }),
  };
});

import { PlanActController, parsePlanSteps, type PlanStep } from "./plan-act-controller.js";
import { PlanSmartContext } from "@dantecode/core";

// ---------------------------------------------------------------------------
// PlanSmartContext unit tests
// ---------------------------------------------------------------------------

describe("PlanSmartContext.getStepBudget", () => {
  it("allocates 40% of budget to the first step of a multi-step plan", () => {
    const ctx = new PlanSmartContext(10000);
    const allocation = ctx.getStepBudget({ id: "step-1", description: "Init" }, 0, 4);
    // First step: 40% = 4000 tokens
    expect(allocation.stepTokenBudget).toBe(4000);
    expect(allocation.isPriorityStep).toBe(true);
  });

  it("divides remaining budget equally among non-first steps", () => {
    const ctx = new PlanSmartContext(10000);
    // Step index 1, 3 remaining → totalSteps=5; after first step (4000), 6000 left / 4 steps = 1500
    const allocation = ctx.getStepBudget({ id: "step-2", description: "Do work" }, 1, 3);
    expect(allocation.stepTokenBudget).toBe(1500);
    expect(allocation.isPriorityStep).toBe(false);
  });

  it("allocates full budget to the last step", () => {
    const ctx = new PlanSmartContext(5000);
    // remainingSteps=0 → last step gets full budget
    const allocation = ctx.getStepBudget({ id: "step-last", description: "Final step" }, 3, 0);
    expect(allocation.stepTokenBudget).toBe(5000);
    expect(allocation.isPriorityStep).toBe(false);
  });

  it("clamps step budget to at least 500 tokens", () => {
    const ctx = new PlanSmartContext(100); // very small budget
    const allocation = ctx.getStepBudget({ id: "step-1", description: "First" }, 0, 10);
    // 40% of 100 = 40, but clamped to 500
    expect(allocation.stepTokenBudget).toBeGreaterThanOrEqual(500);
  });

  it("includes step id in the budgetLabel", () => {
    const ctx = new PlanSmartContext(8000);
    const allocation = ctx.getStepBudget({ id: "step-3", description: "Middle step" }, 1, 2);
    expect(allocation.budgetLabel).toContain("step-3");
    expect(allocation.budgetLabel).toContain("budget=");
  });

  it("handles single-step plans: first step is also the last", () => {
    const ctx = new PlanSmartContext(8000);
    // Only 1 step: stepIndex=0, remainingSteps=0
    const allocation = ctx.getStepBudget({ id: "step-only", description: "Only step" }, 0, 0);
    // remainingSteps=0 → last-step branch → full budget
    expect(allocation.stepTokenBudget).toBe(8000);
    expect(allocation.isPriorityStep).toBe(false);
  });

  it("respects per-call totalBudget override", () => {
    const ctx = new PlanSmartContext(1000); // default 1000
    // Override with 20000 for this call
    const allocation = ctx.getStepBudget({ id: "s1", description: "Step" }, 0, 3, 20000);
    // 40% of 20000 = 8000
    expect(allocation.stepTokenBudget).toBe(8000);
  });
});

// ---------------------------------------------------------------------------
// PlanActController.planSmartContextBudget integration
// ---------------------------------------------------------------------------

describe("PlanActController.planSmartContextBudget", () => {
  it("returns a StepBudgetAllocation with positive token budget", () => {
    const controller = new PlanActController({ smartContextTokenBudget: 8000 });
    const step: PlanStep = { id: "step-1", description: "Install dependencies" };
    const allocation = controller.planSmartContextBudget(step, 0, 3);

    expect(allocation.stepTokenBudget).toBeGreaterThan(0);
    expect(allocation.budgetLabel).toBeTruthy();
    expect(typeof allocation.isPriorityStep).toBe("boolean");
  });

  it("logs budget allocations to getBudgetLog()", () => {
    const controller = new PlanActController({ smartContextTokenBudget: 8000 });
    const steps: PlanStep[] = [
      { id: "s1", description: "Step 1" },
      { id: "s2", description: "Step 2" },
    ];

    controller.planSmartContextBudget(steps[0]!, 0, 1);
    controller.planSmartContextBudget(steps[1]!, 1, 0);

    const log = controller.getBudgetLog();
    expect(log).toHaveLength(2);
    expect(log[0]!.stepId).toBe("s1");
    expect(log[1]!.stepId).toBe("s2");
  });

  it("first step gets priority allocation", () => {
    const controller = new PlanActController({ smartContextTokenBudget: 10000 });
    const step: PlanStep = { id: "first", description: "First step" };
    const allocation = controller.planSmartContextBudget(step, 0, 4);

    expect(allocation.isPriorityStep).toBe(true);
    expect(allocation.stepTokenBudget).toBe(4000); // 40% of 10000
  });

  it("executeStep logs a budget entry before running fn", async () => {
    const controller = new PlanActController({ smartContextTokenBudget: 8000 });
    const step: PlanStep = { id: "test-step", description: "Run tests" };
    let fnCalled = false;

    await controller.executeStep(step, async () => { fnCalled = true; }, 0, 2);

    expect(fnCalled).toBe(true);
    const log = controller.getBudgetLog();
    expect(log).toHaveLength(1);
    expect(log[0]!.stepId).toBe("test-step");
    expect(log[0]!.allocation.stepTokenBudget).toBeGreaterThan(0);
  });

  it("budget label contains readable step info", () => {
    const controller = new PlanActController({ smartContextTokenBudget: 6000 });
    const step: PlanStep = { id: "deploy", description: "Deploy to production" };
    const allocation = controller.planSmartContextBudget(step, 2, 0);

    expect(allocation.budgetLabel).toContain("deploy");
    expect(allocation.budgetLabel).toContain("budget=");
    expect(allocation.budgetLabel).toContain("remaining=0");
  });

  it("parsePlanSteps + planSmartContextBudget works for a multi-step plan string", () => {
    const planText = `
1. Install dependencies
2. Run tests
3. Build the project
4. Deploy to staging
    `.trim();

    const steps = parsePlanSteps(planText);
    expect(steps).toHaveLength(4);

    const controller = new PlanActController({ smartContextTokenBudget: 8000 });
    const allocations = steps.map((step, i) =>
      controller.planSmartContextBudget(step, i, steps.length - 1 - i),
    );

    // First step is priority
    expect(allocations[0]!.isPriorityStep).toBe(true);
    // All allocations are positive
    for (const a of allocations) {
      expect(a.stepTokenBudget).toBeGreaterThan(0);
    }
    // Budget log has all 4 entries
    expect(controller.getBudgetLog()).toHaveLength(4);
  });
});
