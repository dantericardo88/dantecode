// ============================================================================
// @dantecode/core — Task Complexity Router Tests
// ============================================================================

import { describe, it, expect, beforeEach } from "vitest";
import {
  TaskComplexityRouter,
  type TaskSignals,
  type ModelOption,
} from "./task-complexity-router.js";

// ────────────────────────────────────────────────────────────────────────────
// Fixtures
// ────────────────────────────────────────────────────────────────────────────

const SIMPLE_SIGNALS: TaskSignals = {
  tokenCount: 50,
  fileCount: 1,
  reasoningDepth: 5,
  securitySensitivity: 0,
  hasCodeGeneration: false,
  hasMultiFileEdit: false,
};

const STANDARD_SIGNALS: TaskSignals = {
  tokenCount: 500,
  fileCount: 3,
  reasoningDepth: 40,
  securitySensitivity: 20,
  hasCodeGeneration: true,
  hasMultiFileEdit: false,
};

const COMPLEX_SIGNALS: TaskSignals = {
  tokenCount: 5000,
  fileCount: 12,
  reasoningDepth: 80,
  securitySensitivity: 60,
  hasCodeGeneration: true,
  hasMultiFileEdit: true,
};

const MODELS: ModelOption[] = [
  { modelId: "grok-3-mini", provider: "grok", tier: "simple", costPerToken: 0.3 },
  { modelId: "grok-3", provider: "grok", tier: "standard", costPerToken: 3.0 },
  { modelId: "claude-opus-4", provider: "anthropic", tier: "complex", costPerToken: 15.0 },
  { modelId: "gpt-4o", provider: "openai", tier: "standard", costPerToken: 2.5 },
];

// ────────────────────────────────────────────────────────────────────────────
// Tests
// ────────────────────────────────────────────────────────────────────────────

describe("TaskComplexityRouter", () => {
  let router: TaskComplexityRouter;

  beforeEach(() => {
    router = new TaskComplexityRouter();
  });

  describe("classify", () => {
    it("classifies low-signal tasks as simple", () => {
      const tier = router.classify(SIMPLE_SIGNALS);
      expect(tier).toBe("simple");
    });

    it("classifies mid-signal tasks as standard", () => {
      const tier = router.classify(STANDARD_SIGNALS);
      expect(tier).toBe("standard");
    });

    it("classifies high-signal tasks as complex", () => {
      const tier = router.classify(COMPLEX_SIGNALS);
      expect(tier).toBe("complex");
    });
  });

  describe("route", () => {
    it("picks cheapest model in the matching tier", () => {
      const model = router.route("standard", MODELS);
      // gpt-4o (2.5) is cheaper than grok-3 (3.0) in standard tier
      expect(model.modelId).toBe("gpt-4o");
    });

    it("escalates to next tier when no exact match exists", () => {
      const modelsWithoutSimple = MODELS.filter((m) => m.tier !== "simple");
      const model = router.route("simple", modelsWithoutSimple);
      // Should escalate to "standard" and pick cheapest there
      expect(model.tier).toBe("standard");
    });

    it("throws when no models are available", () => {
      expect(() => router.route("simple", [])).toThrow("No models available");
    });
  });

  describe("computeComplexity", () => {
    it("returns a value between 0 and 100", () => {
      const score = router.computeComplexity(COMPLEX_SIGNALS);
      expect(score).toBeGreaterThanOrEqual(0);
      expect(score).toBeLessThanOrEqual(100);
    });

    it("returns higher score for more complex signals", () => {
      const simpleScore = router.computeComplexity(SIMPLE_SIGNALS);
      const complexScore = router.computeComplexity(COMPLEX_SIGNALS);
      expect(complexScore).toBeGreaterThan(simpleScore);
    });
  });

  describe("routeTask", () => {
    it("classifies, routes, and logs decision in one call", () => {
      const { model, decision } = router.routeTask("task-1", SIMPLE_SIGNALS, MODELS);
      expect(model.modelId).toBe("grok-3-mini");
      expect(decision.tier).toBe("simple");
      expect(decision.taskId).toBe("task-1");
      expect(router.getDecisions()).toHaveLength(1);
    });
  });

  describe("logRoutingDecision", () => {
    it("records and retrieves decisions", () => {
      router.logRoutingDecision({
        taskId: "t1",
        complexity: 10,
        tier: "simple",
        selectedModel: "grok-3-mini",
        reason: "test",
      });
      router.logRoutingDecision({
        taskId: "t2",
        complexity: 50,
        tier: "complex",
        selectedModel: "claude-opus-4",
        reason: "test",
      });
      expect(router.getDecisions()).toHaveLength(2);
      expect(router.getDecisions()[0]!.taskId).toBe("t1");
      expect(router.getDecisions()[1]!.taskId).toBe("t2");
    });
  });
});
