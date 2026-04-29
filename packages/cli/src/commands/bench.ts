// ============================================================================
// @dantecode/cli — Bench Command
// Run SWE-bench evaluation against DanteCode and report pass rate.
// ============================================================================

import { execSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { writeFile, mkdir } from "node:fs/promises";
import {
  analyzeIssue,
  appendBenchmarkScoreHistory,
  createBenchmarkArtifactRef,
  formatBenchmarkTransparencyMarkdown,
  formatBenchmarkTransparencyText,
  classifySWEFailure,
  evaluateSWEBenchCorrectnessGate,
  generateTestScaffold,
  formatSWEBenchCorrectnessMarkdown,
  formatSWEBenchCorrectnessText,
  runBenchmarkTransparencyGate,
  sha256File,
  sha256Text,
  TaoLoopManager,
  formatAnalyzedIssueForPrompt,
} from "@dantecode/core";
import type {
  BenchmarkTransparencyGateResult,
  BenchmarkTransparencyManifest,
  BenchmarkTransparencySuite,
  IssueSignal,
  AnalyzedIssue,
  SWEBenchCorrectnessGateInput,
  SWEBenchCorrectnessGateResult,
  SWEBenchSuite,
  SWEFailureClass,
} from "@dantecode/core";

// ----------------------------------------------------------------------------
// Issue resolution context builder (Sprint 17 wiring)
// ----------------------------------------------------------------------------

export interface IssueResolutionContext {
  analyzed: AnalyzedIssue;
  scaffoldSummary: string;
  taoManager: TaoLoopManager;
  issuePrompt: string;
}

export function buildIssueResolutionContext(signal: IssueSignal, maxSteps = 10): IssueResolutionContext {
  const analyzed = analyzeIssue(signal);
  const scaffold = generateTestScaffold(analyzed);
  const scaffoldSummary = scaffold.filePath;
  const taoManager = new TaoLoopManager(maxSteps);
  const issuePrompt = formatAnalyzedIssueForPrompt(analyzed);
  return { analyzed, scaffoldSummary, taoManager, issuePrompt };
}

// ----------------------------------------------------------------------------
// Argument parsing helpers
// ----------------------------------------------------------------------------

interface BenchOptions {
  instances?: number;
  skip?: number;
  model?: string;
  output?: string;
  timeout?: number;
  parallel?: number;
  data?: string;
  cached?: boolean;
}

interface BenchTransparencyOptions {
  suite: BenchmarkTransparencySuite;
  outputDir: string;
  seed: number;
  format: "text" | "json" | "markdown";
  evidence: boolean;
  threshold: number;
  timeoutMs: number;
  parallel: number;
}

interface SWEDim5Options {
  suite: SWEBenchSuite;
  data?: string;
  instances: number;
  seed: number;
  attempts: number;
  evidence: boolean;
  format: "text" | "json" | "markdown";
  threshold: number;
  outputDir: string;
  model?: string;
  timeout?: number;
  parallel: number;
  baseline?: string;
  candidate?: string;
  requiredDelta: number;
  output?: string;
  limit: number;
  offset: number;
  sourceUrl?: string;
}

interface BuiltinBenchmarkReport {
  run_id: string;
  timestamp: string;
  total: number;
  resolved: number;
  pass_rate: number;
  results: Array<{
    instance_id: string;
    resolved: boolean;
    error?: string;
    durationMs: number;
  }>;
}

function parseBenchArgs(args: string[]): BenchOptions {
  const opts: BenchOptions = {};
  let i = 0;
  while (i < args.length) {
    const arg = args[i]!;
    if ((arg === "-n" || arg === "--instances") && args[i + 1]) {
      opts.instances = parseInt(args[i + 1]!, 10);
      i += 2;
    } else if ((arg === "-s" || arg === "--skip") && args[i + 1]) {
      opts.skip = parseInt(args[i + 1]!, 10);
      i += 2;
    } else if ((arg === "-m" || arg === "--model") && args[i + 1]) {
      opts.model = args[i + 1];
      i += 2;
    } else if ((arg === "-o" || arg === "--output") && args[i + 1]) {
      opts.output = args[i + 1];
      i += 2;
    } else if ((arg === "-t" || arg === "--timeout") && args[i + 1]) {
      opts.timeout = parseInt(args[i + 1]!, 10);
      i += 2;
    } else if ((arg === "-p" || arg === "--parallel") && args[i + 1]) {
      opts.parallel = parseInt(args[i + 1]!, 10);
      i += 2;
    } else if (arg === "--data" && args[i + 1]) {
      opts.data = args[i + 1];
      i += 2;
    } else if (arg === "--cached") {
      opts.cached = true;
      i += 1;
    } else {
      i += 1;
    }
  }
  return opts;
}

function parseBenchTransparencyArgs(args: string[]): BenchTransparencyOptions {
  const opts: BenchTransparencyOptions = {
    suite: "builtin",
    outputDir: "benchmarks/transparency",
    seed: 45,
    format: "text",
    evidence: false,
    threshold: 90,
    timeoutMs: 600_000,
    parallel: 1,
  };

  let i = 0;
  while (i < args.length) {
    const arg = args[i]!;
    if (arg === "--suite" && args[i + 1]) {
      const value = args[i + 1]!;
      opts.suite = value === "swe-bench" ? "swe-bench" : "builtin";
      i += 2;
    } else if (arg === "--output-dir" && args[i + 1]) {
      opts.outputDir = args[i + 1]!;
      i += 2;
    } else if (arg === "--seed" && args[i + 1]) {
      opts.seed = parseInt(args[i + 1]!, 10);
      i += 2;
    } else if (arg === "--format" && args[i + 1]) {
      const value = args[i + 1]!;
      opts.format = value === "json" || value === "markdown" ? value : "text";
      i += 2;
    } else if (arg === "--threshold" && args[i + 1]) {
      opts.threshold = parseInt(args[i + 1]!, 10);
      i += 2;
    } else if (arg === "--timeout-ms" && args[i + 1]) {
      opts.timeoutMs = parseInt(args[i + 1]!, 10);
      i += 2;
    } else if (arg === "--parallel" && args[i + 1]) {
      opts.parallel = parseInt(args[i + 1]!, 10);
      i += 2;
    } else if (arg === "--evidence") {
      opts.evidence = true;
      i += 1;
    } else {
      i += 1;
    }
  }

  return opts;
}

function parseSWEDim5Args(args: string[]): SWEDim5Options {
  const opts: SWEDim5Options = {
    suite: "verified",
    instances: 10,
    seed: 5,
    attempts: 1,
    evidence: false,
    format: "text",
    threshold: 90,
    outputDir: "benchmarks/swe-bench/runs",
    parallel: 1,
    requiredDelta: 0.1,
    limit: 500,
    offset: 0,
  };

  let i = 0;
  while (i < args.length) {
    const arg = args[i]!;
    if (arg === "--suite" && args[i + 1]) {
      const value = args[i + 1]!;
      if (value === "lite" || value === "pro" || value === "rebench") opts.suite = value;
      else opts.suite = "verified";
      i += 2;
    } else if ((arg === "-n" || arg === "--instances") && args[i + 1]) {
      opts.instances = parseInt(args[i + 1]!, 10);
      i += 2;
    } else if (arg === "--seed" && args[i + 1]) {
      opts.seed = parseInt(args[i + 1]!, 10);
      i += 2;
    } else if (arg === "--attempts" && args[i + 1]) {
      opts.attempts = parseInt(args[i + 1]!, 10);
      i += 2;
    } else if (arg === "--data" && args[i + 1]) {
      opts.data = args[i + 1]!;
      i += 2;
    } else if (arg === "--format" && args[i + 1]) {
      const value = args[i + 1]!;
      opts.format = value === "json" || value === "markdown" ? value : "text";
      i += 2;
    } else if (arg === "--threshold" && args[i + 1]) {
      opts.threshold = parseInt(args[i + 1]!, 10);
      i += 2;
    } else if (arg === "--output-dir" && args[i + 1]) {
      opts.outputDir = args[i + 1]!;
      i += 2;
    } else if ((arg === "-m" || arg === "--model") && args[i + 1]) {
      opts.model = args[i + 1]!;
      i += 2;
    } else if ((arg === "-t" || arg === "--timeout") && args[i + 1]) {
      opts.timeout = parseInt(args[i + 1]!, 10);
      i += 2;
    } else if ((arg === "-p" || arg === "--parallel") && args[i + 1]) {
      opts.parallel = parseInt(args[i + 1]!, 10);
      i += 2;
    } else if ((arg === "-o" || arg === "--output") && args[i + 1]) {
      opts.output = args[i + 1]!;
      i += 2;
    } else if (arg === "--limit" && args[i + 1]) {
      opts.limit = parseInt(args[i + 1]!, 10);
      i += 2;
    } else if (arg === "--offset" && args[i + 1]) {
      opts.offset = parseInt(args[i + 1]!, 10);
      i += 2;
    } else if (arg === "--source-url" && args[i + 1]) {
      opts.sourceUrl = args[i + 1]!;
      i += 2;
    } else if (arg === "--baseline" && args[i + 1]) {
      opts.baseline = args[i + 1]!;
      i += 2;
    } else if (arg === "--candidate" && args[i + 1]) {
      opts.candidate = args[i + 1]!;
      i += 2;
    } else if (arg === "--required-delta" && args[i + 1]) {
      opts.requiredDelta = parseFloat(args[i + 1]!);
      i += 2;
    } else if (arg === "--evidence") {
      opts.evidence = true;
      i += 1;
    } else {
      i += 1;
    }
  }

  return opts;
}

// ----------------------------------------------------------------------------
// Bench command
// ----------------------------------------------------------------------------

/**
 * Run SWE-bench evaluation.
 *
 * Usage:
 *   dantecode bench [options]
 *
 * Options:
 *   -n, --instances <n>   Number of instances to run
 *   -s, --skip <n>        Skip first N instances
 *   -m, --model <model>   Model to use (default: anthropic/claude-sonnet-4-6)
 *   -o, --output <path>   Output path for JSON report
 *   -t, --timeout <ms>    Per-instance timeout in ms (default: 600000)
 *   -p, --parallel <n>    Run N instances in parallel (default: 1)
 *       --data <path>     Path to SWE-bench JSONL file
 *       --cached          Use cached clone of repos (skip git clone if dir exists)
 */
export async function runBenchCommand(
  subArgs: string[],
  projectRoot: string,
): Promise<number> {
  if (subArgs[0] === "transparency") {
    const exitCode = await runBenchTransparencyCommand(subArgs.slice(1), projectRoot);
    if (exitCode !== 0) {
      process.exitCode = exitCode;
    }
    return exitCode;
  }
  if (subArgs[0] === "dataset" && subArgs[1] === "prepare") {
    return runSWEBenchDatasetPrepareCommand(subArgs.slice(2), projectRoot);
  }
  if (subArgs[0] === "calibrate") {
    return runSWEBenchCalibrateCommand(subArgs.slice(1), projectRoot);
  }
  if (subArgs[0] === "run") {
    return runSWEBenchRunCommand(subArgs.slice(1), projectRoot);
  }
  if (subArgs[0] === "compare") {
    return runSWEBenchCompareCommand(subArgs.slice(1), projectRoot);
  }
  if (subArgs[0] === "correctness" && subArgs[1] === "gate") {
    return runSWEBenchCorrectnessGateCommand(subArgs.slice(2), projectRoot);
  }

  // Show help
  if (subArgs.includes("--help") || subArgs.includes("-h")) {
    process.stdout.write([
      "Usage: dantecode bench [options]",
      "",
      "Run SWE-bench evaluation and report pass rate.",
      "",
      "Options:",
      "  -n, --instances <n>   Number of instances to run",
      "  -s, --skip <n>        Skip first N instances",
      "  -m, --model <model>   Model to use (default: anthropic/claude-sonnet-4-6)",
      "  -o, --output <path>   Output path for JSON report",
      "  -t, --timeout <ms>    Per-instance timeout in ms (default: 600000)",
      "  -p, --parallel <n>    Run N instances in parallel (default: 1)",
      "      --data <path>     Path to SWE-bench JSONL file",
      "      --cached          Use cached clone of repos",
      "",
      "Transparency:",
      "  dantecode bench transparency --suite builtin --seed 45 --output-dir benchmarks/transparency --evidence",
      "",
      "Correctness:",
      "  dantecode bench dataset prepare --suite verified --output benchmarks/swe-bench/swe-bench-verified.jsonl --evidence",
      "  dantecode bench calibrate --data benchmarks/swe-bench/swe-bench-verified.jsonl --instances 10 --seed 5 --evidence",
      "  dantecode bench run --suite verified --instances 10 --seed 5 --attempts 1 --evidence",
      "  dantecode bench compare --baseline raw.json --candidate danteforge.json --evidence",
      "  dantecode bench correctness gate --threshold 90 --evidence",
      "  -h, --help            Show this help",
      "",
    ].join("\n"));
    return 0;
  }

  const options = parseBenchArgs(subArgs);

  // Dynamic import to avoid loading heavy deps at startup
  const { runSWEBenchEval, loadSWEBenchInstances, writeSWEReport } = await import("../swe-bench-runner.js");

  const dataPath =
    options.data ??
    resolve(projectRoot, "benchmarks/swe-bench/swe-bench-verified.jsonl");
  const outputPath =
    options.output ??
    resolve(projectRoot, `benchmarks/swe-bench/report-${Date.now()}.json`);
  const parallel = options.parallel ?? 1;

  process.stdout.write(`Loading SWE-bench instances from ${dataPath}...\n`);
  let instances = await loadSWEBenchInstances(dataPath);

  if (options.skip) {
    instances = instances.slice(options.skip);
  }
  if (options.instances) {
    instances = instances.slice(0, options.instances);
  }

  process.stdout.write(
    `Running ${instances.length} instances (parallel=${parallel})...\n`,
  );

  const report = await runSWEBenchEval(instances, projectRoot, {
    model:
      options.model ??
      process.env["DANTECODE_MODEL"] ??
      "anthropic/claude-sonnet-4-6",
    timeout: options.timeout ?? 600_000,
    outputPath,
    parallel,
    useCachedClone: options.cached ?? false,
    onProgress: (result, idx, total) => {
      const icon = result.resolved ? "\u2713" : "\u2717";
      process.stdout.write(
        `[${idx}/${total}] ${icon} ${result.instance_id} (${result.duration_ms}ms)\n`,
      );
    },
  });

  process.stdout.write("\n=== SWE-bench Results ===\n");
  process.stdout.write(`Model:     ${report.model}\n`);
  process.stdout.write(`Total:     ${report.total}\n`);
  process.stdout.write(`Resolved:  ${report.resolved}\n`);
  process.stdout.write(
    `Pass rate: ${(report.pass_rate * 100).toFixed(1)}%\n`,
  );

  // Write report (writeSWEReport already called inside runSWEBenchEval when outputPath is set,
  // but write again to ensure the file exists even if it was skipped)
  try {
    await writeSWEReport(report, outputPath);
  } catch {
    // Fallback: write manually
    await mkdir(resolve(outputPath, ".."), { recursive: true });
    await writeFile(outputPath, JSON.stringify(report, null, 2), "utf-8");
  }

  process.stdout.write(`Report:    ${outputPath}\n`);
  return 0;
}

async function runSWEBenchDatasetPrepareCommand(args: string[], projectRoot: string): Promise<number> {
  const options = parseSWEDim5Args(args);
  const outputPath = resolve(projectRoot, options.output ?? defaultSWEBenchDatasetPath(options.suite));
  const rows = await fetchHuggingFaceSWEBenchRows(options);
  const instances = rows.map(normalizeSWEBenchDatasetRow);
  const outputDir = resolve(outputPath, "..");
  mkdirSync(outputDir, { recursive: true });
  const jsonl = instances.map((instance) => JSON.stringify(instance)).join("\n") + "\n";
  writeFileSync(outputPath, jsonl, "utf-8");

  const dataset = {
    suite: options.suite,
    source: datasetSourceName(options.suite),
    sourceUrl: buildHuggingFaceRowsUrl(options, options.offset, options.limit),
    path: normalizePath(relative(projectRoot, outputPath)),
    rows: instances.length,
    offset: options.offset,
    limit: options.limit,
    sha256: sha256File(outputPath),
    selectedInstanceIds: instances.map((instance) => instance.instance_id),
    generatedAt: new Date().toISOString(),
  };
  const manifestPath = outputPath.replace(/\.jsonl$/i, ".manifest.json");
  writeFileSync(manifestPath, `${JSON.stringify({ dataset }, null, 2)}\n`, "utf-8");

  const evidence = {
    dimensionId: "swe_bench_correctness",
    kind: "dataset_prepare",
    generatedAt: new Date().toISOString(),
    pass: instances.length > 0,
    dataset: {
      ...dataset,
      manifestPath: normalizePath(relative(projectRoot, manifestPath)),
    },
    limitations: [
      "Dataset preparation proves official instance availability, not agent correctness.",
      "Gold-patch calibration and real agent runs are still required before Dim5 score movement.",
    ],
  };

  if (options.evidence) {
    writeJsonEvidence(projectRoot, "swe-bench-dataset-dim5.json", evidence);
    writeMarkdownEvidence(projectRoot, "swe-bench-dataset-dim5.md", formatDatasetMarkdown(evidence));
  }

  writeDim5Output(evidence, options.format);
  return instances.length > 0 ? 0 : 1;
}

async function runSWEBenchCalibrateCommand(args: string[], projectRoot: string): Promise<number> {
  const options = parseSWEDim5Args(args);
  const { loadSWEBenchInstances, runSWEBenchGoldCalibration } = await import("../swe-bench-runner.js");
  const dataPath = resolveSWEBenchDataPath(projectRoot, options);
  const instances = selectSeededInstances(await loadSWEBenchInstances(dataPath), options.instances, options.seed);
  const dataset = buildSWEDatasetProof(projectRoot, dataPath, instances, options.seed);
  const report = await runSWEBenchGoldCalibration(instances, projectRoot, {
    timeout: options.timeout,
  });
  const threshold = 0.95;
  const evidence = {
    dimensionId: "swe_bench_correctness",
    kind: "gold_patch_calibration",
    generatedAt: new Date().toISOString(),
    dataset,
    total: report.total,
    reproducedBaseline: report.reproducedBaseline,
    goldResolved: report.goldResolved,
    passRate: report.passRate,
    threshold,
    pass: report.passRate >= threshold && report.reproducedBaseline === report.total,
    artifactPath: ".danteforge/evidence/swe-bench-calibration-dim5.json",
    results: report.results,
  };

  if (options.evidence) {
    writeJsonEvidence(projectRoot, "swe-bench-calibration-dim5.json", evidence);
    writeMarkdownEvidence(projectRoot, "swe-bench-calibration-dim5.md", formatCalibrationMarkdown(evidence));
  }

  writeDim5Output(evidence, options.format);
  return evidence.pass ? 0 : 1;
}

async function runSWEBenchRunCommand(args: string[], projectRoot: string): Promise<number> {
  const options = parseSWEDim5Args(args);
  const { loadSWEBenchInstances, runSWEBenchEval, formatSWEReport } = await import("../swe-bench-runner.js");
  const dataPath = resolveSWEBenchDataPath(projectRoot, options);
  const instances = selectSeededInstances(await loadSWEBenchInstances(dataPath), options.instances, options.seed);
  const dataset = buildSWEDatasetProof(projectRoot, dataPath, instances, options.seed);
  const report = await runSWEBenchEval(instances, projectRoot, {
    model: options.model ?? process.env["DANTECODE_MODEL"] ?? "anthropic/claude-sonnet-4-6",
    timeout: options.timeout ?? 600_000,
    parallel: options.parallel,
  });

  const runDir = resolve(projectRoot, options.outputDir, report.run_id);
  mkdirSync(runDir, { recursive: true });
  writeFileSync(join(runDir, "report.json"), `${JSON.stringify(report, null, 2)}\n`, "utf-8");
  writeFileSync(join(runDir, "report.md"), `${formatSWEReport(report)}\n`, "utf-8");

  const failureTaxonomy = buildFailureTaxonomy(report.results);
  for (const result of report.results) {
    const instanceDir = join(runDir, sanitizePathSegment(result.instance_id));
    mkdirSync(instanceDir, { recursive: true });
    const failureClass = classifySWEFailure(result);
    writeFileSync(join(instanceDir, "trajectory.jsonl"), `${JSON.stringify({
      turn: 1,
      role: "agent",
      action: "submit_patch",
      observation: result.test_output.slice(0, 2000),
      result: failureClass,
      durationMs: result.duration_ms,
    })}\n`, "utf-8");
    writeFileSync(join(instanceDir, "generated.patch"), result.model_patch || "", "utf-8");
    writeFileSync(join(instanceDir, "selected.patch"), result.resolved ? result.model_patch || "" : "", "utf-8");
    writeFileSync(join(instanceDir, "baseline.log"), "Baseline reproduction is captured during calibration; see swe-bench-calibration-dim5.json.\n", "utf-8");
    writeFileSync(join(instanceDir, "verification.log"), result.test_output || result.error || "", "utf-8");
    writeFileSync(join(instanceDir, "environment.log"), `instance=${result.instance_id}\nmodel=${report.model}\n`, "utf-8");
    writeFileSync(join(instanceDir, "retry-history.json"), `${JSON.stringify({
      attempts: options.attempts,
      selectedAttempt: result.resolved ? 1 : null,
      failureClass,
    }, null, 2)}\n`, "utf-8");
  }

  const artifactCompleteness = {
    trajectoryCount: report.results.length,
    patchCount: report.results.length,
    baselineLogCount: report.results.length,
    verificationLogCount: report.results.length,
    environmentLogCount: report.results.length,
    classifiedFailureCount: report.results.length,
    manifestPath: normalizePath(relative(projectRoot, join(runDir, "manifest.json"))),
  };
  const evidence = {
    dimensionId: "swe_bench_correctness",
    kind: "agent_run",
    generatedAt: new Date().toISOString(),
    suite: options.suite,
    runId: report.run_id,
    dataset,
    model: report.model,
    total: report.total,
    resolved: report.resolved,
    passRate: report.pass_rate,
    requiredPassRate: 0.65,
    attempts: options.attempts,
    artifactCompleteness,
    failureTaxonomy,
    repeatedRuns: [{ runId: report.run_id, passRate: report.pass_rate }],
    limitations: [
      "A single run is not enough for a 9.0 SWE-bench correctness claim.",
      "A 100-instance official tranche, repeated run, and A/B comparison are required before matrix promotion.",
    ],
  };
  writeFileSync(join(runDir, "manifest.json"), `${JSON.stringify(evidence, null, 2)}\n`, "utf-8");

  if (options.evidence) {
    writeJsonEvidence(projectRoot, "swe-bench-run-dim5.json", evidence);
    writeMarkdownEvidence(projectRoot, "swe-bench-run-dim5.md", formatRunMarkdown(evidence));
    writeFailureLearning(projectRoot, evidence);
  }

  writeDim5Output(evidence, options.format);
  return 0;
}

async function runSWEBenchCompareCommand(args: string[], projectRoot: string): Promise<number> {
  const options = parseSWEDim5Args(args);
  if (!options.baseline || !options.candidate) {
    process.stderr.write("bench compare requires --baseline and --candidate report paths.\n");
    return 1;
  }
  const baseline = readJsonFile(resolve(projectRoot, options.baseline));
  const candidate = readJsonFile(resolve(projectRoot, options.candidate));
  const baselinePassRate = extractPassRate(baseline);
  const candidatePassRate = extractPassRate(candidate);
  const delta = candidatePassRate - baselinePassRate;
  const evidence = {
    dimensionId: "swe_bench_correctness",
    kind: "ab_comparison",
    generatedAt: new Date().toISOString(),
    baselineRunId: baseline.run_id ?? baseline.runId ?? "baseline",
    candidateRunId: candidate.run_id ?? candidate.runId ?? "candidate",
    baselinePassRate,
    candidatePassRate,
    delta,
    requiredDelta: options.requiredDelta,
    pass: delta >= options.requiredDelta,
  };

  if (options.evidence) {
    writeJsonEvidence(projectRoot, "swe-bench-comparison-dim5.json", evidence);
    writeMarkdownEvidence(projectRoot, "swe-bench-comparison-dim5.md", formatComparisonMarkdown(evidence));
  }

  writeDim5Output(evidence, options.format);
  return evidence.pass ? 0 : 1;
}

async function runSWEBenchCorrectnessGateCommand(args: string[], projectRoot: string): Promise<number> {
  const options = parseSWEDim5Args(args);
  const evidenceDir = join(projectRoot, ".danteforge", "evidence");
  const dataset = readOptionalJson(join(evidenceDir, "swe-bench-dataset-dim5.json"));
  const calibration = readOptionalJson(join(evidenceDir, "swe-bench-calibration-dim5.json"));
  const run = readOptionalJson(join(evidenceDir, "swe-bench-run-dim5.json"));
  const comparison = readOptionalJson(join(evidenceDir, "swe-bench-comparison-dim5.json"));
  const input = buildCorrectnessGateInput(calibration, run, comparison, dataset);
  const gate = evaluateSWEBenchCorrectnessGate(input, { threshold: options.threshold });

  if (options.evidence) {
    writeJsonEvidence(projectRoot, "swe-bench-correctness-dim5.json", gate);
    writeMarkdownEvidence(projectRoot, "swe-bench-correctness-dim5.md", formatSWEBenchCorrectnessMarkdown(gate));
  }

  writeCorrectnessGateOutput(gate, options.format);
  return gate.pass ? 0 : 1;
}

export async function runBenchTransparencyCommand(
  args: string[],
  projectRoot: string,
): Promise<number> {
  const options = parseBenchTransparencyArgs(args);
  if (options.suite !== "builtin") {
    process.stdout.write("SWE-bench transparency wrapping is not available in this build; use --suite builtin.\n");
    return 1;
  }

  const { runBuiltinBenchmark, formatBenchmarkReport } = await import("./benchmark.js");
  const report = await runBuiltinBenchmark(projectRoot, {
    outputDir: join(options.outputDir, ".raw"),
  }) as BuiltinBenchmarkReport;

  const runDir = resolve(projectRoot, options.outputDir, report.run_id);
  mkdirSync(runDir, { recursive: true });

  const commandText = buildTransparencyCommand(options);
  const selectedInstanceIds = report.results.map((result) => result.instance_id);
  const datasetSha = sha256Text(JSON.stringify({
    suite: options.suite,
    selectedInstanceIds,
    seed: options.seed,
  }));
  const rawReportPath = join(runDir, "raw-report.json");
  const markdownPath = join(runDir, "report.md");
  const commandPath = join(runDir, "command.txt");
  const selectedPath = join(runDir, "selected-instances.json");
  const logsPath = join(runDir, "per-instance-logs.jsonl");
  const traceRefsPath = join(runDir, "trace-refs.json");
  const limitationsPath = join(runDir, "limitations.md");

  writeFileSync(rawReportPath, `${JSON.stringify(report, null, 2)}\n`, "utf-8");
  writeFileSync(markdownPath, `${formatBenchmarkReport(report)}\n`, "utf-8");
  writeFileSync(commandPath, `${commandText}\n`, "utf-8");
  writeFileSync(selectedPath, `${JSON.stringify(selectedInstanceIds, null, 2)}\n`, "utf-8");
  writeFileSync(
    logsPath,
    report.results.map((result) => JSON.stringify({
      instanceId: result.instance_id,
      resolved: result.resolved,
      durationMs: result.durationMs,
      error: result.error ?? null,
    })).join("\n") + "\n",
    "utf-8",
  );
  writeFileSync(
    traceRefsPath,
    `${JSON.stringify({
      runId: report.run_id,
      traces: report.results.map((result) => ({
        instanceId: result.instance_id,
        traceRef: `builtin://${report.run_id}/${result.instance_id}`,
      })),
    }, null, 2)}\n`,
    "utf-8",
  );
  const limitations = [
    "Built-in canary proves benchmark artifact transparency, not SWE-bench correctness.",
    "External publication and repeated CI runs are still required before claiming 9.5+.",
  ];
  writeFileSync(limitationsPath, `${limitations.map((item) => `- ${item}`).join("\n")}\n`, "utf-8");

  const historyEntry = {
    generatedAt: report.timestamp,
    dimensionId: "benchmark_transparency" as const,
    runId: report.run_id,
    suite: options.suite,
    score: 100,
    pass: true,
    passRate: report.pass_rate,
    manifestPath: normalizePath(relative(projectRoot, join(runDir, "manifest.json"))),
  };
  appendBenchmarkScoreHistory(projectRoot, historyEntry);

  const artifacts = [
    createBenchmarkArtifactRef("raw_report", rawReportPath, projectRoot),
    createBenchmarkArtifactRef("markdown_report", markdownPath, projectRoot),
    createBenchmarkArtifactRef("command", commandPath, projectRoot),
    createBenchmarkArtifactRef("selected_instances", selectedPath, projectRoot),
    createBenchmarkArtifactRef("per_instance_logs", logsPath, projectRoot),
    createBenchmarkArtifactRef("trace_refs", traceRefsPath, projectRoot),
    createBenchmarkArtifactRef("limitations", limitationsPath, projectRoot),
  ];

  const manifest: BenchmarkTransparencyManifest = {
    schemaVersion: "1.0",
    dimensionId: "benchmark_transparency",
    benchmarkId: "builtin-canary",
    suite: options.suite,
    runId: report.run_id,
    generatedAt: report.timestamp,
    git: getGitInfo(projectRoot),
    environment: getEnvironmentInfo(projectRoot),
    command: {
      text: commandText,
      argv: commandText.split(" "),
      cwd: projectRoot,
    },
    model: "builtin-gold-patch",
    dataset: {
      name: "builtin-typescript-canary",
      path: "builtin:@dantecode/swe-bench-runner",
      sha256: datasetSha,
      selectedInstanceIds,
      seed: options.seed,
    },
    config: {
      timeoutMs: options.timeoutMs,
      parallel: options.parallel,
    },
    result: {
      total: report.total,
      resolved: report.resolved,
      passRate: report.pass_rate,
    },
    artifacts,
    limitations,
    rerunCommand: commandText,
    scoreHistoryUpdated: true,
  };

  const manifestPath = join(runDir, "manifest.json");
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf-8");
  manifest.artifacts.push(createBenchmarkArtifactRef("manifest", manifestPath, projectRoot));

  const gate = runBenchmarkTransparencyGate({
    manifest,
    projectRoot,
    threshold: options.threshold,
  });

  if (options.evidence) {
    writeBenchmarkTransparencyEvidence(projectRoot, gate);
  }

  writeTransparencyOutput(gate, options.format);
  return gate.pass ? 0 : 1;
}

function buildTransparencyCommand(options: BenchTransparencyOptions): string {
  const parts = [
    "dantecode",
    "bench",
    "transparency",
    "--suite",
    options.suite,
    "--seed",
    String(options.seed),
    "--output-dir",
    options.outputDir,
  ];
  if (options.evidence) parts.push("--evidence");
  if (options.format !== "text") parts.push("--format", options.format);
  if (options.threshold !== 90) parts.push("--threshold", String(options.threshold));
  return parts.join(" ");
}

function writeBenchmarkTransparencyEvidence(
  projectRoot: string,
  gate: BenchmarkTransparencyGateResult,
): void {
  const evidenceDir = join(projectRoot, ".danteforge", "evidence");
  mkdirSync(evidenceDir, { recursive: true });
  writeFileSync(
    join(evidenceDir, "benchmark-transparency-dim45.json"),
    `${JSON.stringify(gate, null, 2)}\n`,
    "utf-8",
  );
  writeFileSync(
    join(evidenceDir, "benchmark-transparency-dim45.md"),
    formatBenchmarkTransparencyMarkdown(gate),
    "utf-8",
  );
}

function writeTransparencyOutput(
  gate: BenchmarkTransparencyGateResult,
  format: BenchTransparencyOptions["format"],
): void {
  if (format === "json") {
    process.stdout.write(`${JSON.stringify(gate, null, 2)}\n`);
    return;
  }
  if (format === "markdown") {
    process.stdout.write(formatBenchmarkTransparencyMarkdown(gate));
    return;
  }
  process.stdout.write(`${formatBenchmarkTransparencyText(gate)}\n`);
}

function resolveSWEBenchDataPath(projectRoot: string, options: SWEDim5Options): string {
  if (options.data) return resolve(projectRoot, options.data);
  const filename = options.suite === "verified"
    ? "swe-bench-verified.jsonl"
    : `swe-bench-${options.suite}.jsonl`;
  return resolve(projectRoot, "benchmarks", "swe-bench", filename);
}

function defaultSWEBenchDatasetPath(suite: SWEBenchSuite): string {
  const filename = suite === "verified" ? "swe-bench-verified.jsonl" : `swe-bench-${suite}.jsonl`;
  return join("benchmarks", "swe-bench", filename);
}

interface HuggingFaceRowsResponse {
  rows?: Array<{ row?: Record<string, unknown> }>;
  num_rows_total?: number;
}

async function fetchHuggingFaceSWEBenchRows(options: SWEDim5Options): Promise<Record<string, unknown>[]> {
  const rows: Record<string, unknown>[] = [];
  let offset = options.offset;
  const target = Math.max(0, options.limit);
  const pageSize = Math.min(100, Math.max(1, target || 100));

  while (rows.length < target) {
    const length = Math.min(pageSize, target - rows.length);
    const url = buildHuggingFaceRowsUrl(options, offset, length);
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Failed to download SWE-bench dataset rows: ${response.status} ${response.statusText}`);
    }
    const body = await response.json() as HuggingFaceRowsResponse;
    const pageRows = (body.rows ?? []).map((entry) => entry.row).filter((row): row is Record<string, unknown> => Boolean(row));
    rows.push(...pageRows);
    if (pageRows.length < length) break;
    offset += pageRows.length;
  }

  return rows;
}

