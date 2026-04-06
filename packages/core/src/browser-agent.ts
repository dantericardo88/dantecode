// ============================================================================
// @dantecode/core — Browser Automation Agent (Playwright)
// Provides a structured interface for browser automation actions. Playwright is
// loaded dynamically as an optional dependency — all actions gracefully degrade
// when the package is not installed.
// ============================================================================

// ─── Public Interfaces ───────────────────────────────────────────────────────

export interface BrowserAction {
  type:
    | "goto"
    | "click"
    | "type"
    | "screenshot"
    | "accessibility_tree"
    | "scroll"
    | "wait"
    | "evaluate";
  url?: string;
  selector?: string;
  text?: string;
  direction?: "up" | "down";
  timeMs?: number;
  script?: string;
}

export interface BrowserActionResult {
  success: boolean;
  /** base64 for screenshots, text for accessibility tree, url for goto */
  data?: string;
  error?: string;
}

export interface VisionRouter {
  call(prompt: string, imageBase64?: string): Promise<string>;
}

export interface BrowserAgentOptions {
  headless?: boolean;
  timeout?: number;
  viewport?: { width: number; height: number };
  visionRouter?: VisionRouter;
}

// ─── Typed Internal Interfaces (avoid eslint `Function` type) ────────────────

interface PlaywrightAccessibilityNode {
  role: string;
  name: string;
  children?: PlaywrightAccessibilityNode[];
  value?: string;
  description?: string;
  checked?: boolean | "mixed";
  disabled?: boolean;
  expanded?: boolean;
  focused?: boolean;
  level?: number;
  pressed?: boolean | "mixed";
  selected?: boolean;
}

interface PlaywrightAccessibility {
  snapshot(): Promise<PlaywrightAccessibilityNode | null>;
}

interface PlaywrightMouse {
  click(x: number, y: number): Promise<void>;
}

interface PlaywrightPage {
  goto(url: string, options?: { timeout?: number; waitUntil?: string }): Promise<unknown>;
  click(selector: string, options?: { timeout?: number }): Promise<void>;
  fill(selector: string, value: string, options?: { timeout?: number }): Promise<void>;
  screenshot(options?: { fullPage?: boolean; type?: string }): Promise<Buffer>;
  evaluate(fn: string | ((...args: unknown[]) => unknown), ...args: unknown[]): Promise<unknown>;
  accessibility: PlaywrightAccessibility;
  mouse: PlaywrightMouse;
  close(): Promise<void>;
  url(): string;
}

interface PlaywrightBrowserContext {
  newPage(): Promise<PlaywrightPage>;
  close(): Promise<void>;
}

interface PlaywrightBrowser {
  newContext(options?: {
    viewport?: { width: number; height: number };
  }): Promise<PlaywrightBrowserContext>;
  close(): Promise<void>;
}

interface PlaywrightChromium {
  launch(options?: { headless?: boolean; timeout?: number }): Promise<PlaywrightBrowser>;
}

interface PlaywrightModule {
  chromium: PlaywrightChromium;
}

// ─── Constants ───────────────────────────────────────────────────────────────

const PLAYWRIGHT_NOT_INSTALLED =
  "Playwright is not installed. Run `npm install playwright` to enable browser automation.";

const DEFAULT_OPTIONS: Required<Omit<BrowserAgentOptions, "visionRouter">> = {
  headless: true,
  timeout: 30_000,
  viewport: { width: 1280, height: 720 },
};

const SCROLL_DISTANCE = 500;

// ─── URL validation ──────────────────────────────────────────────────────────

const URL_PATTERN = /^https?:\/\/.+/i;

function isValidUrl(url: string): boolean {
  if (!URL_PATTERN.test(url)) {
    return false;
  }
  try {
    new URL(url);
    return true;
  } catch {
    return false;
  }
}

// ─── Accessibility Tree Formatter ────────────────────────────────────────────

function flattenAccessibilityTree(node: PlaywrightAccessibilityNode, depth = 0): string {
  const indent = "  ".repeat(depth);
  const parts: string[] = [];

  let line = `${indent}${node.role}`;
  if (node.name) {
    line += ` "${node.name}"`;
  }
  if (node.value !== undefined) {
    line += ` value="${node.value}"`;
  }
  if (node.description) {
    line += ` description="${node.description}"`;
  }
  if (node.checked !== undefined) {
    line += ` checked=${String(node.checked)}`;
  }
  if (node.disabled) {
    line += " disabled";
  }
  if (node.expanded !== undefined) {
    line += ` expanded=${String(node.expanded)}`;
  }
  if (node.focused) {
    line += " focused";
  }
  if (node.level !== undefined) {
    line += ` level=${node.level}`;
  }
  if (node.pressed !== undefined) {
    line += ` pressed=${String(node.pressed)}`;
  }
  if (node.selected) {
    line += " selected";
  }

  parts.push(line);

  if (node.children) {
    for (const child of node.children) {
      parts.push(flattenAccessibilityTree(child, depth + 1));
    }
  }

  return parts.join("\n");
}

