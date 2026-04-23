// Sprint BY-BZ: SecurityScanReport (dim 23) + ProviderHealthReport (dim 24) tests
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, rmSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import {
  scanContentForFindings,
  buildSecurityScanReport,
  recordSecurityScanReport,
  loadSecurityScanReports,
  getSecurityTrendStats,
} from "@dantecode/core";

import {
  buildProviderHealthSnapshot,
  buildProviderHealthReport,
  recordProviderHealthReport,
  loadProviderHealthReports,
} from "@dantecode/core";

// ─── Test helpers ─────────────────────────────────────────────────────────────

function makeTmp(prefix: string): string {
  const dir = join(tmpdir(), `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

// ─── Sprint BY: Security scan report ─────────────────────────────────────────

describe("scanContentForFindings", () => {
  it("detects eval( usage as critical injection finding", () => {
    const findings = scanContentForFindings('const x = eval("1+1");', "test.ts");
    expect(findings.length).toBeGreaterThanOrEqual(1);
    const evalFinding = findings.find((f) => f.rule === "eval-usage");
    expect(evalFinding).toBeDefined();
    expect(evalFinding!.severity).toBe("critical");
    expect(evalFinding!.category).toBe("injection");
  });

  it("detects innerHTML = as medium xss finding", () => {
    const findings = scanContentForFindings("element.innerHTML = userInput;", "ui.ts");
    const xss = findings.find((f) => f.rule === "xss-innerHTML");
    expect(xss).toBeDefined();
    expect(xss!.severity).toBe("medium");
    expect(xss!.category).toBe("injection");
  });

  it("detects Math.random() as medium weak-random finding", () => {
    const findings = scanContentForFindings("const token = Math.random().toString(36);", "util.ts");
    const rand = findings.find((f) => f.rule === "weak-random");
    expect(rand).toBeDefined();
    expect(rand!.severity).toBe("medium");
    expect(rand!.category).toBe("crypto");
  });

  it("skips eval in comment lines (// eval(...))", () => {
    const findings = scanContentForFindings("// eval(dangerous)", "test.ts");
    const evalFinding = findings.find((f) => f.rule === "eval-usage");
    expect(evalFinding).toBeUndefined();
  });

  it("detects hardcoded-secret rule", () => {
    const findings = scanContentForFindings('const secret = "mysuperpassword";', "config.ts");
    const secretFinding = findings.find((f) => f.rule === "hardcoded-secret");
    expect(secretFinding).toBeDefined();
    expect(secretFinding!.severity).toBe("high");
    expect(secretFinding!.category).toBe("auth");
  });

  it("includes line numbers for findings", () => {
    const content = "const a = 1;\nconst b = eval('2+2');\n";
    const findings = scanContentForFindings(content, "test.ts");
    const evalFinding = findings.find((f) => f.rule === "eval-usage");
    expect(evalFinding).toBeDefined();
    expect(evalFinding!.line).toBe(2);
  });
});

describe("buildSecurityScanReport", () => {
  it("computes riskScore correctly based on severity counts", () => {
    const findings = [
      { severity: "critical" as const, category: "injection" as const, rule: "eval-usage", filePath: "a.ts", description: "d", remediation: "r" },
      { severity: "high" as const, category: "auth" as const, rule: "hardcoded-secret", filePath: "b.ts", description: "d", remediation: "r" },
      { severity: "medium" as const, category: "crypto" as const, rule: "weak-random", filePath: "c.ts", description: "d", remediation: "r" },
    ];
    const report = buildSecurityScanReport("test-001", 10, findings);
    // criticalCount*25 + highCount*10 + mediumCount*3 = 25+10+3 = 38
    expect(report.riskScore).toBe(38);
    expect(report.criticalCount).toBe(1);
    expect(report.highCount).toBe(1);
    expect(report.findingsCount).toBe(3);
  });

  it("caps riskScore at 100", () => {
    const findings = Array.from({ length: 10 }, (_, i) => ({
      severity: "critical" as const,
      category: "injection" as const,
      rule: "eval-usage",
      filePath: `file${i}.ts`,
      description: "d",
      remediation: "r",
    }));
    const report = buildSecurityScanReport("cap-test", 10, findings);
    // 10 criticals * 25 = 250, capped at 100
    expect(report.riskScore).toBe(100);
  });

  it("sets sessionId and filesScanned", () => {
    const report = buildSecurityScanReport("sess-xyz", 42, []);
    expect(report.sessionId).toBe("sess-xyz");
    expect(report.filesScanned).toBe(42);
    expect(report.findingsCount).toBe(0);
    expect(report.riskScore).toBe(0);
  });
});

describe("recordSecurityScanReport / loadSecurityScanReports", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = makeTmp("sec-scan");
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("creates .danteforge/security-scan-report.json on record", () => {
    const report = buildSecurityScanReport("s1", 5, []);
    recordSecurityScanReport(report, tmpDir);
    const filePath = join(tmpDir, ".danteforge", "security-scan-report.json");
    expect(existsSync(filePath)).toBe(true);
    const content = readFileSync(filePath, "utf-8");
    expect(content).toContain("s1");
  });

  it("loadSecurityScanReports returns empty array when file missing", () => {
    const reports = loadSecurityScanReports(tmpDir);
    expect(reports).toEqual([]);
  });

  it("round-trips multiple reports via JSONL", () => {
    const r1 = buildSecurityScanReport("r1", 3, []);
    const r2 = buildSecurityScanReport("r2", 6, []);
    recordSecurityScanReport(r1, tmpDir);
    recordSecurityScanReport(r2, tmpDir);
    const loaded = loadSecurityScanReports(tmpDir);
    expect(loaded).toHaveLength(2);
    expect(loaded[0]!.sessionId).toBe("r1");
    expect(loaded[1]!.sessionId).toBe("r2");
  });
});

describe("getSecurityTrendStats", () => {
  it("returns 'improving' when recent reports have lower risk than earlier ones", () => {
    const make = (riskScore: number, findingsCount: number) =>
      ({ sessionId: "x", filesScanned: 1, findingsCount, criticalCount: 0, highCount: 0, riskScore, findings: [], generatedAt: "" });

    const reports = [
      make(80, 10),
      make(75, 9),
      make(20, 3),
      make(15, 2),
      make(10, 1),
    ];
    const stats = getSecurityTrendStats(reports);
    expect(stats.trendDirection).toBe("improving");
  });

  it("returns 'stable' for fewer than 4 reports", () => {
    const make = (riskScore: number) =>
      ({ sessionId: "x", filesScanned: 1, findingsCount: 1, criticalCount: 0, highCount: 0, riskScore, findings: [], generatedAt: "" });

    const stats = getSecurityTrendStats([make(50), make(45)]);
    expect(stats.trendDirection).toBe("stable");
  });

  it("computes totalFindings across all reports", () => {
    const make = (findingsCount: number) =>
      ({ sessionId: "x", filesScanned: 1, findingsCount, criticalCount: 0, highCount: 0, riskScore: 0, findings: [], generatedAt: "" });

    const stats = getSecurityTrendStats([make(3), make(5), make(2)]);
    expect(stats.totalFindings).toBe(10);
  });
});

// ─── Sprint BZ: Provider health report ───────────────────────────────────────

describe("buildProviderHealthSnapshot", () => {
  it("computes healthScore correctly", () => {
    // latencies = [100, 200, 300, 400, 500]
    // p50 = latencies[floor(5*0.5)] = latencies[2] = 300
    // p95 = latencies[floor(5*0.95)] = latencies[4] = 500
    // errors=2, total=10 → errorRate=0.2, availabilityRate=0.8
    // healthScore = 0.8 * (1-0.2) * max(0, 1-500/10000) = 0.8 * 0.8 * 0.95 = 0.608
    const snap = buildProviderHealthSnapshot("anthropic", [100, 200, 300, 400, 500], 2, 10);
    expect(snap.providerId).toBe("anthropic");
    expect(snap.latencyP50Ms).toBe(300);
    expect(snap.latencyP95Ms).toBe(500);
    expect(snap.errorRate).toBeCloseTo(0.2);
    expect(snap.availabilityRate).toBeCloseTo(0.8);
    expect(snap.healthScore).toBeCloseTo(0.608, 3);
  });

  it("returns availabilityRate=1 when total=0", () => {
    const snap = buildProviderHealthSnapshot("openai", [], 0, 0);
    expect(snap.availabilityRate).toBe(1);
    expect(snap.errorRate).toBe(0);
    expect(snap.healthScore).toBeGreaterThanOrEqual(0);
  });

  it("clamps healthScore to 0 when latencyP95 >= 10000", () => {
    const snap = buildProviderHealthSnapshot("slow", [15000], 0, 1);
    expect(snap.healthScore).toBe(0);
  });
});

describe("buildProviderHealthReport", () => {
  it("identifies bestProvider as the one with highest healthScore", () => {
    const snapA = buildProviderHealthSnapshot("anthropic", [100, 200, 300], 0, 10);
    const snapB = buildProviderHealthSnapshot("openai", [500, 1000, 5000], 3, 10);
    const report = buildProviderHealthReport([snapA, snapB]);
    expect(report.bestProvider).toBe("anthropic");
    expect(report.worstProvider).toBe("openai");
  });

  it("computes overallHealthScore as mean of all providers", () => {
    const snap1 = buildProviderHealthSnapshot("p1", [100], 0, 10);
    const snap2 = buildProviderHealthSnapshot("p2", [200], 0, 10);
    const report = buildProviderHealthReport([snap1, snap2]);
    expect(report.overallHealthScore).toBeCloseTo(
      (snap1.healthScore + snap2.healthScore) / 2,
      5,
    );
  });

  it("handles empty snapshots array", () => {
    const report = buildProviderHealthReport([]);
    expect(report.bestProvider).toBe("");
    expect(report.worstProvider).toBe("");
    expect(report.overallHealthScore).toBe(0);
  });
});

describe("recordProviderHealthReport / loadProviderHealthReports", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = makeTmp("phr");
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("creates .danteforge/provider-health-report.json on record", () => {
    const snap = buildProviderHealthSnapshot("anthropic", [100], 0, 10);
    const report = buildProviderHealthReport([snap]);
    recordProviderHealthReport(report, tmpDir);
    const filePath = join(tmpDir, ".danteforge", "provider-health-report.json");
    expect(existsSync(filePath)).toBe(true);
  });

  it("loadProviderHealthReports reads seeded entries from file", () => {
    const snap1 = buildProviderHealthSnapshot("p1", [200], 0, 5);
    const rep1 = buildProviderHealthReport([snap1]);
    const snap2 = buildProviderHealthSnapshot("p2", [300], 1, 5);
    const rep2 = buildProviderHealthReport([snap2]);
    recordProviderHealthReport(rep1, tmpDir);
    recordProviderHealthReport(rep2, tmpDir);

    const loaded = loadProviderHealthReports(tmpDir);
    expect(loaded).toHaveLength(2);
    expect(loaded[0]!.providers[0]!.providerId).toBe("p1");
    expect(loaded[1]!.providers[0]!.providerId).toBe("p2");
  });

  it("returns empty array when file does not exist", () => {
    const reports = loadProviderHealthReports(tmpDir);
    expect(reports).toEqual([]);
  });
});