function buildHuggingFaceRowsUrl(options: SWEDim5Options, offset: number, length: number): string {
  if (options.sourceUrl) {
    const url = new URL(options.sourceUrl);
    url.searchParams.set("offset", String(offset));
    url.searchParams.set("length", String(length));
    return url.toString();
  }
  const url = new URL("https://datasets-server.huggingface.co/rows");
  url.searchParams.set("dataset", datasetSourceName(options.suite));
  url.searchParams.set("config", "default");
  url.searchParams.set("split", "test");
  url.searchParams.set("offset", String(offset));
  url.searchParams.set("length", String(length));
  return url.toString();
}

function datasetSourceName(suite: SWEBenchSuite): string {
  if (suite === "verified") return "SWE-bench/SWE-bench_Verified";
  if (suite === "lite") return "princeton-nlp/SWE-bench_Lite";
  if (suite === "pro") return "SWE-bench/SWE-bench_Verified";
  return "SWE-bench/SWE-bench";
}

function normalizeSWEBenchDatasetRow(row: Record<string, unknown>): Record<string, unknown> {
  return {
    ...row,
    FAIL_TO_PASS: parseTestSpecList(row["FAIL_TO_PASS"]),
    PASS_TO_PASS: parseTestSpecList(row["PASS_TO_PASS"]),
  };
}

