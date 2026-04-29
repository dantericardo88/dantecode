import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SWEInstance, SWEReport } from "../swe-bench-runner.js";

const mockLoadSWEBenchInstances = vi.fn();
const mockRunSWEBenchEval = vi.fn();
const mockWriteSWEReport = vi.fn();
const mockRunSWEBenchGoldCalibration = vi.fn();

vi.mock("../swe-bench-runner.js", () => ({
  loadSWEBenchInstances: mockLoadSWEBenchInstances,
  runSWEBenchEval: mockRunSWEBenchEval,
  writeSWEReport: mockWriteSWEReport,
  runSWEBenchGoldCalibration: mockRunSWEBenchGoldCalibration,
  formatSWEReport: vi.fn(() => "# SWE-bench Evaluation Report\n"),
}));

import { runBenchCommand } from "../commands/bench.js";

describe("SWE-bench correctness commands", () => {
  const tempDirs: string[] = [];

  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    mockLoadSWEBenchInstances.mockResolvedValue([
      makeInstance("repo__1"),
      makeInstance("repo__2"),
    ]);
    mockRunSWEBenchGoldCalibration.mockResolvedValue({
      runId: "cal-run",
      total: 2,
      reproducedBaseline: 2,
      goldResolved: 2,
      passRate: 1,
      results: [
        { instance_id: "repo__1", baselineReproduced: true, goldResolved: true, failureClass: "resolved" },
        { instance_id: "repo__2", baselineReproduced: true, goldResolved: true, failureClass: "resolved" },
      ],
      generatedAt: "2026-04-29T12:00:00.000Z",
    });
    mockRunSWEBenchEval.mockResolvedValue(makeReport());
    mockWriteSWEReport.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    for (const dir of tempDirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  function tempProject(): string {
    const dir = mkdtempSync(join(tmpdir(), "dante-swe-dim5-"));
    tempDirs.push(dir);
    return dir;
  }

  it("bench calibrate writes calibration evidence", async () => {
    const projectRoot = tempProject();
    const code = await runBenchCommand([
      "calibrate",
      "--data",
      "fixtures/swe.jsonl",
      "--instances",
      "2",
      "--seed",
      "5",
      "--evidence",
    ], projectRoot);

    expect(code).toBe(0);
    expect(mockRunSWEBenchGoldCalibration).toHaveBeenCalledOnce();
    const evidencePath = join(projectRoot, ".danteforge", "evidence", "swe-bench-calibration-dim5.json");
    expect(existsSync(evidencePath)).toBe(true);
    const evidence = JSON.parse(readFileSync(evidencePath, "utf-8"));
    expect(evidence.passRate).toBe(1);
    expect(evidence.dataset.seed).toBe(5);
  });

  it("bench run writes per-instance artifacts and run evidence", async () => {
    const projectRoot = tempProject();
    const code = await runBenchCommand([
      "run",
      "--suite",
      "verified",
      "--data",
      "fixtures/swe.jsonl",
      "--instances",
      "2",
      "--seed",
      "5",
      "--attempts",
      "1",
      "--evidence",
    ], projectRoot);

    expect(code).toBe(0);
    const runDir = join(projectRoot, "benchmarks", "swe-bench", "runs", "run-1");
    expect(existsSync(join(runDir, "manifest.json"))).toBe(true);
    expect(existsSync(join(runDir, "repo__1", "trajectory.jsonl"))).toBe(true);
    expect(existsSync(join(runDir, "repo__1", "generated.patch"))).toBe(true);
    expect(existsSync(join(runDir, "repo__1", "baseline.log"))).toBe(true);
    expect(existsSync(join(runDir, "repo__1", "verification.log"))).toBe(true);
    expect(existsSync(join(runDir, "repo__1", "environment.log"))).toBe(true);
    expect(existsSync(join(projectRoot, ".danteforge", "evidence", "swe-bench-run-dim5.json"))).toBe(true);
  });

  it("bench compare exits non-zero when candidate does not beat baseline by 10 points", async () => {
    const projectRoot = tempProject();
    const baseline = join(projectRoot, "baseline.json");
    const candidate = join(projectRoot, "candidate.json");
    writeFileSync(baseline, JSON.stringify({ pass_rate: 0.5, run_id: "raw" }), "utf-8");
    writeFileSync(candidate, JSON.stringify({ pass_rate: 0.55, run_id: "danteforge" }), "utf-8");

    const code = await runBenchCommand([
      "compare",
      "--baseline",
      baseline,
      "--candidate",
      candidate,
      "--evidence",
    ], projectRoot);

    expect(code).toBe(1);
    const evidence = JSON.parse(
      readFileSync(join(projectRoot, ".danteforge", "evidence", "swe-bench-comparison-dim5.json"), "utf-8"),
    );
    expect(evidence.pass).toBe(false);
    expect(evidence.delta).toBeCloseTo(0.05, 5);
  });

  it("bench correctness gate writes JSON and markdown evidence", async () => {
    const projectRoot = tempProject();
    writeDim5ProofInputs(projectRoot);

    const code = await runBenchCommand([
      "correctness",
      "gate",
      "--threshold",
      "90",
      "--evidence",
    ], projectRoot);

    expect(code).toBe(0);
    const evidencePath = join(projectRoot, ".danteforge", "evidence", "swe-bench-correctness-dim5.json");
    const markdownPath = join(projectRoot, ".danteforge", "evidence", "swe-bench-correctness-dim5.md");
    expect(existsSync(evidencePath)).toBe(true);
    expect(existsSync(markdownPath)).toBe(true);
    const evidence = JSON.parse(readFileSync(evidencePath, "utf-8"));
    expect(evidence.pass).toBe(true);
    expect(evidence.maxEligibleScore).toBe(9);
  });

  it("bench dataset prepare downloads and normalizes official Hugging Face rows", async () => {
    const projectRoot = tempProject();
    const outputPath = join(projectRoot, "benchmarks", "swe-bench", "swe-bench-verified.jsonl");
    vi.stubGlobal("fetch", vi.fn(async () => ({
      ok: true,
      status: 200,
      statusText: "OK",
      json: async () => ({
        num_rows_total: 2,
        rows: [
          { row: makeHuggingFaceRow("repo__1") },
          { row: makeHuggingFaceRow("repo__2") },
        ],
      }),
    })));

    const code = await runBenchCommand([
      "dataset",
      "prepare",
      "--suite",
      "verified",
      "--output",
      outputPath,
      "--limit",
      "2",
      "--evidence",
    ], projectRoot);

    expect(code).toBe(0);
    expect(existsSync(outputPath)).toBe(true);
    const lines = readFileSync(outputPath, "utf-8").trim().split("\n");
    expect(lines).toHaveLength(2);
    const first = JSON.parse(lines[0]!);
    expect(first.instance_id).toBe("repo__1");
    expect(first.FAIL_TO_PASS).toEqual(["tests/test_bug.py::test_fix"]);
    expect(first.PASS_TO_PASS).toEqual(["tests/test_bug.py::test_existing"]);
    expect(existsSync(join(projectRoot, "benchmarks", "swe-bench", "swe-bench-verified.manifest.json"))).toBe(true);
    const evidence = JSON.parse(
      readFileSync(join(projectRoot, ".danteforge", "evidence", "swe-bench-dataset-dim5.json"), "utf-8"),
    );
    expect(evidence.dataset.rows).toBe(2);
    expect(evidence.dataset.sha256).toMatch(/^[a-f0-9]{64}$/);
  });

  it("bench correctness gate uses dataset evidence when calibration evidence is not ready yet", async () => {
    const projectRoot = tempProject();
    const evidenceDir = join(projectRoot, ".danteforge", "evidence");
    mkdirSync(evidenceDir, { recursive: true });
    writeFileSync(join(evidenceDir, "swe-bench-dataset-dim5.json"), JSON.stringify({
      dataset: {
        path: "benchmarks/swe-bench/swe-bench-verified.jsonl",
        sha256: "a".repeat(64),
        selectedInstanceIds: ["repo__1", "repo__2"],
        seed: 5,
      },
    }), "utf-8");

    const code = await runBenchCommand([
      "correctness",
      "gate",
      "--threshold",
      "90",
      "--evidence",
    ], projectRoot);

    expect(code).toBe(1);
    const evidence = JSON.parse(
      readFileSync(join(evidenceDir, "swe-bench-correctness-dim5.json"), "utf-8"),
    );
    expect(evidence.proof.datasetSelected).toBe(true);
    expect(evidence.blockers).not.toContain("dataset path is required");
    expect(evidence.blockers).toContain("gold-patch calibration is below 95%");
  });
});

function makeInstance(instance_id: string): SWEInstance {
  return {
    instance_id,
    repo: "org/repo",
    base_commit: "abc123",
    problem_statement: "Fix bug",
    test_patch: "diff --git a/test.py b/test.py",
    patch: "diff --git a/app.py b/app.py",
    FAIL_TO_PASS: ["tests/test_bug.py::test_fix"],
    PASS_TO_PASS: [],
  };
}

function makeReport(): SWEReport {
  return {
    run_id: "run-1",
    model: "test-model",
    total: 2,
    resolved: 1,
    pass_rate: 0.5,
    generated_at: "2026-04-29T12:00:00.000Z",
    results: [
      {
        instance_id: "repo__1",
        resolved: true,
        model_patch: "diff --git a/app.py b/app.py\n+fix",
        test_output: "passed",
        duration_ms: 1000,
      },
      {
        instance_id: "repo__2",
        resolved: false,
        model_patch: "",
        test_output: "FAILED",
        duration_ms: 1000,
        error: "agent produced no patch",
      },
    ],
  };
}

function makeHuggingFaceRow(instance_id: string): Record<string, unknown> {
  return {
    instance_id,
    repo: "org/repo",
    base_commit: "abc123",
    problem_statement: "Fix bug",
    hints_text: "",
    test_patch: "diff --git a/test.py b/test.py",
    patch: "diff --git a/app.py b/app.py",
    FAIL_TO_PASS: JSON.stringify(["tests/test_bug.py::test_fix"]),
    PASS_TO_PASS: JSON.stringify(["tests/test_bug.py::test_existing"]),
    environment_setup_commit: "def456",
    difficulty: "15 min - 1 hour",
  };
}

function writeDim5ProofInputs(projectRoot: string): void {
  const evidenceDir = join(projectRoot, ".danteforge", "evidence");
  const runDir = join(projectRoot, "benchmarks", "swe-bench", "runs", "run-a");
  rmSync(evidenceDir, { recursive: true, force: true });
  mkdirSync(evidenceDir, { recursive: true });
  writeFileSync(join(evidenceDir, ".keep"), "", "utf-8");
  rmSync(runDir, { recursive: true, force: true });
  mkdirSync(runDir, { recursive: true });
  writeFileSync(join(runDir, ".keep"), "", "utf-8");

  const selected = Array.from({ length: 100 }, (_, i) => `repo__${i + 1}`);
  writeFileSync(join(evidenceDir, "swe-bench-calibration-dim5.json"), JSON.stringify({
    dataset: { path: "benchmarks/swe-bench/swe-bench-verified.jsonl", sha256: "dataset-sha", seed: 5, selectedInstanceIds: selected },
    total: 100,
    reproducedBaseline: 100,
    goldResolved: 98,
    passRate: 0.98,
    threshold: 0.95,
    artifactPath: ".danteforge/evidence/swe-bench-calibration-dim5.json",
  }), "utf-8");
  writeFileSync(join(evidenceDir, "swe-bench-run-dim5.json"), JSON.stringify({
    suite: "verified",
    runId: "run-a",
    total: 100,
    resolved: 68,
    passRate: 0.68,
    requiredPassRate: 0.65,
    attempts: 3,
    artifactCompleteness: {
      trajectoryCount: 100,
      patchCount: 100,
      baselineLogCount: 100,
      verificationLogCount: 100,
      environmentLogCount: 100,
      classifiedFailureCount: 100,
      manifestPath: "benchmarks/swe-bench/runs/run-a/manifest.json",
    },
    failureTaxonomy: { resolved: 68, agent_wrong_patch: 20, timeout: 12 },
    repeatedRuns: [{ runId: "run-a", passRate: 0.68 }, { runId: "run-b", passRate: 0.66 }],
  }), "utf-8");
  writeFileSync(join(evidenceDir, "swe-bench-comparison-dim5.json"), JSON.stringify({
    baselinePassRate: 0.52,
    candidatePassRate: 0.68,
    delta: 0.16,
    requiredDelta: 0.1,
    pass: true,
  }), "utf-8");
}
