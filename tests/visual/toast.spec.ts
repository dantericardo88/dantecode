/**
 * Visual regression tests for Toast component
 *
 * Captures screenshots of all Toast levels and states
 */

import { test, expect } from "@playwright/test";

test.describe("Toast Component", () => {
  test("renders info toast", async ({ page }) => {
    await page.goto("/iframe.html?id=cli-components-toast--info&viewMode=story");
    await page.waitForSelector("pre", { timeout: 5000 });

    await expect(page).toHaveScreenshot("toast-info.png");
  });

  test("renders success toast", async ({ page }) => {
    await page.goto("/iframe.html?id=cli-components-toast--success&viewMode=story");
    await page.waitForSelector("pre", { timeout: 5000 });

    await expect(page).toHaveScreenshot("toast-success.png");
  });

  test("renders warning toast", async ({ page }) => {
    await page.goto("/iframe.html?id=cli-components-toast--warning&viewMode=story");
    await page.waitForSelector("pre", { timeout: 5000 });

    await expect(page).toHaveScreenshot("toast-warning.png");
  });

  test("renders error toast", async ({ page }) => {
    await page.goto("/iframe.html?id=cli-components-toast--error&viewMode=story");
    await page.waitForSelector("pre", { timeout: 5000 });

    await expect(page).toHaveScreenshot("toast-error.png");
  });

  test("renders toast with action", async ({ page }) => {
    await page.goto("/iframe.html?id=cli-components-toast--with-action&viewMode=story");
    await page.waitForSelector("pre", { timeout: 5000 });

    await expect(page).toHaveScreenshot("toast-with-action.png");
  });

  test("renders persistent toast", async ({ page }) => {
    await page.goto("/iframe.html?id=cli-components-toast--persistent&viewMode=story");
    await page.waitForSelector("pre", { timeout: 5000 });

    await expect(page).toHaveScreenshot("toast-persistent.png");
  });

  test("renders auto-dismiss toast", async ({ page }) => {
    await page.goto("/iframe.html?id=cli-components-toast--auto-dismiss&viewMode=story");
    await page.waitForSelector("pre", { timeout: 5000 });

    // Capture before auto-dismiss
    await expect(page).toHaveScreenshot("toast-auto-dismiss.png");
  });
});
