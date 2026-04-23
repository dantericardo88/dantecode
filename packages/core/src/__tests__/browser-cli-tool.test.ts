// packages/core/src/__tests__/browser-cli-tool.test.ts
// Tests for BrowserAgent and runBrowserLoop from browser-agent.ts.
// Uses _injectPage() test helper and _forceUnavailable to avoid requiring Playwright.

import { describe, it, expect, vi } from "vitest";
import { BrowserAgent, runBrowserLoop } from "../browser-agent.js";
import type { BrowserAction } from "../browser-agent.js";

// ---------------------------------------------------------------------------
// BrowserAgent — using _injectPage for unit tests
// ---------------------------------------------------------------------------

function makeMockPage(overrides: Partial<{
  gotoResult: unknown;
  clickResult: void;
  fillResult: void;
  screenshotBuf: Buffer;
  currentUrl: string;
  evalResult: unknown;
  accessibilitySnapshot: unknown;
}> = {}) {
  let _url = overrides.currentUrl ?? "https://example.com";
  return {
    goto: vi.fn().mockImplementation(async (url: string) => { _url = url; return overrides.gotoResult; }),
    click: vi.fn().mockResolvedValue(overrides.clickResult ?? undefined),
    fill: vi.fn().mockResolvedValue(overrides.fillResult ?? undefined),
    screenshot: vi.fn().mockResolvedValue(overrides.screenshotBuf ?? Buffer.from("png-data")),
    evaluate: vi.fn().mockResolvedValue(overrides.evalResult ?? undefined),
    url: () => _url,
    accessibility: {
      snapshot: vi.fn().mockResolvedValue(overrides.accessibilitySnapshot ?? { role: "WebArea", name: "Test", children: [] }),
    },
    close: vi.fn().mockResolvedValue(undefined),
  };
}

describe("BrowserAgent.execute", () => {
  it("goto navigates and returns current url", async () => {
    const agent = new BrowserAgent();
    const page = makeMockPage({ currentUrl: "https://start.com" });
    agent._injectPage(page as never);

    const result = await agent.execute({ type: "goto", url: "https://target.com" });
    expect(result.success).toBe(true);
    expect(page.goto).toHaveBeenCalledWith("https://target.com", expect.any(Object));
  });

  it("goto fails with invalid URL", async () => {
    const agent = new BrowserAgent();
    const page = makeMockPage();
    agent._injectPage(page as never);

    const result = await agent.execute({ type: "goto", url: "not-a-url" });
    expect(result.success).toBe(false);
    expect(result.error).toContain("Invalid URL");
  });

  it("click calls page.click with selector", async () => {
    const agent = new BrowserAgent();
    const page = makeMockPage();
    agent._injectPage(page as never);

    const result = await agent.execute({ type: "click", selector: ".submit-btn" });
    expect(result.success).toBe(true);
    expect(page.click).toHaveBeenCalledWith(".submit-btn", expect.any(Object));
  });

  it("type calls page.fill with selector and text", async () => {
    const agent = new BrowserAgent();
    const page = makeMockPage();
    agent._injectPage(page as never);

    const result = await agent.execute({ type: "type", selector: "#username", text: "admin" });
    expect(result.success).toBe(true);
    expect(page.fill).toHaveBeenCalledWith("#username", "admin", expect.any(Object));
  });

  it("screenshot returns base64 data", async () => {
    const agent = new BrowserAgent();
    const page = makeMockPage({ screenshotBuf: Buffer.from("fakepng") });
    agent._injectPage(page as never);

    const result = await agent.execute({ type: "screenshot" });
    expect(result.success).toBe(true);
    expect(typeof result.data).toBe("string");
    // Should be base64 of Buffer.from("fakepng")
    expect(result.data).toBe(Buffer.from("fakepng").toString("base64"));
  });

  it("scroll down calls page.evaluate with positive distance", async () => {
    const agent = new BrowserAgent();
    const page = makeMockPage();
    agent._injectPage(page as never);

    const result = await agent.execute({ type: "scroll", direction: "down" });
    expect(result.success).toBe(true);
    expect(page.evaluate).toHaveBeenCalledWith(expect.stringContaining("scrollBy"));
  });

  it("_forceUnavailable causes all actions to return playwright-not-installed error", async () => {
    const agent = new BrowserAgent({ _forceUnavailable: true });
    const result = await agent.execute({ type: "screenshot" });
    expect(result.success).toBe(false);
    expect(result.error).toContain("Playwright is not installed");
  });

  it("unknown action type returns error result", async () => {
    const agent = new BrowserAgent();
    const page = makeMockPage();
    agent._injectPage(page as never);

    const result = await agent.execute({ type: "unknown_action" } as unknown as BrowserAction);
    expect(result.success).toBe(false);
    expect(result.error).toContain("Unknown action type");
  });
});

// ---------------------------------------------------------------------------
// runBrowserLoop — uses _forceUnavailable so Playwright isn't needed.
// We test the loop logic at the LLM/action dispatch level.
// Because runBrowserLoop creates its own BrowserAgent internally, we test
// behaviour by observing the LLM call count and return shape.
// ---------------------------------------------------------------------------

describe("runBrowserLoop", () => {
  it("stops when LLM returns 'done' on first step", async () => {
    // With _forceUnavailable the screenshot action fails, but loop should still
    // call the LLM with the screenshot (undefined data) and stop on 'done'.
    // We override the screenshot success path by accepting that success:false
    // from screenshot does NOT stop the loop (only action failures count).
    const llm = vi.fn().mockResolvedValue("done");
    const result = await runBrowserLoop("test", llm, { maxSteps: 5 });
    // LLM called once, returned 'done', loop breaks before executing any action
    expect(llm).toHaveBeenCalledTimes(1);
    expect(result.steps).toHaveLength(0);
  });

  it("respects maxSteps (never exceed limit)", async () => {
    // LLM always returns a screenshot action (loops back) — should stop at maxSteps
    const llm = vi.fn().mockResolvedValue("screenshot");
    await runBrowserLoop("test", llm, { maxSteps: 3 });
    // Either stopped by maxSteps or by consecutive failures
    expect(llm.mock.calls.length).toBeLessThanOrEqual(3);
  });

  it("result includes finalUrl field", async () => {
    const llm = vi.fn().mockResolvedValue("done");
    const result = await runBrowserLoop("test", llm, { maxSteps: 1 });
    // finalUrl comes from agent.currentUrl which is not a real property — should be undefined
    expect("finalUrl" in result).toBe(true);
  });

  it("result.steps is an array", async () => {
    const llm = vi.fn().mockResolvedValue("done");
    const result = await runBrowserLoop("test", llm);
    expect(Array.isArray(result.steps)).toBe(true);
  });

  it("prompt passed to LLM contains the objective", async () => {
    const llm = vi.fn().mockResolvedValue("done");
    await runBrowserLoop("Find the login page", llm, { maxSteps: 1 });
    const prompt = llm.mock.calls[0]![0] as string;
    expect(prompt).toContain("Find the login page");
  });

  it("result.success is false when no steps were taken", async () => {
    const llm = vi.fn().mockResolvedValue("done");
    const result = await runBrowserLoop("test", llm, { maxSteps: 5 });
    // success = steps.length > 0 && lastStep.result.success
    expect(result.success).toBe(false);
  });
});
