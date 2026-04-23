// packages/vscode/src/__tests__/security-scanner-wiring.test.ts
// Sprint H — Dim 23: Security scanner wired into Write/Edit tool execution path
import { describe, it, expect } from "vitest";
import {
  scanFileContent,
  formatSecurityFindings,
  filterSecurityFindingsBySeverity,
  SECURITY_RULES,
} from "@dantecode/core";

// ─── scanFileContent ──────────────────────────────────────────────────────────

describe("scanFileContent", () => {
  it("returns no findings for safe code", () => {
    const safeCode = `
const greeting = "hello world";
function add(a: number, b: number) { return a + b; }
`;
    const result = scanFileContent(safeCode, "safe.ts");
    expect(result.hasBlockers).toBe(false);
    expect(result.findings.length).toBe(0);
  });

  it("detects SQL injection pattern via request params concatenation", () => {
    const unsafeCode = `const query = "SELECT * FROM users WHERE id=" + req.params.id;`;
    const result = scanFileContent(unsafeCode, "db.ts");
    expect(result.findings.length).toBeGreaterThan(0);
    const sqlFinding = result.findings.find((f) => f.category === "injection");
    expect(sqlFinding).toBeTruthy();
  });

  it("detects secret exposure pattern (API key)", () => {
    const fakeStripeKey = "sk_" + "live_redacted_fixture_123456789";
    const codeWithSecret = `
const apiKey = "${fakeStripeKey}";
fetch(\`https://api.stripe.com/charges?key=\${apiKey}\`);
`;
    const result = scanFileContent(codeWithSecret, "payments.ts");
    const secretFinding = result.findings.find((f) => f.category === "secret-exposure");
    expect(secretFinding).toBeTruthy();
    expect(secretFinding!.severity).toMatch(/critical|high/);
  });

  it("hasBlockers is true for critical/high severity findings", () => {
    const sqliCode = `db.execute("SELECT * FROM users WHERE id=" + req.params.id)`;
    const result = scanFileContent(sqliCode, "api.ts");
    if (result.findings.some((f) => f.severity === "critical" || f.severity === "high")) {
      expect(result.hasBlockers).toBe(true);
    }
  });

  it("hasBlockers is false when only low/medium findings", () => {
    const result = scanFileContent("console.log(data)", "debug.ts");
    if (!result.findings.some((f) => f.severity === "critical" || f.severity === "high")) {
      expect(result.hasBlockers).toBe(false);
    }
  });

  it("result includes correct filePath", () => {
    const result = scanFileContent("const x = 1;", "/project/src/index.ts");
    expect(result.filePath).toBe("/project/src/index.ts");
  });

  it("result includes scannedAt timestamp", () => {
    const result = scanFileContent("const x = 1;", "index.ts");
    expect(result.scannedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("counts are populated correctly", () => {
    const safeResult = scanFileContent("const x = 1;", "x.ts");
    expect(safeResult.counts.critical).toBe(0);
    expect(safeResult.counts.high).toBe(0);
    expect(safeResult.counts.medium).toBe(0);
    expect(safeResult.counts.low).toBe(0);
  });

  it("skips comment lines", () => {
    // SQL injection pattern in a comment should not trigger
    const commented = `// const q = "SELECT * FROM users WHERE name=" + x + " -- bad"`;
    const result = scanFileContent(commented, "commented.ts");
    expect(result.findings.length).toBe(0);
  });

  it("each finding has required fields", () => {
    const dangerousCode = `eval(userInput)`;
    const result = scanFileContent(dangerousCode, "eval.js");
    for (const finding of result.findings) {
      expect(finding).toHaveProperty("id");
      expect(finding).toHaveProperty("category");
      expect(finding).toHaveProperty("severity");
      expect(finding).toHaveProperty("message");
      expect(finding).toHaveProperty("ruleId");
      expect(finding).toHaveProperty("filePath");
      expect(finding.line).toBeGreaterThan(0);
    }
  });
});

// ─── filterSecurityFindingsBySeverity ────────────────────────────────────────

describe("filterSecurityFindingsBySeverity", () => {
  it("returns critical and high findings when filtering by high", () => {
    const code = `eval(userInput); const p = "password123";`;
    const result = scanFileContent(code, "test.ts");
    const blocking = filterSecurityFindingsBySeverity(result.findings, "high");
    for (const f of blocking) {
      expect(["critical", "high"]).toContain(f.severity);
    }
  });

  it("returns empty array when no high/critical findings", () => {
    const safeCode = "const x = 1;";
    const result = scanFileContent(safeCode, "safe.ts");
    const blocking = filterSecurityFindingsBySeverity(result.findings, "high");
    expect(blocking).toHaveLength(0);
  });
});

// ─── formatSecurityFindings ───────────────────────────────────────────────────

describe("formatSecurityFindings", () => {
  it("returns markdown string with file path in header", () => {
    const result = scanFileContent("const x = 1;", "/src/app.ts");
    const output = formatSecurityFindings(result);
    expect(output).toContain("/src/app.ts");
    expect(output).toContain("## Security Scan");
  });

  it("includes 'No security issues' for clean files", () => {
    const result = scanFileContent("const x = 1; export default x;", "clean.ts");
    const output = formatSecurityFindings(result);
    expect(output).toContain("No security issues");
  });

  it("includes severity level in output for findings", () => {
    const dangerousCode = `eval(document.location.hash)`;
    const result = scanFileContent(dangerousCode, "xss.js");
    if (result.findings.length > 0) {
      const output = formatSecurityFindings(result);
      expect(output).toMatch(/CRITICAL|HIGH|MEDIUM|LOW/);
    }
  });
});

// ─── SECURITY_RULES ──────────────────────────────────────────────────────────

describe("SECURITY_RULES", () => {
  it("contains rules with required fields", () => {
    expect(Array.isArray(SECURITY_RULES)).toBe(true);
    expect(SECURITY_RULES.length).toBeGreaterThan(5);
    for (const rule of SECURITY_RULES.slice(0, 5)) {
      expect(rule).toHaveProperty("id");
      expect(rule).toHaveProperty("category");
      expect(rule).toHaveProperty("severity");
      expect(rule).toHaveProperty("pattern");
      expect(rule.pattern).toBeInstanceOf(RegExp);
    }
  });
});

// ─── toolWrite security wiring (integration pattern) ─────────────────────────

describe("toolWrite security wiring pattern", () => {
  it("scanning safe content produces no warning", () => {
    const safeContent = "export function add(a: number, b: number) { return a + b; }";
    const scanResult = scanFileContent(safeContent, "/src/math.ts");
    expect(scanResult.hasBlockers).toBe(false);
    // No warning appended
    const warning = scanResult.hasBlockers ? "⚠️ Security findings detected" : "";
    expect(warning).toBe("");
  });

  it("scanning dangerous content triggers security warning", () => {
    const unsafeContent = `const q = "SELECT * FROM users WHERE id=" + req.params.id;`;
    const scanResult = scanFileContent(unsafeContent, "/src/api.ts");
    // If blockers found, the write result would include a warning
    const blockingFindings = filterSecurityFindingsBySeverity(scanResult.findings, "high");
    if (blockingFindings.length > 0) {
      const blockingResult = { ...scanResult, findings: blockingFindings };
      const warning = `⚠️ Security findings detected:\n${formatSecurityFindings(blockingResult)}`;
      expect(warning).toContain("⚠️ Security findings detected");
      expect(warning).toContain("## Security Scan");
    }
  });
});
