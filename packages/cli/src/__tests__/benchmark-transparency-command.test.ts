import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { runBenchCommand } from "../commands/bench.js";

vi.mock("../commands/benchmark.js", () => ({
  runBuiltinBenchmark: vi.fn(async () => ({
    run_id: "builtin-canary-run",
    timestamp: "2026-04-29T12:00:00.000Z",
    total: 2,
    resolved: 2,
    pass_rate: 1,
    results: [
      { instance_id: "ts-utils__001", resolved: true, durationMs: 4 },
      { instance_id: "ts-utils__002", resolved: true, durationMs: 5 },
    ],
  })),
  formatBenchmarkReport: vi.fn((report: { pass_rate: number; run_id: string }) =>
    `## Benchmark Results\n\nPass rate: ${(report.pass_rate * 100).toFixed(1)}%\nRun ID: ${report.run_id}\n`,
  ),
}));

describe("bench transparency command", () => {
  const tempDirs: string[] = [];

  afterEach(() => {
    for (const dir of tempDirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
    vi.restoreAllMocks();
  });

  function tempProject(): string {
    const dir = mkdtempSync(join(tmpdir(), "dante-bench-command-"));
    tempDirs.push(dir);
    return dir;
  }

  it("writes public-proof artifacts, evidence, and score history for the built-in canary", async () => {
    const projectRoot = tempProject();
    const output: string[] = [];
    vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
      output.push(String(chunk));
      return true;
    });

    await runBenchCommand(
      [
        "transparency",
        "--suite",
        "builtin",
        "--seed",
        "45",
        "--output-dir",
        "benchmarks/transparency",
        "--evidence",
        "--format",
        "json",
      ],
      projectRoot,
    );

    const runDir = join(projectRoot, "benchmarks", "transparency", "builtin-canary-run");
    expect(existsSync(join(runDir, "raw-report.json"))).toBe(true);
    expect(existsSync(join(runDir, "report.md"))).toBe(true);
    expect(existsSync(join(runDir, "command.txt"))).toBe(true);
    expect(existsSync(join(runDir, "selected-instances.json"))).toBe(true);
    expect(existsSync(join(runDir, "per-instance-logs.jsonl"))).toBe(true);
    expect(existsSync(join(runDir, "trace-refs.json"))).toBe(true);
    expect(existsSync(join(runDir, "limitations.md"))).toBe(true);
    expect(existsSync(join(runDir, "manifest.json"))).toBe(true);
    expect(existsSync(join(projectRoot, ".danteforge", "benchmark-score-history.jsonl"))).toBe(true);
    expect(existsSync(join(projectRoot, ".danteforge", "evidence", "benchmark-transparency-dim45.json"))).toBe(true);
    expect(existsSync(join(projectRoot, ".danteforge", "evidence", "benchmark-transparency-dim45.md"))).toBe(true);

    const evidence = JSON.parse(
      readFileSync(join(projectRoot, ".danteforge", "evidence", "benchmark-transparency-dim45.json"), "utf-8"),
    );
    expect(evidence.pass).toBe(true);
    expect(evidence.score).toBeGreaterThanOrEqual(90);
    expect(evidence.manifest.dataset.seed).toBe(45);
    expect(evidence.proof.artifactCount).toBeGreaterThanOrEqual(7);
    expect(output.join("")).toContain("\"dimensionId\": \"benchmark_transparency\"");
  });
});
