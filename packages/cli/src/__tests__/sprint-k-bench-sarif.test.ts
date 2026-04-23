// ============================================================================
// Sprint K — Dims 5+23: bench-results.json artifact + SARIF export
// Tests that:
//  - bench-results.json exists at repo root with required fields
//  - bench-results.json has valid structure (pass_rate, timestamp, resolved ≤ total)
//  - toSarif() returns SARIF 2.1.0 schema URL
//  - toSarif() result length matches findings
//  - toSarif() result has ruleId, message.text, physicalLocation
//  - toSarif() with empty findings returns empty results
//  - SARIF level mapping: critical→error, medium→warning, info→note
//  - toSarif() deduplicates rules by ruleId
// ============================================================================

import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { toSarif } from "@dantecode/core";
import type { SecurityFinding } from "@dantecode/core";

// ─── Part 1: bench-results.json artifact (dim 5) ─────────────────────────────

describe("bench-results.json artifact — Sprint K (dim 5)", () => {
  const repoRoot = resolve(__dirname, "../../../..");
  const benchPath = resolve(repoRoot, "bench-results.json");

  // 1. File exists at repo root
  it("bench-results.json exists at repo root", () => {
    expect(existsSync(benchPath)).toBe(true);
  });

  // 2. pass_rate field present
  it("bench-results.json has pass_rate field", () => {
    const data = JSON.parse(readFileSync(benchPath, "utf-8")) as Record<string, unknown>;
    expect(typeof data["pass_rate"]).toBe("number");
  });

  // 3. timestamp is valid ISO string
  it("bench-results.json timestamp is a valid ISO date string", () => {
    const data = JSON.parse(readFileSync(benchPath, "utf-8")) as Record<string, unknown>;
    const ts = data["timestamp"] as string;
    expect(typeof ts).toBe("string");
    expect(isNaN(Date.parse(ts))).toBe(false);
  });

  // 4. top_failures is an array
  it("bench-results.json top_failures is an array", () => {
    const data = JSON.parse(readFileSync(benchPath, "utf-8")) as Record<string, unknown>;
    expect(Array.isArray(data["top_failures"])).toBe(true);
  });

  // 5. resolved ≤ total
  it("bench-results.json resolved ≤ total (no impossible values)", () => {
    const data = JSON.parse(readFileSync(benchPath, "utf-8")) as Record<string, unknown>;
    const total = data["total"] as number;
    const resolved = data["resolved"] as number;
    expect(resolved).toBeLessThanOrEqual(total);
  });

  // 6. pass_rate is not NaN and in [0,1]
  it("bench-results.json pass_rate is between 0 and 1", () => {
    const data = JSON.parse(readFileSync(benchPath, "utf-8")) as Record<string, unknown>;
    const rate = data["pass_rate"] as number;
    expect(rate).toBeGreaterThanOrEqual(0);
    expect(rate).toBeLessThanOrEqual(1);
  });

  // 7. model field present
  it("bench-results.json has model field", () => {
    const data = JSON.parse(readFileSync(benchPath, "utf-8")) as Record<string, unknown>;
    expect(typeof data["model"]).toBe("string");
    expect((data["model"] as string).length).toBeGreaterThan(0);
  });
});

// ─── Part 2: SARIF export (dim 23) ───────────────────────────────────────────

const mockFindings: SecurityFinding[] = [
  {
    id: "f1",
    category: "injection",
    severity: "critical",
    message: "SQL injection detected",
    snippet: "query(userInput)",
    line: 10,
    col: 5,
    filePath: "src/db.ts",
    ruleId: "sql-injection",
    owaspRef: "A1:2021",
    remediation: "Use parameterized queries",
  },
  {
    id: "f2",
    category: "xss",
    severity: "medium",
    message: "XSS via innerHTML",
    snippet: "el.innerHTML = data",
    line: 20,
    col: 0,
    filePath: "src/db.ts",
    ruleId: "xss-innerhtml",
  },
  {
    id: "f3",
    category: "insufficient-logging",
    severity: "info",
    message: "Missing audit log",
    snippet: "doAction()",
    line: 30,
    col: 0,
    filePath: "src/db.ts",
    ruleId: "missing-audit-log",
  },
];

describe("toSarif() SARIF 2.1.0 export — Sprint K (dim 23)", () => {
  // 8. Returns object with SARIF 2.1.0 schema URL
  it("toSarif() returns $schema with SARIF 2.1.0 URL", () => {
    const doc = toSarif(mockFindings, "src/db.ts");
    expect(doc.$schema).toContain("sarif-2.1.0");
    expect(doc.version).toBe("2.1.0");
  });

  // 9. runs[0].results length matches findings
  it("toSarif() results length matches findings.length", () => {
    const doc = toSarif(mockFindings, "src/db.ts");
    expect(doc.runs[0]?.results.length).toBe(mockFindings.length);
  });

  // 10. Result has ruleId, message.text, physicalLocation
  it("toSarif() result has ruleId, message.text, and physicalLocation", () => {
    const doc = toSarif(mockFindings, "src/db.ts");
    const result = doc.runs[0]?.results[0];
    expect(result?.ruleId).toBe("sql-injection");
    expect(typeof result?.message.text).toBe("string");
    expect(result?.message.text).toContain("SQL injection");
    expect(result?.locations[0]?.physicalLocation.artifactLocation.uri).toBe("src/db.ts");
    expect(result?.locations[0]?.physicalLocation.region.startLine).toBe(10);
  });

  // 11. Empty findings → empty results array
  it("toSarif() with empty findings returns empty results", () => {
    const doc = toSarif([], "src/clean.ts");
    expect(doc.runs[0]?.results).toHaveLength(0);
  });

  // 12. Critical severity maps to "error" level
  it("toSarif() critical severity → level 'error'", () => {
    const doc = toSarif([mockFindings[0]!], "src/db.ts");
    expect(doc.runs[0]?.results[0]?.level).toBe("error");
  });

  // 13. Medium severity maps to "warning" level
  it("toSarif() medium severity → level 'warning'", () => {
    const doc = toSarif([mockFindings[1]!], "src/db.ts");
    expect(doc.runs[0]?.results[0]?.level).toBe("warning");
  });

  // 14. Info severity maps to "note" level
  it("toSarif() info severity → level 'note'", () => {
    const doc = toSarif([mockFindings[2]!], "src/db.ts");
    expect(doc.runs[0]?.results[0]?.level).toBe("note");
  });

  // 15. Deduplicates rules by ruleId
  it("toSarif() deduplicates rules when same ruleId appears multiple times", () => {
    const dupeFindings: SecurityFinding[] = [
      { ...mockFindings[0]!, id: "dup1" },
      { ...mockFindings[0]!, id: "dup2" },
    ];
    const doc = toSarif(dupeFindings, "src/db.ts");
    expect(doc.runs[0]?.tool.driver.rules.length).toBe(1);
    expect(doc.runs[0]?.results.length).toBe(2);
  });
});
