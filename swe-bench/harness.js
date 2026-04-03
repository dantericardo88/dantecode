import { runSWEBenchInstance } from "./instance-runner.js";
import { scoreSWEBenchRun, summarizeSWEBenchRuns } from "./scorer.js";

export async function runSWEBenchEvaluation(instances, modelConfig, options = {}) {
  const rawResults = [];

  for (const instance of instances) {
    const result = await runSWEBenchInstance(instance, modelConfig, options);
    rawResults.push(result);
  }

  const scoredResults = rawResults.map((result) => scoreSWEBenchRun(result));
  return {
    modelConfig,
    useAutoforge: Boolean(options.useAutoforge),
    results: scoredResults,
    summary: summarizeSWEBenchRuns(scoredResults),
  };
}
