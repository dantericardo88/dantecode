import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: [
      "packages/*/src/**/*.test.ts",
      "packages/*/tests/**/*.test.ts",
      "swe-bench/src/**/*.test.ts",
      "tests/**/*.test.ts",
    ],
    retry: 1,
    testTimeout: 30_000,
    coverage: {
      provider: "v8",
      // OSS v1 gates the stable runtime packages here. Preview/experimental
      // surfaces still run in `npm test`, but do not block these thresholds.
      include: [
        "packages/core/src/**/*.ts",
        "packages/danteforge/src/**/*.ts",
        "packages/git-engine/src/**/*.ts",
        "packages/mcp/src/**/*.ts",
        "packages/skill-adapter/src/**/*.ts",
        "packages/memory-engine/src/**/*.ts",
        "packages/ux-polish/src/**/*.ts",
        "packages/web-research/src/**/*.ts",
        "packages/web-extractor/src/**/*.ts",
        "packages/agent-orchestrator/src/**/*.ts",
      ],
      exclude: ["**/*.test.ts", "**/*.d.ts", "**/index.ts"],
      reporter: ["text", "text-summary", "json-summary"],
      reportsDirectory: "./coverage",
      thresholds: {
        statements: 30,
        functions: 80,
        lines: 30,
        "packages/memory-engine/src/**/*.ts": {
          statements: 70,
          functions: 70,
          lines: 70,
        },
        "packages/ux-polish/src/**/*.ts": {
          statements: 70,
          functions: 70,
          lines: 70,
        },
        // web-research and web-extractor are preview packages with thin test
        // coverage — thresholds reflect current actual coverage until
        // full integration tests are added.
        "packages/web-research/src/**/*.ts": {
          statements: 20,
          functions: 55,
          lines: 20,
        },
        "packages/web-extractor/src/**/*.ts": {
          statements: 20,
          functions: 55,
          lines: 20,
        },
        // agent-orchestrator functions coverage is 63% — set ceiling at 60%
        // until worker/worktree integration paths gain test coverage.
        "packages/agent-orchestrator/src/**/*.ts": {
          statements: 70,
          functions: 60,
          lines: 70,
        },
      },
    },
  },
});
