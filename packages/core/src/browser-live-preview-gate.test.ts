import { describe, expect, it } from "vitest";
import {
  evaluateBrowserLivePreviewGate,
  generateBrowserLivePreviewReport,
  type BrowserLivePreviewProof,
} from "./browser-live-preview-gate.js";

function completeProof(): BrowserLivePreviewProof {
  return {
    dimensionId: "browser_live_preview",
    generatedAt: "2026-04-29T00:00:00.000Z",
    preview: {
      url: "http://localhost:5173",
      command: "npm run dev",
      port: 5173,
      managed: true,
      startupMs: 840,
      framework: "vite",
    },
    captures: {
      screenshotPath: "artifacts/preview.png",
      screenshotSha256: "a".repeat(64),
      domTextChars: 1200,
      accessibilityTreeCaptured: true,
      consoleErrorCount: 0,
      networkFailureCount: 0,
      blockingErrorCount: 0,
      viewports: [
        { width: 390, height: 844, screenshotPath: "artifacts/mobile.png" },
        { width: 1440, height: 900, screenshotPath: "artifacts/desktop.png" },
      ],
    },
    hotReload: {
      pass: true,
      changedFile: "src/App.tsx",
      beforeHash: "b".repeat(64),
      afterHash: "c".repeat(64),
      observedMs: 320,
    },
    keyboard: {
      pass: true,
      reachableControls: 5,
      totalControls: 5,
      focusOrder: ["Open", "Run", "Refresh", "Inspect", "Fix"],
    },
    repair: {
      failureOverlayAvailable: true,
      repairPromptAvailable: true,
    },
    artifacts: {
      manifestPath: ".danteforge/evidence/browser-live-preview-dim14.json",
      reportPath: ".danteforge/evidence/browser-live-preview-dim14.md",
      tracePath: "artifacts/trace.zip",
    },
  };
}

describe("browser live preview gate", () => {
  it("passes complete managed preview proof at 9-grade threshold", () => {
    const result = evaluateBrowserLivePreviewGate(completeProof(), { threshold: 90 });

    expect(result.pass).toBe(true);
    expect(result.score).toBe(100);
    expect(result.maxEligibleScore).toBe(9);
    expect(result.coverage.hotReload).toBe(true);
    expect(result.coverage.keyboardTraversal).toBe(true);
  });

  it("fails closed and caps eligibility when browser evidence is absent", () => {
    const proof = completeProof();
    proof.captures.screenshotPath = undefined;
    proof.captures.screenshotSha256 = undefined;
    proof.captures.accessibilityTreeCaptured = false;

    const result = evaluateBrowserLivePreviewGate(proof, { threshold: 90 });

    expect(result.pass).toBe(false);
    expect(result.maxEligibleScore).toBeLessThan(9);
    expect(result.blockers).toContain("browser screenshot proof is required");
    expect(result.blockers).toContain("accessibility tree capture is required");
  });

  it("renders a markdown report with blockers and proof coverage", () => {
    const proof = completeProof();
    proof.hotReload.pass = false;
    const result = evaluateBrowserLivePreviewGate(proof, { threshold: 90 });

    const report = generateBrowserLivePreviewReport(result);

    expect(report).toContain("# Browser Live Preview Gate Report");
    expect(report).toContain("hot reload proof is required");
    expect(report).toContain("Preview URL");
  });
});
