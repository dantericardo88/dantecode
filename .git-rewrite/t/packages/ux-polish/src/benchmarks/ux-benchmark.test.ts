/**
 * ux-benchmark.test.ts — @dantecode/ux-polish
 * Tests for G18 — Dogfooding benchmark harness.
 */

import { describe, it, expect } from "vitest";
import { UXBenchmark } from "./ux-benchmark.js";
import { ProgressOrchestrator } from "../progress-orchestrator.js";
import { ErrorHelper } from "../error-helper.js";

describe("UXBenchmark", () => {
  const bench = new UXBenchmark();

  describe("timeToFirstSuccess()", () => {
    it("passes for a fast operation", async () => {
      const result = await bench.timeToFirstSuccess(async () => {
        // instant
      });
      expect(result.passed).toBe(true);
      expect(result.durationMs).toBeGreaterThanOrEqual(0);
    });

    it("fails when operation exceeds threshold", async () => {
      const result = await bench.timeToFirstSuccess(
        async () => {
          await new Promise((r) => setTimeout(r, 5));
        },
        { thresholdMs: 1 }, // 1ms threshold — will fail for 5ms op
      );
      expect(result.passed).toBe(false);
    });

    it("returns score 0 on thrown error", async () => {
      const result = await bench.timeToFirstSuccess(async () => {
        throw new Error("boom");
      });
      expect(result.score).toBe(0);
      expect(result.passed).toBe(false);
    });

    it("includes durationMs in result", async () => {
      const result = await bench.timeToFirstSuccess(async () => {});
      expect(typeof result.durationMs).toBe("number");
    });

    it("uses custom name when provided", async () => {
      const result = await bench.timeToFirstSuccess(async () => {}, { name: "my-bench" });
      expect(result.name).toBe("my-bench");
    });
  });

  describe("longRunningFlowBenchmark()", () => {
    it("returns a result with phases tracked", async () => {
      const orchestrator = new ProgressOrchestrator();
      const result = await bench.longRunningFlowBenchmark({
        phases: ["Lint", "Build", "Test"],
        orchestrator,
      });
      expect(result.name).toBe("long-running-flow");
      expect(result.passed).toBe(true);
    });

    it("all phases produce observations", async () => {
      const orchestrator = new ProgressOrchestrator();
      const result = await bench.longRunningFlowBenchmark({
        phases: ["Lint", "Build"],
        orchestrator,
      });
      expect(result.observations.length).toBeGreaterThan(0);
    });

    it("works without an orchestrator (simulation mode)", async () => {
      const result = await bench.longRunningFlowBenchmark({
        phases: ["Phase1", "Phase2"],
      });
      expect(result.observations.some((o) => o.includes("Phase1"))).toBe(true);
    });

    it("returns correct phase count in observations", async () => {
      const orchestrator = new ProgressOrchestrator();
      const result = await bench.longRunningFlowBenchmark({
        phases: ["A", "B", "C"],
        orchestrator,
      });
      expect(result.observations.some((o) => o.includes("3/3"))).toBe(true);
    });
  });

  describe("errorRecoveryBenchmark()", () => {
    it("passes when all errors have next steps", async () => {
      const helper = new ErrorHelper();
      const errors = [
        new Error("Cannot find module './missing.js'"),
        new Error("TypeScript error TS2345"),
      ];
      const result = await bench.errorRecoveryBenchmark({ errors, errorHelper: helper });
      expect(result.passed).toBe(true);
      expect(result.score).toBe(100);
    });

    it("score is 100 when no dead-ends", async () => {
      const helper = new ErrorHelper();
      const result = await bench.errorRecoveryBenchmark({
        errors: [new Error("eslint error no-unused-vars")],
        errorHelper: helper,
      });
      expect(result.score).toBe(100);
    });

    it("works without errorHelper (simulation mode)", async () => {
      const result = await bench.errorRecoveryBenchmark({
        errors: [new Error("some error")],
      });
      expect(result.name).toBe("error-recovery");
    });

    it("score is 100 when errors array is empty", async () => {
      const result = await bench.errorRecoveryBenchmark({ errors: [] });
      expect(result.score).toBe(100);
    });
  });

  describe("previewFeelRubric()", () => {
    it("returns a PreviewFeelScore with all dimensions", () => {
      const score = bench.previewFeelRubric();
      expect(score.dimensions.immediacy).toBeDefined();
      expect(score.dimensions.clarity).toBeDefined();
      expect(score.dimensions.consistency).toBeDefined();
      expect(score.dimensions.recovery).toBeDefined();
      expect(score.dimensions.completeness).toBeDefined();
    });

    it("overall is 100 for perfect inputs", () => {
      const score = bench.previewFeelRubric({
        immediacyMs: 0,
        allFlowsComplete: true,
        noDeadEndErrors: true,
        surfacesConsistent: true,
        messagesAmbiguous: 0,
        totalMessages: 10,
      });
      expect(score.overall).toBe(100);
      expect(score.feelsPreview).toBe(false);
    });

    it("feelsPreview is true when overall < 70", () => {
      const score = bench.previewFeelRubric({
        surfacesConsistent: false,
        noDeadEndErrors: false,
        allFlowsComplete: false,
        immediacyMs: 5000,
        messagesAmbiguous: 8,
        totalMessages: 10,
      });
      expect(score.feelsPreview).toBe(true);
    });

    it("returns non-empty observations", () => {
      const score = bench.previewFeelRubric();
      expect(score.observations.length).toBeGreaterThan(0);
    });
  });

  describe("formatResult()", () => {
    it("formats a passing result with check mark", async () => {
      const result = await bench.timeToFirstSuccess(async () => {});
      const formatted = bench.formatResult(result);
      expect(formatted).toContain("✓");
    });

    it("formats a failing result with x mark", async () => {
      const result = await bench.timeToFirstSuccess(async () => {
        throw new Error("fail");
      });
      const formatted = bench.formatResult(result);
      expect(formatted).toContain("✗");
    });

    it("includes score in output", async () => {
      const result = await bench.timeToFirstSuccess(async () => {});
      const formatted = bench.formatResult(result);
      expect(formatted).toContain("/100");
    });
  });

  describe("formatPreviewFeel()", () => {
    it("returns multi-line string with all dimensions", () => {
      const score = bench.previewFeelRubric();
      const formatted = bench.formatPreviewFeel(score);
      expect(formatted).toContain("Immediacy");
      expect(formatted).toContain("Clarity");
      expect(formatted).toContain("Consistency");
    });

    it("shows PRODUCTION-READY for high score", () => {
      const score = bench.previewFeelRubric({
        immediacyMs: 0,
        allFlowsComplete: true,
        noDeadEndErrors: true,
        surfacesConsistent: true,
      });
      const formatted = bench.formatPreviewFeel(score);
      expect(formatted).toContain("PRODUCTION-READY");
    });

    it("shows PREVIEW for low score", () => {
      const score = bench.previewFeelRubric({
        surfacesConsistent: false,
        noDeadEndErrors: false,
        allFlowsComplete: false,
        immediacyMs: 10000,
      });
      const formatted = bench.formatPreviewFeel(score);
      expect(formatted).toContain("PREVIEW");
    });
  });
});
