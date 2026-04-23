// ============================================================================
// packages/cli/src/__tests__/benchmark.test.ts
//
// End-to-end tests for the built-in benchmark evaluation pipeline.
//
// Design:
//   - Zero mocks — calls the real InstanceLoader, runTestPatch, ReportGenerator
//   - Gold patches are run against gold tests: expects >= 80% pass rate
//   - Proves the evaluation pipeline is functional from CLI entry point
// ============================================================================

import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, it, expect } from "vitest";
import { runBuiltinBenchmark, formatBenchmarkReport } from "../commands/benchmark.js";

describe("runBuiltinBenchmark", () => {
  // -------------------------------------------------------------------------
  // 1. Shape — proves the pipeline returns a well-formed EvalReport
  // -------------------------------------------------------------------------
  it("returns an EvalReport with required fields", async () => {
    const report = await runBuiltinBenchmark(tmpdir(), { maxInstances: 3 });

    expect(report.total).toBe(3);
    expect(typeof report.run_id).toBe("string");
    expect(report.run_id.length).toBeGreaterThan(0);
    expect(typeof report.timestamp).toBe("string");
    expect(typeof report.pass_rate).toBe("number");
    expect(report.pass_rate).toBeGreaterThanOrEqual(0);
    expect(report.pass_rate).toBeLessThanOrEqual(1);
    expect(Array.isArray(report.results)).toBe(true);
    expect(report.results).toHaveLength(3);
  });

  // -------------------------------------------------------------------------
  // 2. Coverage — proves all 20 built-in instances are loaded by default
  // -------------------------------------------------------------------------
  it("evaluates all built-in instances when maxInstances is omitted", async () => {
    const report = await runBuiltinBenchmark(tmpdir());

    // getBuiltinInstances() returns 25 instances (ts-utils__001..025)
    expect(report.total).toBe(25);
    expect(report.results).toHaveLength(25);
    expect(typeof report.resolved).toBe("number");
  });

  // -------------------------------------------------------------------------
  // 3. Gold-patch proof — the canonical evaluation correctness assertion
  //    Gold patches must solve gold tests: proves the VM runner is functional
  // -------------------------------------------------------------------------
  it("gold patches achieve >= 80% pass rate on built-in instances", async () => {
    const report = await runBuiltinBenchmark(tmpdir());

    expect(
      report.pass_rate,
      `Expected pass_rate >= 0.8 but got ${report.pass_rate}. ` +
        `${report.resolved}/${report.total} instances resolved.\n` +
        `Failures: ${report.results
          .filter((r) => !r.resolved)
          .map((r) => `${r.instance_id}: ${r.error ?? "no error"}`)
          .join(", ")}`,
    ).toBeGreaterThanOrEqual(0.8);
  });

  // -------------------------------------------------------------------------
  // 4. Result shape — proves each result carries the required fields
  // -------------------------------------------------------------------------
  it("each RunResult has instance_id, resolved, and durationMs", async () => {
    const report = await runBuiltinBenchmark(tmpdir(), { maxInstances: 5 });

    expect(report.results).toHaveLength(5);
    for (const r of report.results) {
      expect(typeof r.instance_id, `instance_id missing on result`).toBe("string");
      expect(typeof r.resolved, `resolved missing on ${r.instance_id}`).toBe("boolean");
      expect(typeof r.durationMs, `durationMs missing on ${r.instance_id}`).toBe("number");
      expect(r.durationMs).toBeGreaterThanOrEqual(0);
    }
  });

  // -------------------------------------------------------------------------
  // 5. Persistence — proves results are written to disk
  // -------------------------------------------------------------------------
  it("writes a JSON results file to the output directory", async () => {
    const dir = join(tmpdir(), `eval-${Date.now()}`);
    const report = await runBuiltinBenchmark(dir, {
      maxInstances: 2,
      outputDir: ".",
    });

    const files = await readdir(dir);
    const jsonFiles = files.filter((f) => f.endsWith(".json"));
    expect(jsonFiles.length).toBeGreaterThan(0);
    expect(jsonFiles.some((f) => f.includes(report.run_id))).toBe(true);
  });

  // -------------------------------------------------------------------------
  // 6. maxInstances — proves the option correctly limits scope
  // -------------------------------------------------------------------------
  it("maxInstances option limits the number of evaluated instances", async () => {
    const report = await runBuiltinBenchmark(tmpdir(), { maxInstances: 7 });

    expect(report.total).toBe(7);
    expect(report.results).toHaveLength(7);
  });
});

// ---------------------------------------------------------------------------
// formatBenchmarkReport
// ---------------------------------------------------------------------------

describe("formatBenchmarkReport", () => {
  it("returns a non-empty markdown string containing pass rate", async () => {
    const report = await runBuiltinBenchmark(tmpdir(), { maxInstances: 3 });
    const md = formatBenchmarkReport(report);

    expect(typeof md).toBe("string");
    expect(md.length).toBeGreaterThan(0);
    // Should mention pass rate or resolved count somewhere
    expect(md.toLowerCase()).toMatch(/pass|resolv|result/i);
  });
});
