// ============================================================================
// Sprint Dim 48: Accessibility / Inclusive UX tests
// ============================================================================

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, mkdirSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  runAccessibilityAudit,
  generateA11yReport,
  recordA11yAudit,
  loadA11yAuditLog,
  getA11yTrendScore,
} from "@dantecode/core";

let tmpDir: string;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "dim48-test-"));
  mkdirSync(join(tmpDir, ".danteforge"), { recursive: true });
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

describe("runAccessibilityAudit", () => {
  it("returns no violations for clean accessible HTML", () => {
    const html = [
      '<!DOCTYPE html>',
      '<html lang="en">',
      '<head><title>Test</title></head>',
      '<body>',
      '  <h1>Title</h1>',
      '  <h2>Section</h2>',
      '  <img src="logo.png" alt="Company logo" />',
      '  <button aria-label="Close dialog">X</button>',
      '  <a href="/about">About us</a>',
      '  <input id="email" type="text" aria-label="Email address" />',
      '</body>',
      '</html>',
    ].join("\n");
    const result = runAccessibilityAudit(html);
    expect(result.violationCount).toBe(0);
    expect(result.passes.length).toBeGreaterThan(0);
    expect(result.score).toBe(100);
  });

  it("detects image-alt violation for img without alt", () => {
    const html = '<html lang="en"><body><img src="logo.png" /></body></html>';
    const result = runAccessibilityAudit(html);
    const violation = result.violations.find((v) => v.ruleId === "image-alt");
    expect(violation).toBeDefined();
    expect(violation!.impact).toBe("critical");
    expect(violation!.wcagLevel).toBe("wcag2a");
  });

  it("does NOT flag img with empty alt", () => {
    const html = '<html lang="en"><body><img src="decorative.png" alt="" /></body></html>';
    const result = runAccessibilityAudit(html);
    expect(result.violations.find((v) => v.ruleId === "image-alt")).toBeUndefined();
  });

  it("detects button-name violation for empty button", () => {
    const html = '<html lang="en"><body><button></button></body></html>';
    const result = runAccessibilityAudit(html);
    const violation = result.violations.find((v) => v.ruleId === "button-name");
    expect(violation).toBeDefined();
    expect(violation!.impact).toBe("critical");
  });

  it("does NOT flag button with aria-label", () => {
    const html = '<html lang="en"><body><button aria-label="Close">X</button></body></html>';
    const result = runAccessibilityAudit(html);
    expect(result.violations.find((v) => v.ruleId === "button-name")).toBeUndefined();
  });

  it("detects link-name violation for empty anchor", () => {
    const html = '<html lang="en"><body><a href="/page"></a></body></html>';
    const result = runAccessibilityAudit(html);
    const violation = result.violations.find((v) => v.ruleId === "link-name");
    expect(violation).toBeDefined();
    expect(violation!.wcagLevel).toBe("wcag2a");
  });

  it("detects html-has-lang violation when lang is missing", () => {
    const html = "<html><body><p>Hello</p></body></html>";
    const result = runAccessibilityAudit(html);
    const violation = result.violations.find((v) => v.ruleId === "html-has-lang");
    expect(violation).toBeDefined();
    expect(violation!.impact).toBe("serious");
  });

  it("does NOT flag html-has-lang when lang is present", () => {
    const html = '<html lang="en"><body><p>Hello</p></body></html>';
    const result = runAccessibilityAudit(html);
    expect(result.violations.find((v) => v.ruleId === "html-has-lang")).toBeUndefined();
  });

  it("detects tabindex violation for tabindex > 0", () => {
    const html = '<html lang="en"><body><div tabindex="2">item</div></body></html>';
    const result = runAccessibilityAudit(html);
    const violation = result.violations.find((v) => v.ruleId === "tabindex");
    expect(violation).toBeDefined();
    expect(violation!.wcagLevel).toBe("best-practice");
  });

  it("score is lower for more violations", () => {
    const bad = "<html><body><img src=\"a.png\" /><img src=\"b.png\" /><button></button></body></html>";
    const good = '<html lang="en"><body><p>OK</p></body></html>';
    expect(runAccessibilityAudit(bad).score).toBeLessThan(runAccessibilityAudit(good).score);
  });

  it("criticalCount matches actual critical violations", () => {
    const html = '<html lang="en"><body><img src="x.png" /><button></button></body></html>';
    const result = runAccessibilityAudit(html);
    const actual = result.violations.filter((v) => v.impact === "critical").length;
    expect(result.criticalCount).toBe(actual);
  });

  it("wcag2aViolations counts only wcag2a violations", () => {
    const html = "<html><body><img src=\"x.png\" /></body></html>";
    const result = runAccessibilityAudit(html);
    const actual = result.violations.filter((v) => v.wcagLevel === "wcag2a").length;
    expect(result.wcag2aViolations).toBe(actual);
  });

  it("violations include element snippet", () => {
    const html = '<html lang="en"><body><img src="no-alt.png" /></body></html>';
    const result = runAccessibilityAudit(html);
    const v = result.violations.find((v) => v.ruleId === "image-alt");
    expect(v!.element).toContain("no-alt.png");
  });
});

