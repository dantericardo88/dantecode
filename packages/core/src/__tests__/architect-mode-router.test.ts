// packages/core/src/__tests__/architect-mode-router.test.ts
import { describe, it, expect, beforeEach } from "vitest";
import {
  buildFileEditInstruction,
  buildArchitectPlan,
  topoSortInstructions,
  validateArchitectPlan,
  estimatePlanCost,
  ArchitectModeRouter,
  type FileEditInstruction,
  type ArchitectPlan,
} from "../architect-mode-router.js";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeInst(filePath: string, op: FileEditInstruction["operation"] = "modify", deps: string[] = []): FileEditInstruction {
  return buildFileEditInstruction(filePath, op, `Update ${filePath}`, {
    content: `// content for ${filePath}`,
    dependsOn: deps,
  });
}

function makePlan(instructions: FileEditInstruction[] = []): ArchitectPlan {
  return buildArchitectPlan("Implement feature X", "Modify auth module then update tests", instructions);
}

// ─── buildFileEditInstruction ─────────────────────────────────────────────────

describe("buildFileEditInstruction", () => {
  it("creates instruction with correct fields", () => {
    const inst = buildFileEditInstruction("src/a.ts", "modify", "Fix bug");
    expect(inst.filePath).toBe("src/a.ts");
    expect(inst.operation).toBe("modify");
    expect(inst.rationale).toBe("Fix bug");
    expect((inst as { status?: unknown }).status).toBeUndefined(); // no status field on instruction
    expect(inst.dependsOn).toEqual([]);
  });

  it("accepts content and dependsOn", () => {
    const inst = buildFileEditInstruction("b.ts", "create", "New file", {
      content: "const x = 1;",
      dependsOn: ["inst-1"],
    });
    expect(inst.content).toBe("const x = 1;");
    expect(inst.dependsOn).toContain("inst-1");
  });

  it("generates unique IDs", () => {
    const a = makeInst("a.ts");
    const b = makeInst("b.ts");
    expect(a.id).not.toBe(b.id);
  });

  it("defaults estimatedEditorTokens to 500", () => {
    const inst = makeInst("a.ts");
    expect(inst.estimatedEditorTokens).toBe(500);
  });

  it("rename instruction accepts newPath", () => {
    const inst = buildFileEditInstruction("old.ts", "rename", "Rename file", { newPath: "new.ts" });
    expect(inst.newPath).toBe("new.ts");
  });
});

// ─── buildArchitectPlan ───────────────────────────────────────────────────────

describe("buildArchitectPlan", () => {
  it("creates plan with draft status", () => {
    const plan = makePlan();
    expect(plan.status).toBe("draft");
  });

  it("defaults to opus/sonnet model pair", () => {
    const plan = makePlan();
    expect(plan.architectModel).toContain("opus");
    expect(plan.editorModel).toContain("sonnet");
  });

  it("accepts custom model names", () => {
    const plan = buildArchitectPlan("task", "strategy", [], {
      architectModel: "claude-opus-4-6",
      editorModel: "claude-haiku-4-5",
    });
    expect(plan.editorModel).toBe("claude-haiku-4-5");
  });

  it("starts with zero token usage", () => {
    const plan = makePlan();
    expect(plan.architectTokensUsed).toBe(0);
    expect(plan.editorTokensUsed).toBe(0);
  });
});

// ─── topoSortInstructions ─────────────────────────────────────────────────────

