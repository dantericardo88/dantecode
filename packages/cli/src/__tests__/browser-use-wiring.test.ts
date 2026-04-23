// ============================================================================
// packages/cli/src/__tests__/browser-use-wiring.test.ts
//
// Sprint 16 + Sprint 20 — Dim 17: BrowserUseManager + BrowserAgent wiring tests.
// Sprint 16: BrowserSessionManager action taxonomy and session lifecycle.
// Sprint 20: BrowserAgent.execute() wired for real Playwright execution.
// ============================================================================

import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock BrowserAgent so tests don't require Playwright installed
vi.mock("@dantecode/core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@dantecode/core")>();
  return {
    ...actual,
    BrowserAgent: vi.fn().mockImplementation(() => ({
      options: { headless: true, timeout: 30000, viewport: { width: 1280, height: 720 } },
      execute: vi.fn().mockResolvedValue({ success: true, data: "https://example.com" }),
      screenshotBase64: vi.fn().mockResolvedValue(""),
      captureDomSnapshot: vi.fn().mockResolvedValue({
        capturedAt: new Date().toISOString(),
        url: "https://example.com",
        title: "Example",
        bodyText: "Example body text",
        interactiveElements: [
          { tag: "button", classes: ["primary"], text: "Submit", selector: { strategy: "css", value: "button.primary" } },
        ],
        metaTags: { description: "Example page" },
      }),
    })),
    // Sprint 35 — browser capability detection (not yet in compiled dist)
    detectBrowserCapabilities: vi.fn().mockResolvedValue({
      playwright: { available: true },
      cdp: { available: false, port: 9222 },
      recommendedMode: "playwright",
    }),
  };
});

import { cmdBrowse, globalBrowserManager } from "../commands/browse.js";
import {
  BrowserSessionManager,
  BrowserAgent,
  buildNavigateAction,
  buildClickAction,
  buildTypeAction,
  buildSuccessResult,
  buildErrorResult,
  resolveSelector,
  classifyBrowserError,
} from "@dantecode/core";

describe("BrowserSessionManager unit tests (Sprint 16)", () => {

  it("openSession returns a session with active status", () => {
    const mgr = new BrowserSessionManager();
    const session = mgr.openSession();
    expect(session.status).toBe("active");
    expect(session.id).toMatch(/^browser-session-/);
  });

  it("closeSession transitions status to closed", () => {
    const mgr = new BrowserSessionManager();
    const session = mgr.openSession();
    expect(mgr.closeSession(session.id)).toBe(true);
    expect(mgr.getSession(session.id)!.status).toBe("closed");
  });

  it("pauseSession and resumeSession cycle works", () => {
    const mgr = new BrowserSessionManager();
    const session = mgr.openSession();
    expect(mgr.pauseSession(session.id)).toBe(true);
    expect(mgr.getSession(session.id)!.status).toBe("paused");
    expect(mgr.resumeSession(session.id)).toBe(true);
    expect(mgr.getSession(session.id)!.status).toBe("active");
  });

  it("recordAction appends to session.actions", () => {
    const mgr = new BrowserSessionManager();
    const session = mgr.openSession();
    const action = buildNavigateAction("https://example.com");
    mgr.recordAction(session.id, buildSuccessResult(action, 50));
    expect(mgr.getSession(session.id)!.actions).toHaveLength(1);
  });

  it("getSessionSummary counts successes and failures", () => {
    const mgr = new BrowserSessionManager();
    const session = mgr.openSession();
    const nav = buildNavigateAction("https://example.com");
    const click = buildClickAction("#btn");
    mgr.recordAction(session.id, buildSuccessResult(nav, 50));
    mgr.recordAction(session.id, buildErrorResult(click, "Timeout", 3000));
    const summary = mgr.getSessionSummary(session.id)!;
    expect(summary.successCount).toBe(1);
    expect(summary.failureCount).toBe(1);
  });

});

