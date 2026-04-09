/** @type {import('@stryker-mutator/core').PartialStrykerOptions} */
export default {
  packageManager: "npm",
  testRunner: "vitest",
  mutate: [
    "packages/core/src/completion-gate.ts",
    "packages/core/src/convergence-metrics.ts",
    "packages/core/src/error-helper.ts",
    "packages/core/src/context-budget.ts"
  ],
  thresholds: { high: 60, low: 50, break: 0 },
  coverageAnalysis: "perTest",
  vitest: {
    configFile: "packages/core/vitest.config.ts"
  }
};