// ─── BrowserAgent ────────────────────────────────────────────────────────────

/**
 * Provides structured browser automation via Playwright. The Playwright
 * package is lazily loaded — if not installed, all actions return a clear
 * error message instead of throwing.
 *
 * Supports six actions: goto, click, type, screenshot, accessibility_tree,
 * and scroll. Screenshots are returned as base64-encoded strings.
 *
 * For testing, use the `_injectPage` helper to supply a mock page object
 * without requiring Playwright to be installed.
 */
export class BrowserAgent {
  private page: PlaywrightPage | null = null;
  private context: PlaywrightBrowserContext | null = null;
  private browser: PlaywrightBrowser | null = null;
  private playwrightAvailable: boolean | null = null;
  private visionRouter: VisionRouter | null = null;
  readonly options: Required<Omit<BrowserAgentOptions, "visionRouter">>;

  constructor(options?: BrowserAgentOptions) {
    this.options = {
      headless: options?.headless ?? DEFAULT_OPTIONS.headless,
      timeout: options?.timeout ?? DEFAULT_OPTIONS.timeout,
      viewport: options?.viewport
        ? { width: options.viewport.width, height: options.viewport.height }
        : { ...DEFAULT_OPTIONS.viewport },
    };
    this.visionRouter = options?.visionRouter ?? null;
  }

  // ─── Execute Dispatcher ──────────────────────────────────────────────

  /**
   * Execute a browser action. Dispatches to the correct method based on
   * `action.type`. Returns an error result for unrecognised action types.
   */
  async execute(action: BrowserAction): Promise<BrowserActionResult> {
    switch (action.type) {
      case "goto":
        return this.goto(action.url ?? "");
      case "click":
        return this.click(action.selector ?? "");
      case "type":
        return this.type(action.selector ?? "", action.text ?? "");
      case "screenshot":
        return this.screenshot();
      case "accessibility_tree":
        return this.getAccessibilityTree();
      case "scroll":
        return this.scroll(action.direction ?? "down");
      case "wait":
        return this.wait(
          action.timeMs ?? Math.max(1000, action.text ? parseInt(action.text) : 1000),
        );
      case "evaluate":
        return this.evaluate(action.script ?? "return null;");
      default: {
        const unknownType = (action as { type: string }).type;
        return { success: false, error: `Unknown action type: ${unknownType}` };
      }
    }
  }

  // ─── Individual Actions ──────────────────────────────────────────────

  /**
   * Navigate to a URL. Validates that the URL starts with http(s)://.
   */
  async goto(url: string): Promise<BrowserActionResult> {
    if (!url) {
      return { success: false, error: "URL is required for goto action" };
    }
    if (!isValidUrl(url)) {
      return { success: false, error: `Invalid URL: ${url}. Must start with http:// or https://` };
    }

    const page = await this.ensurePage();
    if (!page) {
      return { success: false, error: PLAYWRIGHT_NOT_INSTALLED };
    }

    try {
      await page.goto(url, { timeout: this.options.timeout, waitUntil: "domcontentloaded" });
      return { success: true, data: page.url() };
    } catch (err: unknown) {
      return { success: false, error: `Navigation failed: ${errorMessage(err)}` };
    }
  }

  /**
   * Click an element identified by a CSS selector. When a `visionRouter` is
   * configured, a failed selector click automatically falls back to a
   * screenshot-based LLM vision lookup that returns coordinates.
   */
  async click(selector: string): Promise<BrowserActionResult> {
    if (!selector || !selector.trim()) {
      return { success: false, error: "Selector is required for click action" };
    }

    const page = await this.ensurePage();
    if (!page) {
      return { success: false, error: PLAYWRIGHT_NOT_INSTALLED };
    }

    if (this.visionRouter) {
      try {
        const result = await this.clickWithVisionFallback(page, selector);
        return { success: true, data: selector, ...result };
      } catch (err: unknown) {
        return { success: false, error: `Click failed on "${selector}": ${errorMessage(err)}` };
      }
    }

    try {
      await page.click(selector, { timeout: this.options.timeout });
      return { success: true, data: selector };
    } catch (err: unknown) {
      return { success: false, error: `Click failed on "${selector}": ${errorMessage(err)}` };
    }
  }