describe("cmdBrowse (Sprint 16 + Sprint 20)", () => {

  beforeEach(() => {
    vi.mocked(BrowserAgent).mockClear();
  });

  it("returns a structured result with sessionId and url", async () => {
    const result = await cmdBrowse({ url: "https://example.com" });
    expect(result.sessionId).toMatch(/^browser-session-/);
    expect(result.url).toBe("https://example.com");
    expect(result.status).toBe("active");
  });

  it("records navigate action — actionsCount >= 1", async () => {
    const result = await cmdBrowse({ url: "https://test.dev" });
    expect(result.actionsCount).toBeGreaterThanOrEqual(1);
  });

  it("records click action when clickSelector provided", async () => {
    const result = await cmdBrowse({ url: "https://example.com", clickSelector: "#submit" });
    expect(result.actionsCount).toBeGreaterThanOrEqual(2);
  });

  it("records type action when typeInput provided", async () => {
    const result = await cmdBrowse({
      url: "https://example.com",
      typeInput: { selector: "input[name=q]", text: "hello world" },
    });
    expect(result.actionsCount).toBeGreaterThanOrEqual(2);
  });

  it("lastActionSuccess is true when all actions succeed", async () => {
    const result = await cmdBrowse({ url: "https://example.com" });
    expect(result.lastActionSuccess).toBe(true);
  });

  it("promptContext contains session ID and url", async () => {
    const result = await cmdBrowse({ url: "https://prompt.test" });
    expect(result.promptContext).toContain("Browser Session");
    expect(result.promptContext).toContain("https://prompt.test");
  });

  it("promptContext contains extracted page context and screenshot note when available", async () => {
    vi.mocked(BrowserAgent).mockImplementationOnce(() => ({
      options: { headless: true, timeout: 30000, viewport: { width: 1280, height: 720 } },
      execute: vi
        .fn()
        .mockResolvedValueOnce({ success: true, data: "https://prompt.test" })
        .mockResolvedValueOnce({ success: true, data: "document\n  button Submit" }),
      screenshotBase64: vi.fn().mockResolvedValue("abc123"),
      captureDomSnapshot: vi.fn().mockResolvedValue({
        capturedAt: new Date().toISOString(),
        url: "https://prompt.test",
        title: "Prompt Test",
        bodyText: "Prompt body",
        interactiveElements: [
          { tag: "button", classes: [], text: "Submit", selector: { strategy: "css", value: "button" } },
        ],
        metaTags: {},
      }),
    }) as unknown as BrowserAgent);
    const result = await cmdBrowse({ url: "https://prompt.test" });
    expect(result.promptContext).toContain("Prompt Test");
    expect(result.promptContext).toContain("Accessibility Tree");
    expect(result.promptContext).toContain("screenshotB64");
  });

  it("globalBrowserManager is a BrowserSessionManager instance", () => {
    expect(globalBrowserManager).toBeInstanceOf(BrowserSessionManager);
  });

});

// ── Sprint 20: BrowserAgent.execute() wiring ──────────────────────────────────

describe("BrowserAgent.execute() wiring (Sprint 20)", () => {

  beforeEach(() => {
    vi.mocked(BrowserAgent).mockClear();
  });

  it("BrowserAgent is importable and callable from @dantecode/core", () => {
    const agent = new BrowserAgent({ headless: true });
    expect(agent).toBeDefined();
  });

  it("cmdBrowse calls agent.execute() with goto type for navigate", async () => {
    await cmdBrowse({ url: "https://execute-test.com" });
    const agentInstance = vi.mocked(BrowserAgent).mock.results[0]!.value;
    expect(agentInstance.execute).toHaveBeenCalledWith(
      expect.objectContaining({ type: "goto", url: "https://execute-test.com" }),
    );
  });

  it("cmdBrowse calls agent.execute() for click when clickSelector provided", async () => {
    await cmdBrowse({ url: "https://example.com", clickSelector: "#btn" });
    const agentInstance = vi.mocked(BrowserAgent).mock.results[0]!.value;
    expect(agentInstance.execute).toHaveBeenCalledWith(
      expect.objectContaining({ type: "click", selector: "#btn" }),
    );
  });

  it("cmdBrowse records error result when agent.execute() returns failure", async () => {
    vi.mocked(BrowserAgent).mockImplementationOnce(() => ({
      options: { headless: true, timeout: 30000, viewport: { width: 1280, height: 720 } },
      execute: vi.fn().mockResolvedValue({ success: false, error: "Navigation failed" }),
      screenshotBase64: vi.fn().mockResolvedValue(""),
      captureDomSnapshot: vi.fn().mockResolvedValue(null),
    }) as unknown as BrowserAgent);
    const result = await cmdBrowse({ url: "https://fail.test" });
    // last action recorded should be a failure
    expect(result.lastActionSuccess).toBe(false);
  });

  it("session lastActionSuccess is false when agent.execute() fails", async () => {
    vi.mocked(BrowserAgent).mockImplementationOnce(() => ({
      options: { headless: true, timeout: 30000, viewport: { width: 1280, height: 720 } },
      execute: vi.fn().mockResolvedValue({ success: false, error: "Timeout" }),
      screenshotBase64: vi.fn().mockResolvedValue(""),
      captureDomSnapshot: vi.fn().mockResolvedValue(null),
    }) as unknown as BrowserAgent);
    const result = await cmdBrowse({ url: "https://timeout.test" });
    expect(result.lastActionSuccess).toBe(false);
  });

  it("session lastActionSuccess is true on agent success", async () => {
    const result = await cmdBrowse({ url: "https://success.test" });
    expect(result.lastActionSuccess).toBe(true);
  });

  it("BrowserAgent constructor accepts headless boolean option", () => {
    new BrowserAgent({ headless: false });
    expect(vi.mocked(BrowserAgent)).toHaveBeenCalledWith({ headless: false });
  });

  it("cmdBrowse gracefully handles agent.execute() throw (Playwright not installed)", async () => {
    vi.mocked(BrowserAgent).mockImplementationOnce(() => ({
      options: { headless: true, timeout: 30000, viewport: { width: 1280, height: 720 } },
      execute: vi.fn().mockRejectedValue(new Error("Cannot find module 'playwright'")),
      screenshotBase64: vi.fn().mockResolvedValue(""),
      captureDomSnapshot: vi.fn().mockResolvedValue(null),
    }) as unknown as BrowserAgent);
    // Should not throw — error is caught and recorded as failure
    const result = await cmdBrowse({ url: "https://no-playwright.test" });
    expect(result.lastActionSuccess).toBe(false);
    expect(result.sessionId).toMatch(/^browser-session-/);
  });

});

