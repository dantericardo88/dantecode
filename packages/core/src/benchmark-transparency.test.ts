import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  appendBenchmarkScoreHistory,
  createBenchmarkArtifactRef,
  formatBenchmarkTransparencyMarkdown,
  runBenchmarkTransparencyGate,
  validateBenchmarkTransparencyManifest,
} from "./benchmark-transparency.js";
import type { BenchmarkTransparencyManifest } from "./benchmark-transparency.js";

describe("benchmark transparency gate", () => {
  const tempDirs: string[] = [];

  afterEach(() => {
    for (const dir of tempDirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  function tempProject(): string {
    const dir = mkdtempSync(join(tmpdir(), "dante-bench-transparency-"));
    tempDirs.push(dir);
    return dir;
  }

  function completeManifest(projectRoot: string): BenchmarkTransparencyManifest {
    const runDir = join(projectRoot, "benchmarks", "transparency", "run-45");
    mkdirSync(runDir, { recursive: true });
    writeFileSync(join(runDir, "raw-report.json"), JSON.stringify({ total: 2, resolved: 2 }), "utf-8");
    writeFileSync(join(runDir, "report.md"), "# Benchmark\n\nPass rate: 100%\n", "utf-8");
    writeFileSync(join(runDir, "command.txt"), "dantecode bench transparency --suite builtin --seed 45", "utf-8");
    writeFileSync(join(runDir, "selected-instances.json"), JSON.stringify(["case-1", "case-2"]), "utf-8");
    writeFileSync(join(runDir, "per-instance-logs.jsonl"), "{\"instanceId\":\"case-1\",\"resolved\":true}\n", "utf-8");
    writeFileSync(join(runDir, "trace-refs.json"), JSON.stringify({ traces: ["builtin://run-45/case-1"] }), "utf-8");
    writeFileSync(join(runDir, "limitations.md"), "- Built-in canary only\n", "utf-8");

    return {
      schemaVersion: "1.0",
      dimensionId: "benchmark_transparency",
      benchmarkId: "builtin-canary",
      suite: "builtin",
      runId: "run-45",
      generatedAt: "2026-04-29T12:00:00.000Z",
      git: { commit: "abc123", dirty: false },
      environment: {
        platform: "test",
        arch: "x64",
        node: "v22.0.0",
        npm: "10.0.0",
      },
      command: {
        text: "dantecode bench transparency --suite builtin --seed 45",
        argv: ["dantecode", "bench", "transparency", "--suite", "builtin", "--seed", "45"],
        cwd: projectRoot,
      },
      model: "builtin-gold-patch",
      dataset: {
        name: "builtin-typescript-canary",
        path: "builtin:@dantecode/swe-bench-runner",
        sha256: "dataset-sha",
        selectedInstanceIds: ["case-1", "case-2"],
        seed: 45,
      },
      config: {
        timeoutMs: 600_000,
        parallel: 1,
      },
      result: {
        total: 2,
        resolved: 2,
        passRate: 1,
      },
      artifacts: [
        createBenchmarkArtifactRef("raw_report", join(runDir, "raw-report.json"), projectRoot),
        createBenchmarkArtifactRef("markdown_report", join(runDir, "report.md"), projectRoot),
        createBenchmarkArtifactRef("command", join(runDir, "command.txt"), projectRoot),
        createBenchmarkArtifactRef("selected_instances", join(runDir, "selected-instances.json"), projectRoot),
        createBenchmarkArtifactRef("per_instance_logs", join(runDir, "per-instance-logs.jsonl"), projectRoot),
        createBenchmarkArtifactRef("trace_refs", join(runDir, "trace-refs.json"), projectRoot),
        createBenchmarkArtifactRef("limitations", join(runDir, "limitations.md"), projectRoot),
      ],
      limitations: ["Built-in canary only; full SWE-bench performance is scored separately."],
      rerunCommand: "dantecode bench transparency --suite builtin --seed 45",
      scoreHistoryUpdated: true,
    };
  }

  it("fails validation when required proof fields are missing", () => {
    const projectRoot = tempProject();
    const manifest = completeManifest(projectRoot);
    manifest.command.text = "";
    manifest.dataset.sha256 = "";
    manifest.limitations = [];

    const result = validateBenchmarkTransparencyManifest(manifest, projectRoot);

    expect(result.pass).toBe(false);
    expect(result.blockers).toEqual(
      expect.arrayContaining([
        "command text is required",
        "dataset sha256 is required",
        "limitations are required",
      ]),
    );
  });

  it("fails closed when an artifact is missing or has a checksum mismatch", () => {
    const projectRoot = tempProject();
    const manifest = completeManifest(projectRoot);
    const raw = manifest.artifacts.find((artifact) => artifact.kind === "raw_report");
    expect(raw).toBeDefined();
    if (raw) {
      writeFileSync(join(projectRoot, raw.path), JSON.stringify({ total: 99 }), "utf-8");
    }

    const result = validateBenchmarkTransparencyManifest(manifest, projectRoot);

    expect(result.pass).toBe(false);
    expect(result.blockers.join("\n")).toContain("checksum mismatch");
  });

  it("passes a complete built-in benchmark transparency manifest", () => {
    const projectRoot = tempProject();
    const manifest = completeManifest(projectRoot);

    const result = runBenchmarkTransparencyGate({
      manifest,
      projectRoot,
      threshold: 90,
    });

    expect(result.pass).toBe(true);
    expect(result.score).toBeGreaterThanOrEqual(90);
    expect(result.proof.commandRecorded).toBe(true);
    expect(result.proof.datasetHashRecorded).toBe(true);
    expect(result.proof.scoreHistoryUpdated).toBe(true);
  });

  it("appends deterministic JSONL score history entries", () => {
    const projectRoot = tempProject();
    const historyPath = appendBenchmarkScoreHistory(projectRoot, {
      generatedAt: "2026-04-29T12:00:00.000Z",
      dimensionId: "benchmark_transparency",
      runId: "run-45",
      suite: "builtin",
      score: 100,
      pass: true,
      passRate: 1,
      manifestPath: "benchmarks/transparency/run-45/manifest.json",
    });

    expect(existsSync(historyPath)).toBe(true);
    const lines = readFileSync(historyPath, "utf-8").trim().split(/\r?\n/);
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0]!)).toMatchObject({
      dimensionId: "benchmark_transparency",
      runId: "run-45",
      score: 100,
    });
  });

  it("formats a markdown report with rerun and limitation proof", () => {
    const projectRoot = tempProject();
    const result = runBenchmarkTransparencyGate({
      manifest: completeManifest(projectRoot),
      projectRoot,
      threshold: 90,
    });

    const markdown = formatBenchmarkTransparencyMarkdown(result);

    expect(markdown).toContain("Benchmark Transparency Gate");
    expect(markdown).toContain("dantecode bench transparency --suite builtin --seed 45");
    expect(markdown).toContain("Built-in canary only");
  });
});