describe("topoSortInstructions", () => {
  it("returns all IDs for instructions with no deps", () => {
    const a = makeInst("a.ts");
    const b = makeInst("b.ts");
    const sorted = topoSortInstructions([a, b]);
    expect(sorted).toHaveLength(2);
    expect(sorted).toContain(a.id);
    expect(sorted).toContain(b.id);
  });

  it("respects dependency ordering", () => {
    const a = makeInst("a.ts");
    const b = buildFileEditInstruction("b.ts", "modify", "After a", { dependsOn: [a.id] });
    const sorted = topoSortInstructions([b, a]); // deliberately reversed input
    expect(sorted.indexOf(a.id)).toBeLessThan(sorted.indexOf(b.id));
  });

  it("throws on cyclic dependencies", () => {
    const a = buildFileEditInstruction("a.ts", "modify", "a");
    const b = buildFileEditInstruction("b.ts", "modify", "b", { dependsOn: [a.id] });
    // Manually create cycle
    a.dependsOn.push(b.id);
    expect(() => topoSortInstructions([a, b])).toThrow("Cyclic");
  });

  it("handles empty instruction list", () => {
    expect(topoSortInstructions([])).toEqual([]);
  });
});

// ─── validateArchitectPlan ────────────────────────────────────────────────────

describe("validateArchitectPlan", () => {
  it("returns valid for well-formed plan", () => {
    const inst = makeInst("src/a.ts");
    const plan = makePlan([inst]);
    expect(validateArchitectPlan(plan).valid).toBe(true);
  });

  it("errors on missing dependency reference", () => {
    const inst = buildFileEditInstruction("a.ts", "modify", "r", { dependsOn: ["nonexistent"] });
    const plan = makePlan([inst]);
    const result = validateArchitectPlan(plan);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("nonexistent"))).toBe(true);
  });

  it("errors on multiple create for same file", () => {
    const a = buildFileEditInstruction("same.ts", "create", "first", { content: "a" });
    const b = buildFileEditInstruction("same.ts", "create", "second", { content: "b" });
    const plan = makePlan([a, b]);
    const result = validateArchitectPlan(plan);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("multiple create"))).toBe(true);
  });

  it("warns on delete + other operation on same file", () => {
    const del = buildFileEditInstruction("a.ts", "delete", "del");
    const mod = buildFileEditInstruction("a.ts", "modify", "mod", { content: "x" });
    const plan = makePlan([del, mod]);
    const result = validateArchitectPlan(plan);
    expect(result.warnings.some((w) => w.includes("deleted"))).toBe(true);
  });

  it("errors on rename without newPath", () => {
    const inst = buildFileEditInstruction("a.ts", "rename", "rename");
    const plan = makePlan([inst]);
    const result = validateArchitectPlan(plan);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("newPath"))).toBe(true);
  });

  it("returns executionOrder in topological order", () => {
    const a = makeInst("a.ts");
    const b = buildFileEditInstruction("b.ts", "modify", "r", {
      content: "x",
      dependsOn: [a.id],
    });
    const plan = makePlan([b, a]);
    const result = validateArchitectPlan(plan);
    expect(result.executionOrder.indexOf(a.id)).toBeLessThan(result.executionOrder.indexOf(b.id));
  });
});

// ─── estimatePlanCost ─────────────────────────────────────────────────────────

describe("estimatePlanCost", () => {
  it("returns positive cost for non-empty plan", () => {
    const plan = makePlan([makeInst("a.ts"), makeInst("b.ts")]);
    const cost = estimatePlanCost(plan);
    expect(cost.totalTokens).toBeGreaterThan(0);
    expect(cost.estimatedUsd).toBeGreaterThan(0);
  });

  it("editorTokens scales with number of instructions", () => {
    const plan1 = makePlan([makeInst("a.ts")]);
    const plan2 = makePlan([makeInst("a.ts"), makeInst("b.ts")]);
    const c1 = estimatePlanCost(plan1);
    const c2 = estimatePlanCost(plan2);
    expect(c2.editorTokens).toBeGreaterThan(c1.editorTokens);
  });

  it("uses haiku for cheaper editor = lower cost", () => {
    const expensivePlan = buildArchitectPlan("t", "s", [makeInst("a.ts")], { editorModel: "claude-opus-4-6" });
    const cheapPlan = buildArchitectPlan("t", "s", [makeInst("a.ts")], { editorModel: "claude-haiku-4-5" });
    expect(estimatePlanCost(cheapPlan).estimatedUsd).toBeLessThan(estimatePlanCost(expensivePlan).estimatedUsd);
  });
});

