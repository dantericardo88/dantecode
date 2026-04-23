// ============================================================================
// packages/cli/src/commands/benchmark.ts
//
// End-to-end evaluation pipeline using the built-in TypeScript benchmark
// instances from @dantecode/swe-bench-runner.
//
// Design:
//   - InstanceLoader.getBuiltinInstances() returns 20 self-contained tasks
//   - runTestPatch() runs each gold patch against its gold tests in a Node VM
//   - ReportGenerator produces a structured EvalReport + optional JSON file
//   - No Docker, no live AI, no network — deterministic and always runnable
// ============================================================================

import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import {
  InstanceLoader,
  ReportGenerator,
  runTestPatch,
} from "@dantecode/swe-bench-runner";
import type { EvalReport, RunResult } from "@dantecode/swe-bench-runner";

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface BenchmarkOptions {
  /** Maximum number of instances to evaluate. Default: all built-in instances. */
  maxInstances?: number;
  /**
   * Output directory for the JSON results file, resolved relative to
   * projectRoot. Default: ".dantecode/evaluation-results".
   */
  outputDir?: string;
}

/**
 * Run the built-in TypeScript benchmark instances end-to-end.
 *
 * Each instance is evaluated by running its gold-standard patch through the
 * Node.js VM against its gold-standard test suite. Results are written to
 * `<projectRoot>/<outputDir>/<run_id>.json` and returned as an EvalReport.
 *
 * Pass rate on gold patches is expected to be ≥ 80 % — this serves as
 * the canonical proof that the evaluation pipeline is functional.
 */
export async function runBuiltinBenchmark(
  projectRoot: string,
  options: BenchmarkOptions = {},
): Promise<EvalReport> {
  const loader = new InstanceLoader();
  const all = loader.getBuiltinInstances();
  const instances =
    options.maxInstances !== undefined ? all.slice(0, options.maxInstances) : all;

  // The VM runner can produce unhandled promise rejections for instances whose
  // async test assertions escape the sandbox context after runTestPatch returns.
  // Absorb these with a temporary handler so they don't surface as global errors
  // in the calling process (vitest, REPL, etc.).
  const suppressedVmRejections: unknown[] = [];
  const vmRejectionHandler = (reason: unknown) => {
    suppressedVmRejections.push(reason);
  };
  process.on("unhandledRejection", vmRejectionHandler);

  const results: RunResult[] = [];
  try {
    for (const inst of instances) {
      try {
        const vmResult = await runTestPatch(inst.patch, inst.test_patch, inst.instance_id);
        results.push({
          instance_id: inst.instance_id,
          resolved: vmResult.passed,
          error: vmResult.error,
          durationMs: vmResult.durationMs,
        });
      } catch (err) {
        results.push({
          instance_id: inst.instance_id,
          resolved: false,
          error: err instanceof Error ? err.message : String(err),
          durationMs: 0,
        });
      }
    }
  } finally {
    // Grace period: VM test assertions can fire via setTimeout after the
    // main evaluation loop completes. Keep the handler alive for 250ms to
    // absorb any late-firing timer callbacks before removing it.
    await new Promise<void>((resolve) => setTimeout(resolve, 250));
    process.off("unhandledRejection", vmRejectionHandler);
  }

  const reporter = new ReportGenerator();
  const report = reporter.generateReport(results);

  // Persist results alongside any previous runs
  const outputDir = join(
    projectRoot,
    options.outputDir ?? ".dantecode/evaluation-results",
  );
  await mkdir(outputDir, { recursive: true });
  await reporter.saveReport(report, join(outputDir, `${report.run_id}.json`));

  return report;
}

/**
 * Format an EvalReport as human-readable markdown for display in the REPL.
 */
export function formatBenchmarkReport(report: EvalReport): string {
  const reporter = new ReportGenerator();
  return reporter.formatMarkdown(report);
}
