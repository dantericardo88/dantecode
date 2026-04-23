// ============================================================================
// Sprint BB — Dims 10+3: TypeAwareGenerationGate + CodeQualityTrendTracker
// Tests that:
//  - AppGenerationGate.getBaselineErrorCount returns a number >= 0
//  - AppGenerationFileResult includes errorDelta field
//  - runGenerationWithGate halts when gate fails (regression detected)
//  - computeQualityTrend returns rollingAvg from seeded code-quality-log.json
//  - computeQualityTrend returns isAlert=true when current avg drops 0.2 below rolling
//  - computeQualityTrend returns isAlert=false when current avg equals rolling
//  - recordQualityTrend creates .danteforge/quality-trend-log.json
//  - loadQualityTrendLog reads and parses entries
//  - getQualityTrendStats returns correct alertRate
// ============================================================================

import { describe, it, expect } from "vitest";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import {
  AppGenerationGate,
  runGenerationWithGate,
  computeQualityTrend,
  recordQualityTrend,
  loadQualityTrendLog,
  getQualityTrendStats,
} from "@dantecode/core";
import type { QualityTrendResult, GenerationFileSpec } from "@dantecode/core";

function makeDir(): string {
  const dir = join(tmpdir(), `sprint-bb-${randomUUID()}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

/** Create a seeded code-quality-log.json in the given dir with given entries. */
function seedQualityLog(dir: string, entries: Array<{ overall: number; hoursAgo: number }>) {
  mkdirSync(join(dir, ".danteforge"), { recursive: true });
  const lines = entries.map((e) => {
    const ts = new Date(Date.now() - e.hoursAgo * 3_600_000).toISOString();
    return JSON.stringify({ timestamp: ts, filePath: "/src/x.ts", language: "ts", overall: e.overall, linesOfCode: 50, noConsoleLog: true, hasErrorHandling: true });
  });
  writeFileSync(join(dir, ".danteforge", "code-quality-log.json"), lines.join("\n") + "\n", "utf-8");
}

describe("AppGenerationGate — Sprint BB (dim 10)", () => {
  // 1. getBaselineErrorCount returns a number >= 0
  it("getBaselineErrorCount returns a number >= 0", async () => {
    const dir = makeDir();
    const gate = new AppGenerationGate("test-session", dir);
    const count = await gate.getBaselineErrorCount(dir, async () => ({ stdout: "error TS2322: bad type\nerror TS2304: bad name\n", stderr: "", exitCode: 1 }));
    expect(typeof count).toBe("number");
    expect(count).toBeGreaterThanOrEqual(0);
    expect(count).toBe(2); // 2 error lines
  });

  // 2. AppGenerationFileResult has errorDelta field
  it("checkFile result includes an errorDelta field", async () => {
    const dir = makeDir();
    const gate = new AppGenerationGate("test-session", dir);
    const mockExecFn = async () => ({ stdout: "", stderr: "", exitCode: 0 });
    const result = await gate.checkFile("/tmp/test.ts", { stack: "typescript-node", scaffoldHint: "", entryPoints: [], typecheckCmd: "", testCmd: "" }, mockExecFn);
    expect(typeof result.errorDelta).toBe("number");
  });

  // 3. runGenerationWithGate halts when gate fails
  it("runGenerationWithGate halts and marks failed file when gate returns false", async () => {
    const files: GenerationFileSpec[] = [
      { filePath: "/tmp/a.ts", content: "const a = 1;" },
      { filePath: "/tmp/b.ts", content: "const b = 2;" },
    ];
    const written: string[] = [];
    const writeFn = async (spec: GenerationFileSpec) => { written.push(spec.filePath); };
    let callCount = 0;
    const gate = async (_fp: string) => { callCount++; return callCount < 2; }; // fail on 2nd file
    const result = await runGenerationWithGate(files, writeFn, gate);
    expect(result.passed).toBe(false);
    expect(result.haltedAt).toBe("/tmp/b.ts");
    expect(result.typeRegressionFiles).toContain("/tmp/b.ts");
  });
});

describe("computeQualityTrend — Sprint BB (dim 3)", () => {
  // 4. returns rollingAvg from seeded code-quality-log.json
  it("computeQualityTrend returns correct rollingAvg from seeded log", () => {
    const dir = makeDir();
    // Seed: 3 old entries (past 24h but within 30 days) with avg 0.8
    seedQualityLog(dir, [
      { overall: 0.8, hoursAgo: 48 },
      { overall: 0.8, hoursAgo: 72 },
      { overall: 0.8, hoursAgo: 96 },
    ]);
    const trend = computeQualityTrend(dir);
    expect(trend.rollingAvg).toBeCloseTo(0.8, 5);
    expect(trend.entryCount).toBeGreaterThanOrEqual(3);
  });

  // 5. returns isAlert=true when current avg is 0.2 below rolling avg
  it("returns isAlert=true when current session avg drops more than 0.1 below rolling", () => {
    const dir = makeDir();
    // Historical entries (>24h ago): avg 0.85
    seedQualityLog(dir, [
      { overall: 0.85, hoursAgo: 48 },
      { overall: 0.85, hoursAgo: 72 },
      { overall: 0.85, hoursAgo: 96 },
      // Recent (within 24h): avg 0.60 — 0.25 below rolling
      { overall: 0.60, hoursAgo: 1 },
      { overall: 0.60, hoursAgo: 2 },
    ]);
    const trend = computeQualityTrend(dir);
    expect(trend.isAlert).toBe(true);
    expect(trend.delta).toBeLessThan(-0.1);
  });

  // 6. returns isAlert=false when current avg equals rolling
  it("returns isAlert=false when current avg equals rolling avg", () => {
    const dir = makeDir();
    seedQualityLog(dir, [
      { overall: 0.8, hoursAgo: 48 },
      { overall: 0.8, hoursAgo: 72 },
      { overall: 0.8, hoursAgo: 1 }, // recent = same as historical
    ]);
    const trend = computeQualityTrend(dir);
    expect(trend.isAlert).toBe(false);
  });

  // 7. recordQualityTrend creates .danteforge/quality-trend-log.json
  it("recordQualityTrend creates .danteforge/quality-trend-log.json", () => {
    const trendDir = makeDir();
    const trend: QualityTrendResult = {
      windowDays: 30, rollingAvg: 0.8, currentSessionAvg: 0.75, delta: -0.05, isAlert: false, entryCount: 5,
    };
    recordQualityTrend(trend, trendDir);
    expect(existsSync(join(trendDir, ".danteforge", "quality-trend-log.json"))).toBe(true);
  });

  // 8. loadQualityTrendLog reads and parses entries
  it("loadQualityTrendLog reads and parses entries correctly", () => {
    const dir = makeDir();
    const t1: QualityTrendResult = { windowDays: 30, rollingAvg: 0.8, currentSessionAvg: 0.75, delta: -0.05, isAlert: false, entryCount: 4 };
    const t2: QualityTrendResult = { windowDays: 30, rollingAvg: 0.79, currentSessionAvg: 0.65, delta: -0.14, isAlert: true, entryCount: 5 };
    recordQualityTrend(t1, dir);
    recordQualityTrend(t2, dir);
    const entries = loadQualityTrendLog(dir);
    expect(entries.length).toBe(2);
    expect(entries[0]!.rollingAvg).toBeCloseTo(0.8, 5);
    expect(entries[1]!.isAlert).toBe(true);
  });

  // 9. getQualityTrendStats returns correct alertRate
  it("getQualityTrendStats returns correct alertRate across entries", () => {
    const entries = [
      { windowDays: 30, rollingAvg: 0.8, currentSessionAvg: 0.65, delta: -0.15, isAlert: true, entryCount: 5, timestamp: "" },
      { windowDays: 30, rollingAvg: 0.8, currentSessionAvg: 0.82, delta: 0.02, isAlert: false, entryCount: 5, timestamp: "" },
      { windowDays: 30, rollingAvg: 0.8, currentSessionAvg: 0.60, delta: -0.20, isAlert: true, entryCount: 5, timestamp: "" },
    ];
    const stats = getQualityTrendStats(entries);
    expect(stats.alertRate).toBeCloseTo(2 / 3, 5);
    expect(stats.totalEntries).toBe(3);
    expect(stats.avgDelta).toBeLessThan(0);
  });
});
