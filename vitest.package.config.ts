import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    root: process.cwd(),
    include: ["src/**/*.test.ts"],
    exclude: ["**/node_modules/**", "**/dist/**"],
    // Retry once on failure — catches timing-sensitive tests that flake under
    // parallel turbo load (temp-dir contention, setInterval races, etc.)
    setupFiles: ["../../test-setup.ts"],
    retry: 1,
    testTimeout: 30_000,
    coverage: {
      enabled: false,
    },
  },
});
