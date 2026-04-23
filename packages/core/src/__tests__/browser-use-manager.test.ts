// packages/core/src/__tests__/browser-use-manager.test.ts
import { describe, it, expect, beforeEach } from "vitest";
import {
  resolveSelector,
  formatSelector,
  buildNavigateAction,
  buildClickAction,
  buildTypeAction,
  buildScrollAction,
  buildScreenshotAction,
  buildEvaluateAction,
  buildKeyPressAction,
  classifyBrowserError,
  buildSuccessResult,
  buildErrorResult,
  buildDomSnapshot,
  formatDomSnapshotForPrompt,
  BrowserSessionManager,
} from "../browser-use-manager.js";

// ─── resolveSelector ──────────────────────────────────────────────────────────

describe("resolveSelector", () => {
  it("resolves CSS id shorthand to id strategy", () => {
    const sel = resolveSelector("#submit-btn");
    expect(sel.strategy).toBe("id");
    expect(sel.value).toBe("submit-btn");
  });

  it("resolves XPath starting with //", () => {
    const sel = resolveSelector("//div[@class='foo']");
    expect(sel.strategy).toBe("xpath");
  });

  it("resolves aria-label selector", () => {
    const sel = resolveSelector("[aria-label=\"Close\"]");
    expect(sel.strategy).toBe("aria");
  });

  it("resolves text= prefix to text strategy", () => {
    const sel = resolveSelector("text=Submit");
    expect(sel.strategy).toBe("text");
    expect(sel.value).toBe("Submit");
  });

  it("resolves plain string to css strategy", () => {
    const sel = resolveSelector("div.container > button");
    expect(sel.strategy).toBe("css");
    expect(sel.value).toBe("div.container > button");
  });

  it("resolves (#id with non-alpha char) to css not id", () => {
    const sel = resolveSelector("#123invalid");
    expect(sel.strategy).toBe("css");
  });
});

// ─── formatSelector ───────────────────────────────────────────────────────────

describe("formatSelector", () => {
  it("formats id selector with # prefix", () => {
    expect(formatSelector({ strategy: "id", value: "btn" })).toBe("#btn");
  });

  it("formats text selector with text= prefix", () => {
    expect(formatSelector({ strategy: "text", value: "Click me" })).toContain("Click me");
  });

  it("formats aria selector with aria-label attribute", () => {
    expect(formatSelector({ strategy: "aria", value: "Close" })).toContain("Close");
  });

  it("formats css selector as-is", () => {
    expect(formatSelector({ strategy: "css", value: "div.foo" })).toBe("div.foo");
  });

  it("formats xpath as-is", () => {
    expect(formatSelector({ strategy: "xpath", value: "//div" })).toBe("//div");
  });
});

// ─── Action builders ──────────────────────────────────────────────────────────

describe("buildNavigateAction", () => {
  it("creates navigate action with url", () => {
    const a = buildNavigateAction("https://example.com");
    expect(a.type).toBe("navigate");
    expect(a.value).toBe("https://example.com");
  });

  it("uses custom timeout", () => {
    const a = buildNavigateAction("https://x.com", 5000);
    expect(a.timeoutMs).toBe(5000);
  });
});

describe("buildClickAction", () => {
  it("creates click action with resolved selector", () => {
    const a = buildClickAction("#btn");
    expect(a.type).toBe("click");
    expect(a.selector?.strategy).toBe("id");
  });
});

describe("buildTypeAction", () => {
  it("creates type action with selector and text", () => {
    const a = buildTypeAction("input[name=q]", "hello world");
    expect(a.type).toBe("type");
    expect(a.value).toBe("hello world");
  });
});

describe("buildScrollAction", () => {
  it("sets scroll delta", () => {
    const a = buildScrollAction(300);
    expect(a.type).toBe("scroll");
    expect(a.scrollDeltaY).toBe(300);
  });

  it("accepts optional selector", () => {
    const a = buildScrollAction(100, ".list");
    expect(a.selector?.value).toBe(".list");
  });
});

describe("buildScreenshotAction", () => {
  it("creates screenshot action", () => {
    expect(buildScreenshotAction().type).toBe("screenshot");
  });
});

describe("buildEvaluateAction", () => {
  it("stores expression", () => {
    const a = buildEvaluateAction("document.title");
    expect(a.expression).toBe("document.title");
  });
});

describe("buildKeyPressAction", () => {
  it("creates key_press action with key name", () => {
    const a = buildKeyPressAction("Enter");
    expect(a.type).toBe("key_press");
    expect(a.value).toBe("Enter");
  });
});

// ─── classifyBrowserError ─────────────────────────────────────────────────────

describe("classifyBrowserError", () => {
  it("classifies timeout error", () => {
    expect(classifyBrowserError("Timed out waiting for element")).toBe("timeout");
  });

  it("classifies navigation error", () => {
    expect(classifyBrowserError("net::ERR_NAME_NOT_RESOLVED")).toBe("navigation");
  });

  it("classifies selector error", () => {
    expect(classifyBrowserError("element not found")).toBe("selector");
  });

  it("classifies network error", () => {
    expect(classifyBrowserError("ERR_INTERNET_DISCONNECTED")).toBe("network");
  });

  it("classifies javascript error", () => {
    expect(classifyBrowserError("TypeError: Cannot read property")).toBe("javascript");
  });

  it("classifies permission error", () => {
    expect(classifyBrowserError("Permission denied")).toBe("permission");
  });

  it("returns unknown for unrecognized error", () => {
    expect(classifyBrowserError("something random")).toBe("unknown");
  });
});

// ─── buildSuccessResult / buildErrorResult ────────────────────────────────────

