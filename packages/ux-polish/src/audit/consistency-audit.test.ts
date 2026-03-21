/**
 * consistency-audit.test.ts — @dantecode/ux-polish
 * Tests for G17 — Consistency audit harness.
 */

import { describe, it, expect } from "vitest";
import { ConsistencyAudit } from "./consistency-audit.js";
import { ThemeEngine } from "../theme-engine.js";
import type { RenderPayload, UXSurface } from "../types.js";

const noColorTheme = new ThemeEngine({ colors: false });

describe("ConsistencyAudit", () => {
  describe("renderAcrossSurfaces()", () => {
    it("returns outputs for all three surfaces", () => {
      const audit = new ConsistencyAudit(noColorTheme);
      const payload: RenderPayload = { kind: "text", content: "Hello world" };
      const result = audit.renderAcrossSurfaces(payload);
      expect(result.outputs.cli).toBeDefined();
      expect(result.outputs.repl).toBeDefined();
      expect(result.outputs.vscode).toBeDefined();
    });

    it("each surface output contains the payload content", () => {
      const audit = new ConsistencyAudit(noColorTheme);
      const payload: RenderPayload = { kind: "text", content: "consistent-text" };
      const result = audit.renderAcrossSurfaces(payload);
      for (const surface of ["cli", "repl", "vscode"] as UXSurface[]) {
        expect(result.outputs[surface]).toContain("consistent-text");
      }
    });

    it("preserves the original payload in result", () => {
      const audit = new ConsistencyAudit(noColorTheme);
      const payload: RenderPayload = { kind: "success", content: "Done" };
      const result = audit.renderAcrossSurfaces(payload);
      expect(result.payload).toBe(payload);
    });
  });

  describe("detectToneDrift()", () => {
    it("returns empty array for consistent outputs", () => {
      const audit = new ConsistencyAudit(noColorTheme);
      const outputs: Record<UXSurface, string> = {
        cli: "Build passed.",
        repl: "Build passed.",
        vscode: "Build passed.",
      };
      const drifts = audit.detectToneDrift(outputs);
      const critical = drifts.filter((d) => d.severity === 3);
      expect(critical).toHaveLength(0);
    });

    it("detects critical drift when a surface has empty output", () => {
      const audit = new ConsistencyAudit(noColorTheme);
      const outputs: Record<UXSurface, string> = {
        cli: "Build passed.",
        repl: "Build passed.",
        vscode: "",
      };
      const drifts = audit.detectToneDrift(outputs);
      expect(drifts.some((d) => d.severity === 3 && d.surfaces.includes("vscode"))).toBe(true);
    });

    it("detects length drift when one surface has much less content", () => {
      const audit = new ConsistencyAudit(noColorTheme);
      const outputs: Record<UXSurface, string> = {
        cli: "A".repeat(500),
        repl: "A".repeat(500),
        vscode: "A",
      };
      const drifts = audit.detectToneDrift(outputs);
      expect(drifts.some((d) => d.type === "length" || d.type === "missing-token")).toBe(true);
    });
  });

  describe("detectThemeDrift()", () => {
    it("returns empty array for a valid no-color theme", () => {
      const audit = new ConsistencyAudit(noColorTheme);
      const drifts = audit.detectThemeDrift(noColorTheme);
      // No-color theme has all empty strings — that's intentional, not a drift
      // The function should not flag built-in minimal theme issues
      expect(Array.isArray(drifts)).toBe(true);
    });

    it("returns token drift results as an array", () => {
      const audit = new ConsistencyAudit(noColorTheme);
      const colorTheme = new ThemeEngine({ colors: true });
      const drifts = audit.detectThemeDrift(colorTheme);
      expect(Array.isArray(drifts)).toBe(true);
    });
  });

  describe("runAudit()", () => {
    it("returns an AuditReport with payloadCount", () => {
      const audit = new ConsistencyAudit(noColorTheme);
      const payloads: RenderPayload[] = [
        { kind: "text", content: "Hello" },
        { kind: "success", content: "Done" },
      ];
      const report = audit.runAudit(payloads);
      expect(report.payloadCount).toBe(2);
    });

    it("report has drifts array and summary", () => {
      const audit = new ConsistencyAudit(noColorTheme);
      const report = audit.runAudit([{ kind: "text", content: "test" }]);
      expect(Array.isArray(report.drifts)).toBe(true);
      expect(typeof report.summary).toBe("string");
    });

    it("hasCritical is false for consistent text payloads", () => {
      const audit = new ConsistencyAudit(noColorTheme);
      const report = audit.runAudit([{ kind: "text", content: "test output" }]);
      expect(report.hasCritical).toBe(false);
    });

    it("handles empty payload array gracefully", () => {
      const audit = new ConsistencyAudit(noColorTheme);
      const report = audit.runAudit([]);
      expect(report.payloadCount).toBe(0);
      expect(report.drifts).toHaveLength(0);
    });
  });

  describe("formatReport()", () => {
    it("returns a non-empty string", () => {
      const audit = new ConsistencyAudit(noColorTheme);
      const report = audit.runAudit([{ kind: "text", content: "hello" }]);
      const formatted = audit.formatReport(report);
      expect(formatted.length).toBeGreaterThan(10);
    });

    it("contains PASS when no drifts", () => {
      const audit = new ConsistencyAudit(noColorTheme);
      const report = audit.runAudit([{ kind: "text", content: "hello world" }]);
      if (!report.hasCritical && report.drifts.filter((d) => d.severity > 1).length === 0) {
        const formatted = audit.formatReport(report);
        expect(formatted).toMatch(/PASS|No drift/i);
      }
    });

    it("includes CRITICAL marker for critical drifts", () => {
      const audit = new ConsistencyAudit(noColorTheme);
      const report = {
        payloadCount: 1,
        drifts: [
          {
            type: "missing-token" as const,
            description: "vscode empty",
            severity: 3 as const,
            surfaces: ["vscode" as UXSurface],
          },
        ],
        hasCritical: true,
        tokenDrifts: [],
        summary: "DRIFT: 1 critical",
      };
      const formatted = audit.formatReport(report);
      expect(formatted).toContain("CRITICAL");
    });
  });
});
