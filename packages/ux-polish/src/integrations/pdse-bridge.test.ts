/**
 * pdse-bridge.test.ts — @dantecode/ux-polish
 * Tests for G13 — DanteForge / PDSE weld.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { PdseBridge, getPdseBridge, resetPdseBridge } from "./pdse-bridge.js";
import type { PdseState } from "./pdse-bridge.js";
import { ThemeEngine } from "../theme-engine.js";

const trusted: PdseState = {
  overall: 0.9,
  label: "High confidence",
  verified: true,
  pipeline: "forge",
};
const caution: PdseState = { overall: 0.6, metrics: { Preciseness: 0.5, Depth: 0.7 } };
const blocked: PdseState = { overall: 0.3, verified: false };

describe("PdseBridge", () => {
  let bridge: PdseBridge;
  const noColorTheme = new ThemeEngine({ colors: false });

  beforeEach(() => {
    bridge = new PdseBridge();
    resetPdseBridge();
  });

  describe("formatTrustBand()", () => {
    it("returns 'trusted' for score >= 0.75", () => {
      expect(bridge.formatTrustBand(0.9)).toBe("trusted");
      expect(bridge.formatTrustBand(0.75)).toBe("trusted");
    });

    it("returns 'caution' for score 0.5–0.75", () => {
      expect(bridge.formatTrustBand(0.6)).toBe("caution");
      expect(bridge.formatTrustBand(0.5)).toBe("caution");
    });

    it("returns 'blocked' for score < 0.5", () => {
      expect(bridge.formatTrustBand(0.3)).toBe("blocked");
      expect(bridge.formatTrustBand(0)).toBe("blocked");
    });
  });

  describe("renderInlineHint()", () => {
    it("includes percent score in output", () => {
      const hint = bridge.renderInlineHint(trusted);
      expect(hint).toContain("90%");
    });

    it("includes trust band label or custom label", () => {
      // trusted fixture has label "High confidence" — overrides the band name
      expect(bridge.renderInlineHint(trusted)).toContain("High confidence");
      // caution/blocked fixtures have no label — band name is shown
      expect(bridge.renderInlineHint(caution)).toContain("caution");
      expect(bridge.renderInlineHint(blocked)).toContain("blocked");
    });

    it("includes check icon for trusted", () => {
      expect(bridge.renderInlineHint(trusted)).toContain("✓");
    });

    it("includes warning icon for caution", () => {
      expect(bridge.renderInlineHint(caution)).toContain("⚠");
    });

    it("includes error icon for blocked", () => {
      expect(bridge.renderInlineHint(blocked)).toContain("✗");
    });

    it("works without a theme", () => {
      const hint = bridge.renderInlineHint(trusted);
      expect(hint).toBeTruthy();
    });

    it("accepts a ThemeEngine (no-color mode)", () => {
      const hint = bridge.renderInlineHint(trusted, noColorTheme);
      expect(hint).toContain("90%");
    });
  });

  describe("getNextStepGuidance()", () => {
    it("gives proceed guidance for trusted score", () => {
      const steps = bridge.getNextStepGuidance(trusted, "forge");
      expect(steps.length).toBeGreaterThan(0);
      expect(
        steps.some(
          (s) => s.includes("proceed") || s.includes("safe") || s.includes("high-confidence"),
        ),
      ).toBe(true);
    });

    it("recommends review for caution score", () => {
      const steps = bridge.getNextStepGuidance(caution);
      expect(steps.some((s) => s.toLowerCase().includes("review"))).toBe(true);
    });

    it("recommends not shipping for blocked score", () => {
      const steps = bridge.getNextStepGuidance(blocked);
      expect(
        steps.some(
          (s) => s.toLowerCase().includes("not ship") || s.toLowerCase().includes("do not"),
        ),
      ).toBe(true);
    });

    it("mentions low-scoring dimensions for caution", () => {
      const steps = bridge.getNextStepGuidance(caution);
      expect(steps.some((s) => s.includes("Preciseness"))).toBe(true);
    });
  });

  describe("formatVerificationSummary()", () => {
    it("includes percent score in summary", () => {
      const summary = bridge.formatVerificationSummary(trusted);
      expect(summary).toContain("90%");
    });

    it("includes pipeline name when provided", () => {
      const summary = bridge.formatVerificationSummary(trusted);
      expect(summary).toContain("forge");
    });

    it("includes per-metric breakdown when metrics are present", () => {
      const summary = bridge.formatVerificationSummary(caution);
      expect(summary).toContain("Preciseness");
      expect(summary).toContain("Depth");
    });

    it("works without theme", () => {
      const summary = bridge.formatVerificationSummary(blocked);
      expect(summary).toBeTruthy();
    });
  });

  describe("buildTrustHint()", () => {
    it("returns all fields", () => {
      const hint = bridge.buildTrustHint(trusted);
      expect(hint.inline).toBeTruthy();
      expect(hint.detail).toBeTruthy();
      expect(hint.band).toBe("trusted");
      expect(hint.nextSteps.length).toBeGreaterThan(0);
    });
  });

  describe("getPdseBridge() singleton", () => {
    it("returns the same instance", () => {
      const a = getPdseBridge();
      const b = getPdseBridge();
      expect(a).toBe(b);
    });

    it("reset clears the singleton", () => {
      const a = getPdseBridge();
      resetPdseBridge();
      const b = getPdseBridge();
      expect(a).not.toBe(b);
    });
  });
});
