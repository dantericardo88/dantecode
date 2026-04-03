// ============================================================================
// @dantecode/core — Council Resilience Tests
// ============================================================================

import { describe, it, expect, beforeEach } from "vitest";
import { CouncilResilience } from "./council-resilience.js";

describe("CouncilResilience", () => {
  let resilience: CouncilResilience;

  beforeEach(() => {
    resilience = new CouncilResilience();
  });

  // ──────────────────────────────────────────────────────────────────────────
  // Stale agent detection
  // ──────────────────────────────────────────────────────────────────────────

  describe("detectStaleAgent", () => {
    it("returns true when agent exceeds timeout", () => {
      const fiveMinutesAgo = Date.now() - 5 * 60_000;
      const result = resilience.detectStaleAgent("agent-1", fiveMinutesAgo, 60_000);
      expect(result).toBe(true);
    });

    it("returns false when agent is within timeout", () => {
      const justNow = Date.now() - 500;
      const result = resilience.detectStaleAgent("agent-1", justNow, 60_000);
      expect(result).toBe(false);
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // Council timeout
  // ──────────────────────────────────────────────────────────────────────────

  describe("monitorCouncilTimeout", () => {
    it("returns true when council exceeds max duration", () => {
      const thirtyMinutesAgo = Date.now() - 30 * 60_000;
      const result = resilience.monitorCouncilTimeout(thirtyMinutesAgo, 15 * 60_000);
      expect(result).toBe(true);
    });

    it("returns false when council is within duration", () => {
      const fiveMinutesAgo = Date.now() - 5 * 60_000;
      const result = resilience.monitorCouncilTimeout(fiveMinutesAgo, 15 * 60_000);
      expect(result).toBe(false);
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // Redistribution after failure
  // ──────────────────────────────────────────────────────────────────────────

  describe("handleAgentFailure", () => {
    it("redistributes tasks round-robin to available agents", () => {
      const plan = resilience.handleAgentFailure(
        "failed-agent",
        ["task-1", "task-2", "task-3"],
        ["agent-a", "agent-b"],
      );

      expect(plan.reassignments).toHaveLength(3);
      expect(plan.unassignable).toHaveLength(0);
      expect(plan.reassignments[0]).toEqual({
        taskId: "task-1",
        fromAgent: "failed-agent",
        toAgent: "agent-a",
      });
      expect(plan.reassignments[1]).toEqual({
        taskId: "task-2",
        fromAgent: "failed-agent",
        toAgent: "agent-b",
      });
      expect(plan.reassignments[2]).toEqual({
        taskId: "task-3",
        fromAgent: "failed-agent",
        toAgent: "agent-a",
      });
    });

    it("marks all tasks unassignable when no agents available", () => {
      const plan = resilience.handleAgentFailure("failed-agent", ["task-1", "task-2"], []);

      expect(plan.reassignments).toHaveLength(0);
      expect(plan.unassignable).toEqual(["task-1", "task-2"]);
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // Partial completion recovery
  // ──────────────────────────────────────────────────────────────────────────

  describe("recoverPartialCompletion", () => {
    it("reports correct completion percentage", () => {
      const report = resilience.recoverPartialCompletion(
        ["task-1", "task-2"],
        ["task-1", "task-2", "task-3", "task-4"],
      );

      expect(report.completed).toEqual(["task-1", "task-2"]);
      expect(report.pending).toEqual(["task-3", "task-4"]);
      expect(report.completionPercentage).toBe(50);
      expect(report.canContinue).toBe(true);
    });

    it("marks as not continuable when completion is below 25%", () => {
      const report = resilience.recoverPartialCompletion(
        ["task-1"],
        ["task-1", "task-2", "task-3", "task-4", "task-5"],
      );

      expect(report.completionPercentage).toBe(20);
      expect(report.canContinue).toBe(false);
    });

    it("handles empty task list gracefully", () => {
      const report = resilience.recoverPartialCompletion([], []);
      expect(report.completionPercentage).toBe(100);
      expect(report.canContinue).toBe(true);
    });
  });
});
