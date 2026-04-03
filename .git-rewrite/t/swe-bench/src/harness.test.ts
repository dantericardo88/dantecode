import { mkdirSync, writeFileSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { SWEBenchInstance } from "./dataset-loader.js";
import { getCacheDir, loadSWEBenchDataset } from "./dataset-loader.js";
import type { RunResult } from "./instance-runner.js";
import { compareRuns, scoreResults } from "./scorer.js";
import { runSWEBenchHarness } from "./harness.js";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeInstance(overrides?: Partial<SWEBenchInstance>): SWEBenchInstance {
  return {
    instanceId: overrides?.instanceId ?? "test/instance-001",
    repo: overrides?.repo ?? "https://github.com/example/repo.git",
    baseSha: overrides?.baseSha ?? "abc123",
    problem: overrides?.problem ?? "Fix the bug in module X",
    hints: overrides?.hints,
    testPatch: overrides?.testPatch ?? "--- a/test.py\n+++ b/test.py",
    patchGold: overrides?.patchGold,
  };
}

function makeRunResult(overrides?: Partial<RunResult>): RunResult {
  return {
    instanceId: overrides?.instanceId ?? "test/instance-001",
    status: overrides?.status ?? "resolved",
    testOutput: overrides?.testOutput ?? "All tests passed",
    patchApplied: overrides?.patchApplied ?? true,
    durationMs: overrides?.durationMs ?? 1500,
  };
}

// ---------------------------------------------------------------------------
// Scorer tests
// ---------------------------------------------------------------------------

describe("scoreResults", () => {
  it("should score all resolved results correctly", () => {
    const results: RunResult[] = [
      makeRunResult({ instanceId: "i1", status: "resolved" }),
      makeRunResult({ instanceId: "i2", status: "resolved" }),
      makeRunResult({ instanceId: "i3", status: "resolved" }),
    ];

    const score = scoreResults(results);

    expect(score.total).toBe(3);
    expect(score.resolved).toBe(3);
    expect(score.failed).toBe(0);
    expect(score.errors).toBe(0);
    expect(score.resolvedRate).toBe(1);
    expect(score.instanceResults.size).toBe(3);
    expect(score.instanceResults.get("i1")).toBe("resolved");
    expect(score.instanceResults.get("i2")).toBe("resolved");
    expect(score.instanceResults.get("i3")).toBe("resolved");
  });

  it("should score mixed results correctly", () => {
    const results: RunResult[] = [
      makeRunResult({ instanceId: "i1", status: "resolved" }),
      makeRunResult({ instanceId: "i2", status: "failed" }),
      makeRunResult({ instanceId: "i3", status: "error" }),
      makeRunResult({ instanceId: "i4", status: "timeout" }),
      makeRunResult({ instanceId: "i5", status: "resolved" }),
    ];

    const score = scoreResults(results);

    expect(score.total).toBe(5);
    expect(score.resolved).toBe(2);
    expect(score.failed).toBe(1);
    expect(score.errors).toBe(2); // error + timeout both counted as errors
    expect(score.resolvedRate).toBeCloseTo(0.4);
    expect(score.instanceResults.get("i3")).toBe("error");
    expect(score.instanceResults.get("i4")).toBe("timeout");
  });

  it("should handle empty results", () => {
    const score = scoreResults([]);

    expect(score.total).toBe(0);
    expect(score.resolved).toBe(0);
    expect(score.failed).toBe(0);
    expect(score.errors).toBe(0);
    expect(score.resolvedRate).toBe(0);
    expect(score.instanceResults.size).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// compareRuns tests
// ---------------------------------------------------------------------------

describe("compareRuns", () => {
  it("should show improvement when forge has higher resolved rate", () => {
    const withForge = scoreResults([
      makeRunResult({ instanceId: "i1", status: "resolved" }),
      makeRunResult({ instanceId: "i2", status: "resolved" }),
      makeRunResult({ instanceId: "i3", status: "failed" }),
    ]);

    const withoutForge = scoreResults([
      makeRunResult({ instanceId: "i1", status: "resolved" }),
      makeRunResult({ instanceId: "i2", status: "failed" }),
      makeRunResult({ instanceId: "i3", status: "failed" }),
    ]);

    const comparison = compareRuns(withForge, withoutForge);

    expect(comparison.delta).toBeGreaterThan(0);
    expect(comparison.delta).toBeCloseTo(1 / 3);
    expect(comparison.improvement).toContain("improved");
    expect(comparison.improvement).toContain("2/3");
    expect(comparison.improvement).toContain("1/3");
  });

  it("should show regression when forge has lower resolved rate", () => {
    const withForge = scoreResults([
      makeRunResult({ instanceId: "i1", status: "resolved" }),
      makeRunResult({ instanceId: "i2", status: "failed" }),
      makeRunResult({ instanceId: "i3", status: "failed" }),
      makeRunResult({ instanceId: "i4", status: "failed" }),
    ]);

    const withoutForge = scoreResults([
      makeRunResult({ instanceId: "i1", status: "resolved" }),
      makeRunResult({ instanceId: "i2", status: "resolved" }),
      makeRunResult({ instanceId: "i3", status: "resolved" }),
      makeRunResult({ instanceId: "i4", status: "failed" }),
    ]);

    const comparison = compareRuns(withForge, withoutForge);

    expect(comparison.delta).toBeLessThan(0);
    expect(comparison.improvement).toContain("regressed");
  });

  it("should show no difference when rates are equal", () => {
    const score = scoreResults([
      makeRunResult({ instanceId: "i1", status: "resolved" }),
      makeRunResult({ instanceId: "i2", status: "failed" }),
    ]);

    const comparison = compareRuns(score, score);

    expect(comparison.delta).toBe(0);
    expect(comparison.improvement).toContain("No difference");
  });
});

// ---------------------------------------------------------------------------
// Dataset loader tests
// ---------------------------------------------------------------------------

describe("getCacheDir", () => {
  it("should return the default cache directory", () => {
    const dir = getCacheDir("/home/user/project");
    expect(dir).toBe(
      join("/home/user/project", ".dantecode", "swe-bench-cache"),
    );
  });

  it("should fall back to cwd when no root given", () => {
    const dir = getCacheDir();
    expect(dir).toContain(".dantecode");
    expect(dir).toContain("swe-bench-cache");
  });
});

describe("loadSWEBenchDataset", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "swe-cache-test-"));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it("should return cached instances when cache exists (cache hit)", async () => {
    // Pre-populate the cache
    const instances: SWEBenchInstance[] = [
      makeInstance({ instanceId: "cached/001" }),
      makeInstance({ instanceId: "cached/002" }),
    ];

    mkdirSync(tempDir, { recursive: true });
    writeFileSync(
      join(tempDir, "_index.json"),
      JSON.stringify(instances),
      "utf-8",
    );

    const result = await loadSWEBenchDataset({ cacheDir: tempDir });

    expect(result).toHaveLength(2);
    expect(result[0]?.instanceId).toBe("cached/001");
    expect(result[1]?.instanceId).toBe("cached/002");
  });

  it("should fetch from API when cache is empty (cache miss)", async () => {
    // Mock global fetch to return fake HuggingFace data
    const mockRows = [
      {
        row: {
          instance_id: "django__django-12345",
          repo: "django/django",
          base_commit: "sha1",
          problem_statement: "Fix admin view",
          hints_text: "",
          test_patch: "--- a/t.py\n+++ b/t.py",
          patch: "--- a/fix.py\n+++ b/fix.py",
        },
      },
    ];

    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      json: async () => ({ rows: mockRows }),
    } as Response);

    const result = await loadSWEBenchDataset({ cacheDir: tempDir });

    expect(fetchSpy).toHaveBeenCalledOnce();
    expect(result).toHaveLength(1);
    expect(result[0]?.instanceId).toBe("django__django-12345");
    expect(result[0]?.repo).toBe("django/django");
    expect(result[0]?.problem).toBe("Fix admin view");

    // Verify that the cache was written
    const indexContent = await readFile(
      join(tempDir, "_index.json"),
      "utf-8",
    );
    const cached = JSON.parse(indexContent) as SWEBenchInstance[];
    expect(cached).toHaveLength(1);

    fetchSpy.mockRestore();
  });
});

