/**
 * Visual regression tests for Spinner component
 *
 * Captures screenshots of all Spinner states and compares against baselines
 */

import { test, expect } from "@playwright/test";

test.describe("Spinner Component", () => {
  test("renders default spinner", async ({ page }) => {
    await page.goto("/iframe.html?id=cli-components-spinner--default&viewMode=story");
    await page.waitForSelector("pre", { timeout: 5000 });

    // Wait for spinner to render
    await page.waitForTimeout(1000);

    await expect(page).toHaveScreenshot("spinner-default.png");
  });

  test("renders success state", async ({ page }) => {
    await page.goto("/iframe.html?id=cli-components-spinner--success&viewMode=story");
    await page.waitForSelector("pre", { timeout: 5000 });

    // Wait for success animation to complete
    await page.waitForTimeout(2500);

    await expect(page).toHaveScreenshot("spinner-success.png");
  });

  test("renders error state", async ({ page }) => {
    await page.goto("/iframe.html?id=cli-components-spinner--error&viewMode=story");
    await page.waitForSelector("pre", { timeout: 5000 });

    // Wait for error animation
    await page.waitForTimeout(2500);

    await expect(page).toHaveScreenshot("spinner-error.png");
  });

  test("renders warning state", async ({ page }) => {
    await page.goto("/iframe.html?id=cli-components-spinner--warning&viewMode=story");
    await page.waitForSelector("pre", { timeout: 5000 });

    // Wait for warning animation
    await page.waitForTimeout(2500);

    await expect(page).toHaveScreenshot("spinner-warning.png");
  });

  test("renders line spinner", async ({ page }) => {
    await page.goto("/iframe.html?id=cli-components-spinner--line-spinner&viewMode=story");
    await page.waitForSelector("pre", { timeout: 5000 });

    await page.waitForTimeout(1000);

    await expect(page).toHaveScreenshot("spinner-line.png");
  });

  test("renders arrow spinner", async ({ page }) => {
    await page.goto("/iframe.html?id=cli-components-spinner--arrow-spinner&viewMode=story");
    await page.waitForSelector("pre", { timeout: 5000 });

    await page.waitForTimeout(1000);

    await expect(page).toHaveScreenshot("spinner-arrow.png");
  });

  test("renders circle spinner", async ({ page }) => {
    await page.goto("/iframe.html?id=cli-components-spinner--circle-spinner&viewMode=story");
    await page.waitForSelector("pre", { timeout: 5000 });

    await page.waitForTimeout(1000);

    await expect(page).toHaveScreenshot("spinner-circle.png");
  });
});
