import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["packages/*/src/**/*.test.ts"],
    coverage: {
      provider: "v8",
      include: [
        "packages/core/src/**/*.ts",
        "packages/danteforge/src/**/*.ts",
        "packages/git-engine/src/**/*.ts",
        "packages/skill-adapter/src/**/*.ts",
      ],
      exclude: ["**/*.test.ts", "**/*.d.ts", "**/index.ts"],
      reporter: ["text", "text-summary", "json-summary"],
      reportsDirectory: "./coverage",
      thresholds: {
        statements: 90,
        functions: 95,
        lines: 90,
      },
    },
  },
});
