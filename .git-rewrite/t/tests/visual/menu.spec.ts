/**
 * Visual regression tests for Menu component
 *
 * Captures screenshots of all Menu modes and states
 */

import { test, expect } from "@playwright/test";

test.describe("Menu Component", () => {
  test("renders single-select menu", async ({ page }) => {
    await page.goto("/iframe.html?id=cli-components-menu--single-select&viewMode=story");
    await page.waitForSelector("div", { timeout: 5000 });

    await expect(page).toHaveScreenshot("menu-single-select.png");
  });

  test("renders multi-select menu", async ({ page }) => {
    await page.goto("/iframe.html?id=cli-components-menu--multi-select&viewMode=story");
    await page.waitForSelector("div", { timeout: 5000 });

    await expect(page).toHaveScreenshot("menu-multi-select.png");
  });

  test("renders menu with descriptions", async ({ page }) => {
    await page.goto("/iframe.html?id=cli-components-menu--with-descriptions&viewMode=story");
    await page.waitForSelector("div", { timeout: 5000 });

    await expect(page).toHaveScreenshot("menu-with-descriptions.png");
  });

  test("renders menu with disabled items", async ({ page }) => {
    await page.goto("/iframe.html?id=cli-components-menu--with-disabled-items&viewMode=story");
    await page.waitForSelector("div", { timeout: 5000 });

    await expect(page).toHaveScreenshot("menu-with-disabled.png");
  });

  test("renders long list menu", async ({ page }) => {
    await page.goto("/iframe.html?id=cli-components-menu--long-list&viewMode=story");
    await page.waitForSelector("div", { timeout: 5000 });

    await expect(page).toHaveScreenshot("menu-long-list.png");
  });

  test("renders filtered results menu", async ({ page }) => {
    await page.goto("/iframe.html?id=cli-components-menu--filtered-results&viewMode=story");
    await page.waitForSelector("div", { timeout: 5000 });

    await expect(page).toHaveScreenshot("menu-filtered.png");
  });
});
