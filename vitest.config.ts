import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["packages/*/src/**/*.test.ts"],
    coverage: {
      provider: "v8",
      // OSS v1 gates the stable runtime packages here. Preview/beta surfaces
      // still run in `npm test`, but do not block release coverage thresholds.
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
        statements: 30,
        functions: 85,
        lines: 30,
      },
    },
  },
});
