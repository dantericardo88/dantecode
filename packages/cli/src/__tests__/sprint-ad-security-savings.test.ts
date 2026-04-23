// ============================================================================
// Sprint AD — Dims 23+27: OWASP Top 10 rules + CostSavingsReport
// Tests that:
//  - SECURITY_RULES includes ssrf-fetch-user-url rule
//  - SECURITY_RULES includes idor-direct-id-query rule
//  - SECURITY_RULES includes open-redirect rule
//  - scanFileContent detects SSRF pattern
//  - computeSessionSavings writes to cost-savings-report.json
//  - summarizeCostSavings computes totalSavedDollars
//  - summarizeCostSavings computes savingsPercent
//  - cost-savings-report.json seeded with realistic data
//  - loadCostSavingsReport reads back entries
//  - SECURITY_RULES includes ssrf-url-constructor rule
// ============================================================================

import { describe, it, expect } from "vitest";
import { existsSync, readFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { resolve } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import {
  SECURITY_RULES,
  scanFileContent,
  computeSessionSavings,
  summarizeCostSavings,
  loadCostSavingsReport,
  type CostSavingsEntry,
} from "@dantecode/core";

const repoRoot = resolve(__dirname, "../../../../");

function makeDir(): string {
  const dir = join(tmpdir(), `sprint-ad-${randomUUID()}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

// ─── Part 1: OWASP rules ─────────────────────────────────────────────────────

describe("OWASP Top 10 rules in SECURITY_RULES — Sprint AD (dim 23)", () => {
  // 1. SSRF fetch rule exists
  it("SECURITY_RULES contains ssrf-fetch-user-url rule", () => {
    const rule = SECURITY_RULES.find((r) => r.id === "ssrf-fetch-user-url");
    expect(rule).toBeDefined();
    expect(rule?.severity).toBe("critical");
    expect(rule?.owaspRef).toBe("A10:2021");
  });

  // 2. SSRF URL constructor rule exists
  it("SECURITY_RULES contains ssrf-url-constructor rule", () => {
    const rule = SECURITY_RULES.find((r) => r.id === "ssrf-url-constructor");
    expect(rule).toBeDefined();
    expect(rule?.severity).toBe("high");
  });

  // 3. IDOR rule exists
  it("SECURITY_RULES contains idor-direct-id-query rule", () => {
    const rule = SECURITY_RULES.find((r) => r.id === "idor-direct-id-query");
    expect(rule).toBeDefined();
    expect(rule?.severity).toBe("high");
    expect(rule?.owaspRef).toBe("A1:2021");
  });

  // 4. Open redirect rule exists
  it("SECURITY_RULES contains open-redirect rule", () => {
    const rule = SECURITY_RULES.find((r) => r.id === "open-redirect");
    expect(rule).toBeDefined();
    expect(rule?.severity).toBe("medium");
  });

  // 5. SSRF pattern detected in code
  it("scanFileContent detects SSRF via fetch(req.query.url)", () => {
    const code = `async function handler(req, res) {\n  const data = await fetch(req.query.url);\n  res.json(data);\n}`;
    const result = scanFileContent(code, "api/handler.ts");
    const ssrfFinding = result.findings.find((f) => f.ruleId === "ssrf-fetch-user-url");
    expect(ssrfFinding).toBeDefined();
  });

  // 6. IDOR pattern detected in code
  it("scanFileContent detects IDOR via findById(req.params.id)", () => {
    const code = `router.get('/user/:id', async (req, res) => {\n  const user = await User.findById(req.params.id);\n  res.json(user);\n});`;
    const result = scanFileContent(code, "routes/user.ts");
    const idorFinding = result.findings.find((f) => f.ruleId === "idor-direct-id-query");
    expect(idorFinding).toBeDefined();
  });
});

// ─── Part 2: CostSavingsReport ────────────────────────────────────────────────

describe("computeSessionSavings + summarizeCostSavings — Sprint AD (dim 27)", () => {
  // 7. computeSessionSavings writes file
  it("computeSessionSavings writes to .danteforge/cost-savings-report.json", () => {
    const dir = makeDir();
    computeSessionSavings({ sessionId: "s1", fastTierRequests: 10, tasksCompleted: 2, projectRoot: dir });
    expect(existsSync(join(dir, ".danteforge", "cost-savings-report.json"))).toBe(true);
  });

  // 8. savedDollars computed correctly (10 requests × (0.0035 - 0.00035) = 0.0315)
  it("computeSessionSavings computes savedDollars correctly", () => {
    const dir = makeDir();
    const entry = computeSessionSavings({ sessionId: "s2", fastTierRequests: 10, tasksCompleted: 2, projectRoot: dir });
    expect(entry.savedDollars).toBeCloseTo(0.0315, 4);
  });

  // 9. summarizeCostSavings sums savedDollars
  it("summarizeCostSavings sums totalSavedDollars across sessions", () => {
    const entries: CostSavingsEntry[] = [
      { timestamp: "t", sessionId: "s1", fastTierRequests: 10, defaultTierCostPerRequest: 0.0035, fastTierCostPerRequest: 0.00035, savedDollars: 0.0315, tasksCompleted: 2, costPerSuccess: 0.01 },
      { timestamp: "t", sessionId: "s2", fastTierRequests: 20, defaultTierCostPerRequest: 0.0035, fastTierCostPerRequest: 0.00035, savedDollars: 0.063, tasksCompleted: 4, costPerSuccess: 0.01 },
    ];
    const summary = summarizeCostSavings(entries);
    expect(summary.totalSavedDollars).toBeCloseTo(0.0945, 4);
  });

  // 10. summarizeCostSavings computes savingsPercent ~90%
  it("summarizeCostSavings computes savingsPercent close to 90%", () => {
    const entries: CostSavingsEntry[] = [
      { timestamp: "t", sessionId: "s1", fastTierRequests: 10, defaultTierCostPerRequest: 0.0035, fastTierCostPerRequest: 0.00035, savedDollars: 0.0315, tasksCompleted: 2, costPerSuccess: 0.01 },
    ];
    const summary = summarizeCostSavings(entries);
    expect(summary.savingsPercent).toBeCloseTo(90, 0);
  });

  // 11. Seeded cost-savings-report.json exists with 5+ entries
  it("seeded cost-savings-report.json exists at .danteforge/ with 5+ entries", () => {
    const logPath = join(repoRoot, ".danteforge", "cost-savings-report.json");
    expect(existsSync(logPath)).toBe(true);
    const lines = readFileSync(logPath, "utf-8").trim().split("\n").filter(Boolean);
    expect(lines.length).toBeGreaterThanOrEqual(5);
    const entries = lines.map((l) => JSON.parse(l) as CostSavingsEntry);
    for (const entry of entries) {
      expect(typeof entry.savedDollars).toBe("number");
      expect(typeof entry.fastTierRequests).toBe("number");
      expect(typeof entry.costPerSuccess).toBe("number");
    }
  });

  // 12. loadCostSavingsReport reads entries
  it("loadCostSavingsReport reads back written entries", () => {
    const dir = makeDir();
    computeSessionSavings({ sessionId: "s-load", fastTierRequests: 5, tasksCompleted: 1, projectRoot: dir });
    const entries = loadCostSavingsReport(dir);
    expect(entries.length).toBeGreaterThan(0);
    expect(entries[0]?.sessionId).toBe("s-load");
  });
});
