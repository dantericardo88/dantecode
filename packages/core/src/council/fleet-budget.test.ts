// ============================================================================
// fleet-budget.test.ts — Unit tests for FleetBudget
// ============================================================================

import { describe, it, expect, beforeEach } from "vitest";
import { FleetBudget } from "./fleet-budget.js";

describe("FleetBudget", () => {
  let budget: FleetBudget;

  beforeEach(() => {
    budget = new FleetBudget({
      maxTotalTokens: 10_000,
      maxTokensPerAgent: 5_000,
      maxTotalCostUsd: 1.0,
      warningThreshold: 0.8,
    });
  });

  it("record usage — total increases", () => {
    budget.record("agent-a", 1_000, 0.1);
    budget.record("agent-b", 2_000, 0.2);
    const report = budget.report();
    expect(report.totalTokens).toBe(3_000);
    expect(report.totalCost).toBeCloseTo(0.3);
  });

  it("record cumulative — delta computed correctly on second call", () => {
    budget.record("agent-a", 1_000, 0.1);
    budget.record("agent-a", 2_000, 0.2); // cumulative, not additive
    const report = budget.report();
    expect(report.totalTokens).toBe(2_000);
  });

  it("per-agent limit reached — canContinue returns false", () => {
    budget.record("agent-a", 5_000, 0.5); // at limit
    expect(budget.canContinue("agent-a")).toBe(false);
  });

  it("per-agent limit not reached — canContinue returns true", () => {
    budget.record("agent-a", 2_000, 0.2);
    expect(budget.canContinue("agent-a")).toBe(true);
  });

  it("fleet-wide token limit reached — isExhausted returns true", () => {
    budget.record("agent-a", 5_000, 0.5);
    budget.record("agent-b", 5_000, 0.5); // fleet total = 10_000
    expect(budget.isExhausted()).toBe(true);
  });

  it("fleet-wide cost limit reached — isExhausted returns true", () => {
    budget.record("agent-a", 1_000, 1.0); // cost at limit
    expect(budget.isExhausted()).toBe(true);
  });

  it("warning threshold at 80% — isWarning true", () => {
    budget.record("agent-a", 8_000, 0.0); // 80% of 10_000
    expect(budget.isWarning()).toBe(true);
    expect(budget.isExhausted()).toBe(false);
  });

  it("below warning threshold — isWarning false", () => {
    budget.record("agent-a", 5_000, 0.0); // 50% — below warning
    expect(budget.isWarning()).toBe(false);
  });

  it("unlimited budget (0) — never exhausts", () => {
    const unlimited = new FleetBudget({
      maxTotalTokens: 0,
      maxTokensPerAgent: 0,
      maxTotalCostUsd: 0,
      warningThreshold: 0.8,
    });
    unlimited.record("agent-a", 1_000_000, 999.99);
    expect(unlimited.isExhausted()).toBe(false);
    expect(unlimited.isWarning()).toBe(false);
    expect(unlimited.canContinue("agent-a")).toBe(true);
  });

  it("report shows per-agent breakdown with percentages", () => {
    budget.record("agent-a", 3_000, 0.3);
    budget.record("agent-b", 7_000, 0.7);
    const report = budget.report();
    expect(report.totalTokens).toBe(10_000);
    const a = report.perAgent.find((e) => e.agentId === "agent-a")!;
    const b = report.perAgent.find((e) => e.agentId === "agent-b")!;
    expect(a.pctOfTotal).toBe(30);
    expect(b.pctOfTotal).toBe(70);
  });

  it("remainingForAgent returns correct values", () => {
    budget.record("agent-a", 2_000, 0.2);
    const rem = budget.remainingForAgent("agent-a");
    expect(rem.tokens).toBe(3_000); // 5000 - 2000
  });

  it("remainingForAgent for unknown agent returns full limit", () => {
    const rem = budget.remainingForAgent("unknown");
    expect(rem.tokens).toBe(5_000);
  });

  it("multiple agents tracked independently", () => {
    budget.record("agent-a", 1_000, 0.1);
    budget.record("agent-b", 2_000, 0.2);
    budget.record("agent-c", 3_000, 0.3);
    const report = budget.report();
    expect(report.perAgent.length).toBe(3);
    expect(report.totalTokens).toBe(6_000);
  });

  it("record returns false when per-agent limit exceeded", () => {
    const result = budget.record("agent-a", 5_001, 0.5);
    expect(result).toBe(false);
  });

  it("record returns true when within limits", () => {
    const result = budget.record("agent-a", 1_000, 0.1);
    expect(result).toBe(true);
  });

  it("report budgetRemaining is -1 for unlimited budgets", () => {
    const unlimited = new FleetBudget({ maxTotalTokens: 0 });
    unlimited.record("agent-a", 5_000, 0.5);
    expect(unlimited.report().budgetRemaining).toBe(-1);
  });

  it("reset clears all state", () => {
    budget.record("agent-a", 5_000, 0.5);
    budget.reset();
    expect(budget.report().totalTokens).toBe(0);
    expect(budget.isExhausted()).toBe(false);
    expect(budget.isWarning()).toBe(false);
  });

  // ── Edge cases ────────────────────────────────────────────────────────────

  it("decreasing cumulative values — delta clamped to 0, aggregate never decreases", () => {
    budget.record("agent-a", 2_000, 0.2);
    budget.record("agent-a", 1_500, 0.1); // backward — should be a no-op delta
    const report = budget.report();
    // Aggregate should NOT decrease
    expect(report.totalTokens).toBe(2_000);
    expect(report.totalCost).toBeCloseTo(0.2);
    expect(budget.isExhausted()).toBe(false);
  });

  it("warning fires even when the same call simultaneously crosses exhaustion", () => {
    // Go from 0 straight to 10_000 (100%) in one call — should fire warning AND exhaustion
    budget.record("agent-a", 10_000, 0.0);
    expect(budget.isWarning()).toBe(true);
    expect(budget.isExhausted()).toBe(true);
  });

  it("per-agent limit returns false; other agent can still continue", () => {
    budget.record("agent-a", 5_001, 0.1); // exceeds per-agent 5_000 limit
    budget.record("agent-b", 1_000, 0.1);
    // Fleet is not exhausted (only 6_001 tokens total, limit 10_000)
    expect(budget.isExhausted()).toBe(false);
    expect(budget.canContinue("agent-b")).toBe(true);
    expect(budget.canContinue("agent-a")).toBe(false);
  });

  it("record returns false for per-agent limit but fleet not exhausted", () => {
    // First call hits per-agent limit
    const result = budget.record("agent-a", 5_001, 0.1);
    expect(result).toBe(false);
    // Fleet still has headroom
    expect(budget.isExhausted()).toBe(false);
    // A different agent can still record successfully
    expect(budget.record("agent-b", 1_000, 0.1)).toBe(true);
  });
});
