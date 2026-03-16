import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    root: process.cwd(),
    include: ["src/**/*.test.ts"],
    exclude: ["**/node_modules/**", "**/dist/**"],
    coverage: {
      enabled: false,
    },
  },
});
