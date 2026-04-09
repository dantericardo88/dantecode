/**
 * e2e-task-completion.test.ts
 *
 * Unit tests for CompletionGate and ConvergenceMetrics.
 *
 * These tests verify that:
 *  - CompletionGate correctly gates genuine vs. premature/stub completions
 *  - ConvergenceMetrics tracks session iteration counters and formats summaries
 *
 * No real LLM or agent-loop is required.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { CompletionGate, ConvergenceMetrics } from "@dantecode/core";

// ─────────────────────────────────────────────────────────────────────────────
// CompletionGate tests
// ─────────────────────────────────────────────────────────────────────────────

describe("CompletionGate", () => {
  let gate: CompletionGate;

  beforeEach(() => {
    gate = new CompletionGate();
  });

  it("passes genuine completion response", () => {
    // A response that:
    //  - has soft signals ("successfully", "all tests pass", "implemented")
    //  - has no tool call syntax (adds hard signal)
    //  - toolsCalledCount >= 1
    const response = [
      "I have successfully implemented the CompletionGate class.",
      "All tests pass with no errors.",
      "The feature is complete and verified — here is the output:",
      "npm test output: 42 tests, 42 passed, 0 failed.",
    ].join("\n");

    const verdict = gate.evaluate(response, 3);

    expect(verdict.shouldExit).toBe(true);
    expect(verdict.confidence).toBeGreaterThanOrEqual(0.6);
  });

  it("rejects premature 'Done.' response", () => {
    // Very short response, no tools called — classic premature exit
    const response = "Done.";

    const verdict = gate.evaluate(response, 0);

    expect(verdict.shouldExit).toBe(false);
    expect(verdict.confidence).toBeLessThan(0.8);
    expect(verdict.reason).toBeTruthy();
  });

  it("rejects stub responses with TODO", () => {
    const response = [
      "I've implemented the feature.",
      "TODO: add actual implementation here",
      "This is a placeholder for now.",
    ].join("\n");

    const verdict = gate.evaluate(response, 2);

    expect(verdict.shouldExit).toBe(false);
    expect(verdict.reason).toContain("stub detected");
  });

  it("rejects stub responses with 'not implemented'", () => {
    const response = "The method is not implemented yet. Please add the logic here.";

    const verdict = gate.evaluate(response, 1);

    expect(verdict.shouldExit).toBe(false);
    expect(verdict.reason).toContain("stub detected");
  });

  it("rejects when confidence below threshold and no tools called", () => {
    // Response has some signals but toolsCalledCount < 2
    const response = "Task done.";

    const verdict = gate.evaluate(response, 1);

    // Either too short or premature
    expect(verdict.shouldExit).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// ConvergenceMetrics tests
// ─────────────────────────────────────────────────────────────────────────────

describe("ConvergenceMetrics", () => {
  it("tracks iterations and repairs correctly", () => {
    const metrics = new ConvergenceMetrics();

    metrics.increment("iterations");
    metrics.increment("iterations");
    metrics.increment("iterations");
    metrics.increment("repairTriggers");
    metrics.increment("loopDetectorHits");
    metrics.increment("completionGateRejections");
    metrics.increment("completionGateRejections");

    const snapshot = metrics.snapshot();

    expect(snapshot.iterations).toBe(3);
    expect(snapshot.repairTriggers).toBe(1);
    expect(snapshot.loopDetectorHits).toBe(1);
    expect(snapshot.completionGateRejections).toBe(2);
    expect(snapshot.verificationPassed).toBeNull();
    expect(snapshot.elapsedMs).toBeGreaterThanOrEqual(0);
  });

  it("formatSummary includes all fields", () => {
    const metrics = new ConvergenceMetrics();

    metrics.increment("iterations");
    metrics.increment("iterations");
    metrics.increment("iterations");
    metrics.increment("iterations");
    metrics.increment("repairTriggers");
    metrics.increment("completionGateRejections");
    metrics.increment("completionGateRejections");
    metrics.setVerificationPassed(true);

    const summary = metrics.formatSummary();

    expect(summary).toContain("4 rounds");
    expect(summary).toContain("1 repair");
    expect(summary).toContain("gate rejected 2×");
    expect(summary).toContain("✓ verified");
  });

  it("reset clears all counters", () => {
    const metrics = new ConvergenceMetrics();

    metrics.increment("iterations");
    metrics.increment("repairTriggers");
    metrics.setVerificationPassed(false);

    metrics.reset();
    const snapshot = metrics.snapshot();

    expect(snapshot.iterations).toBe(0);
    expect(snapshot.repairTriggers).toBe(0);
    expect(snapshot.verificationPassed).toBeNull();
  });

  it("verificationPassed reflects setVerificationPassed", () => {
    const metrics = new ConvergenceMetrics();

    expect(metrics.snapshot().verificationPassed).toBeNull();

    metrics.setVerificationPassed(true);
    expect(metrics.snapshot().verificationPassed).toBe(true);

    metrics.setVerificationPassed(false);
    expect(metrics.snapshot().verificationPassed).toBe(false);
  });

  it("formatSummary shows verify failed when verification failed", () => {
    const metrics = new ConvergenceMetrics();
    metrics.increment("iterations");
    metrics.setVerificationPassed(false);

    const summary = metrics.formatSummary();

    expect(summary).toContain("✗ verify failed");
  });
});
