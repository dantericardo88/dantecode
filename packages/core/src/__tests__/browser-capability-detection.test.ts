// packages/core/src/__tests__/browser-capability-detection.test.ts
// Sprint 35 — Dim 17: Playwright detection + CDP fallback (7→8)
// Tests: detectPlaywright, detectChromeCdp, detectBrowserCapabilities

import { describe, it, expect } from "vitest";
import { detectPlaywright, detectChromeCdp, detectBrowserCapabilities } from "../browser-agent.js";
import type { CdpCapability } from "../browser-agent.js";

// ─── detectPlaywright ─────────────────────────────────────────────────────────

describe("detectPlaywright", () => {
  it("returns available: true when forced true", async () => {
    const result = await detectPlaywright(true);
    expect(result.available).toBe(true);
  });

  it("returns available: false when forced false", async () => {
    const result = await detectPlaywright(false);
    expect(result.available).toBe(false);
  });

  it("returns a boolean available field without throwing", async () => {
    const result = await detectPlaywright();
    expect(typeof result.available).toBe("boolean");
  });

  it("forced available result has available property", async () => {
    const result = await detectPlaywright(true);
    expect(result).toHaveProperty("available");
  });
});

// ─── detectChromeCdp ──────────────────────────────────────────────────────────

describe("detectChromeCdp", () => {
  it("returns forced available result with full metadata", async () => {
    const forced: CdpCapability = {
      available: true,
      port: 9222,
      browserVersion: "Chrome/124.0",
      webSocketDebuggerUrl: "ws://localhost:9222/devtools/browser/abc",
    };
    const result = await detectChromeCdp(9222, forced);
    expect(result.available).toBe(true);
    expect(result.browserVersion).toBe("Chrome/124.0");
    expect(result.webSocketDebuggerUrl).toBe("ws://localhost:9222/devtools/browser/abc");
  });

  it("returns available: false when nothing runs on unused port", async () => {
    // Port 19222 is very unlikely to be open
    const result = await detectChromeCdp(19222);
    expect(result.available).toBe(false);
    expect(result.port).toBe(19222);
  });

  it("forced unavailable result has port field", async () => {
    const forced: CdpCapability = { available: false, port: 9222 };
    const result = await detectChromeCdp(9222, forced);
    expect(result.available).toBe(false);
    expect(result.port).toBe(9222);
  });

  it("result always has a port field matching input", async () => {
    const result = await detectChromeCdp(9999);
    expect(result.port).toBe(9999);
  });
});

// ─── detectBrowserCapabilities ────────────────────────────────────────────────

describe("detectBrowserCapabilities", () => {
  it("recommendedMode is 'playwright' when playwright is available", async () => {
    const caps = await detectBrowserCapabilities(9222, {
      playwright: true,
      cdp: { available: false, port: 9222 },
    });
    expect(caps.recommendedMode).toBe("playwright");
    expect(caps.installInstructions).toBeUndefined();
  });

  it("recommendedMode is 'cdp' when playwright unavailable but CDP is running", async () => {
    const caps = await detectBrowserCapabilities(9222, {
      playwright: false,
      cdp: { available: true, port: 9222, browserVersion: "Chrome/124.0" },
    });
    expect(caps.recommendedMode).toBe("cdp");
    expect(caps.installInstructions).toBeUndefined();
  });

  it("recommendedMode is 'none' when neither playwright nor CDP is found", async () => {
    const caps = await detectBrowserCapabilities(9222, {
      playwright: false,
      cdp: { available: false, port: 9222 },
    });
    expect(caps.recommendedMode).toBe("none");
  });

  it("installInstructions defined and includes npm install when no driver available", async () => {
    const caps = await detectBrowserCapabilities(9222, {
      playwright: false,
      cdp: { available: false, port: 9222 },
    });
    expect(caps.installInstructions).toBeDefined();
    expect(caps.installInstructions).toContain("npm install playwright");
  });

  it("installInstructions includes CDP remote-debugging-port flag", async () => {
    const caps = await detectBrowserCapabilities(9222, {
      playwright: false,
      cdp: { available: false, port: 9222 },
    });
    expect(caps.installInstructions).toContain("--remote-debugging-port=9222");
  });

  it("capabilities always has playwright, cdp, and recommendedMode fields", async () => {
    const caps = await detectBrowserCapabilities(9222, {
      playwright: false,
      cdp: { available: false, port: 9222 },
    });
    expect(caps).toHaveProperty("playwright");
    expect(caps).toHaveProperty("cdp");
    expect(caps).toHaveProperty("recommendedMode");
  });

  it("playwright field matches the input detection result", async () => {
    const caps = await detectBrowserCapabilities(9222, {
      playwright: true,
      cdp: { available: false, port: 9222 },
    });
    expect(caps.playwright.available).toBe(true);
  });
});