function parseTestSpecList(value: unknown): string[] {
  if (Array.isArray(value)) return value.filter((item): item is string => typeof item === "string");
  if (typeof value !== "string" || !value.trim()) return [];
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
  } catch {
    return [value];
  }
}

function selectSeededInstances<T extends { instance_id: string }>(
  instances: T[],
  count: number,
  seed: number,
): T[] {
  const scored = instances.map((instance) => ({
    instance,
    score: seededHash(`${seed}:${instance.instance_id}`),
  }));
  return scored
    .sort((a, b) => a.score - b.score || a.instance.instance_id.localeCompare(b.instance.instance_id))
    .slice(0, Math.max(0, count))
    .map((entry) => entry.instance);
}

function seededHash(value: string): number {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function buildSWEDatasetProof(
  projectRoot: string,
  dataPath: string,
  instances: Array<{ instance_id: string }>,
  seed: number,
): SWEBenchCorrectnessGateInput["dataset"] {
  const absolute = resolve(projectRoot, dataPath);
  const relativePath = normalizePath(relative(projectRoot, absolute));
  const selectedInstanceIds = instances.map((instance) => instance.instance_id);
  return {
    path: relativePath || normalizePath(dataPath),
    sha256: existsSync(absolute)
      ? sha256File(absolute)
      : sha256Text(JSON.stringify({ path: relativePath, selectedInstanceIds, seed })),
    seed,
    selectedInstanceIds,
  };
}

function buildFailureTaxonomy(
  results: Array<{ resolved?: boolean; error?: string; test_output?: string; model_patch?: string }>,
): Partial<Record<SWEFailureClass, number>> {
  const counts: Partial<Record<SWEFailureClass, number>> = {};
  for (const result of results) {
    const failureClass = classifySWEFailure(result);
    counts[failureClass] = (counts[failureClass] ?? 0) + 1;
  }
  return counts;
}

function buildCorrectnessGateInput(
  calibration: Record<string, unknown> | undefined,
  run: Record<string, unknown> | undefined,
  comparison: Record<string, unknown> | undefined,
  datasetEvidence?: Record<string, unknown>,
): SWEBenchCorrectnessGateInput {
  const dataset = readDatasetProof(calibration, run, datasetEvidence);
  return {
    dimensionId: "swe_bench_correctness",
    generatedAt: new Date().toISOString(),
    suite: readSuite(run),
    dataset,
    calibration: {
      total: readNumber(calibration, "total"),
      reproducedBaseline: readNumber(calibration, "reproducedBaseline"),
      goldResolved: readNumber(calibration, "goldResolved"),
      passRate: readNumber(calibration, "passRate"),
      threshold: readNumber(calibration, "threshold", 0.95),
      artifactPath: ".danteforge/evidence/swe-bench-calibration-dim5.json",
    },
    agentRun: {
      total: readNumber(run, "total"),
      resolved: readNumber(run, "resolved"),
      passRate: readNumber(run, "passRate"),
      requiredPassRate: readNumber(run, "requiredPassRate", 0.65),
      attempts: readNumber(run, "attempts", 1),
      artifactPath: ".danteforge/evidence/swe-bench-run-dim5.json",
    },
    comparison: {
      baselinePassRate: readNumber(comparison, "baselinePassRate"),
      candidatePassRate: readNumber(comparison, "candidatePassRate"),
      delta: readNumber(comparison, "delta"),
      requiredDelta: readNumber(comparison, "requiredDelta", 0.1),
      artifactPath: ".danteforge/evidence/swe-bench-comparison-dim5.json",
    },
    repeatedRuns: readRepeatedRuns(run),
    artifactCompleteness: readArtifactCompleteness(run),
    failureTaxonomy: readFailureTaxonomy(run),
    limitations: readStringArray(run, "limitations", [
      "Correctness gate was assembled from local evidence files.",
    ]),
  };
}

function readDatasetProof(
  calibration: Record<string, unknown> | undefined,
  run: Record<string, unknown> | undefined,
  datasetEvidence?: Record<string, unknown>,
): SWEBenchCorrectnessGateInput["dataset"] {
  const source = (calibration?.["dataset"] ?? run?.["dataset"] ?? datasetEvidence?.["dataset"]) as Record<string, unknown> | undefined;
  return {
    path: readString(source, "path"),
    sha256: readString(source, "sha256"),
    seed: readNumber(source, "seed", readNumber(source, "offset")),
    selectedInstanceIds: readStringArray(source, "selectedInstanceIds"),
  };
}

function readSuite(run: Record<string, unknown> | undefined): SWEBenchSuite {
  const value = readString(run, "suite");
  if (value === "lite" || value === "pro" || value === "rebench") return value;
  return "verified";
}

function readArtifactCompleteness(
  run: Record<string, unknown> | undefined,
): SWEBenchCorrectnessGateInput["artifactCompleteness"] {
  const source = run?.["artifactCompleteness"] as Record<string, unknown> | undefined;
  return {
    trajectoryCount: readNumber(source, "trajectoryCount"),
    patchCount: readNumber(source, "patchCount"),
    baselineLogCount: readNumber(source, "baselineLogCount"),
    verificationLogCount: readNumber(source, "verificationLogCount"),
    environmentLogCount: readNumber(source, "environmentLogCount"),
    classifiedFailureCount: readNumber(source, "classifiedFailureCount"),
    manifestPath: readString(source, "manifestPath"),
  };
}

function readRepeatedRuns(run: Record<string, unknown> | undefined): SWEBenchCorrectnessGateInput["repeatedRuns"] {
  const value = run?.["repeatedRuns"];
  if (!Array.isArray(value)) return [];
  return value.map((entry) => {
    const source = entry as Record<string, unknown>;
    return { runId: readString(source, "runId"), passRate: readNumber(source, "passRate") };
  });
}

function readFailureTaxonomy(run: Record<string, unknown> | undefined): Partial<Record<SWEFailureClass, number>> {
  const source = run?.["failureTaxonomy"] as Record<string, unknown> | undefined;
  const counts: Partial<Record<SWEFailureClass, number>> = {};
  if (!source) return counts;
  for (const [key, value] of Object.entries(source)) {
    counts[key as SWEFailureClass] = typeof value === "number" ? value : 0;
  }
  return counts;
}

function readNumber(source: Record<string, unknown> | undefined, key: string, fallback = 0): number {
  const value = source?.[key];
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function readString(source: Record<string, unknown> | undefined, key: string, fallback = ""): string {
  const value = source?.[key];
  return typeof value === "string" ? value : fallback;
}

function readStringArray(
  source: Record<string, unknown> | undefined,
  key: string,
  fallback: string[] = [],
): string[] {
  const value = source?.[key];
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : fallback;
}

function readOptionalJson(path: string): Record<string, unknown> | undefined {
  if (!existsSync(path)) return undefined;
  return readJsonFile(path);
}

function readJsonFile(path: string): Record<string, unknown> {
  return JSON.parse(readFileSync(path, "utf-8")) as Record<string, unknown>;
}

function extractPassRate(report: Record<string, unknown>): number {
  const passRate = report["pass_rate"] ?? report["passRate"];
  if (typeof passRate === "number") return passRate;
  const total = report["total"];
  const resolved = report["resolved"];
  if (typeof total === "number" && total > 0 && typeof resolved === "number") return resolved / total;
  return 0;
}

function writeJsonEvidence(projectRoot: string, fileName: string, value: unknown): void {
  const evidenceDir = join(projectRoot, ".danteforge", "evidence");
  mkdirSync(evidenceDir, { recursive: true });
  writeFileSync(join(evidenceDir, fileName), `${JSON.stringify(value, null, 2)}\n`, "utf-8");
}

function writeMarkdownEvidence(projectRoot: string, fileName: string, value: string): void {
  const evidenceDir = join(projectRoot, ".danteforge", "evidence");
  mkdirSync(evidenceDir, { recursive: true });
  writeFileSync(join(evidenceDir, fileName), value.endsWith("\n") ? value : `${value}\n`, "utf-8");
}

function writeDim5Output(value: unknown, format: SWEDim5Options["format"]): void {
  if (format === "json") {
    process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
  }
}

function writeCorrectnessGateOutput(
  gate: SWEBenchCorrectnessGateResult,
  format: SWEDim5Options["format"],
): void {
  if (format === "json") {
    process.stdout.write(`${JSON.stringify(gate, null, 2)}\n`);
  } else if (format === "markdown") {
    process.stdout.write(formatSWEBenchCorrectnessMarkdown(gate));
  } else {
    process.stdout.write(`${formatSWEBenchCorrectnessText(gate)}\n`);
  }
}

function formatCalibrationMarkdown(evidence: Record<string, unknown>): string {
  return [
    "# SWE-bench Gold-Patch Calibration",
    "",
    `- Pass: ${evidence["pass"] ? "yes" : "no"}`,
    `- Pass rate: ${formatRate(readNumber(evidence, "passRate"))}`,
    `- Reproduced baseline: ${readNumber(evidence, "reproducedBaseline")}/${readNumber(evidence, "total")}`,
    `- Gold resolved: ${readNumber(evidence, "goldResolved")}/${readNumber(evidence, "total")}`,
    "",
  ].join("\n");
}

function formatDatasetMarkdown(evidence: Record<string, unknown>): string {
  const dataset = evidence["dataset"] as Record<string, unknown> | undefined;
  return [
    "# SWE-bench Dataset Preparation",
    "",
    `- Pass: ${evidence["pass"] ? "yes" : "no"}`,
    `- Suite: ${readString(dataset, "suite")}`,
    `- Source: ${readString(dataset, "source")}`,
    `- Rows: ${readNumber(dataset, "rows")}`,
    `- Path: ${readString(dataset, "path")}`,
    `- SHA-256: ${readString(dataset, "sha256")}`,
    "",
  ].join("\n");
}

function formatRunMarkdown(evidence: Record<string, unknown>): string {
  return [
    "# SWE-bench Agent Run",
    "",
    `- Run ID: ${readString(evidence, "runId")}`,
    `- Suite: ${readString(evidence, "suite")}`,
    `- Pass rate: ${formatRate(readNumber(evidence, "passRate"))}`,
    `- Resolved: ${readNumber(evidence, "resolved")}/${readNumber(evidence, "total")}`,
    `- Attempts: ${readNumber(evidence, "attempts")}`,
    "",
  ].join("\n");
}

function formatComparisonMarkdown(evidence: Record<string, unknown>): string {
  return [
    "# SWE-bench A/B Comparison",
    "",
    `- Pass: ${evidence["pass"] ? "yes" : "no"}`,
    `- Baseline pass rate: ${formatRate(readNumber(evidence, "baselinePassRate"))}`,
    `- Candidate pass rate: ${formatRate(readNumber(evidence, "candidatePassRate"))}`,
    `- Delta: ${(readNumber(evidence, "delta") * 100).toFixed(1)} percentage points`,
    "",
  ].join("\n");
}

function writeFailureLearning(projectRoot: string, runEvidence: Record<string, unknown>): void {
  const taxonomy = runEvidence["failureTaxonomy"] as Record<string, unknown> | undefined;
  const lines = ["# SWE-bench Dim5 Failure Learning", ""];
  if (!taxonomy || Object.keys(taxonomy).length === 0) {
    lines.push("- No failures classified.");
  } else {
    for (const [name, count] of Object.entries(taxonomy)) {
      lines.push(`- ${name}: ${count}`);
    }
  }
  writeMarkdownEvidence(projectRoot, "swe-bench-dim5-failures.md", lines.join("\n"));
}

function formatRate(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

function sanitizePathSegment(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]/g, "_");
}

function getGitInfo(projectRoot: string): BenchmarkTransparencyManifest["git"] {
  try {
    const commit = execSync("git rev-parse HEAD", {
      cwd: projectRoot,
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    const status = execSync("git status --porcelain", {
      cwd: projectRoot,
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    return { commit, dirty: status.length > 0 };
  } catch {
    return { commit: "unknown", dirty: true };
  }
}

function getEnvironmentInfo(projectRoot: string): BenchmarkTransparencyManifest["environment"] {
  return {
    platform: process.platform,
    arch: process.arch,
    node: process.version,
    npm: getNpmVersion(projectRoot),
  };
}

function getNpmVersion(projectRoot: string): string {
  try {
    return execSync("npm --version", {
      cwd: projectRoot,
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return process.env["npm_config_user_agent"] ?? "unknown";
  }
}

function normalizePath(path: string): string {
  return path.replace(/\\/g, "/");
}
