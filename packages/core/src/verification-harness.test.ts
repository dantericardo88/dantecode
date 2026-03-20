import { describe, expect, it, beforeEach } from "vitest";
import {
  VerificationSuiteRunner,
  buildCoverageTestCase,
  buildSafetyTestCase,
  buildStructureTestCase,
  type SuiteDefinition,
} from "./verification-suite-runner.js";
import {
  VerificationBenchmarkRunner,
  createStandardBenchmarkCorpus,
} from "./verification-benchmark-runner.js";

const GOOD_OUTPUT =
  "Steps:\n1. Build artifact.\n2. Deploy to staging.\n3. Deploy to production.\nRollback if health checks fail.";

const BAD_OUTPUT = "TODO: implement this later.";

// ---------------------------------------------------------------------------
// Suite Runner
// ---------------------------------------------------------------------------

describe("VerificationSuiteRunner", () => {
  let runner: VerificationSuiteRunner;

  beforeEach(() => {
    runner = new VerificationSuiteRunner();
  });

  it("runs a simple coverage suite and reports pass/fail", async () => {
    const suite: SuiteDefinition = {
      label: "Deploy Suite",
      cases: [
        buildCoverageTestCase("deploy and rollback", GOOD_OUTPUT, ["deploy", "rollback"]),
        buildCoverageTestCase("implement auth", BAD_OUTPUT, ["auth", "login"]),
      ],
    };
    const report = await runner.run(suite);
    expect(report.totalCases).toBe(2);
    expect(report.passedCases).toBe(1);
    expect(report.failedCases).toBe(1);
    expect(report.averagePdseScore).toBeGreaterThan(0);
    expect(report.durationMs).toBeGreaterThanOrEqual(0);
  });

  it("runs a safety test case and detects forbidden patterns", async () => {
    const safeCase = buildSafetyTestCase("reset db", "DROP TABLE users;", ["DROP TABLE"]);
    const suite: SuiteDefinition = { label: "Safety Suite", cases: [safeCase] };
    const report = await runner.run(suite);
    expect(report.results[0]?.passed).toBe(false);
  });

  it("runs a structure test case and checks expected sections", async () => {
    const structCase = buildStructureTestCase(
      "steps rollback",
      "Steps:\n1. Build the release.\n2. Deploy to staging.\nRollback:\nRevert artifact if health checks fail.",
      ["Steps", "Rollback"],
    );
    const suite: SuiteDefinition = { label: "Structure Suite", cases: [structCase] };
    const report = await runner.run(suite);
    expect(report.results[0]?.passed).toBe(true);
  });

  it("registers and runs a suite by id", async () => {
    const id = runner.registerSuite({
      label: "Registered Suite",
      cases: [
        buildCoverageTestCase("deploy", GOOD_OUTPUT, ["deploy"]),
      ],
    });
    const report = await runner.runById(id);
    expect(report).not.toBeNull();
    expect(report!.passedCases).toBe(1);
  });

  it("returns null for unknown suite id", async () => {
    expect(await runner.runById("unknown")).toBeNull();
  });

  it("validates expectedDecision assertion", async () => {
    const suite: SuiteDefinition = {
      label: "Assertion Suite",
      cases: [
        {
          ...buildCoverageTestCase("deploy", GOOD_OUTPUT, ["deploy", "rollback"]),
          expectedDecision: "pass",
        },
        {
          ...buildCoverageTestCase("auth", BAD_OUTPUT, ["auth"]),
          expectedDecision: "pass",  // should NOT match — output is bad
        },
      ],
    };
    const report = await runner.run(suite);
    expect(report.assertionsMet).toBeLessThan(report.totalCases);
    expect(report.assertionsFailed).toBeGreaterThan(0);
  });

  it("includes synthesis in each case result", async () => {
    const suite: SuiteDefinition = {
      label: "Synthesis Suite",
      cases: [buildCoverageTestCase("task", GOOD_OUTPUT, ["deploy"])],
    };
    const report = await runner.run(suite);
    expect(report.results[0]?.synthesis.decision).toBeDefined();
    expect(["pass", "soft-pass", "review-required", "block"]).toContain(
      report.results[0]?.synthesis.decision,
    );
  });
});

