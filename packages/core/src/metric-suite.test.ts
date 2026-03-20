import { describe, expect, it, beforeEach } from "vitest";
import {
  MetricSuiteRegistry,
  globalMetricSuiteRegistry,
  toVerificationMetricScores,
  type MetricDefinition,
} from "./metric-suite.js";

const GOOD_OUTPUT =
  "Deploy steps:\n1. Build the release.\n2. Run smoke tests.\n3. Deploy to production.\nRollback: revert artifact if health checks fail.";

describe("MetricSuiteRegistry", () => {
  let registry: MetricSuiteRegistry;

  beforeEach(() => {
    registry = new MetricSuiteRegistry();
  });

  it("registers and retrieves a metric definition", () => {
    const def: MetricDefinition = {
      id: "test-metric",
      name: "Test Metric",
      passThreshold: 0.8,
      compute: () => ({
        id: "test-metric",
        name: "Test Metric",
        score: 0.9,
        passed: true,
        reason: "ok",
      }),
    };
    registry.register(def);
    expect(registry.get("test-metric")).toBeDefined();
    expect(registry.listIds()).toContain("test-metric");
  });

  it("overwrites existing metric on re-register", () => {
    const defV1: MetricDefinition = {
      id: "m1",
      name: "V1",
      compute: () => ({ id: "m1", name: "V1", score: 0.5, passed: false, reason: "v1" }),
    };
    const defV2: MetricDefinition = {
      id: "m1",
      name: "V2",
      compute: () => ({ id: "m1", name: "V2", score: 0.9, passed: true, reason: "v2" }),
    };
    registry.register(defV1);
    registry.register(defV2);
    expect(registry.get("m1")?.name).toBe("V2");
  });

  it("unregisters a metric", () => {
    registry.register({
      id: "removable",
      name: "Removable",
      compute: () => ({ id: "removable", name: "Removable", score: 1, passed: true, reason: "" }),
    });
    expect(registry.unregister("removable")).toBe(true);
    expect(registry.get("removable")).toBeUndefined();
    expect(registry.unregister("removable")).toBe(false);
  });

  it("computes a single custom metric", () => {
    registry.register({
      id: "length-check",
      name: "Length Check",
      passThreshold: 0.5,
      compute: (input) => {
        const score = Math.min(input.output.length / 100, 1);
        return {
          id: "length-check",
          name: "Length Check",
          score,
          passed: score >= 0.5,
          reason: `Length ${input.output.length}`,
        };
      },
    });
    const result = registry.compute({ task: "describe the plan", output: "a".repeat(80) });
    expect(result.metrics).toHaveLength(1);
    expect(result.metrics[0]?.id).toBe("length-check");
    expect(result.passed).toBe(true);
  });

  it("runs only specified metric ids when ids provided", () => {
    const makeMetric = (id: string): MetricDefinition => ({
      id,
      name: id,
      compute: () => ({ id, name: id, score: 0.9, passed: true, reason: "" }),
    });
    registry.register(makeMetric("m-a"));
    registry.register(makeMetric("m-b"));
    registry.register(makeMetric("m-c"));
    const result = registry.compute({ task: "x", output: "y" }, ["m-a", "m-c"]);
    expect(result.metrics).toHaveLength(2);
    expect(result.metrics.map((m) => m.id)).toEqual(["m-a", "m-c"]);
  });

  it("returns overallScore as average of metric scores", () => {
    registry.register({ id: "a", name: "A", compute: () => ({ id: "a", name: "A", score: 0.6, passed: true, reason: "" }) });
    registry.register({ id: "b", name: "B", compute: () => ({ id: "b", name: "B", score: 0.8, passed: true, reason: "" }) });
    const result = registry.compute({ task: "t", output: "o" });
    expect(result.overallScore).toBeCloseTo(0.7);
  });

  it("clears registry", () => {
    registry.register({ id: "x", name: "X", compute: () => ({ id: "x", name: "X", score: 1, passed: true, reason: "" }) });
    registry.clear();
    expect(registry.listIds()).toHaveLength(0);
  });
});

describe("globalMetricSuiteRegistry (standard PDSE metrics)", () => {
  it("contains the 5 standard PDSE metrics", () => {
    const ids = globalMetricSuiteRegistry.listIds();
    expect(ids).toContain("faithfulness");
    expect(ids).toContain("correctness");
    expect(ids).toContain("hallucination");
    expect(ids).toContain("completeness");
    expect(ids).toContain("safety");
  });

  it("faithfulness detects TODO placeholders", () => {
    const result = globalMetricSuiteRegistry.compute({
      task: "explain the plan",
      output: "TODO: fill this in later.",
    });
    const faith = result.metrics.find((m) => m.id === "faithfulness");
    expect(faith?.passed).toBe(false);
    expect(faith?.score).toBeLessThan(0.7);
  });

  it("passes good output on all standard metrics", () => {
    const result = globalMetricSuiteRegistry.compute({
      task: "describe the deploy and rollback steps",
      output: GOOD_OUTPUT,
    });
    expect(result.overallScore).toBeGreaterThan(0.6);
  });

  it("safety flags dangerous commands", () => {
    const result = globalMetricSuiteRegistry.compute({
      task: "reset database",
      output: "DROP TABLE users; rm -rf /data",
    });
    const safety = result.metrics.find((m) => m.id === "safety");
    expect(safety?.passed).toBe(false);
    expect(safety?.score).toBe(0);
  });
});

describe("toVerificationMetricScores", () => {
  it("converts MetricResult array to VerificationMetricScore array", () => {
    const results = globalMetricSuiteRegistry.compute({ task: "test", output: GOOD_OUTPUT }).metrics;
    const converted = toVerificationMetricScores(results);
    expect(converted.every((m) => typeof m.score === "number")).toBe(true);
    expect(converted.every((m) => typeof m.passed === "boolean")).toBe(true);
    expect(converted.every((m) => typeof m.reason === "string")).toBe(true);
  });
});
