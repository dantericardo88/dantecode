// ============================================================================
// @dantecode/cli — Bench Command
// Run SWE-bench evaluation against DanteCode and report pass rate.
// ============================================================================

import { resolve } from "node:path";
import { writeFile, mkdir } from "node:fs/promises";
import {
  analyzeIssue,
  generateTestScaffold,
  TaoLoopManager,
  formatAnalyzedIssueForPrompt,
} from "@dantecode/core";
import type { IssueSignal, AnalyzedIssue } from "@dantecode/core";

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
): Promise<void> {
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
      "  -h, --help            Show this help",
      "",
    ].join("\n"));
    return;
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
}
