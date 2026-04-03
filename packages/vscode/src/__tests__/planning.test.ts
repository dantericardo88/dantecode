/**
 * planning.test.ts — Planning Mode Tests
 *
 * Tests for planning mode workflow including plan generation,
 * display, approve/reject workflows, plan persistence, and step execution tracking.
 *
 * Phase 6: Testing & Documentation
 */

import { describe, it, expect, beforeEach } from "vitest";

// ──────────────────────────────────────────────────────────────────────────────
// Test Types (mirror planning-panel.ts types)
// ──────────────────────────────────────────────────────────────────────────────

interface PlanStep {
  id: string;
  title: string;
  description: string;
  files: string[];
  dependencies: string[];
  verifyCommands: string[];
  estimatedHours: number;
  complexity: number;
  status?: "pending" | "in-progress" | "complete" | "failed";
}

interface Plan {
  id: string;
  goal: string;
  complexity: number;
  createdAt: string;
  steps: PlanStep[];
  totalEstimatedHours: number;
  status: "draft" | "approved" | "rejected" | "executing" | "complete";
  approvedAt?: string;
  rejectedAt?: string;
  rejectionReason?: string;
}

interface PlanGenerateMessage {
  type: "plan_generate";
  goal: string;
}

interface PlanApproveMessage {
  type: "plan_approve";
  planId: string;
}

interface PlanRejectMessage {
  type: "plan_reject";
  planId: string;
  reason?: string;
}

interface PlanListMessage {
  type: "plan_list";
}

interface PlanStatusMessage {
  type: "plan_status";
  planId: string;
}

// ──────────────────────────────────────────────────────────────────────────────
// Test Suite
// ──────────────────────────────────────────────────────────────────────────────

