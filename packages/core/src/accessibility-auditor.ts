// ============================================================================
// packages/core/src/accessibility-auditor.ts
//
// Dim 48 — Accessibility / Inclusive UX
// Static HTML accessibility auditor inspired by axe-core rule schema.
// Runs without a real DOM — parses HTML strings via regex to catch common
// WCAG 2.1 violations in generated webview output, documentation HTML,
// and preview panel content.
//
// Patterns from dequelabs/axe-core (MPL-2.0):
// - Rule schema: id, impact, wcagLevel, wcagCriteria, selector
// - Impact levels: critical > serious > moderate > minor
// - WCAG tag system: wcag2a / wcag2aa / best-practice
// Patterns from adobe/react-spectrum (Apache-2.0):
// - ARIA live region conventions, focus ring semantics
// ============================================================================

import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

// ── Types ─────────────────────────────────────────────────────────────────────

export type A11yImpact = "critical" | "serious" | "moderate" | "minor";
export type A11yWcagLevel = "wcag2a" | "wcag2aa" | "best-practice";

export interface A11yViolation {
  ruleId: string;
  impact: A11yImpact;
  wcagLevel: A11yWcagLevel;
  wcagCriteria: string;
  element: string;
  description: string;
  help: string;
}

export interface AccessibilityAuditResult {
  auditedAt: string;
  violations: A11yViolation[];
  passes: string[];
  violationCount: number;
  criticalCount: number;
  seriousCount: number;
  wcag2aViolations: number;
  wcag2aaViolations: number;
  score: number;
}

export interface A11yAuditLogEntry {
  sessionId: string;
  url: string;
  violationCount: number;
  criticalCount: number;
  wcag2aViolations: number;
  score: number;
  recordedAt: string;
}

// ── Internal Rule Definition ──────────────────────────────────────────────────

