// ============================================================================
// E2E: Full Pipeline — init config -> run task -> verify output -> check audit
// ============================================================================

import { describe, it, expect, beforeEach } from "vitest";
import { TaskComplexityRouter } from "../../task-complexity-router.js";
import { VerificationTrendTracker } from "../../verification-trend-tracker.js";
import type { ModelOption, TaskSignals } from "../../task-complexity-router.js";

describe("E2E: Full Pipeline", () => {
  let router: TaskComplexityRouter;
  let tracker: VerificationTrendTracker;

  beforeEach(() => {
    router = new TaskComplexityRouter();
    tracker = new VerificationTrendTracker();
  });

  it("routes a task, records verification, and checks health", () => {
    // Step 1: Configure models
    const models: ModelOption[] = [
      { modelId: "grok-3-mini", provider: "grok", tier: "simple", costPerToken: 0.3 },
      { modelId: "grok-3", provider: "grok", tier: "standard", costPerToken: 3.0 },
      { modelId: "claude-opus-4", provider: "anthropic", tier: "complex", costPerToken: 15.0 },
    ];

    // Step 2: Route task
    const signals: TaskSignals = {
      tokenCount: 200,
      fileCount: 2,
      reasoningDepth: 30,
      securitySensitivity: 10,
      hasCodeGeneration: true,
      hasMultiFileEdit: false,
    };

    const { model, decision } = router.routeTask("pipeline-test-1", signals, models);
    expect(model).toBeDefined();
    expect(decision.tier).toBeDefined();

    // Step 3: Record verification score
    tracker.record("correctness", 85);
    tracker.record("completeness", 90);

    // Step 4: Check health
    const health = tracker.generateHealthReport();
    expect(health.overallHealth).toBe("healthy");
    expect(health.categories.length).toBe(2);
  });

  it("detects regression in pipeline output quality", () => {
    const now = Date.now();
    const DAY = 86_400_000;

    // Record declining scores
    tracker.record("correctness", 95, now - 6 * DAY);
    tracker.record("correctness", 92, now - 4 * DAY);
    tracker.record("correctness", 88, now - 2 * DAY);
    tracker.record("correctness", 75, now); // regression

    const regressed = tracker.detectRegression("correctness", 5);
    expect(regressed).toBe(true);

    const health = tracker.generateHealthReport();
    expect(health.regressions).toContain("correctness");
  });

  it("routes and logs multiple tasks with different complexity", () => {
    const models: ModelOption[] = [
      { modelId: "mini", provider: "grok", tier: "simple", costPerToken: 0.3 },
      { modelId: "standard", provider: "grok", tier: "standard", costPerToken: 3.0 },
      { modelId: "opus", provider: "anthropic", tier: "complex", costPerToken: 15.0 },
    ];

    // Simple task
    const simple = router.routeTask("t1", {
      tokenCount: 10, fileCount: 1, reasoningDepth: 0,
      securitySensitivity: 0, hasCodeGeneration: false, hasMultiFileEdit: false,
    }, models);
    expect(simple.decision.tier).toBe("simple");

    // Complex task
    const complex = router.routeTask("t2", {
      tokenCount: 5000, fileCount: 20, reasoningDepth: 90,
      securitySensitivity: 80, hasCodeGeneration: true, hasMultiFileEdit: true,
    }, models);
    expect(complex.decision.tier).toBe("complex");

    expect(router.getDecisions()).toHaveLength(2);
  });

  it("end-to-end: route -> verify -> health report flow", () => {
    const models: ModelOption[] = [
      { modelId: "mid", provider: "grok", tier: "standard", costPerToken: 3.0 },
    ];

    // Route
    const { decision } = router.routeTask("e2e-1", {
      tokenCount: 300, fileCount: 3, reasoningDepth: 40,
      securitySensitivity: 20, hasCodeGeneration: true, hasMultiFileEdit: false,
    }, models);

    // Verify (simulate passing scores)
    tracker.record("correctness", 92);
    tracker.record("completeness", 88);
    tracker.record("clarity", 95);

    // Health check
    const health = tracker.generateHealthReport();
    expect(health.overallHealth).toBe("healthy");
    expect(health.regressions).toHaveLength(0);
    expect(decision.selectedModel).toBe("mid");
  });
});
