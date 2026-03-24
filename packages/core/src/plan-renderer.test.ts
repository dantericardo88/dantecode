import { describe, it, expect } from "vitest";
import { renderPlan, renderPlanStep, renderPlanSummary, complexityBadge } from "./plan-renderer.js";
import type { ExecutionPlan, PlanStep } from "./architect-planner.js";

const step: PlanStep = {
  id: "step-1",
  description: "Create the API endpoint",
  files: ["src/api.ts", "src/routes.ts"],
  verifyCommand: "npm test",
  dependencies: ["step-0"],
  status: "pending",
};

const plan: ExecutionPlan = {
  goal: "Build a REST API",
  steps: [
    { id: "step-1", description: "Create models", files: ["models.ts"], status: "completed" },
    {
      id: "step-2",
      description: "Create routes",
      files: ["routes.ts"],
      status: "in_progress",
      dependencies: ["step-1"],
    },
    {
      id: "step-3",
      description: "Add tests",
      files: ["test.ts"],
      status: "pending",
      verifyCommand: "npm test",
    },
  ],
  createdAt: "2026-03-24T00:00:00Z",
  estimatedComplexity: 0.6,
};

describe("plan-renderer", () => {
  describe("complexityBadge", () => {
    it("returns CRITICAL for >= 0.8", () => {
      expect(complexityBadge(0.9, false)).toBe("[CRITICAL]");
    });
    it("returns HIGH for >= 0.5", () => {
      expect(complexityBadge(0.6, false)).toBe("[HIGH]");
    });
    it("returns MED for >= 0.3", () => {
      expect(complexityBadge(0.4, false)).toBe("[MED]");
    });
    it("returns LOW for < 0.3", () => {
      expect(complexityBadge(0.2, false)).toBe("[LOW]");
    });
  });

  describe("renderPlanStep", () => {
    it("renders step with all annotations", () => {
      const result = renderPlanStep(step, 0, { colors: false });
      expect(result).toContain("1.");
      expect(result).toContain("Create the API endpoint");
      expect(result).toContain("src/api.ts");
      expect(result).toContain("npm test");
      expect(result).toContain("step-0");
    });

    it("hides deps when showDeps is false", () => {
      const result = renderPlanStep(step, 0, { colors: false, showDeps: false });
      expect(result).not.toContain("Depends:");
    });

    it("hides verify when showVerify is false", () => {
      const result = renderPlanStep(step, 0, { colors: false, showVerify: false });
      expect(result).not.toContain("Verify:");
    });
  });

  describe("renderPlan", () => {
    it("includes header with goal and complexity", () => {
      const result = renderPlan(plan, { colors: false });
      expect(result).toContain("Execution Plan");
      expect(result).toContain("Build a REST API");
      expect(result).toContain("3");
      expect(result).toContain("0.60");
    });

    it("renders all steps", () => {
      const result = renderPlan(plan, { colors: false });
      expect(result).toContain("Create models");
      expect(result).toContain("Create routes");
      expect(result).toContain("Add tests");
    });
  });

  describe("renderPlanSummary", () => {
    it("summarizes plan status", () => {
      const result = renderPlanSummary(plan);
      expect(result).toContain("3 steps");
      expect(result).toContain("1 done");
      expect(result).toContain("1 running");
      expect(result).toContain("1 pending");
      expect(result).toContain("0.60");
    });
  });
});
