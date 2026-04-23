// ============================================================================
// Sprint O — Dims 5+23: SWE-bench trend artifact + multi-engine security scan
// Tests that:
//  - computeTrend() returns correct slope/direction for improving runs
//  - computeTrend() returns "declining" when pass rate drops
//  - computeTrend() handles single-run case (slope=0, stable)
//  - computeTrend() handles empty runs
//  - bench-trend.json exists at repo root with required fields
//  - scanPackageJson() detects known vulnerable lodash version
//  - scanPackageJson() detects minimist CVE-2021-44906
//  - scanPackageJson() finds no vulns for clean deps
//  - scanPackageJson() scans devDependencies too
//  - scanFileContentAsync uses scanPackageJson for package.json files
// ============================================================================

import { describe, it, expect } from "vitest";
import { resolve } from "node:path";
import { readFile } from "node:fs/promises";
import { computeTrend, type PersistentBenchResults } from "../swe-bench-runner.js";
import { scanPackageJson, scanFileContentAsync } from "@dantecode/core";

// ─── Part 1: SWE-bench trend artifact (dim 5) ────────────────────────────────

function makePersisted(rates: number[]): PersistentBenchResults {
  const runs = rates.map((r, i) => ({
    run_id: `run-${i}`,
    timestamp: new Date(Date.now() - (rates.length - i) * 60000).toISOString(),
    model: "claude-sonnet",
    total: 10,
    resolved: Math.round(r * 10),
    pass_rate: r,
    failure_modes: ["test_assertion:2"],
    instance_outcomes: [],
  }));
  return {
    last_updated: new Date().toISOString(),
    best_pass_rate: Math.max(...rates),
    best_model: "claude-sonnet",
    runs,
  };
}

describe("computeTrend — Sprint O (dim 5)", () => {
  // 1. Improving run sequence (newest-first array: runs[0] is most recent)
  it("returns direction=improving when pass rate increases over runs", () => {
    // Newest-first: most recent run=0.50, oldest=0.30 → chronological slope is positive
    const data = makePersisted([0.50, 0.45, 0.40, 0.35, 0.30]);
    const trend = computeTrend(data);
    expect(trend.direction).toBe("improving");
    expect(trend.slope).toBeGreaterThan(0);
  });

  // 2. Declining run sequence
  it("returns direction=declining when pass rate decreases over runs", () => {
    // Newest-first: most recent run=0.30, oldest=0.50 → chronological slope is negative
    const data = makePersisted([0.30, 0.35, 0.40, 0.45, 0.50]);
    const trend = computeTrend(data);
    expect(trend.direction).toBe("declining");
    expect(trend.slope).toBeLessThan(0);
  });

  // 3. Stable (flat)
  it("returns direction=stable when pass rate barely changes", () => {
    const data = makePersisted([0.44, 0.44, 0.44, 0.44]);
    const trend = computeTrend(data);
    expect(trend.direction).toBe("stable");
    expect(Math.abs(trend.slope)).toBeLessThan(0.005);
  });

  // 4. Single run
  it("handles single-run case with slope=0 and stable direction", () => {
    const data = makePersisted([0.44]);
    const trend = computeTrend(data);
    expect(trend.slope).toBe(0);
    expect(trend.direction).toBe("stable");
    expect(trend.run_count).toBe(1);
  });

  // 5. Empty runs
  it("handles empty runs array without throwing", () => {
    const data: PersistentBenchResults = { last_updated: "", best_pass_rate: 0, best_model: "", runs: [] };
    const trend = computeTrend(data);
    expect(trend.run_count).toBe(0);
    expect(trend.slope).toBe(0);
  });

  // 6. best/worst fields are correct
  it("best_pass_rate and worst_pass_rate reflect min/max in window", () => {
    const data = makePersisted([0.55, 0.30, 0.60, 0.44, 0.20]);
    const trend = computeTrend(data);
    expect(trend.best_pass_rate).toBeCloseTo(0.60, 2);
    expect(trend.worst_pass_rate).toBeCloseTo(0.20, 2);
  });

  // 7. bench-trend.json exists at repo root
  it("bench-trend.json exists at repo root with required fields", async () => {
    const trendPath = resolve(__dirname, "../../../../bench-trend.json");
    const raw = await readFile(trendPath, "utf-8");
    const data = JSON.parse(raw) as Record<string, unknown>;
    expect(typeof data["direction"]).toBe("string");
    expect(typeof data["slope"]).toBe("number");
    expect(typeof data["run_count"]).toBe("number");
    expect(Array.isArray(data["top_failure_modes"])).toBe(true);
  });

  // 8. top_failure_modes aggregated across runs
  it("top_failure_modes contains failure modes from all window runs", () => {
    const data: PersistentBenchResults = {
      last_updated: "",
      best_pass_rate: 0.44,
      best_model: "m",
      runs: [
        { run_id: "a", timestamp: "", model: "m", total: 10, resolved: 4, pass_rate: 0.4, failure_modes: ["timeout:3", "compile_error:2"], instance_outcomes: [] },
        { run_id: "b", timestamp: "", model: "m", total: 10, resolved: 5, pass_rate: 0.5, failure_modes: ["timeout:1", "no_patch:4"], instance_outcomes: [] },
      ],
    };
    const trend = computeTrend(data);
    expect(trend.top_failure_modes.length).toBeGreaterThan(0);
    expect(trend.top_failure_modes).toContain("timeout");
  });
});

