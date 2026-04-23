// Sprint BN — Dim 3: CodeQualityTrend — loadQualityTrendLog + getQualityTrendStats tests
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  loadQualityTrendLog,
  getQualityTrendStats,
  recordQualityTrend,
  scoreGeneratedCode,
  type QualityTrendResult,
} from "./code-quality-gate.js";

function makeTrendEntry(overrides: Partial<QualityTrendResult & { timestamp: string }> = {}): QualityTrendResult & { timestamp: string } {
  return {
    windowDays: 30,
    rollingAvg: 0.6,
    currentSessionAvg: 0.7,
    delta: 0.1,
    isAlert: false,
    entryCount: 5,
    timestamp: new Date().toISOString(),
    ...overrides,
  };
}

describe("loadQualityTrendLog", () => {
  let tmpRoot: string;

  beforeEach(() => {
    tmpRoot = join(tmpdir(), `qtrend-test-${Date.now()}`);
    mkdirSync(join(tmpRoot, ".danteforge"), { recursive: true });
  });

  afterEach(() => {
    if (existsSync(tmpRoot)) rmSync(tmpRoot, { recursive: true, force: true });
  });

  it("returns empty array when trend log does not exist", () => {
    const results = loadQualityTrendLog(tmpRoot);
    expect(results).toEqual([]);
  });

  it("loads valid NDJSON entries from quality-trend-log.json", () => {
    const entry1 = makeTrendEntry({ delta: 0.05 });
    const entry2 = makeTrendEntry({ delta: -0.15, isAlert: true });
    writeFileSync(
      join(tmpRoot, ".danteforge", "quality-trend-log.json"),
      [JSON.stringify(entry1), JSON.stringify(entry2)].join("\n"),
      "utf-8",
    );
    const results = loadQualityTrendLog(tmpRoot);
    expect(results).toHaveLength(2);
    expect(results[0]!.delta).toBeCloseTo(0.05);
    expect(results[1]!.isAlert).toBe(true);
  });

  it("returns empty array for malformed log file", () => {
    writeFileSync(
      join(tmpRoot, ".danteforge", "quality-trend-log.json"),
      "not-valid-json\n",
      "utf-8",
    );
    const results = loadQualityTrendLog(tmpRoot);
    expect(results).toEqual([]);
  });
});

describe("getQualityTrendStats", () => {
  it("returns zeros for empty entries", () => {
    const stats = getQualityTrendStats([]);
    expect(stats.alertRate).toBe(0);
    expect(stats.avgDelta).toBe(0);
    expect(stats.totalEntries).toBe(0);
  });

  it("computes alertRate as fraction of isAlert entries", () => {
    const entries = [
      makeTrendEntry({ isAlert: true }),
      makeTrendEntry({ isAlert: false }),
      makeTrendEntry({ isAlert: true }),
      makeTrendEntry({ isAlert: false }),
    ];
    const stats = getQualityTrendStats(entries);
    expect(stats.alertRate).toBeCloseTo(0.5);
    expect(stats.totalEntries).toBe(4);
  });

  it("computes avgDelta as average of all delta values", () => {
    const entries = [
      makeTrendEntry({ delta: 0.2 }),
      makeTrendEntry({ delta: -0.1 }),
      makeTrendEntry({ delta: 0.0 }),
    ];
    const stats = getQualityTrendStats(entries);
    // (0.2 - 0.1 + 0.0) / 3 = 0.1/3 ≈ 0.033
    expect(stats.avgDelta).toBeCloseTo(0.1 / 3);
  });

  it("alertRate is 1.0 when all entries are alerts", () => {
    const entries = [
      makeTrendEntry({ isAlert: true, delta: -0.2 }),
      makeTrendEntry({ isAlert: true, delta: -0.3 }),
    ];
    const stats = getQualityTrendStats(entries);
    expect(stats.alertRate).toBeCloseTo(1.0);
    expect(stats.avgDelta).toBeCloseTo(-0.25);
  });

  it("alertRate is 0 when no entries are alerts", () => {
    const entries = [
      makeTrendEntry({ isAlert: false, delta: 0.1 }),
      makeTrendEntry({ isAlert: false, delta: 0.2 }),
    ];
    const stats = getQualityTrendStats(entries);
    expect(stats.alertRate).toBe(0);
  });
});

describe("recordQualityTrend + loadQualityTrendLog round-trip", () => {
  let tmpRoot: string;

  beforeEach(() => {
    tmpRoot = join(tmpdir(), `qtrend-rt-${Date.now()}`);
    mkdirSync(join(tmpRoot, ".danteforge"), { recursive: true });
  });

  afterEach(() => {
    if (existsSync(tmpRoot)) rmSync(tmpRoot, { recursive: true, force: true });
  });

  it("records and reloads trend entries correctly", () => {
    const trend: QualityTrendResult = {
      windowDays: 30,
      rollingAvg: 0.65,
      currentSessionAvg: 0.55,
      delta: -0.1,
      isAlert: true,
      entryCount: 8,
    };
    recordQualityTrend(trend, tmpRoot);
    recordQualityTrend({ ...trend, delta: 0.05, isAlert: false }, tmpRoot);

    const entries = loadQualityTrendLog(tmpRoot);
    expect(entries).toHaveLength(2);
    expect(entries[0]!.isAlert).toBe(true);
    expect(entries[1]!.isAlert).toBe(false);

    const stats = getQualityTrendStats(entries);
    expect(stats.alertRate).toBeCloseTo(0.5);
    expect(stats.totalEntries).toBe(2);
  });
});

describe("scoreGeneratedCode — basic sanity", () => {
  it("scores clean code higher than messy code", () => {
    const clean = `
      export function computeAverage(values: number[]): number {
        if (values.length === 0) return 0;
        return values.reduce((sum, v) => sum + v, 0) / values.length;
      }
    `;
    const messy = `console.log(12345); var x=99999; function foo(){console.log(x)}`;
    const cleanScore = scoreGeneratedCode(clean);
    const messyScore = scoreGeneratedCode(messy);
    expect(cleanScore.overall).toBeGreaterThan(messyScore.overall);
  });
});
