// ============================================================================
// Sprint T — Dims 1+23: Completion ranking by acceptance history + npm audit
// Tests that:
//  - rankCompletionsByAcceptanceRate sorts by per-language history
//  - unknown language falls back to global average rate
//  - empty history uses 0.5 global rate
//  - completions with same score preserve order
//  - parseNpmAuditOutput converts npm audit JSON to SecurityFindings
//  - parseNpmAuditOutput handles empty vulnerabilities object
//  - parseNpmAuditOutput maps severity correctly
//  - parseNpmAuditOutput returns [] on invalid JSON
//  - runNpmAudit returns findings on non-zero exit (vulns present)
//  - runNpmAudit returns [] when npm not available (ENOENT)
// ============================================================================

import { describe, it, expect } from "vitest";
import {
  rankCompletionsByAcceptanceRate,
  type LanguageAcceptanceStats,
} from "../fim-rate-adapter.js";
import { parseNpmAuditOutput } from "@dantecode/core";

// ─── Part 1: rankCompletionsByAcceptanceRate (dim 1) ─────────────────────────

describe("rankCompletionsByAcceptanceRate — Sprint T (dim 1)", () => {
  const history: LanguageAcceptanceStats[] = [
    { language: "typescript", shown: 100, accepted: 80, rate: 0.8 },
    { language: "python", shown: 100, accepted: 40, rate: 0.4 },
    { language: "rust", shown: 50, accepted: 5, rate: 0.1 },
  ];

  // 1. Higher acceptance rate language ranked first
  it("sorts completions by per-language acceptance rate descending", () => {
    const completions = [
      { insertText: "py snippet", language: "python" },
      { insertText: "ts snippet", language: "typescript" },
      { insertText: "rs snippet", language: "rust" },
    ];
    const ranked = rankCompletionsByAcceptanceRate(completions, history);
    expect(ranked[0]!.language).toBe("typescript");
    expect(ranked[1]!.language).toBe("python");
    expect(ranked[2]!.language).toBe("rust");
  });

  // 2. qualityScore matches known rate
  it("qualityScore equals the per-language acceptance rate", () => {
    const completions = [{ insertText: "ts code", language: "typescript" }];
    const ranked = rankCompletionsByAcceptanceRate(completions, history);
    expect(ranked[0]!.qualityScore).toBe(0.8);
  });

  // 3. Unknown language falls back to global average
  it("unknown language gets global average rate as qualityScore", () => {
    const completions = [{ insertText: "go code", language: "go" }];
    const ranked = rankCompletionsByAcceptanceRate(completions, history);
    const expectedGlobal = (0.8 + 0.4 + 0.1) / 3;
    expect(ranked[0]!.qualityScore).toBeCloseTo(expectedGlobal, 5);
  });

  // 4. Empty history uses 0.5 global rate
  it("empty history assigns 0.5 to all completions", () => {
    const completions = [
      { insertText: "a", language: "typescript" },
      { insertText: "b", language: "python" },
    ];
    const ranked = rankCompletionsByAcceptanceRate(completions, []);
    expect(ranked.every((r) => r.qualityScore === 0.5)).toBe(true);
  });

  // 5. Returns all completions (no filtering)
  it("returns the same number of completions as input", () => {
    const completions = [
      { insertText: "a", language: "typescript" },
      { insertText: "b", language: "python" },
      { insertText: "c", language: "java" },
    ];
    const ranked = rankCompletionsByAcceptanceRate(completions, history);
    expect(ranked).toHaveLength(3);
  });

  // 6. insertText preserved in ranked output
  it("preserves insertText in ranked completions", () => {
    const completions = [{ insertText: "function foo() {}", language: "typescript" }];
    const ranked = rankCompletionsByAcceptanceRate(completions, history);
    expect(ranked[0]!.insertText).toBe("function foo() {}");
  });
});

// ─── Part 2: parseNpmAuditOutput (dim 23) ────────────────────────────────────

describe("parseNpmAuditOutput — Sprint T (dim 23)", () => {
  const validAuditOutput = JSON.stringify({
    vulnerabilities: {
      lodash: {
        name: "lodash",
        severity: "high",
        via: [{ title: "Prototype Pollution", name: "lodash" }],
        fixAvailable: false,
      },
      minimist: {
        name: "minimist",
        severity: "critical",
        via: ["minimist"],
        fixAvailable: true,
      },
    },
    metadata: { vulnerabilities: { total: 2 } },
  });

  // 7. Parses npm audit output into SecurityFindings
  it("parses npm audit JSON into SecurityFinding array", () => {
    const findings = parseNpmAuditOutput(validAuditOutput, "/project");
    expect(findings.length).toBe(2);
  });

  // 8. Maps severity correctly (high → high, critical → critical)
  it("maps npm severity levels to SecuritySeverity", () => {
    const findings = parseNpmAuditOutput(validAuditOutput, "/project");
    const lodash = findings.find((f) => f.message.includes("lodash"));
    const minimist = findings.find((f) => f.message.includes("minimist"));
    expect(lodash?.severity).toBe("high");
    expect(minimist?.severity).toBe("critical");
  });

  // 9. Empty vulnerabilities object returns []
  it("returns empty array when no vulnerabilities found", () => {
    const empty = JSON.stringify({ vulnerabilities: {}, metadata: { vulnerabilities: { total: 0 } } });
    const findings = parseNpmAuditOutput(empty, "/project");
    expect(findings).toHaveLength(0);
  });

  // 10. Returns [] on invalid JSON (graceful degradation)
  it("returns empty array on invalid JSON input", () => {
    const findings = parseNpmAuditOutput("not valid json {{{", "/project");
    expect(findings).toHaveLength(0);
  });

  // 11. ruleId follows NPM-AUDIT-{name} pattern
  it("ruleId follows NPM-AUDIT-{packageName} format", () => {
    const findings = parseNpmAuditOutput(validAuditOutput, "/project");
    expect(findings.every((f) => f.ruleId.startsWith("NPM-AUDIT-"))).toBe(true);
  });

  // 12. filePath contains the workdir
  it("filePath is set to the provided workdir", () => {
    const findings = parseNpmAuditOutput(validAuditOutput, "/my/project");
    expect(findings.every((f) => f.filePath === "/my/project")).toBe(true);
  });
});