  /**
   * Type text into an element identified by a CSS selector.
   * Uses Playwright's `fill()` which clears the field first. When a
   * `visionRouter` is configured and the selector fails, falls back to
   * vision-based coordinate click followed by fill on `:focus`.
   */
  async type(selector: string, text: string): Promise<BrowserActionResult> {
    if (!selector || !selector.trim()) {
      return { success: false, error: "Selector is required for type action" };
    }
    if (text === undefined || text === null) {
      return { success: false, error: "Text is required for type action" };
    }

    const page = await this.ensurePage();
    if (!page) {
      return { success: false, error: PLAYWRIGHT_NOT_INSTALLED };
    }

    if (this.visionRouter) {
      try {
        const result = await this.typeWithVisionFallback(page, selector, text);
        return { success: true, data: text, ...result };
      } catch (err: unknown) {
        return {
          success: false,
          error: `Type failed on "${selector}": ${errorMessage(err)}`,
        };
      }
    }

    try {
      await page.fill(selector, text, { timeout: this.options.timeout });
      return { success: true, data: text };
    } catch (err: unknown) {
      return {
        success: false,
        error: `Type failed on "${selector}": ${errorMessage(err)}`,
      };
    }
  }

  /**
   * Take a screenshot of the current page. Returns the image as a
   * base64-encoded PNG string.
   */
  async screenshot(): Promise<BrowserActionResult> {
    const page = await this.ensurePage();
    if (!page) {
      return { success: false, error: PLAYWRIGHT_NOT_INSTALLED };
    }

    try {
      const buffer = await page.screenshot({ fullPage: false, type: "png" });
      const base64 = Buffer.from(buffer).toString("base64");
      return { success: true, data: base64 };
    } catch (err: unknown) {
      return { success: false, error: `Screenshot failed: ${errorMessage(err)}` };
    }
  }

  /**
   * Capture the accessibility tree of the current page and return it as
   * indented text. Useful for AI agents that need to understand page structure
   * without relying on vision.
   */
  async getAccessibilityTree(): Promise<BrowserActionResult> {
    const page = await this.ensurePage();
    if (!page) {
      return { success: false, error: PLAYWRIGHT_NOT_INSTALLED };
    }

    try {
      const snapshot = await page.accessibility.snapshot();
      if (!snapshot) {
        return { success: true, data: "(empty accessibility tree)" };
      }
      const text = flattenAccessibilityTree(snapshot);
      return { success: true, data: text };
    } catch (err: unknown) {
      return {
        success: false,
        error: `Accessibility tree capture failed: ${errorMessage(err)}`,
      };
    }
  }

  /**
   * Scroll the page in the given direction.
   */
  async scroll(direction: "up" | "down"): Promise<BrowserActionResult> {
    if (direction !== "up" && direction !== "down") {
      return {
        success: false,
        error: `Invalid scroll direction: ${String(direction)}. Must be "up" or "down"`,
      };
    }

    const page = await this.ensurePage();
    if (!page) {
      return { success: false, error: PLAYWRIGHT_NOT_INSTALLED };
    }

    const distance = direction === "down" ? SCROLL_DISTANCE : -SCROLL_DISTANCE;
    try {
      await page.evaluate(`window.scrollBy(0, ${distance})`);
      return { success: true, data: direction };
    } catch (err: unknown) {
      return { success: false, error: `Scroll failed: ${errorMessage(err)}` };
    }
  }

  /**
   * Wait for a specified number of milliseconds (stagehand-style pre-action delay).
   */
  async wait(ms: number): Promise<BrowserActionResult> {
    const page = await this.ensurePage();
    if (!page) {
      return { success: false, error: PLAYWRIGHT_NOT_INSTALLED };
    }

    try {
      await new Promise((r) => setTimeout(r, ms));
      return { success: true, data: `Waited ${ms}ms` };
    } catch (err: unknown) {
      return { success: false, error: `Wait failed: ${errorMessage(err)}` };
    }
  }

  /**
   * Evaluate a custom script in the browser context (stagehand-style pre-action).
   */
  async evaluate(script: string): Promise<BrowserActionResult> {
    const page = await this.ensurePage();
    if (!page) {
      return { success: false, error: PLAYWRIGHT_NOT_INSTALLED };
    }

    try {
      const result = await page.evaluate(script);
      return { success: true, data: typeof result === "string" ? result : JSON.stringify(result) };
    } catch (err: unknown) {
      return { success: false, error: `Script evaluation failed: ${errorMessage(err)}` };
    }
  }

  // ─── Vision Fallback ─────────────────────────────────────────────────

  /**
   * Attempt a selector-based click, falling back to screenshot + LLM vision
   * when the selector fails. Requires `this.visionRouter` to be set.
   */
  private async clickWithVisionFallback(
    page: PlaywrightPage,
    selector: string,
  ): Promise<{ method: string }> {
    // Step 1: Try normal selector click
    try {
      await page.click(selector, { timeout: 5000 });
      return { method: "selector" };
    } catch {
      // Selector click failed — fall through to vision
    }

    // Step 2: No vision router means we cannot recover
    if (!this.visionRouter) {
      throw new Error(`Element not found: ${selector} (no vision fallback available)`);
    }

    // Step 3: Take screenshot and ask LLM for coordinates
    const coords = await this.locateElementViaVision(page, selector);

    // Step 4: Click at the coordinates
    await page.mouse.click(coords.x, coords.y);
    return { method: "vision" };
  }