describe("buildSuccessResult", () => {
  it("sets success=true", () => {
    const r = buildSuccessResult(buildScreenshotAction(), 50);
    expect(r.success).toBe(true);
    expect(r.durationMs).toBe(50);
  });

  it("merges extras", () => {
    const r = buildSuccessResult(buildScreenshotAction(), 50, { screenshotDigest: "abc" });
    expect(r.screenshotDigest).toBe("abc");
  });
});

describe("buildErrorResult", () => {
  it("sets success=false", () => {
    const r = buildErrorResult(buildClickAction("#x"), "element not found", 100);
    expect(r.success).toBe(false);
    expect(r.errorType).toBe("selector");
  });
});

// ─── buildDomSnapshot ─────────────────────────────────────────────────────────

describe("buildDomSnapshot", () => {
  it("truncates bodyText to maxBodyChars", () => {
    const text = "a".repeat(5000);
    const snap = buildDomSnapshot({ title: "T", url: "u", bodyText: text }, 100);
    expect(snap.bodyText.length).toBe(100);
  });

  it("preserves title and url", () => {
    const snap = buildDomSnapshot({ title: "My Page", url: "https://x.com", bodyText: "hello" });
    expect(snap.title).toBe("My Page");
    expect(snap.url).toBe("https://x.com");
  });

  it("defaults interactiveElements to empty array", () => {
    const snap = buildDomSnapshot({ title: "T", url: "u", bodyText: "" });
    expect(snap.interactiveElements).toHaveLength(0);
  });
});

// ─── formatDomSnapshotForPrompt ───────────────────────────────────────────────

describe("formatDomSnapshotForPrompt", () => {
  it("includes url and title in output", () => {
    const snap = buildDomSnapshot({ title: "Home", url: "https://x.com", bodyText: "foo" });
    const out = formatDomSnapshotForPrompt(snap);
    expect(out).toContain("https://x.com");
    expect(out).toContain("Home");
  });

  it("includes interactive elements section when present", () => {
    const snap = buildDomSnapshot({
      title: "T", url: "u", bodyText: "",
      interactiveElements: [{ tag: "button", classes: [], text: "Submit", selector: { strategy: "css", value: "button.submit" } }],
    });
    const out = formatDomSnapshotForPrompt(snap);
    expect(out).toContain("Interactive Elements");
    expect(out).toContain("button");
  });
});

// ─── BrowserSessionManager ────────────────────────────────────────────────────

describe("BrowserSessionManager", () => {
  let mgr: BrowserSessionManager;

  beforeEach(() => {
    mgr = new BrowserSessionManager();
  });

  it("openSession creates a new active session", () => {
    const s = mgr.openSession();
    expect(s.status).toBe("active");
    expect(mgr.totalSessions).toBe(1);
  });

  it("getSession returns the session", () => {
    const s = mgr.openSession();
    expect(mgr.getSession(s.id)).toBe(s);
  });

  it("pauseSession changes status to paused", () => {
    const s = mgr.openSession();
    expect(mgr.pauseSession(s.id)).toBe(true);
    expect(mgr.getSession(s.id)!.status).toBe("paused");
  });

  it("resumeSession restores active status", () => {
    const s = mgr.openSession();
    mgr.pauseSession(s.id);
    expect(mgr.resumeSession(s.id)).toBe(true);
    expect(mgr.getSession(s.id)!.status).toBe("active");
  });

  it("closeSession marks session as closed with timestamp", () => {
    const s = mgr.openSession();
    expect(mgr.closeSession(s.id)).toBe(true);
    expect(mgr.getSession(s.id)!.status).toBe("closed");
    expect(mgr.getSession(s.id)!.closedAt).toBeDefined();
  });

  it("recordAction appends to session actions", () => {
    const s = mgr.openSession();
    const r = buildSuccessResult(buildScreenshotAction(), 50);
    mgr.recordAction(s.id, r);
    expect(mgr.getSession(s.id)!.actions).toHaveLength(1);
  });

  it("recordAction updates currentUrl when provided", () => {
    const s = mgr.openSession();
    const r = buildSuccessResult(buildNavigateAction("https://x.com"), 100);
    mgr.recordAction(s.id, r, "https://x.com");
    expect(mgr.getSession(s.id)!.currentUrl).toBe("https://x.com");
  });

  it("getSessionSummary counts successes and failures", () => {
    const s = mgr.openSession();
    mgr.recordAction(s.id, buildSuccessResult(buildScreenshotAction(), 10));
    mgr.recordAction(s.id, buildErrorResult(buildClickAction("#x"), "element not found", 5));
    const summary = mgr.getSessionSummary(s.id);
    expect(summary!.successCount).toBe(1);
    expect(summary!.failureCount).toBe(1);
    expect(summary!.errorTypes.selector).toBe(1);
  });

  it("activeSessions excludes closed sessions", () => {
    const s1 = mgr.openSession();
    const s2 = mgr.openSession();
    mgr.closeSession(s1.id);
    expect(mgr.activeSessions.some((s) => s.id === s1.id)).toBe(false);
    expect(mgr.activeSessions.some((s) => s.id === s2.id)).toBe(true);
  });

  it("clearClosed removes closed sessions", () => {
    const s = mgr.openSession();
    mgr.closeSession(s.id);
    expect(mgr.totalSessions).toBe(1);
    mgr.clearClosed();
    expect(mgr.totalSessions).toBe(0);
  });

  it("formatHistoryForPrompt includes action types", () => {
    const s = mgr.openSession();
    mgr.recordAction(s.id, buildSuccessResult(buildNavigateAction("https://x.com"), 200), "https://x.com");
    const hist = mgr.formatHistoryForPrompt(s.id);
    expect(hist).toContain("navigate");
    expect(hist).toContain("Browser Session History");
  });
});
