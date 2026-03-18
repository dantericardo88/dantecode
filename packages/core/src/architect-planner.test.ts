import { describe, expect, it, vi } from "vitest";
import {
  ArchitectPlanner,
  analyzeComplexity,
  parsePlanFromText,
} from "./architect-planner.js";

describe("architect-planner", () => {
  describe("analyzeComplexity", () => {
    it("returns low complexity for simple prompts", () => {
      expect(analyzeComplexity("fix the typo")).toBeLessThan(0.3);
    });

    it("returns higher complexity for multi-file refactors", () => {
      const score = analyzeComplexity("refactor the authentication system across multiple files");
      expect(score).toBeGreaterThanOrEqual(0.3);
    });

    it("returns high complexity for architecture tasks", () => {
      const score = analyzeComplexity(
        "design and implement a new API pipeline with database integration, then create tests",
      );
      expect(score).toBeGreaterThanOrEqual(0.4);
    });

    it("returns 0 for empty string", () => {
      expect(analyzeComplexity("")).toBe(0);
    });

    it("caps at 1.0", () => {
      const score = analyzeComplexity(
        "refactor across the entire codebase, implement a new system design with database schema migration, " +
          "then build API endpoints, first step is infrastructure, second step is integration, " +
          "finally implement tests throughout all files project-wide",
      );
      expect(score).toBeLessThanOrEqual(1);
    });

    it("detects multi-step indicators", () => {
      const simple = analyzeComplexity("add a button");
      const multiStep = analyzeComplexity("first add the button, then style it, finally add tests");
      expect(multiStep).toBeGreaterThan(simple);
    });
  });

  describe("parsePlanFromText", () => {
    it("parses numbered steps", () => {
      const text = [
        "1. Create the auth module",
        "2. Add the login endpoint",
        "3. Write tests for authentication",
      ].join("\n");

      const plan = parsePlanFromText("build auth", text);
      expect(plan.steps).toHaveLength(3);
      expect(plan.steps[0]!.description).toBe("Create the auth module");
      expect(plan.steps[2]!.description).toBe("Write tests for authentication");
    });

    it("parses steps with file annotations", () => {
      const text = [
        "1. Implement the user model",
        "   Files: src/models/user.ts, src/models/index.ts",
        "2. Add the API route",
        "   Files: src/routes/users.ts",
      ].join("\n");

      const plan = parsePlanFromText("add users", text);
      expect(plan.steps[0]!.files).toEqual(["src/models/user.ts", "src/models/index.ts"]);
      expect(plan.steps[1]!.files).toEqual(["src/routes/users.ts"]);
    });

    it("parses steps with verify commands", () => {
      const text = [
        "1. Fix the failing test",
        "   Verify: npm test",
        "2. Update the docs",
      ].join("\n");

      const plan = parsePlanFromText("fix tests", text);
      expect(plan.steps[0]!.verifyCommand).toBe("npm test");
      expect(plan.steps[1]!.verifyCommand).toBeUndefined();
    });

    it("parses steps with dependency annotations", () => {
      const text = [
        "1. Create the database schema",
        "2. Build the API layer",
        "   Depends: step 1",
      ].join("\n");

      const plan = parsePlanFromText("build api", text);
      expect(plan.steps[1]!.dependencies).toEqual(["1"]);
    });

    it("handles 'Step N:' format", () => {
      const text = [
        "Step 1: Analyze the codebase",
        "Step 2: Implement changes",
      ].join("\n");

      const plan = parsePlanFromText("analyze", text);
      expect(plan.steps).toHaveLength(2);
    });

    it("handles parenthetical format '1)'", () => {
      const text = [
        "1) First task",
        "2) Second task",
      ].join("\n");

      const plan = parsePlanFromText("tasks", text);
      expect(plan.steps).toHaveLength(2);
      expect(plan.steps[0]!.description).toBe("First task");
    });

    it("returns empty steps for unstructured text", () => {
      const text = "Just a paragraph of text without numbered steps.";
      const plan = parsePlanFromText("something", text);
      expect(plan.steps).toHaveLength(0);
    });

    it("assigns step IDs sequentially", () => {
      const text = "1. Step A\n2. Step B\n3. Step C";
      const plan = parsePlanFromText("test", text);
      expect(plan.steps[0]!.id).toBe("step-1");
      expect(plan.steps[1]!.id).toBe("step-2");
      expect(plan.steps[2]!.id).toBe("step-3");
    });

    it("all steps start as pending", () => {
      const text = "1. Do something\n2. Do another thing";
      const plan = parsePlanFromText("test", text);
      expect(plan.steps.every((s) => s.status === "pending")).toBe(true);
    });

    it("includes goal and timestamp", () => {
      const plan = parsePlanFromText("build feature X", "1. First step");
      expect(plan.goal).toBe("build feature X");
      expect(plan.createdAt).toBeDefined();
    });

    it("strips backticks from file paths", () => {
      const text = "1. Update files\n   Files: `src/main.ts`, `src/app.ts`";
      const plan = parsePlanFromText("update", text);
      expect(plan.steps[0]!.files).toEqual(["src/main.ts", "src/app.ts"]);
    });
  });

  describe("ArchitectPlanner", () => {
    it("generates a plan using the provided model function", async () => {
      const generatePlan = vi.fn().mockResolvedValue(
        "1. Create the auth module\n   Files: src/auth.ts\n2. Add tests\n   Verify: npm test",
      );

      const planner = new ArchitectPlanner({ generatePlan });
      const plan = await planner.createPlan("build auth system", "repo context here");

      expect(generatePlan).toHaveBeenCalledOnce();
      expect(plan.steps).toHaveLength(2);
      expect(plan.goal).toBe("build auth system");
    });

    it("passes architect prompt to the model", async () => {
      const generatePlan = vi.fn().mockResolvedValue("1. Do work");

      const planner = new ArchitectPlanner({ generatePlan });
      await planner.createPlan("refactor database", "context");

      const prompt = generatePlan.mock.calls[0]![0] as string;
      expect(prompt).toContain("architect");
      expect(prompt).toContain("refactor database");
    });
  });
});
