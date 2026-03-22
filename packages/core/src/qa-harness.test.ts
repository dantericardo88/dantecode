import { beforeEach, describe, expect, it } from "vitest";
import { generateQaTestCases, runQaSuite, verifyOutput } from "./qa-harness.js";
import { globalVerificationRailRegistry } from "./rails-enforcer.js";

describe("verifyOutput", () => {
  beforeEach(() => {
    globalVerificationRailRegistry.clear();
  });

  it("passes structured outputs that satisfy required keywords and rails", () => {
    const report = verifyOutput({
      task: "Provide deployment steps and rollback guidance",
      output: [
        "Steps",
        "1. Build the service.",
        "2. Deploy the release.",
        "Rollback",
        "Revert to the previous artifact if health checks fail.",
      ].join("\n"),
      criteria: {
        requiredKeywords: ["deploy", "rollback"],
        expectedSections: ["Steps", "Rollback"],
        minLength: 60,
      },
      rails: [
        {
          id: "rail-steps",
          name: "Steps section required",
          requiredSubstrings: ["Steps"],
        },
      ],
    });

    expect(report.overallPassed).toBe(true);
    expect(report.passedGate).toBe(true);
    expect(report.pdseScore).toBeGreaterThan(0.85);
    expect(report.critiqueTrace.map((stage) => stage.stage)).toEqual([
      "syntactic",
      "semantic",
      "factual",
      "safety",
    ]);
    expect(report.railFindings.every((finding) => finding.passed)).toBe(true);
  });

  it("fails outputs that trip hard rails and placeholder heuristics", () => {
    const report = verifyOutput({
      task: "Summarize the migration plan",
      output: "TODO: fill this in later.",
      criteria: {
        requiredKeywords: ["migration"],
        minLength: 40,
      },
      rails: [
        {
          id: "rail-no-todo",
          name: "No TODOs",
          forbiddenPatterns: ["TODO"],
        },
      ],
    });

    expect(report.overallPassed).toBe(false);
    expect(report.passedGate).toBe(false);
    expect(report.pdseScore).toBeLessThan(0.6);
    expect(report.railFindings.some((finding) => finding.passed === false)).toBe(true);
    expect(report.metrics.find((metric) => metric.name === "faithfulness")?.passed).toBe(false);
  });
});

describe("runQaSuite", () => {
  beforeEach(() => {
    globalVerificationRailRegistry.clear();
  });

  it("aggregates pass/fail results across outputs", () => {
    const suite = runQaSuite("plan-123", [
      {
        id: "good",
        task: "Explain the deploy flow",
        output: "Deploy steps:\n1. Build\n2. Deploy\nRollback if health checks fail.",
        criteria: { requiredKeywords: ["deploy", "rollback"], minLength: 40 },
      },
      {
        id: "bad",
        task: "Explain the incident response flow",
        output: "TBD",
        criteria: { requiredKeywords: ["incident"], minLength: 40 },
      },
    ]);

    expect(suite.planId).toBe("plan-123");
    expect(suite.outputReports).toHaveLength(2);
    expect(suite.overallPassed).toBe(false);
    expect(suite.failingOutputIds).toEqual(["bad"]);
    expect(suite.averagePdseScore).toBeGreaterThan(0);
  });
});

describe("generateQaTestCases", () => {
  it("derives coverage, structure, and safety cases from a task description", () => {
    const cases = generateQaTestCases("Provide deployment steps and rollback guidance");

    expect(cases.map((entry) => entry.id)).toEqual(["coverage", "structure", "safety"]);
    expect(cases[0]?.criteria.requiredKeywords).toContain("deploy");
    expect(cases[0]?.criteria.requiredKeywords).toContain("rollback");
    expect(cases[1]?.criteria.expectedSections).toEqual(["Steps", "Rollback"]);
    expect(cases[2]?.criteria.forbiddenPatterns).toContain("TODO");
  });
});
