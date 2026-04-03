import type { SWEBenchInstance } from "./dataset-loader.js";
import { loadSWEBenchDataset } from "./dataset-loader.js";
import type { RunResult, RunnerOptions } from "./instance-runner.js";
import { runInstance, runInstanceLocal } from "./instance-runner.js";
import type { ScoreResult } from "./scorer.js";
import { scoreResults } from "./scorer.js";

export interface HarnessOptions {
  /** Maximum number of instances to evaluate (default: all) */
  maxInstances?: number;
  /** Number of instances to run in parallel (default: 1) */
  parallel?: number;
  /** Use Docker-based runner (default: true) */
  useDocker?: boolean;
  /** Docker runner options */
  runnerOptions?: RunnerOptions;
  /** Agent function: given a problem statement and repo, return a patch string */
  agentFn: (problem: string, repo: string) => Promise<string>;
  /** Dataset loader options override */
  datasetOptions?: {
    cacheDir?: string;
    datasetName?: string;
    split?: string;
  };
}

export interface HarnessResult {
  score: ScoreResult;
  durationMs: number;
  instanceResults: RunResult[];
}

/**
 * Main SWE-bench harness orchestrator.
 *
 * 1. Loads the dataset (from cache or HuggingFace)
 * 2. Runs each instance through the provided agentFn to generate patches
 * 3. Executes each patch (Docker or local)
 * 4. Scores and returns aggregated results
 */
export async function runSWEBenchHarness(
  options: HarnessOptions,
): Promise<HarnessResult> {
  const startTime = Date.now();

  // Step 1: Load dataset
  const allInstances = await loadSWEBenchDataset(options.datasetOptions);

  // Apply maxInstances limit
  const instances =
    options.maxInstances !== undefined && options.maxInstances > 0
      ? allInstances.slice(0, options.maxInstances)
      : allInstances;

  // Step 2 + 3: Generate patches and execute them
  const parallel = options.parallel ?? 1;
  const useDocker = options.useDocker ?? true;
  const allResults: RunResult[] = [];

  if (parallel <= 1) {
    // Sequential execution
    for (const instance of instances) {
      const result = await processInstance(
        instance,
        options.agentFn,
        useDocker,
        options.runnerOptions,
      );
      allResults.push(result);
    }
  } else {
    // Parallel execution with concurrency limit
    const results = await runWithConcurrency(
      instances,
      (instance) =>
        processInstance(
          instance,
          options.agentFn,
          useDocker,
          options.runnerOptions,
        ),
      parallel,
    );
    allResults.push(...results);
  }

  // Step 4: Score results
  const score = scoreResults(allResults);

  return {
    score,
    durationMs: Date.now() - startTime,
    instanceResults: allResults,
  };
}

/**
 * Process a single SWE-bench instance:
 *   1. Call the agent to generate a patch
 *   2. Execute the patch
 */
async function processInstance(
  instance: SWEBenchInstance,
  agentFn: (problem: string, repo: string) => Promise<string>,
  useDocker: boolean,
  runnerOptions?: RunnerOptions,
): Promise<RunResult> {
  let patch: string;

  try {
    patch = await agentFn(instance.problem, instance.repo);
  } catch (err: unknown) {
    // Agent failed to produce a patch
    return {
      instanceId: instance.instanceId,
      status: "error",
      testOutput: `Agent error: ${err instanceof Error ? err.message : String(err)}`,
      patchApplied: false,
      durationMs: 0,
    };
  }

  try {
    if (useDocker) {
      return await runInstance(instance, patch, runnerOptions);
    }

    // Local execution needs a workDir
    const workDir = runnerOptions?.workDir ?? process.cwd();
    return await runInstanceLocal(instance, patch, workDir);
  } catch (err: unknown) {
    return {
      instanceId: instance.instanceId,
      status: "error",
      testOutput: `Runner error: ${err instanceof Error ? err.message : String(err)}`,
      patchApplied: false,
      durationMs: 0,
    };
  }
}

/**
 * Run async tasks with a concurrency limit.
 * Processes items from the array, keeping at most `limit` tasks in flight.
 */
async function runWithConcurrency<T, R>(
  items: T[],
  fn: (item: T) => Promise<R>,
  limit: number,
): Promise<R[]> {
  const results: R[] = new Array(items.length) as R[];
  let nextIndex = 0;

  async function worker(): Promise<void> {
    while (nextIndex < items.length) {
      const index = nextIndex++;
      const item = items[index];
      if (item !== undefined) {
        results[index] = await fn(item);
      }
    }
  }

  const workerCount = Math.min(limit, items.length);
  const workers: Promise<void>[] = [];
  for (let i = 0; i < workerCount; i++) {
    workers.push(worker());
  }

  await Promise.all(workers);
  return results;
}

// Re-export all types for convenient single-entry-point imports
export type {
  SWEBenchInstance,
  DatasetLoaderOptions,
} from "./dataset-loader.js";
export { loadSWEBenchDataset, getCacheDir } from "./dataset-loader.js";
export type { RunnerOptions, RunResult } from "./instance-runner.js";
export { runInstance, runInstanceLocal } from "./instance-runner.js";
export type { ScoreResult, ComparisonResult } from "./scorer.js";
export { scoreResults, compareRuns } from "./scorer.js";