describe("browser-use helper functions (Sprint 16)", () => {

  it("buildNavigateAction sets type=navigate and url as value", () => {
    const action = buildNavigateAction("https://example.com");
    expect(action.type).toBe("navigate");
    expect(action.value).toBe("https://example.com");
  });

  it("buildClickAction sets type=click and selector payload", () => {
    const action = buildClickAction("#btn");
    expect(action.type).toBe("click");
  });

  it("buildTypeAction sets type=type and includes value", () => {
    const action = buildTypeAction("input", "hello");
    expect(action.type).toBe("type");
    expect(action.value).toBe("hello");
  });

  it("resolveSelector detects CSS id shorthand", () => {
    const sel = resolveSelector("#myId");
    expect(sel.strategy).toBe("id");
    expect(sel.value).toBe("myId");
  });

  it("classifyBrowserError detects timeout errors", () => {
    expect(classifyBrowserError("Timeout waiting for element")).toBe("timeout");
  });

});

// ─── Sprint G — screenshotBase64 + cmdBrowse screenshot wiring ────────────────

describe("BrowserAgent.screenshotBase64() (Sprint G, dim 17)", () => {

  it("cmdBrowse calls agent.execute() for navigate action (not no-op)", async () => {
    const executeSpy = vi.fn().mockResolvedValue({ success: true, data: "https://example.com" });
    (BrowserAgent as ReturnType<typeof vi.fn>).mockImplementationOnce(() => ({
      options: { headless: true, timeout: 30000, viewport: { width: 1280, height: 720 } },
      execute: executeSpy,
      screenshotBase64: vi.fn().mockResolvedValue(""),
      captureDomSnapshot: vi.fn().mockResolvedValue(null),
    }));
    await cmdBrowse({ url: "https://example.com", sessionId: "test-nav", headless: true });
    expect(executeSpy).toHaveBeenCalledWith(expect.objectContaining({ type: "goto" }));
  });

  it("cmdBrowse calls agent.execute() for click action", async () => {
    const executeSpy = vi.fn().mockResolvedValue({ success: true, data: "" });
    (BrowserAgent as ReturnType<typeof vi.fn>).mockImplementationOnce(() => ({
      options: { headless: true, timeout: 30000, viewport: { width: 1280, height: 720 } },
      execute: executeSpy,
      screenshotBase64: vi.fn().mockResolvedValue(""),
      captureDomSnapshot: vi.fn().mockResolvedValue(null),
    }));
    await cmdBrowse({ url: "https://example.com", clickSelector: "#btn", sessionId: "test-click", headless: true });
    const clickCall = executeSpy.mock.calls.find((c: unknown[]) => (c[0] as Record<string, string>)["type"] === "click");
    expect(clickCall).toBeDefined();
  });

  it("screenshotBase64 returns non-empty string when page available (mock)", async () => {
    const mockB64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";
    const screenshotSpy = vi.fn().mockResolvedValue(mockB64);
    (BrowserAgent as ReturnType<typeof vi.fn>).mockImplementationOnce(() => ({
      options: { headless: true, timeout: 30000, viewport: { width: 1280, height: 720 } },
      execute: vi.fn().mockResolvedValue({ success: true, data: "ok" }),
      screenshotBase64: screenshotSpy,
      captureDomSnapshot: vi.fn().mockResolvedValue(null),
    }));
    const result = await cmdBrowse({ url: "https://example.com", sessionId: "test-ss", headless: true });
    expect(result.screenshotB64).toBe(mockB64);
  });

  it("screenshotBase64 returns empty string gracefully when page null (mock)", async () => {
    const screenshotSpy = vi.fn().mockResolvedValue("");
    (BrowserAgent as ReturnType<typeof vi.fn>).mockImplementationOnce(() => ({
      options: { headless: true, timeout: 30000, viewport: { width: 1280, height: 720 } },
      execute: vi.fn().mockResolvedValue({ success: true, data: "ok" }),
      screenshotBase64: screenshotSpy,
      captureDomSnapshot: vi.fn().mockResolvedValue(null),
    }));
    const result = await cmdBrowse({ url: "https://example.com", sessionId: "test-ss-null", headless: true });
    // Empty string → undefined in result (screenshotB64 is undefined when empty)
    expect(result.screenshotB64 ?? "").toBe("");
  });

  it("cmdBrowse records error result when execute throws", async () => {
    (BrowserAgent as ReturnType<typeof vi.fn>).mockImplementationOnce(() => ({
      options: { headless: true, timeout: 30000, viewport: { width: 1280, height: 720 } },
      execute: vi.fn().mockRejectedValue(new Error("Network failed")),
      screenshotBase64: vi.fn().mockResolvedValue(""),
      captureDomSnapshot: vi.fn().mockResolvedValue(null),
    }));
    const result = await cmdBrowse({ url: "https://example.com", sessionId: "test-err", headless: true });
    // Should not throw, should return a result with lastActionSuccess: false
    expect(result.lastActionSuccess).toBe(false);
  });

  it("cmdBrowse lastActionSuccess is true on success", async () => {
    (BrowserAgent as ReturnType<typeof vi.fn>).mockImplementationOnce(() => ({
      options: { headless: true, timeout: 30000, viewport: { width: 1280, height: 720 } },
      execute: vi.fn().mockResolvedValue({ success: true, data: "https://example.com" }),
      screenshotBase64: vi.fn().mockResolvedValue("abc123"),
      captureDomSnapshot: vi.fn().mockResolvedValue(null),
    }));
    const result = await cmdBrowse({ url: "https://example.com", sessionId: "test-ok", headless: true });
    expect(result.lastActionSuccess).toBe(true);
  });

  it("dynamic import failure of Playwright → graceful degradation, no crash", async () => {
    (BrowserAgent as ReturnType<typeof vi.fn>).mockImplementationOnce(() => ({
      options: { headless: true, timeout: 30000, viewport: { width: 1280, height: 720 } },
      execute: vi.fn().mockResolvedValue({ success: false, error: "Playwright not installed" }),
      screenshotBase64: vi.fn().mockResolvedValue(""),
      captureDomSnapshot: vi.fn().mockResolvedValue(null),
    }));
    // Should NOT throw even when Playwright unavailable
    await expect(cmdBrowse({ url: "https://example.com", sessionId: "test-graceful", headless: true })).resolves.toBeDefined();
  });

  it("screenshot attached as screenshotB64 in result after navigate+click", async () => {
    const mockB64 = "base64screenshot";
    (BrowserAgent as ReturnType<typeof vi.fn>).mockImplementationOnce(() => ({
      options: { headless: true, timeout: 30000, viewport: { width: 1280, height: 720 } },
      execute: vi.fn().mockResolvedValue({ success: true, data: "ok" }),
      screenshotBase64: vi.fn().mockResolvedValue(mockB64),
      captureDomSnapshot: vi.fn().mockResolvedValue(null),
    }));
    const result = await cmdBrowse({ url: "https://example.com", clickSelector: "#btn", sessionId: "test-combined", headless: true });
    expect(result.screenshotB64).toBe(mockB64);
  });
});
