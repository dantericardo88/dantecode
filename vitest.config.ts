import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["packages/*/src/**/*.test.ts", "swe-bench/src/**/*.test.ts", "tests/**/*.test.ts"],
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
      ],
      exclude: ["**/*.test.ts", "**/*.d.ts", "**/index.ts"],
      reporter: ["text", "text-summary", "json-summary"],
      reportsDirectory: "./coverage",
      thresholds: {
        statements: 30,
        functions: 80,
        lines: 30,
      },
    },
  },
});
