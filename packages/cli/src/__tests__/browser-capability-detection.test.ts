// packages/cli/src/__tests__/browser-capability-detection.test.ts
// Sprint 35 — Dim 17: cmdBrowse capability-gated early exit (7→8)
// Tests: cmdBrowse returns install instructions when no browser driver is found

import { describe, it, expect, vi } from "vitest";

// Mock @dantecode/core — the dist may not have new exports yet
vi.mock("@dantecode/core", () => ({
  BrowserSessionManager: vi.fn().mockImplementation(() => ({
    openSession: vi.fn().mockReturnValue({ id: "session-1", status: "active", actions: [] }),
    recordAction: vi.fn(),
    getSessionSummary: vi.fn().mockReturnValue({ actionCount: 0, successCount: 0, failureCount: 0 }),
  })),
  BrowserAgent: vi.fn().mockImplementation(() => ({
    execute: vi.fn().mockResolvedValue({ success: true, data: "https://example.com" }),
    close: vi.fn().mockResolvedValue(undefined),
    screenshotBase64: vi.fn().mockResolvedValue(""),
    captureDomSnapshot: vi.fn().mockResolvedValue(null),
  })),
  detectBrowserCapabilities: vi.fn(),
  buildNavigateAction: vi.fn().mockReturnValue({ type: "navigate", url: "https://example.com" }),
  buildClickAction: vi.fn().mockReturnValue({ type: "click" }),
  buildTypeAction: vi.fn().mockReturnValue({ type: "type" }),
  buildScreenshotAction: vi.fn().mockReturnValue({ type: "screenshot" }),
  buildSuccessResult: vi.fn().mockImplementation((action: unknown, ms: number) => ({ success: true, action, duration: ms })),
  buildErrorResult: vi.fn().mockImplementation((action: unknown, err: string) => ({ success: false, action, error: err })),
  formatDomSnapshotForPrompt: vi.fn().mockReturnValue(""),
}));

import { cmdBrowse } from "../commands/browse.js";

async function mockDetect(available: boolean) {
  const core = await import("@dantecode/core");
  vi.mocked(core.detectBrowserCapabilities).mockResolvedValue({
    playwright: { available },
    cdp: { available: false, port: 9222 },
    recommendedMode: available ? "playwright" : "none",
    installInstructions: available
      ? undefined
      : "## Browser Automation Not Available\n\nnpm install playwright",
  });
}

// ─── cmdBrowse early exit ─────────────────────────────────────────────────────

describe("cmdBrowse — capability-gated early exit", () => {
  it("returns error status when no browser driver found", async () => {
    await mockDetect(false);
    const result = await cmdBrowse({ url: "https://example.com" });
    expect(result.status).toBe("error");
  });

  it("returns actionsCount 0 when no browser driver found", async () => {
    await mockDetect(false);
    const result = await cmdBrowse({ url: "https://example.com" });
    expect(result.actionsCount).toBe(0);
  });

  it("returns lastActionSuccess false when no browser driver found", async () => {
    await mockDetect(false);
    const result = await cmdBrowse({ url: "https://example.com" });
    expect(result.lastActionSuccess).toBe(false);
  });

  it("includes install instructions in promptContext when no driver found", async () => {
    await mockDetect(false);
    const result = await cmdBrowse({ url: "https://example.com" });
    expect(result.promptContext).toContain("npm install playwright");
  });

  it("result includes capabilities field with recommendedMode 'none'", async () => {
    await mockDetect(false);
    const result = await cmdBrowse({ url: "https://example.com" });
    expect(result.capabilities?.recommendedMode).toBe("none");
  });

  it("returns active status when playwright is available (happy path)", async () => {
    await mockDetect(true);
    const result = await cmdBrowse({ url: "https://example.com" });
    expect(result.status).not.toBe("error");
  });

  it("capabilities field is always present in result", async () => {
    await mockDetect(true);
    const result = await cmdBrowse({ url: "https://example.com" });
    expect(result.capabilities).toBeDefined();
  });

  it("promptContext includes session ID regardless of mode", async () => {
    await mockDetect(false);
    const result = await cmdBrowse({ url: "https://example.com" });
    expect(result.promptContext).toContain("Browser Session:");
  });
});