  /**
   * Attempt a selector-based fill, falling back to vision-located click +
   * fill on the focused element when the selector fails.
   */
  private async typeWithVisionFallback(
    page: PlaywrightPage,
    selector: string,
    text: string,
  ): Promise<{ method: string }> {
    // Step 1: Try normal selector fill
    try {
      await page.fill(selector, text, { timeout: 5000 });
      return { method: "selector" };
    } catch {
      // Selector fill failed — fall through to vision
    }

    // Step 2: No vision router means we cannot recover
    if (!this.visionRouter) {
      throw new Error(`Element not found: ${selector} (no vision fallback available)`);
    }

    // Step 3: Locate via vision and click to focus
    const coords = await this.locateElementViaVision(page, selector);
    await page.mouse.click(coords.x, coords.y);

    // Step 4: Fill the now-focused element
    try {
      await page.fill(":focus", text, { timeout: 5000 });
    } catch {
      // If :focus fill fails, fall back to the original selector as a last resort
      await page.fill(selector, text, { timeout: 5000 });
    }
    return { method: "vision" };
  }

  /**
   * Take a screenshot and ask the vision router to locate an element.
   * Returns the {x, y} coordinates of the element's center.
   */
  private async locateElementViaVision(
    page: PlaywrightPage,
    selector: string,
  ): Promise<{ x: number; y: number }> {
    const screenshotBuffer = await page.screenshot({ type: "png" });
    const base64 = Buffer.from(screenshotBuffer).toString("base64");

    const prompt =
      `You are looking at a screenshot of a web page. Find the element that matches ` +
      `this description or selector: "${selector}". Return ONLY a JSON object with the ` +
      `x,y coordinates of the center of the element: {"x": number, "y": number}. ` +
      `If you cannot find it, return {"x": -1, "y": -1}.`;

    const response = await this.visionRouter!.call(prompt, base64);

    const match = response.match(/\{[^}]*"x"\s*:\s*(-?\d+)[^}]*"y"\s*:\s*(-?\d+)[^}]*/);
    if (!match) {
      throw new Error(`Vision fallback: could not parse LLM response for "${selector}"`);
    }

    const x = parseInt(match[1]!, 10);
    const y = parseInt(match[2]!, 10);

    if (x < 0 || y < 0) {
      throw new Error(`Vision fallback: element "${selector}" not found in screenshot`);
    }

    return { x, y };
  }

  // ─── Lifecycle ───────────────────────────────────────────────────────

  /**
   * Close the browser and release all resources. Safe to call even when
   * no browser has been launched.
   */
  async close(): Promise<void> {
    try {
      if (this.page) {
        await this.page.close();
      }
    } catch {
      // Swallow close errors — the page may already be gone
    }
    try {
      if (this.context) {
        await this.context.close();
      }
    } catch {
      // Swallow close errors
    }
    try {
      if (this.browser) {
        await this.browser.close();
      }
    } catch {
      // Swallow close errors
    }
    this.page = null;
    this.context = null;
    this.browser = null;
  }

  // ─── Test Helpers ────────────────────────────────────────────────────

  /**
   * Inject a mock page for testing. Bypasses the Playwright launch sequence
   * entirely, allowing unit tests to exercise all action methods without
   * requiring the playwright package.
   *
   * @internal — intended for tests only.
   */
  _injectPage(mockPage: PlaywrightPage): void {
    this.page = mockPage;
    this.playwrightAvailable = true;
  }

  // ─── Private ─────────────────────────────────────────────────────────

  /**
   * Ensure a browser page is ready. Lazy-loads Playwright on first call.
   * Returns null if Playwright is not installed, caching the result so
   * the dynamic import is only attempted once.
   */
  private async ensurePage(): Promise<PlaywrightPage | null> {
    if (this.page) {
      return this.page;
    }

    // If we've already determined Playwright is unavailable, fast-exit
    if (this.playwrightAvailable === false) {
      return null;
    }

    try {
      const module = "playwright";
      const pw = (await import(/* webpackIgnore: true */ module)) as unknown as PlaywrightModule;
      this.playwrightAvailable = true;

      this.browser = await pw.chromium.launch({
        headless: this.options.headless,
        timeout: this.options.timeout,
      });

      this.context = await this.browser.newContext({
        viewport: this.options.viewport,
      });

      this.page = await this.context.newPage();
      return this.page;
    } catch {
      this.playwrightAvailable = false;
      return null;
    }
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
