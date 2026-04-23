// packages/cli/src/__tests__/sprint-be-swe-eval.test.ts
// Sprint BE — Real SWE-bench eval harness tests (dim 5: 5.8 → 7)

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, writeFileSync, rmSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  evalSWEBenchInstance,
  recordSWEBenchEval,
  loadSWEBenchEvalLog,
  getSWEBenchEvalStats,
} from "../swe-bench-eval-harness.js";
import type {
  SWEBenchInstance,
  SWEBenchEvalResult,
  SWEBenchEvalLog,
  SWEBenchEvalStats,
} from "../swe-bench-eval-harness.js";

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

function makeTmpDir(): string {
  const d = join(tmpdir(), `swe-be-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(d, { recursive: true });
  return d;
}

function makeInstance(overrides: Partial<SWEBenchInstance> = {}): SWEBenchInstance {
  return {
    instanceId: "test-instance-1",
    repoUrl: "https://github.com/nonexistent-org/nonexistent-repo-xyz123",
    baseCommit: "abc123def456",
    patch: "--- a/foo.py\n+++ b/foo.py\n@@ -1 +1 @@\n-old\n+new\n",
    ...overrides,
  };
}

function makeEvalResult(overrides: Partial<SWEBenchEvalResult> = {}): SWEBenchEvalResult {
  return {
    instanceId: "test-inst",
    cloneSucceeded: true,
    checkoutSucceeded: true,
    patchApplicable: true,
    workDir: "/tmp/swe-eval-test",
    durationMs: 500,
    ...overrides,
  };
}

function makeLog(overrides: Partial<SWEBenchEvalLog> = {}): SWEBenchEvalLog {
  return {
    instanceId: "test-inst",
    repoUrl: "https://github.com/org/repo",
    baseCommit: "abc123",
    result: makeEvalResult(),
    timestamp: new Date().toISOString(),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Test 1: evalSWEBenchInstance returns cloneSucceeded=false for non-existent repo
// ---------------------------------------------------------------------------

describe("evalSWEBenchInstance", () => {
  it("returns cloneSucceeded=false for a non-existent repo URL without throwing", async () => {
    const instance = makeInstance();
    const tmpBase = makeTmpDir();
    let result: SWEBenchEvalResult | undefined;
    // Should not throw
    await expect(
      evalSWEBenchInstance(instance, tmpBase).then((r) => { result = r; return r; }),
    ).resolves.toBeDefined();

    expect(result!.cloneSucceeded).toBe(false);
    expect(result!.checkoutSucceeded).toBe(false);
    expect(result!.patchApplicable).toBe(false);
    rmSync(tmpBase, { recursive: true, force: true });
  }, 30_000);

  // Test 2: returns object with correct schema
  it("returns an object with all required schema fields", async () => {
    const instance = makeInstance();
    const tmpBase = makeTmpDir();
    const result = await evalSWEBenchInstance(instance, tmpBase);

    expect(result).toHaveProperty("instanceId");
    expect(result).toHaveProperty("cloneSucceeded");
    expect(result).toHaveProperty("checkoutSucceeded");
    expect(result).toHaveProperty("patchApplicable");
    expect(result).toHaveProperty("workDir");
    expect(result).toHaveProperty("durationMs");

    expect(typeof result.instanceId).toBe("string");
    expect(typeof result.cloneSucceeded).toBe("boolean");
    expect(typeof result.checkoutSucceeded).toBe("boolean");
    expect(typeof result.patchApplicable).toBe("boolean");
    expect(typeof result.workDir).toBe("string");
    expect(typeof result.durationMs).toBe("number");

    rmSync(tmpBase, { recursive: true, force: true });
  }, 30_000);

  // Test 3: returns result within reasonable time without hanging
  it("returns SWEBenchEvalResult within timeout without hanging", async () => {
    const instance = makeInstance();
    const tmpBase = makeTmpDir();
    const start = Date.now();
    const result = await evalSWEBenchInstance(instance, tmpBase);
    const elapsed = Date.now() - start;

    // Should fail fast (< 30s) when repo doesn't exist
    expect(elapsed).toBeLessThan(30_000);
    expect(result.durationMs).toBeGreaterThanOrEqual(0);

    rmSync(tmpBase, { recursive: true, force: true });
  }, 35_000);

  // Test: instanceId is preserved in result
  it("preserves instanceId from input", async () => {
    const instance = makeInstance({ instanceId: "my-special-instance" });
    const tmpBase = makeTmpDir();
    const result = await evalSWEBenchInstance(instance, tmpBase);
    expect(result.instanceId).toBe("my-special-instance");
    rmSync(tmpBase, { recursive: true, force: true });
  }, 30_000);

  // Test: errorReason is populated on clone failure
  it("populates errorReason on clone failure", async () => {
    const instance = makeInstance({ repoUrl: "https://github.com/nope/nope-does-not-exist-xyz" });
    const tmpBase = makeTmpDir();
    const result = await evalSWEBenchInstance(instance, tmpBase);
    expect(result.cloneSucceeded).toBe(false);
    expect(typeof result.errorReason).toBe("string");
    expect(result.errorReason!.length).toBeGreaterThan(0);
    rmSync(tmpBase, { recursive: true, force: true });
  }, 30_000);
});

// ---------------------------------------------------------------------------
// Test 4: recordSWEBenchEval creates .danteforge/swe-bench-eval-log.json
// ---------------------------------------------------------------------------

describe("recordSWEBenchEval", () => {
  let testRoot: string;

  beforeEach(() => {
    testRoot = makeTmpDir();
  });

  afterEach(() => {
    rmSync(testRoot, { recursive: true, force: true });
  });

  it("creates .danteforge/swe-bench-eval-log.json in project root", () => {
    const log = makeLog({ instanceId: "record-test-1" });
    recordSWEBenchEval(log, testRoot);

    const logPath = join(testRoot, ".danteforge/swe-bench-eval-log.json");
    const raw = readFileSync(logPath, "utf-8");
    expect(raw.trim().length).toBeGreaterThan(0);

    const parsed = JSON.parse(raw.trim()) as SWEBenchEvalLog;
    expect(parsed.instanceId).toBe("record-test-1");
  });

  it("appends multiple entries as JSONL", () => {
    const log1 = makeLog({ instanceId: "entry-1" });
    const log2 = makeLog({ instanceId: "entry-2" });

    recordSWEBenchEval(log1, testRoot);
    recordSWEBenchEval(log2, testRoot);

    const logPath = join(testRoot, ".danteforge/swe-bench-eval-log.json");
    const raw = readFileSync(logPath, "utf-8");
    const lines = raw.trim().split("\n").filter((l) => l.trim().length > 0);
    expect(lines.length).toBe(2);

    const e1 = JSON.parse(lines[0]!) as SWEBenchEvalLog;
    const e2 = JSON.parse(lines[1]!) as SWEBenchEvalLog;
    expect(e1.instanceId).toBe("entry-1");
    expect(e2.instanceId).toBe("entry-2");
  });
});

// ---------------------------------------------------------------------------
// Test 5: loadSWEBenchEvalLog reads and parses seeded entries
// ---------------------------------------------------------------------------

describe("loadSWEBenchEvalLog", () => {
  let testRoot: string;

  beforeEach(() => {
    testRoot = makeTmpDir();
  });

  afterEach(() => {
    rmSync(testRoot, { recursive: true, force: true });
  });

  it("reads and parses seeded JSONL entries", () => {
    const logPath = join(testRoot, ".danteforge/swe-bench-eval-log.json");
    mkdirSync(join(testRoot, ".danteforge"), { recursive: true });

    const entry1 = makeLog({ instanceId: "load-test-1" });
    const entry2 = makeLog({ instanceId: "load-test-2" });
    writeFileSync(logPath, JSON.stringify(entry1) + "\n" + JSON.stringify(entry2) + "\n", "utf-8");

    const logs = loadSWEBenchEvalLog(testRoot);
    expect(logs.length).toBe(2);
    expect(logs[0]!.instanceId).toBe("load-test-1");
    expect(logs[1]!.instanceId).toBe("load-test-2");
  });

  it("returns empty array when log file does not exist", () => {
    const logs = loadSWEBenchEvalLog(testRoot);
    expect(Array.isArray(logs)).toBe(true);
    expect(logs.length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Tests 6-9: getSWEBenchEvalStats
// ---------------------------------------------------------------------------

describe("getSWEBenchEvalStats", () => {
  it("returns correct patchApplicableRate for seeded data", () => {
    const logs: SWEBenchEvalLog[] = [
      makeLog({ result: makeEvalResult({ cloneSucceeded: true, patchApplicable: true }) }),
      makeLog({ result: makeEvalResult({ cloneSucceeded: true, patchApplicable: true }) }),
      makeLog({ result: makeEvalResult({ cloneSucceeded: true, patchApplicable: false }) }),
      makeLog({ result: makeEvalResult({ cloneSucceeded: false, patchApplicable: false }) }),
    ];
    const stats = getSWEBenchEvalStats(logs);
    // 2 out of 4 → 0.5
    expect(stats.patchApplicableRate).toBeCloseTo(0.5);
  });

  it("returns correct cloneSuccessRate", () => {
    const logs: SWEBenchEvalLog[] = [
      makeLog({ result: makeEvalResult({ cloneSucceeded: true }) }),
      makeLog({ result: makeEvalResult({ cloneSucceeded: true }) }),
      makeLog({ result: makeEvalResult({ cloneSucceeded: true }) }),
      makeLog({ result: makeEvalResult({ cloneSucceeded: false }) }),
    ];
    const stats = getSWEBenchEvalStats(logs);
    // 3 out of 4 → 0.75
    expect(stats.cloneSuccessRate).toBeCloseTo(0.75);
  });

  it("handles empty log gracefully returning zero rates", () => {
    const stats: SWEBenchEvalStats = getSWEBenchEvalStats([]);
    expect(stats.totalInstances).toBe(0);
    expect(stats.cloneSuccessRate).toBe(0);
    expect(stats.patchApplicableRate).toBe(0);
    expect(stats.testPassRate).toBe(0);
  });

  it("computes testPassRate only over instances with testCmd output", () => {
    const logs: SWEBenchEvalLog[] = [
      // Has test result
      makeLog({ result: makeEvalResult({ testsPassed: true }) }),
      makeLog({ result: makeEvalResult({ testsPassed: false }) }),
      makeLog({ result: makeEvalResult({ testsPassed: true }) }),
      // No test result (testsPassed = undefined)
      makeLog({ result: makeEvalResult({ testsPassed: undefined }) }),
      makeLog({ result: makeEvalResult({ testsPassed: undefined }) }),
    ];
    const stats = getSWEBenchEvalStats(logs);
    // 2 passed out of 3 that ran tests → 2/3
    expect(stats.testPassRate).toBeCloseTo(2 / 3);
    expect(stats.totalInstances).toBe(5);
  });

  it("returns totalInstances equal to log length", () => {
    const logs = [makeLog(), makeLog(), makeLog()];
    const stats = getSWEBenchEvalStats(logs);
    expect(stats.totalInstances).toBe(3);
  });
});