// ─── Part 2: Multi-engine security scanning (dim 23) ─────────────────────────

describe("scanPackageJson — Sprint O (dim 23)", () => {
  // 9. Detects lodash vulnerability
  it("detects lodash prototype pollution in vulnerable version", () => {
    const content = JSON.stringify({ dependencies: { lodash: "^3.10.1" } });
    const findings = scanPackageJson(content, "package.json");
    expect(findings.length).toBeGreaterThan(0);
    const lodashFinding = findings.find((f: { snippet?: string }) => f.snippet?.includes("lodash"));
    expect(lodashFinding).toBeDefined();
    expect(lodashFinding?.severity).toBe("high");
  });

  // 10. Detects minimist CVE
  it("detects minimist CVE-2021-44906 in old version", () => {
    const content = JSON.stringify({ dependencies: { minimist: "^0.2.1" } });
    const findings = scanPackageJson(content, "package.json");
    const f = findings.find((f: { snippet?: string }) => f.snippet?.includes("minimist"));
    expect(f).toBeDefined();
    expect(f?.severity).toBe("critical");
    expect(f?.ruleId).toContain("CVE");
  });

  // 11. No findings for safe deps
  it("returns no findings for modern safe package versions", () => {
    const content = JSON.stringify({ dependencies: { react: "^18.2.0", typescript: "^5.0.0" } });
    const findings = scanPackageJson(content, "package.json");
    expect(findings).toHaveLength(0);
  });

  // 12. Scans devDependencies too
  it("scans devDependencies in addition to dependencies", () => {
    const content = JSON.stringify({
      dependencies: {},
      devDependencies: { minimist: "0.1.0" },
    });
    const findings = scanPackageJson(content, "package.json");
    expect(findings.length).toBeGreaterThan(0);
    expect(findings[0]?.snippet).toContain("minimist");
  });

  // 13. Returns empty array for invalid JSON
  it("returns empty array for invalid JSON without throwing", () => {
    expect(() => scanPackageJson("not json at all", "package.json")).not.toThrow();
    expect(scanPackageJson("not json at all", "package.json")).toHaveLength(0);
  });

  // 14. Finding has remediation field
  it("findings include remediation advice", () => {
    const content = JSON.stringify({ dependencies: { minimist: "0.1.0" } });
    const findings = scanPackageJson(content, "package.json");
    expect(findings[0]?.remediation).toMatch(/Upgrade|upgrade/);
  });

  // 15. scanFileContentAsync wires in package.json scanning
  it("scanFileContentAsync returns pkg vuln findings for package.json content", async () => {
    const content = JSON.stringify({ dependencies: { minimist: "0.1.0" } });
    const result = await scanFileContentAsync(content, "package.json", undefined, async () => {
      throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
    });
    const pkgFindings = result.findings.filter((f) => f.ruleId?.startsWith("PKG-VULN"));
    expect(pkgFindings.length).toBeGreaterThan(0);
  });
});