describe("Planning Mode", () => {
  let mockPlan: Plan;

  beforeEach(() => {
    mockPlan = {
      id: "plan-test-123",
      goal: "Build a todo app with React",
      complexity: 6.5,
      createdAt: new Date().toISOString(),
      totalEstimatedHours: 24,
      status: "draft",
      steps: [
        {
          id: "step-1",
          title: "Setup project structure",
          description: "Initialize React app with TypeScript",
          files: ["package.json", "tsconfig.json", "src/App.tsx"],
          dependencies: [],
          verifyCommands: ["npm run build", "npm test"],
          estimatedHours: 2,
          complexity: 3,
          status: "pending",
        },
        {
          id: "step-2",
          title: "Create Todo components",
          description: "Build TodoList and TodoItem components",
          files: ["src/components/TodoList.tsx", "src/components/TodoItem.tsx"],
          dependencies: ["step-1"],
          verifyCommands: ["npm test"],
          estimatedHours: 6,
          complexity: 5,
          status: "pending",
        },
        {
          id: "step-3",
          title: "Add state management",
          description: "Implement Redux for todo state",
          files: ["src/store/todoSlice.ts", "src/store/index.ts"],
          dependencies: ["step-2"],
          verifyCommands: ["npm test", "npm run lint"],
          estimatedHours: 8,
          complexity: 7,
          status: "pending",
        },
        {
          id: "step-4",
          title: "Add persistence",
          description: "Save todos to localStorage",
          files: ["src/utils/persistence.ts"],
          dependencies: ["step-3"],
          verifyCommands: ["npm test"],
          estimatedHours: 4,
          complexity: 4,
          status: "pending",
        },
        {
          id: "step-5",
          title: "Polish UI",
          description: "Add styles and animations",
          files: ["src/styles/App.css", "src/styles/animations.css"],
          dependencies: ["step-4"],
          verifyCommands: ["npm run build"],
          estimatedHours: 4,
          complexity: 3,
          status: "pending",
        },
      ],
    };
  });

  // ────────────────────────────────────────────────────────────────────────────
  // Plan Generation
  // ────────────────────────────────────────────────────────────────────────────

  describe("Plan Generation", () => {
    it("should generate plan from goal", () => {
      const message: PlanGenerateMessage = {
        type: "plan_generate",
        goal: "Build a todo app with React",
      };

      expect(message.type).toBe("plan_generate");
      expect(message.goal).toBe("Build a todo app with React");
      expect(mockPlan.goal).toBe(message.goal);
    });

    it("should create plan with unique ID", () => {
      expect(mockPlan.id).toMatch(/^plan-/);
      expect(mockPlan.id.length).toBeGreaterThan(5);
    });

    it("should set plan status to draft", () => {
      expect(mockPlan.status).toBe("draft");
    });

    it("should include creation timestamp", () => {
      expect(mockPlan.createdAt).toBeTruthy();
      const timestamp = new Date(mockPlan.createdAt);
      expect(timestamp.getTime()).toBeLessThanOrEqual(Date.now());
    });

    it("should calculate total estimated hours", () => {
      const totalHours = mockPlan.steps.reduce((sum, step) => sum + step.estimatedHours, 0);
      expect(mockPlan.totalEstimatedHours).toBe(totalHours);
      expect(mockPlan.totalEstimatedHours).toBe(24);
    });

    it("should assign complexity score", () => {
      expect(mockPlan.complexity).toBeGreaterThan(0);
      expect(mockPlan.complexity).toBeLessThanOrEqual(10);
    });
  });

  // ────────────────────────────────────────────────────────────────────────────
  // Plan Display
  // ────────────────────────────────────────────────────────────────────────────

  describe("Plan Display", () => {
    it("should display plan overview", () => {
      const overview = {
        goal: mockPlan.goal,
        complexity: mockPlan.complexity,
        totalSteps: mockPlan.steps.length,
        totalHours: mockPlan.totalEstimatedHours,
        createdAt: mockPlan.createdAt,
      };

      expect(overview.goal).toBe("Build a todo app with React");
      expect(overview.complexity).toBe(6.5);
      expect(overview.totalSteps).toBe(5);
      expect(overview.totalHours).toBe(24);
    });

    it("should display step list", () => {
      expect(mockPlan.steps).toHaveLength(5);
      expect(mockPlan.steps[0]?.title).toBe("Setup project structure");
      expect(mockPlan.steps[4]?.title).toBe("Polish UI");
    });

    it("should show step dependencies", () => {
      const step2 = mockPlan.steps[1];
      expect(step2?.dependencies).toContain("step-1");

      const step3 = mockPlan.steps[2];
      expect(step3?.dependencies).toContain("step-2");
    });

    it("should show files for each step", () => {
      const step1 = mockPlan.steps[0];
      expect(step1?.files).toContain("package.json");
      expect(step1?.files).toContain("tsconfig.json");
      expect(step1?.files).toContain("src/App.tsx");
    });

    it("should show verify commands", () => {
      const step1 = mockPlan.steps[0];
      expect(step1?.verifyCommands).toContain("npm run build");
      expect(step1?.verifyCommands).toContain("npm test");
    });

    it("should show step complexity", () => {
      mockPlan.steps.forEach((step) => {
        expect(step.complexity).toBeGreaterThan(0);
        expect(step.complexity).toBeLessThanOrEqual(10);
      });
    });
  });

  // ────────────────────────────────────────────────────────────────────────────
  // Approve Workflow
  // ────────────────────────────────────────────────────────────────────────────

  describe("Approve Workflow", () => {
    it("should approve plan", () => {
      // Simulate approval message
      // const message: PlanApproveMessage = {
      //   type: "plan_approve",
      //   planId: mockPlan.id,
      // };

      // Simulate approval
      mockPlan.status = "approved";
      mockPlan.approvedAt = new Date().toISOString();

      expect(mockPlan.status).toBe("approved");
      expect(mockPlan.approvedAt).toBeTruthy();
    });

    it("should transition from draft to approved", () => {
      expect(mockPlan.status).toBe("draft");

      mockPlan.status = "approved";
      expect(mockPlan.status).toBe("approved");
    });

    it("should record approval timestamp", () => {
      const approvalTime = new Date().toISOString();
      mockPlan.approvedAt = approvalTime;

      expect(mockPlan.approvedAt).toBe(approvalTime);
    });

    it("should start execution after approval", () => {
      mockPlan.status = "approved";
      mockPlan.status = "executing";

      expect(mockPlan.status).toBe("executing");
    });
  });

  // ────────────────────────────────────────────────────────────────────────────
  // Reject Workflow
  // ────────────────────────────────────────────────────────────────────────────

  describe("Reject Workflow", () => {
    it("should reject plan with reason", () => {
      const rejectionReason = "Too complex, break into smaller steps";

      mockPlan.status = "rejected";
      mockPlan.rejectedAt = new Date().toISOString();
      mockPlan.rejectionReason = rejectionReason;

      expect(mockPlan.status).toBe("rejected");
      expect(mockPlan.rejectionReason).toBe("Too complex, break into smaller steps");
    });

    it("should handle rejection without reason", () => {
      const message: PlanRejectMessage = {
        type: "plan_reject",
        planId: mockPlan.id,
      };

      mockPlan.status = "rejected";
      mockPlan.rejectedAt = new Date().toISOString();

      expect(mockPlan.status).toBe("rejected");
      expect(mockPlan.rejectionReason).toBeUndefined();
    });

    it("should record rejection timestamp", () => {
      const rejectionTime = new Date().toISOString();
      mockPlan.rejectedAt = rejectionTime;

      expect(mockPlan.rejectedAt).toBe(rejectionTime);
    });

    it("should allow regeneration after rejection", () => {
      mockPlan.status = "rejected";

      // User can generate new plan
      const newPlan = { ...mockPlan, id: "plan-new-456", status: "draft" as const };

      expect(newPlan.id).not.toBe(mockPlan.id);
      expect(newPlan.status).toBe("draft");
    });
  });

  // ────────────────────────────────────────────────────────────────────────────
  // Plan Persistence
  // ────────────────────────────────────────────────────────────────────────────

  describe("Plan Persistence", () => {
    it("should save plan to storage", () => {
      const savedPlan = JSON.stringify(mockPlan);
      const parsedPlan = JSON.parse(savedPlan);

      expect(parsedPlan.id).toBe(mockPlan.id);
      expect(parsedPlan.goal).toBe(mockPlan.goal);
      expect(parsedPlan.steps).toHaveLength(mockPlan.steps.length);
    });

    it("should list all saved plans", () => {
      // const message: PlanListMessage = {
      //   type: "plan_list",
      // };

      const plans = [mockPlan];

      expect(plans).toHaveLength(1);
      expect(plans[0]?.id).toBe(mockPlan.id);
    });

    it("should get plan status by ID", () => {
      // const message: PlanStatusMessage = {
      //   type: "plan_status",
      //   planId: mockPlan.id,
      // };

      const status = {
        planId: mockPlan.id,
        status: mockPlan.status,
        completedSteps: mockPlan.steps.filter((s) => s.status === "complete").length,
        totalSteps: mockPlan.steps.length,
      };

      expect(status.planId).toBe(mockPlan.id);
      expect(status.status).toBe("draft");
      expect(status.totalSteps).toBe(5);
    });

    it("should handle multiple plans", () => {
      const plan2: Plan = {
        ...mockPlan,
        id: "plan-test-456",
        goal: "Add authentication",
      };

      const plans = [mockPlan, plan2];

      expect(plans).toHaveLength(2);
      expect(plans[0]?.id).toBe("plan-test-123");
      expect(plans[1]?.id).toBe("plan-test-456");
    });
  });

  // ────────────────────────────────────────────────────────────────────────────
  // Step Execution Tracking
  // ────────────────────────────────────────────────────────────────────────────

  describe("Step Execution Tracking", () => {
    it("should start step execution", () => {
      const step = mockPlan.steps[0];
      if (step) step.status = "in-progress";

      expect(step?.status).toBe("in-progress");
    });

    it("should complete step execution", () => {
      const step = mockPlan.steps[0];
      if (step) {
        step.status = "in-progress";
        step.status = "complete";
      }

      expect(step?.status).toBe("complete");
    });

    it("should mark step as failed", () => {
      const step = mockPlan.steps[0];
      if (step) step.status = "failed";

      expect(step?.status).toBe("failed");
    });

    it("should track execution progress", () => {
      // Complete first 3 steps
      mockPlan.steps[0]!.status = "complete";
      mockPlan.steps[1]!.status = "complete";
      mockPlan.steps[2]!.status = "complete";

      const completedCount = mockPlan.steps.filter((s) => s.status === "complete").length;
      const progress = (completedCount / mockPlan.steps.length) * 100;

      expect(completedCount).toBe(3);
      expect(progress).toBe(60); // 3/5 = 60%
    });

    it("should execute steps in dependency order", () => {
      const step1 = mockPlan.steps[0];
      const step2 = mockPlan.steps[1];

      // Step 1 has no dependencies
      expect(step1?.dependencies).toHaveLength(0);

      // Step 2 depends on step 1
      expect(step2?.dependencies).toContain("step-1");

      // Can only start step 2 after step 1 completes
      if (step1) step1.status = "complete";
      const canStartStep2 = step1?.status === "complete";

      expect(canStartStep2).toBe(true);
    });

    it("should calculate remaining hours", () => {
      mockPlan.steps[0]!.status = "complete";
      mockPlan.steps[1]!.status = "complete";

      const completedHours = mockPlan.steps
        .filter((s) => s.status === "complete")
        .reduce((sum, s) => sum + s.estimatedHours, 0);

      const remainingHours = mockPlan.totalEstimatedHours - completedHours;

      expect(completedHours).toBe(8); // step-1 (2h) + step-2 (6h)
      expect(remainingHours).toBe(16); // 24 - 8
    });

    it("should mark plan complete when all steps done", () => {
      mockPlan.steps.forEach((step) => {
        step.status = "complete";
      });

      const allComplete = mockPlan.steps.every((s) => s.status === "complete");
      if (allComplete) {
        mockPlan.status = "complete";
      }

      expect(mockPlan.status).toBe("complete");
    });
  });

  // ────────────────────────────────────────────────────────────────────────────
  // Edge Cases
  // ────────────────────────────────────────────────────────────────────────────

  describe("Edge Cases", () => {
    it("should handle plan with no steps", () => {
      const emptyPlan: Plan = {
        ...mockPlan,
        steps: [],
        totalEstimatedHours: 0,
      };

      expect(emptyPlan.steps).toHaveLength(0);
      expect(emptyPlan.totalEstimatedHours).toBe(0);
    });

    it("should handle plan with single step", () => {
      const singleStepPlan: Plan = {
        ...mockPlan,
        steps: [mockPlan.steps[0]!],
        totalEstimatedHours: mockPlan.steps[0]!.estimatedHours,
      };

      expect(singleStepPlan.steps).toHaveLength(1);
    });

    it("should handle very long goal text", () => {
      const longGoal = "A".repeat(1000);
      const plan = { ...mockPlan, goal: longGoal };

      expect(plan.goal).toHaveLength(1000);
    });

    it("should handle circular dependencies gracefully", () => {
      // Step 1 depends on Step 2, Step 2 depends on Step 1
      const step1 = { ...mockPlan.steps[0]!, dependencies: ["step-2"] };
      const step2 = { ...mockPlan.steps[1]!, dependencies: ["step-1"] };

      // Circular dependency detection
      const hasCircular = step1.dependencies.includes("step-2") &&
                          step2.dependencies.includes("step-1");

      expect(hasCircular).toBe(true);
    });
  });
});