// ─── ArchitectModeRouter ──────────────────────────────────────────────────────

describe("ArchitectModeRouter", () => {
  let router: ArchitectModeRouter;

  beforeEach(() => { router = new ArchitectModeRouter(); });

  it("registerPlan stores the plan", () => {
    const plan = router.registerPlan(makePlan());
    expect(router.getPlan(plan.id)).toBeDefined();
  });

  it("validatePlan returns valid result for good plan", () => {
    const plan = router.registerPlan(makePlan([makeInst("a.ts")]));
    const result = router.validatePlan(plan.id);
    expect(result!.valid).toBe(true);
  });

  it("validatePlan updates plan status to validated on success", () => {
    const plan = router.registerPlan(makePlan([makeInst("a.ts")]));
    router.validatePlan(plan.id);
    expect(router.getPlan(plan.id)!.status).toBe("validated");
  });

  it("recordArchitectPhase updates token count", () => {
    const plan = router.registerPlan(makePlan());
    router.recordArchitectPhase(plan.id, 2500);
    expect(router.getPlan(plan.id)!.architectTokensUsed).toBe(2500);
  });

  it("recordEditorResult accumulates editorTokensUsed", () => {
    const inst = makeInst("a.ts");
    const plan = router.registerPlan(makePlan([inst]));
    router.recordEditorResult(plan.id, {
      instructionId: inst.id,
      filePath: inst.filePath,
      success: true,
      tokensUsed: 300,
    });
    expect(router.getPlan(plan.id)!.editorTokensUsed).toBe(300);
  });

  it("getReadyInstructions returns instructions with all deps met", () => {
    const a = makeInst("a.ts");
    const b = buildFileEditInstruction("b.ts", "modify", "r", { content: "x", dependsOn: [a.id] });
    const plan = router.registerPlan(makePlan([a, b]));
    const ready = router.getReadyInstructions(plan.id);
    expect(ready.map((i) => i.id)).toContain(a.id);
    expect(ready.map((i) => i.id)).not.toContain(b.id);
  });

  it("getReadyInstructions returns b after a completes", () => {
    const a = makeInst("a.ts");
    const b = buildFileEditInstruction("b.ts", "modify", "r", { content: "x", dependsOn: [a.id] });
    const plan = router.registerPlan(makePlan([a, b]));
    router.recordEditorResult(plan.id, { instructionId: a.id, filePath: a.filePath, success: true, tokensUsed: 100 });
    const ready = router.getReadyInstructions(plan.id);
    expect(ready.map((i) => i.id)).toContain(b.id);
  });

  it("completePlan sets status to complete", () => {
    const plan = router.registerPlan(makePlan());
    router.completePlan(plan.id);
    expect(router.getPlan(plan.id)!.status).toBe("complete");
  });

  it("failPlan sets status to failed", () => {
    const plan = router.registerPlan(makePlan());
    router.failPlan(plan.id, "timeout");
    expect(router.getPlan(plan.id)!.status).toBe("failed");
  });

  it("formatPlanForPrompt includes task and strategy", () => {
    const plan = router.registerPlan(makePlan([makeInst("a.ts")]));
    const output = router.formatPlanForPrompt(plan.id);
    expect(output).toContain("Implement feature X");
    expect(output).toContain("Strategy:");
  });

  it("totalPlans tracks registered plans", () => {
    router.registerPlan(makePlan());
    router.registerPlan(makePlan());
    expect(router.totalPlans).toBe(2);
  });

  it("activePlans excludes complete and draft plans", () => {
    const p1 = router.registerPlan(makePlan());
    router.validatePlan(p1.id); // now validated
    const p2 = router.registerPlan(makePlan());
    router.completePlan(p2.id); // now complete
    expect(router.activePlans.some((p) => p.id === p1.id)).toBe(true);
    expect(router.activePlans.some((p) => p.id === p2.id)).toBe(false);
  });
});