// ---------------------------------------------------------------------------
// Benchmark Runner
// ---------------------------------------------------------------------------

describe("VerificationBenchmarkRunner", () => {
  let runner: VerificationBenchmarkRunner;

  beforeEach(() => {
    runner = new VerificationBenchmarkRunner();
  });

  it("runs the standard benchmark corpus", async () => {
    runner.addTasks(createStandardBenchmarkCorpus());
    const report = await runner.run("Standard Corpus");
    expect(report.taskCount).toBe(5);
    expect(report.passRate).toBeGreaterThan(0);
    expect(report.averagePdseScore).toBeGreaterThan(0);
    expect(report.categoryBreakdown).toBeDefined();
  });

  it("surfaces goldAccuracy when gold decisions provided", async () => {
    runner.addTasks(createStandardBenchmarkCorpus());
    const report = await runner.run("Gold Corpus");
    // Some should match gold (good outputs = pass, bad = block)
    expect(report.goldAccuracy).toBeGreaterThanOrEqual(0);
    expect(report.goldAccuracy).toBeLessThanOrEqual(1);
  });

  it("detects regressions against a baseline", async () => {
    runner.addTasks(createStandardBenchmarkCorpus());
    const firstRun = await runner.run("Baseline");
    const baseline = runner.extractBaseline(firstRun);

    // Artificially create a worse runner by modifying scores in baseline
    const worseBaseline = {
      ...baseline,
      taskScores: Object.fromEntries(
        Object.entries(baseline.taskScores).map(([id, score]) => [id, score + 0.2]),
      ),
    };

    const secondRun = await runner.run("Candidate", { baseline: worseBaseline });
    expect(secondRun.regressions.length).toBeGreaterThan(0);
  });

  it("detects improvements against a baseline", async () => {
    runner.addTasks(createStandardBenchmarkCorpus());
    const firstRun = await runner.run("Baseline");
    const baseline = runner.extractBaseline(firstRun);

    // Artificially create a better baseline (lower than actual scores)
    const betterBaseline = {
      ...baseline,
      taskScores: Object.fromEntries(
        Object.entries(baseline.taskScores).map(([id, score]) => [id, Math.max(0, score - 0.2)]),
      ),
    };

    const secondRun = await runner.run("Candidate", { baseline: betterBaseline });
    expect(secondRun.improvements.length).toBeGreaterThan(0);
  });

  it("runs only specified task ids", async () => {
    runner.addTasks(createStandardBenchmarkCorpus());
    const ids = ["bm-deploy-001", "bm-plan-001"];
    const report = await runner.run("Subset", { taskIds: ids });
    expect(report.taskCount).toBe(2);
    expect(report.results.map((r) => r.id)).toEqual(ids);
  });

  it("builds category breakdown correctly", async () => {
    runner.addTasks(createStandardBenchmarkCorpus());
    const report = await runner.run("Category Test");
    expect(report.categoryBreakdown["code-generation"]).toBeDefined();
    expect(report.categoryBreakdown["planning"]).toBeDefined();
    const cg = report.categoryBreakdown["code-generation"]!;
    expect(cg.count).toBe(2);
  });

  it("removes a task by id", async () => {
    runner.addTasks(createStandardBenchmarkCorpus());
    expect(runner.removeTask("bm-deploy-001")).toBe(true);
    expect(runner.listTaskIds()).not.toContain("bm-deploy-001");
  });

  it("extracts a baseline snapshot from a report", async () => {
    runner.addTasks(createStandardBenchmarkCorpus());
    const report = await runner.run("For baseline");
    const baseline = runner.extractBaseline(report);
    expect(Object.keys(baseline.taskScores)).toHaveLength(report.taskCount);
    expect(Object.keys(baseline.taskDecisions)).toHaveLength(report.taskCount);
  });
});
