import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { VerificationBenchmarkStore } from "./verification-benchmark-store.js";

describe("VerificationBenchmarkStore", () => {
  let projectRoot = "";

  afterEach(async () => {
    if (projectRoot) {
      await rm(projectRoot, { recursive: true, force: true });
      projectRoot = "";
    }
  });

  it("persists benchmark runs and lists newest first", async () => {
    projectRoot = await mkdtemp(join(tmpdir(), "dantecode-benchmarks-"));
    const store = new VerificationBenchmarkStore(projectRoot);

    await store.append({
      benchmarkId: "plan-42",
      planId: "plan-42",
      source: "cli",
      passed: true,
      averagePdseScore: 0.91,
      outputCount: 2,
      failingOutputIds: [],
      payload: { outputIds: ["deploy", "rollback"] },
      recordedAt: "2026-03-18T10:00:00.000Z",
    });

    await store.append({
      benchmarkId: "plan-42",
      planId: "plan-42",
      source: "cli",
      passed: false,
      averagePdseScore: 0.61,
      outputCount: 2,
      failingOutputIds: ["incident"],
      payload: { outputIds: ["incident"] },
      recordedAt: "2026-03-19T10:00:00.000Z",
    });

    const runs = await store.list({ benchmarkId: "plan-42" });

    expect(runs).toHaveLength(2);
    expect(runs[0]?.passed).toBe(false);
    expect(runs[1]?.passed).toBe(true);
  });

  it("summarizes pass rate and average score per benchmark", async () => {
    projectRoot = await mkdtemp(join(tmpdir(), "dantecode-benchmark-summary-"));
    const store = new VerificationBenchmarkStore(projectRoot);

    await store.append({
      benchmarkId: "plan-42",
      planId: "plan-42",
      source: "cli",
      passed: true,
      averagePdseScore: 0.9,
      outputCount: 2,
      failingOutputIds: [],
      payload: {},
      recordedAt: "2026-03-18T10:00:00.000Z",
    });

    await store.append({
      benchmarkId: "plan-42",
      planId: "plan-42",
      source: "mcp",
      passed: false,
      averagePdseScore: 0.6,
      outputCount: 3,
      failingOutputIds: ["output-2"],
      payload: {},
      recordedAt: "2026-03-19T10:00:00.000Z",
    });

    await store.append({
      benchmarkId: "plan-7",
      planId: "plan-7",
      source: "cli",
      passed: true,
      averagePdseScore: 0.95,
      outputCount: 1,
      failingOutputIds: [],
      payload: {},
      recordedAt: "2026-03-20T10:00:00.000Z",
    });

    const summary = await store.summarize("plan-42");
    const all = await store.summarizeAll();

    expect(summary).toMatchObject({
      benchmarkId: "plan-42",
      totalRuns: 2,
      passRate: 0.5,
      latestFailingOutputIds: ["output-2"],
      lastPassed: false,
    });
    expect(summary?.averagePdseScore).toBeCloseTo(0.75, 5);
    expect(summary?.averageOutputCount).toBeCloseTo(2.5, 5);
    expect(all.map((entry) => entry.benchmarkId)).toEqual(["plan-7", "plan-42"]);
  });
});
