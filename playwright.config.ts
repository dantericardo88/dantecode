/**
 * Playwright configuration for visual regression testing
 *
 * Tests ux-polish Storybook components to prevent visual regressions
 */

import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/visual",

  // Maximum time one test can run for
  timeout: 30 * 1000,

  // Run tests in files in parallel
  fullyParallel: true,

  // Fail the build on CI if you accidentally left test.only in the source code
  forbidOnly: !!process.env.CI,

  // Retry on CI only
  retries: process.env.CI ? 2 : 0,

  // Opt out of parallel tests on CI
  workers: process.env.CI ? 1 : undefined,

  // Reporter to use
  reporter: "html",

  // Shared settings for all the projects below
  use: {
    // Base URL to use in actions like `await page.goto('/')`
    baseURL: "http://localhost:6006",

    // Collect trace when retrying the failed test
    trace: "on-first-retry",

    // Screenshot on failure
    screenshot: "only-on-failure",
  },

  // Configure projects for different browsers
  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 1280, height: 720 },
      },
    },
  ],

  // Run Storybook dev server before starting the tests
  webServer: {
    command: "npm run storybook --workspace=packages/ux-polish",
    url: "http://localhost:6006",
    reuseExistingServer: !process.env.CI,
    timeout: 120 * 1000, // 2 minutes for Storybook to start
  },
});