describe("generateA11yReport", () => {
  it("returns markdown with score", () => {
    const result = runAccessibilityAudit('<html lang="en"><body><p>OK</p></body></html>');
    const report = generateA11yReport(result);
    expect(report).toContain("# Accessibility Audit Report");
    expect(report).toContain("Score:");
  });

  it("includes violation rule IDs in report", () => {
    const result = runAccessibilityAudit("<html><body><img src=\"x.png\" /></body></html>");
    const report = generateA11yReport(result);
    expect(report).toContain("image-alt");
  });

  it("shows passes section", () => {
    const result = runAccessibilityAudit('<html lang="en"><body></body></html>');
    const report = generateA11yReport(result);
    expect(report).toContain("## Passes");
  });
});

describe("recordA11yAudit + loadA11yAuditLog", () => {
  it("creates audit log file on first record", () => {
    recordA11yAudit(
      { sessionId: "s1", url: "http://localhost:3000", violationCount: 2, criticalCount: 1, wcag2aViolations: 2, score: 60, recordedAt: "" },
      tmpDir,
    );
    expect(existsSync(join(tmpDir, ".danteforge", "accessibility-audit-log.jsonl"))).toBe(true);
  });

  it("reads back entries correctly", () => {
    recordA11yAudit({ sessionId: "s1", url: "http://localhost:3000", violationCount: 0, criticalCount: 0, wcag2aViolations: 0, score: 100, recordedAt: "" }, tmpDir);
    recordA11yAudit({ sessionId: "s2", url: "http://localhost:5173", violationCount: 3, criticalCount: 2, wcag2aViolations: 3, score: 40, recordedAt: "" }, tmpDir);
    const entries = loadA11yAuditLog(tmpDir);
    expect(entries).toHaveLength(2);
    expect(entries[0]!.sessionId).toBe("s1");
    expect(entries[1]!.score).toBe(40);
  });

  it("returns empty array when no file", () => {
    expect(loadA11yAuditLog(tmpDir)).toEqual([]);
  });
});

describe("getA11yTrendScore", () => {
  it("returns 100 for empty entries", () => {
    expect(getA11yTrendScore([])).toBe(100);
  });

  it("returns average of last 5 scores", () => {
    const entries = [80, 60, 100, 40, 80].map((score, i) => ({
      sessionId: "s" + i,
      url: "",
      violationCount: 0,
      criticalCount: 0,
      wcag2aViolations: 0,
      score,
      recordedAt: "",
    }));
    expect(getA11yTrendScore(entries)).toBe(72);
  });

  it("only uses last 5 when more entries exist", () => {
    const entries = Array.from({ length: 10 }, (_, i) => ({
      sessionId: "s" + i,
      url: "",
      violationCount: 0,
      criticalCount: 0,
      wcag2aViolations: 0,
      score: i < 5 ? 0 : 100,
      recordedAt: "",
    }));
    expect(getA11yTrendScore(entries)).toBe(100);
  });
});
