// ============================================================================
// packages/vscode/src/__tests__/browser-tool.test.ts
// Tests for browser-tool.ts — Playwright browser automation
// All playwright interaction is mocked; no real browser is opened.
// ============================================================================

import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Mock playwright entirely ────────────────────────────────────────────────
// Capture mock refs here so tests can inspect calls without re-importing playwright.

const mockPage = {
  setViewportSize: vi.fn(),
  goto: vi.fn().mockResolvedValue(undefined),
  mouse: { click: vi.fn().mockResolvedValue(undefined) },
  keyboard: { type: vi.fn().mockResolvedValue(undefined) },
  screenshot: vi.fn().mockResolvedValue(Buffer.from("fakepng")),
  waitForTimeout: vi.fn().mockResolvedValue(undefined),
  url: vi.fn().mockReturnValue("https://example.com"),
  on: vi.fn(),
};

const mockBrowser = {
  newPage: vi.fn().mockResolvedValue(mockPage),
  close: vi.fn().mockResolvedValue(undefined),
};

const mockChromium = {
  launch: vi.fn().mockResolvedValue(mockBrowser),
};

vi.mock("playwright", () => ({
  chromium: mockChromium,
}));

// ── Subject under test ──────────────────────────────────────────────────────

import { BrowserSession } from "../browser-tool.js";

// ── Setup ────────────────────────────────────────────────────────────────────

let session: BrowserSession;

beforeEach(() => {
  session = new BrowserSession();
  vi.clearAllMocks();
  // Reset mock implementations after clearAllMocks
  mockPage.goto.mockResolvedValue(undefined);
  mockPage.mouse.click.mockResolvedValue(undefined);
  mockPage.keyboard.type.mockResolvedValue(undefined);
  mockPage.screenshot.mockResolvedValue(Buffer.from("fakepng"));
  mockPage.url.mockReturnValue("https://example.com");
  mockBrowser.newPage.mockResolvedValue(mockPage);
  mockBrowser.close.mockResolvedValue(undefined);
  mockChromium.launch.mockResolvedValue(mockBrowser);
});

// ── Tests ───────────────────────────────────────────────────────────────────

describe("BrowserSession", () => {
  it("1. isActive returns false before launch", () => {
    expect(session.isActive).toBe(false);
  });

  it("2. execute({ action: 'launch' }) sets isActive to true", async () => {
    await session.execute({ action: "launch" });
    expect(session.isActive).toBe(true);
  });

  it("3. execute({ action: 'screenshot' }) returns non-null base64 string after launch", async () => {
    await session.execute({ action: "launch" });
    const result = await session.execute({ action: "screenshot" });
    expect(result.screenshot).not.toBeNull();
    expect(typeof result.screenshot).toBe("string");
    // base64 of Buffer.from("fakepng")
    expect(result.screenshot).toBe(Buffer.from("fakepng").toString("base64"));
  });

  it("4. execute({ action: 'navigate', url }) calls page.goto with correct url", async () => {
    await session.execute({ action: "launch" });
    await session.execute({ action: "navigate", url: "https://example.com" });

    expect(mockPage.goto).toHaveBeenCalledWith("https://example.com", {
      waitUntil: "domcontentloaded",
      timeout: 15000,
    });
  });

  it("5. execute({ action: 'click', coordinate: [100, 200] }) calls page.mouse.click with correct coords", async () => {
    await session.execute({ action: "launch" });
    await session.execute({ action: "click", coordinate: [100, 200] });

    expect(mockPage.mouse.click).toHaveBeenCalledWith(100, 200);
  });

  it("6. execute({ action: 'type', text: 'hello' }) calls page.keyboard.type with correct text", async () => {
    await session.execute({ action: "launch" });
    await session.execute({ action: "type", text: "hello" });

    expect(mockPage.keyboard.type).toHaveBeenCalledWith("hello");
  });

  it("7. execute({ action: 'close' }) sets isActive to false", async () => {
    await session.execute({ action: "launch" });
    expect(session.isActive).toBe(true);

    await session.execute({ action: "close" });
    expect(session.isActive).toBe(false);
    expect(mockBrowser.close).toHaveBeenCalledOnce();
  });

  it("8. execute() on uninitialized session (no launch) returns error result for navigate", async () => {
    const result = await session.execute({ action: "navigate", url: "https://example.com" });
    expect(result.error).toBeDefined();
    expect(result.error).toContain("No active browser session");
  });
});
