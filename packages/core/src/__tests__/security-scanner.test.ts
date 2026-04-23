// packages/core/src/__tests__/security-scanner.test.ts
import { describe, it, expect } from "vitest";
import {
  scanFileContent,
  filterFindingsBySeverity,
  sortFindingsBySeverity,
  groupFindingsByCategory,
  formatSecurityFindings,
  isSecretExposure,
  SECURITY_RULES,
  type SecurityFinding,
} from "../security-scanner.js";

// ─── scanFileContent ──────────────────────────────────────────────────────────

describe("scanFileContent", () => {
  it("returns empty findings for clean code", () => {
    const result = scanFileContent("const x = 1;\nexport { x };", "safe.ts");
    expect(result.findings).toHaveLength(0);
    expect(result.hasBlockers).toBe(false);
  });

  it("detects innerHTML XSS", () => {
    const code = `element.innerHTML = userInput;`;
    const result = scanFileContent(code, "comp.tsx");
    expect(result.findings.some((f) => f.ruleId === "xss-inner-html")).toBe(true);
  });

  it("detects SQL injection via template literal", () => {
    const code = 'const q = `SELECT * FROM users WHERE id = ${req.params.id}`;';
    const result = scanFileContent(code, "db.ts");
    expect(result.findings.some((f) => f.category === "injection")).toBe(true);
  });

  it("detects eval usage", () => {
    const code = `const result = eval(userInput);`;
    const result = scanFileContent(code, "eval.ts");
    expect(result.findings.some((f) => f.ruleId === "eval-usage")).toBe(true);
  });

  it("detects hardcoded password", () => {
    const code = `const password = "supersecret123";`;
    const result = scanFileContent(code, "config.ts");
    expect(result.findings.some((f) => f.category === "secret-exposure")).toBe(true);
  });

  it("detects AWS access key", () => {
    const awsKey = "AKIA" + "IOSFODNN7EXAMPLE";
    const code = `const key = "${awsKey}";`;
    const result = scanFileContent(code, "aws.ts");
    expect(result.findings.some((f) => f.ruleId === "aws-key")).toBe(true);
  });

  it("detects GitHub token pattern", () => {
    const githubToken = "ghp_" + "abcdefghijklmnopqrstuvwxyz12345";
    const code = `const token = "${githubToken}";`;
    const result = scanFileContent(code, "auth.ts");
    expect(result.findings.some((f) => f.ruleId === "generic-token")).toBe(true);
  });

  it("detects dangerouslySetInnerHTML", () => {
    const code = `<div dangerouslySetInnerHTML={{ __html: content }} />`;
    const result = scanFileContent(code, "React.tsx");
    expect(result.findings.some((f) => f.ruleId === "xss-dangerously-set")).toBe(true);
  });

  it("detects weak MD5 hash", () => {
    const code = `crypto.createHash('md5').update(data).digest('hex');`;
    const result = scanFileContent(code, "hash.ts");
    expect(result.findings.some((f) => f.ruleId === "weak-hash-md5")).toBe(true);
  });

  it("detects prototype pollution", () => {
    const code = `obj['__proto__']['polluted'] = true;`;
    const result = scanFileContent(code, "merge.ts");
    expect(result.findings.some((f) => f.category === "prototype-pollution")).toBe(true);
  });

  it("sets hasBlockers=true for critical/high findings", () => {
    const code = `element.innerHTML = userInput;`;
    const result = scanFileContent(code, "f.ts");
    expect(result.hasBlockers).toBe(true);
  });

  it("counts severity correctly", () => {
    const code = `element.innerHTML = userInput;\nconst x = eval(foo);`;
    const result = scanFileContent(code, "f.ts");
    expect(result.counts.high + result.counts.critical).toBeGreaterThan(0);
  });

  it("includes file path in finding", () => {
    const code = `element.innerHTML = x;`;
    const result = scanFileContent(code, "src/components/Comp.tsx");
    expect(result.findings[0]!.filePath).toBe("src/components/Comp.tsx");
  });

  it("includes line number in finding (1-indexed)", () => {
    const code = `const x = 1;\nelement.innerHTML = x;`;
    const result = scanFileContent(code, "f.ts");
    const xss = result.findings.find((f) => f.ruleId === "xss-inner-html");
    expect(xss?.line).toBe(2);
  });

  it("skips comment-only lines", () => {
    const code = `// element.innerHTML = userInput;\nconst x = 1;`;
    const result = scanFileContent(code, "f.ts");
    expect(result.findings.some((f) => f.ruleId === "xss-inner-html")).toBe(false);
  });

  it("scannedAt is a valid ISO timestamp", () => {
    const result = scanFileContent("const x = 1;", "f.ts");
    expect(result.scannedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });
});

// ─── filterFindingsBySeverity ─────────────────────────────────────────────────

describe("filterFindingsBySeverity", () => {
  function makeFinding(severity: SecurityFinding["severity"]): SecurityFinding {
    return { id: "f1", category: "xss", severity, message: "msg", snippet: "x", line: 1, col: 0, filePath: "f.ts", ruleId: "r1" };
  }

  it("keeps findings at or above threshold", () => {
    const findings = [makeFinding("critical"), makeFinding("high"), makeFinding("low")];
    const filtered = filterFindingsBySeverity(findings, "high");
    expect(filtered.some((f) => f.severity === "critical")).toBe(true);
    expect(filtered.some((f) => f.severity === "high")).toBe(true);
    expect(filtered.some((f) => f.severity === "low")).toBe(false);
  });

  it("returns empty when none meet threshold", () => {
    const findings = [makeFinding("info")];
    expect(filterFindingsBySeverity(findings, "high")).toHaveLength(0);
  });
});

// ─── sortFindingsBySeverity ───────────────────────────────────────────────────

describe("sortFindingsBySeverity", () => {
  it("sorts critical before high before medium", () => {
    const findings = [
      { id: "1", category: "xss" as const, severity: "medium" as const, message: "", snippet: "", line: 1, col: 0, filePath: "f", ruleId: "r" },
      { id: "2", category: "xss" as const, severity: "critical" as const, message: "", snippet: "", line: 2, col: 0, filePath: "f", ruleId: "r" },
    ];
    const sorted = sortFindingsBySeverity(findings);
    expect(sorted[0]!.severity).toBe("critical");
  });
});

// ─── groupFindingsByCategory ──────────────────────────────────────────────────

describe("groupFindingsByCategory", () => {
  it("groups by category", () => {
    const code = `element.innerHTML = x;\nconst password = "secret123";`;
    const findings = scanFileContent(code, "f.ts").findings;
    const grouped = groupFindingsByCategory(findings);
    expect(grouped.has("xss")).toBe(true);
    expect(grouped.has("secret-exposure")).toBe(true);
  });
});

// ─── formatSecurityFindings ───────────────────────────────────────────────────

describe("formatSecurityFindings", () => {
  it("shows '✅ No security issues' for clean result", () => {
    const result = scanFileContent("const x = 1;", "safe.ts");
    expect(formatSecurityFindings(result)).toContain("No security issues");
  });

  it("includes '## Security Scan' header", () => {
    const result = scanFileContent("element.innerHTML = x;", "f.ts");
    expect(formatSecurityFindings(result)).toContain("## Security Scan");
  });

  it("shows BLOCKING ISSUES when hasBlockers=true", () => {
    const result = scanFileContent("element.innerHTML = x;", "f.ts");
    expect(formatSecurityFindings(result)).toContain("BLOCKING");
  });

  it("includes rule ID in output", () => {
    const result = scanFileContent("element.innerHTML = x;", "f.ts");
    expect(formatSecurityFindings(result)).toContain("xss-inner-html");
  });

  it("includes remediation text", () => {
    const result = scanFileContent("element.innerHTML = x;", "f.ts");
    const output = formatSecurityFindings(result);
    expect(output).toContain("textContent");
  });

  it("limits output to maxFindings", () => {
    // Generate many findings by putting multiple patterns
    const code = Array.from({ length: 20 }, (_, i) => `element${i}.innerHTML = x;`).join("\n");
    const result = scanFileContent(code, "f.ts");
    const output = formatSecurityFindings(result, 3);
    // Should mention "more findings" if we have more than 3
    if (result.findings.length > 3) {
      expect(output).toContain("more findings");
    }
  });
});

// ─── isSecretExposure ─────────────────────────────────────────────────────────

describe("isSecretExposure", () => {
  it("returns true for secret-exposure category", () => {
    const finding: SecurityFinding = {
      id: "f", category: "secret-exposure", severity: "critical",
      message: "m", snippet: "s", line: 1, col: 0, filePath: "f", ruleId: "r",
    };
    expect(isSecretExposure(finding)).toBe(true);
  });

  it("returns false for xss category", () => {
    const finding: SecurityFinding = {
      id: "f", category: "xss", severity: "high",
      message: "m", snippet: "s", line: 1, col: 0, filePath: "f", ruleId: "r",
    };
    expect(isSecretExposure(finding)).toBe(false);
  });
});

// ─── SECURITY_RULES ───────────────────────────────────────────────────────────

describe("SECURITY_RULES", () => {
  it("has at least 10 rules", () => {
    expect(SECURITY_RULES.length).toBeGreaterThanOrEqual(10);
  });

  it("every rule has id, category, severity, pattern, message", () => {
    for (const rule of SECURITY_RULES) {
      expect(rule.id).toBeTruthy();
      expect(rule.category).toBeTruthy();
      expect(rule.severity).toBeTruthy();
      expect(rule.pattern).toBeInstanceOf(RegExp);
      expect(rule.message).toBeTruthy();
    }
  });
});
