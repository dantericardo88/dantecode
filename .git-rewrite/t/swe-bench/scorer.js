export function scoreSWEBenchRun(result) {
  const passed = Boolean(result.patchApplied) && Boolean(result.testsPassed);
  return {
    instanceId: result.instanceId,
    passed,
    patchApplied: Boolean(result.patchApplied),
    testsPassed: Boolean(result.testsPassed),
    durationMs: result.durationMs ?? 0,
  };
}

export function summarizeSWEBenchRuns(results) {
  const passed = results.filter((result) => result.passed).length;
  return {
    total: results.length,
    passed,
    failed: results.length - passed,
    passRate: results.length === 0 ? 0 : passed / results.length,
  };
}