interface A11yRule {
  id: string;
  impact: A11yImpact;
  wcagLevel: A11yWcagLevel;
  wcagCriteria: string;
  description: string;
  help: string;
  check: (html: string) => string[];
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function extractMatches(html: string, pattern: RegExp): string[] {
  const matches: string[] = [];
  let m: RegExpExecArray | null;
  const re = new RegExp(pattern.source, pattern.flags.includes("g") ? pattern.flags : pattern.flags + "g");
  while ((m = re.exec(html)) !== null) {
    matches.push(m[0].slice(0, 120));
  }
  return matches;
}

function hasNonEmptyAttr(tag: string, attr: string): boolean {
  return new RegExp(`\\b${attr}\\s*=\\s*["'][^"'\\s][^"']*["']`, "i").test(tag);
}

function innerText(element: string): string {
  return element.replace(/<[^>]+>/g, "").trim();
}

// ── Rule Definitions (inspired by axe-core schema) ────────────────────────────

const RULES: A11yRule[] = [
  {
    id: "image-alt",
    impact: "critical",
    wcagLevel: "wcag2a",
    wcagCriteria: "WCAG 1.1.1",
    description: "Ensure <img> elements have alternative text",
    help: "Images must have an alt attribute",
    check(html) {
      const imgs = extractMatches(html, /<img\b[^>]*>/i);
      return imgs.filter(
        (tag) =>
          !hasNonEmptyAttr(tag, "alt") &&
          !/\balt\s*=\s*["']{2}/i.test(tag) &&
          !hasNonEmptyAttr(tag, "aria-label") &&
          !hasNonEmptyAttr(tag, "aria-labelledby") &&
          !/role\s*=\s*["']presentation["']/i.test(tag),
      );
    },
  },
  {
    id: "button-name",
    impact: "critical",
    wcagLevel: "wcag2a",
    wcagCriteria: "WCAG 4.1.2",
    description: "Ensure buttons have discernible text",
    help: "Buttons must have discernible text or aria-label",
    check(html) {
      const buttons = extractMatches(html, /<button\b[^>]*>[\s\S]*?<\/button>/i);
      return buttons.filter(
        (el) =>
          !hasNonEmptyAttr(el, "aria-label") &&
          !hasNonEmptyAttr(el, "aria-labelledby") &&
          innerText(el) === "",
      );
    },
  },
  {
    id: "link-name",
    impact: "serious",
    wcagLevel: "wcag2a",
    wcagCriteria: "WCAG 2.4.4",
    description: "Ensure links have discernible text",
    help: "Links must have discernible text or aria-label",
    check(html) {
      const links = extractMatches(html, /<a\b[^>]*href[^>]*>[\s\S]*?<\/a>/i);
      return links.filter(
        (el) =>
          !hasNonEmptyAttr(el, "aria-label") &&
          !hasNonEmptyAttr(el, "aria-labelledby") &&
          !hasNonEmptyAttr(el, "title") &&
          innerText(el) === "",
      );
    },
  },
  {
    id: "label",
    impact: "critical",
    wcagLevel: "wcag2a",
    wcagCriteria: "WCAG 4.1.2",
    description: "Ensure every form input has a label",
    help: "Form inputs must have labels or aria-label",
    check(html) {
      const inputs = extractMatches(html, /<(input|textarea)\b[^>]*>/i);
      return inputs.filter((tag) => {
        if (/type\s*=\s*["'](hidden|submit|button|reset|image)["']/i.test(tag)) return false;
        return (
          !hasNonEmptyAttr(tag, "aria-label") &&
          !hasNonEmptyAttr(tag, "aria-labelledby") &&
          !hasNonEmptyAttr(tag, "id")
        );
      });
    },
  },
  {
    id: "html-has-lang",
    impact: "serious",
    wcagLevel: "wcag2a",
    wcagCriteria: "WCAG 3.1.1",
    description: "Ensure the <html> element has a lang attribute",
    help: "<html> element must have a lang attribute",
    check(html) {
      const htmlTag = html.match(/<html\b[^>]*>/i);
      if (!htmlTag) return [];
      return hasNonEmptyAttr(htmlTag[0], "lang") ? [] : [htmlTag[0]];
    },
  },
  {
    id: "tabindex",
    impact: "serious",
    wcagLevel: "best-practice",
    wcagCriteria: "Best Practice",
    description: "Ensure tabindex values are not greater than 0",
    help: "Elements should not have tabindex greater than zero",
    check(html) {
      const elements = extractMatches(html, /<[a-z][^>]*tabindex\s*=\s*["'][^"']*["'][^>]*>/i);
      return elements.filter((tag) => {
        const m = tag.match(/tabindex\s*=\s*["'](\d+)["']/i);
        return m ? parseInt(m[1]!, 10) > 0 : false;
      });
    },
  },
  {
    id: "heading-order",
    impact: "moderate",
    wcagLevel: "best-practice",
    wcagCriteria: "Best Practice",
    description: "Ensure heading levels only increase by one",
    help: "Heading levels should not be skipped",
    check(html) {
      const headings = extractMatches(html, /<h([1-6])\b[^>]*>/gi);
      const levels = headings.map((h) => {
        const m = h.match(/<h([1-6])/i);
        return m ? parseInt(m[1]!, 10) : 0;
      });
      const violations: string[] = [];
      for (let i = 1; i < levels.length; i++) {
        const prev = levels[i - 1]!;
        const curr = levels[i]!;
        if (curr > prev + 1) {
          violations.push(`<h${prev}> followed by <h${curr}> (skipped level)`);
        }
      }
      return violations;
    },
  },
  {
    id: "aria-hidden-focus",
    impact: "serious",
    wcagLevel: "wcag2a",
    wcagCriteria: "WCAG 1.3.1",
    description: "Ensure aria-hidden elements do not contain focusable elements",
    help: "Focusable elements should not be inside aria-hidden regions",
    check(html) {
      const hiddenRegions = extractMatches(
        html,
        /aria-hidden\s*=\s*["']true["'][^>]*>[\s\S]*?<\//i,
      );
      return hiddenRegions.filter((region) => /<(a|button|input|select|textarea)\b/i.test(region));
    },
  },
  {
    id: "select-name",
    impact: "critical",
    wcagLevel: "wcag2a",
    wcagCriteria: "WCAG 4.1.2",
    description: "Ensure <select> elements have accessible labels",
    help: "<select> elements must have labels or aria-label",
    check(html) {
      const selects = extractMatches(html, /<select\b[^>]*>/i);
      return selects.filter(
        (tag) =>
          !hasNonEmptyAttr(tag, "aria-label") &&
          !hasNonEmptyAttr(tag, "aria-labelledby") &&
          !hasNonEmptyAttr(tag, "id"),
      );
    },
  },
];

// ── Audit Engine ──────────────────────────────────────────────────────────────

export function runAccessibilityAudit(html: string): AccessibilityAuditResult {
  const violations: A11yViolation[] = [];
  const passes: string[] = [];

  for (const rule of RULES) {
    const elements = rule.check(html);
    if (elements.length === 0) {
      passes.push(rule.id);
    } else {
      for (const element of elements) {
        violations.push({
          ruleId: rule.id,
          impact: rule.impact,
          wcagLevel: rule.wcagLevel,
          wcagCriteria: rule.wcagCriteria,
          element,
          description: rule.description,
          help: rule.help,
        });
      }
    }
  }

  const criticalCount = violations.filter((v) => v.impact === "critical").length;
  const seriousCount = violations.filter((v) => v.impact === "serious").length;
  const wcag2aViolations = violations.filter((v) => v.wcagLevel === "wcag2a").length;
  const wcag2aaViolations = violations.filter((v) => v.wcagLevel === "wcag2aa").length;

  const penalty = violations.reduce((sum, v) => {
    const weights: Record<A11yImpact, number> = { critical: 20, serious: 10, moderate: 5, minor: 2 };
    return sum + (weights[v.impact] ?? 2);
  }, 0);
  const score = Math.max(0, 100 - penalty);

  return {
    auditedAt: new Date().toISOString(),
    violations,
    passes,
    violationCount: violations.length,
    criticalCount,
    seriousCount,
    wcag2aViolations,
    wcag2aaViolations,
    score,
  };
}

// ── A11y Report ───────────────────────────────────────────────────────────────

export function generateA11yReport(result: AccessibilityAuditResult): string {
  const lines: string[] = [
    `# Accessibility Audit Report`,
    `Audited: ${result.auditedAt}`,
    `Score: ${result.score}/100`,
    `Total violations: ${result.violationCount} (${result.criticalCount} critical, ${result.seriousCount} serious)`,
    `WCAG 2.0 Level A violations: ${result.wcag2aViolations}`,
    `WCAG 2.0 Level AA violations: ${result.wcag2aaViolations}`,
    ``,
    `## Violations`,
  ];

  if (result.violations.length === 0) {
    lines.push("No violations found.");
  } else {
    for (const v of result.violations) {
      lines.push(`### [${v.impact.toUpperCase()}] ${v.ruleId} — ${v.wcagCriteria}`);
      lines.push(`${v.description}`);
      lines.push(`Help: ${v.help}`);
      lines.push(`Element: \`${v.element}\``);
      lines.push(``);
    }
  }

  lines.push(`## Passes (${result.passes.length} rules)`);
  lines.push(result.passes.join(", ") || "none");
  return lines.join("\n");
}

// ── JSONL Persistence ─────────────────────────────────────────────────────────

const AUDIT_LOG_FILE = ".danteforge/accessibility-audit-log.jsonl";

export function recordA11yAudit(entry: A11yAuditLogEntry, projectRoot: string): void {
  try {
    const dir = join(resolve(projectRoot), ".danteforge");
    mkdirSync(dir, { recursive: true });
    appendFileSync(
      join(dir, "accessibility-audit-log.jsonl"),
      JSON.stringify(entry) + "\n",
      "utf-8",
    );
  } catch { /* non-fatal */ }
}

export function loadA11yAuditLog(projectRoot: string): A11yAuditLogEntry[] {
  const path = join(resolve(projectRoot), AUDIT_LOG_FILE);
  if (!existsSync(path)) return [];
  try {
    return readFileSync(path, "utf-8")
      .split("\n")
      .filter(Boolean)
      .map((l) => JSON.parse(l) as A11yAuditLogEntry);
  } catch {
    return [];
  }
}

export function getA11yTrendScore(entries: A11yAuditLogEntry[]): number {
  if (entries.length === 0) return 100;
  const recent = entries.slice(-5);
  return Math.round(recent.reduce((sum, e) => sum + e.score, 0) / recent.length);
}