// ---------------------------------------------------------------------------
// Harness orchestration tests
// ---------------------------------------------------------------------------

describe("runSWEBenchHarness", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "swe-harness-test-"));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  /**
   * Helper to pre-seed the dataset cache so harness doesn't hit the network.
   */
  function seedCache(instances: SWEBenchInstance[]): string {
    const cacheDir = join(tempDir, "cache");
    mkdirSync(cacheDir, { recursive: true });
    writeFileSync(
      join(cacheDir, "_index.json"),
      JSON.stringify(instances),
      "utf-8",
    );
    return cacheDir;
  }

  it("should orchestrate agent -> runner -> scorer pipeline", async () => {
    const instances = [
      makeInstance({ instanceId: "test/001" }),
      makeInstance({ instanceId: "test/002" }),
    ];
    const cacheDir = seedCache(instances);

    const agentFn = vi.fn(async (_problem: string, _repo: string) => {
      return "--- fake patch ---";
    });

    // The runner will produce "error" status (Docker not available in test)
    // but the harness orchestration is still validated end-to-end.
    const result = await runSWEBenchHarness({
      agentFn,
      useDocker: true,
      datasetOptions: { cacheDir },
    });

    expect(agentFn).toHaveBeenCalledTimes(2);
    expect(agentFn).toHaveBeenCalledWith(
      "Fix the bug in module X",
      "https://github.com/example/repo.git",
    );
    expect(result.instanceResults).toHaveLength(2);
    expect(result.score.total).toBe(2);
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });

  it("should respect maxInstances limit", async () => {
    const instances = [
      makeInstance({ instanceId: "test/001" }),
      makeInstance({ instanceId: "test/002" }),
      makeInstance({ instanceId: "test/003" }),
      makeInstance({ instanceId: "test/004" }),
      makeInstance({ instanceId: "test/005" }),
    ];
    const cacheDir = seedCache(instances);

    const agentFn = vi.fn(async () => "--- patch ---");

    const result = await runSWEBenchHarness({
      agentFn,
      maxInstances: 2,
      useDocker: true,
      datasetOptions: { cacheDir },
    });

    // Only 2 out of 5 instances should have been processed
    expect(agentFn).toHaveBeenCalledTimes(2);
    expect(result.instanceResults).toHaveLength(2);
    expect(result.score.total).toBe(2);
  });

  it("should handle agent errors gracefully", async () => {
    const instances = [
      makeInstance({ instanceId: "test/err-001" }),
      makeInstance({ instanceId: "test/err-002" }),
    ];
    const cacheDir = seedCache(instances);

    const agentFn = vi.fn(async () => {
      throw new Error("LLM API rate limit exceeded");
    });

    const result = await runSWEBenchHarness({
      agentFn,
      useDocker: true,
      datasetOptions: { cacheDir },
    });

    // Both should be errors, not crashes
    expect(result.instanceResults).toHaveLength(2);
    for (const ir of result.instanceResults) {
      expect(ir.status).toBe("error");
      expect(ir.testOutput).toContain("Agent error");
      expect(ir.testOutput).toContain("rate limit");
      expect(ir.patchApplied).toBe(false);
    }
    expect(result.score.errors).toBe(2);
    expect(result.score.resolved).toBe(0);
    expect(result.score.resolvedRate).toBe(0);
  });

  it("should process instances in parallel when parallel > 1", async () => {
    const instances = [
      makeInstance({ instanceId: "par/001" }),
      makeInstance({ instanceId: "par/002" }),
      makeInstance({ instanceId: "par/003" }),
    ];
    const cacheDir = seedCache(instances);

    const agentFn = vi.fn(async (_problem: string, _repo: string) => {
      return "--- patch ---";
    });

    const result = await runSWEBenchHarness({
      agentFn,
      parallel: 3,
      useDocker: true,
      datasetOptions: { cacheDir },
    });

    expect(agentFn).toHaveBeenCalledTimes(3);
    expect(result.instanceResults).toHaveLength(3);
    expect(result.score.total).toBe(3);
  });

  it("should use sequential execution when parallel is 1", async () => {
    const instances = [
      makeInstance({ instanceId: "seq/001" }),
      makeInstance({ instanceId: "seq/002" }),
    ];
    const cacheDir = seedCache(instances);

    const agentFn = vi.fn(async () => "--- patch ---");

    const result = await runSWEBenchHarness({
      agentFn,
      parallel: 1,
      useDocker: true,
      datasetOptions: { cacheDir },
    });

    expect(agentFn).toHaveBeenCalledTimes(2);
    expect(result.instanceResults).toHaveLength(2);
  });

  it("should report correct durationMs for the entire run", async () => {
    const instances = [makeInstance({ instanceId: "time/001" })];
    const cacheDir = seedCache(instances);

    const agentFn = vi.fn(async () => {
      // Small delay to ensure measurable duration
      await new Promise((resolve) => setTimeout(resolve, 10));
      return "--- patch ---";
    });

    const result = await runSWEBenchHarness({
      agentFn,
      useDocker: true,
      datasetOptions: { cacheDir },
    });

    expect(result.durationMs).toBeGreaterThan(0);
  });
});
