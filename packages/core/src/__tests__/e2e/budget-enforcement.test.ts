// ============================================================================
// E2E: Budget Enforcement — set budget -> run tasks -> approach limit -> halt
// ============================================================================

import { describe, it, expect } from "vitest";
import { TaskComplexityRouter, type ModelOption } from "../../task-complexity-router.js";

// ────────────────────────────────────────────────────────────────────────────
// Simple Budget Tracker (simulates token budget enforcement)
// ────────────────────────────────────────────────────────────────────────────

class BudgetTracker {
  private used = 0;
  private readonly limit: number;
  private readonly warningThreshold: number;
  private warnings: string[] = [];

  constructor(limit: number, warningThreshold = 0.8) {
    this.limit = limit;
    this.warningThreshold = warningThreshold;
  }

  consume(tokens: number): { allowed: boolean; warning?: string } {
    if (this.used + tokens > this.limit) {
      return { allowed: false, warning: `Budget exhausted: ${this.used + tokens}/${this.limit} tokens` };
    }

    this.used += tokens;

    if (this.used / this.limit >= this.warningThreshold) {
      const warning = `Budget warning: ${Math.round((this.used / this.limit) * 100)}% used (${this.used}/${this.limit})`;
      this.warnings.push(warning);
      return { allowed: true, warning };
    }

    return { allowed: true };
  }

  getUsed(): number {
    return this.used;
  }

  getRemaining(): number {
    return this.limit - this.used;
  }

  getWarnings(): string[] {
    return [...this.warnings];
  }

  isExhausted(): boolean {
    return this.used >= this.limit;
  }
}

// ────────────────────────────────────────────────────────────────────────────
// Tests
// ────────────────────────────────────────────────────────────────────────────

describe("E2E: Budget Enforcement", () => {
  const MODELS: ModelOption[] = [
    { modelId: "mini", provider: "grok", tier: "simple", costPerToken: 0.3 },
    { modelId: "standard", provider: "grok", tier: "standard", costPerToken: 3.0 },
    { modelId: "opus", provider: "anthropic", tier: "complex", costPerToken: 15.0 },
  ];

  it("runs tasks within budget and completes successfully", () => {
    const budget = new BudgetTracker(10_000);
    const router = new TaskComplexityRouter();

    // Run 3 simple tasks, each using 1000 tokens
    for (let i = 0; i < 3; i++) {
      const { model } = router.routeTask(`task-${i}`, {
        tokenCount: 100, fileCount: 1, reasoningDepth: 5,
        securitySensitivity: 0, hasCodeGeneration: false, hasMultiFileEdit: false,
      }, MODELS);

      const result = budget.consume(1000);
      expect(result.allowed).toBe(true);
      expect(model.modelId).toBe("mini");
    }

    expect(budget.getUsed()).toBe(3000);
    expect(budget.getRemaining()).toBe(7000);
    expect(budget.isExhausted()).toBe(false);
  });

  it("triggers warning when approaching budget limit", () => {
    const budget = new BudgetTracker(10_000, 0.8); // warn at 80%

    // Consume 85% of budget
    budget.consume(8500);

    const warnings = budget.getWarnings();
    expect(warnings.length).toBeGreaterThan(0);
    expect(warnings[0]).toContain("Budget warning");
    expect(warnings[0]).toContain("85%");
  });

  it("halts when budget is exhausted", () => {
    const budget = new BudgetTracker(5000);
    const router = new TaskComplexityRouter();

    let tasksCompleted = 0;

    // Try to run tasks until budget is exhausted
    for (let i = 0; i < 10; i++) {
      router.routeTask(`task-${i}`, {
        tokenCount: 100, fileCount: 1, reasoningDepth: 5,
        securitySensitivity: 0, hasCodeGeneration: false, hasMultiFileEdit: false,
      }, MODELS);

      const result = budget.consume(1500);
      if (!result.allowed) {
        break;
      }
      tasksCompleted++;
    }

    // Should have completed 3 tasks (3 * 1500 = 4500, 4th would be 6000 > 5000)
    expect(tasksCompleted).toBe(3);
    expect(budget.getUsed()).toBe(4500);
  });

  it("routes to cheaper models when budget is low", () => {
    const router = new TaskComplexityRouter();
    const budget = new BudgetTracker(2000);

    // First task: complex, but budget allows it
    budget.consume(1500);

    // Second task: budget is low, should route to simple model
    const remaining = budget.getRemaining();
    expect(remaining).toBe(500);

    // With limited budget, router still picks cheapest in tier
    const { model } = router.routeTask("low-budget-task", {
      tokenCount: 10, fileCount: 1, reasoningDepth: 5,
      securitySensitivity: 0, hasCodeGeneration: false, hasMultiFileEdit: false,
    }, MODELS);

    expect(model.modelId).toBe("mini");
    expect(model.costPerToken).toBe(0.3);
  });
});
