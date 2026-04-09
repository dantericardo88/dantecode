import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { join } from "node:path";

// ---------------------------------------------------------------------------
// We test the arg-parsing and dispatch logic of benchmarkCommand.
// The real SWE-bench harness and runAgentLoop are mocked — unit-level tests.
// ---------------------------------------------------------------------------

vi.mock("@dantecode/swe-bench", () => ({
  runSWEBenchHarness: vi.fn(),
}));

vi.mock("../agent-loop.js", () => ({
  runAgentLoop: vi.fn(async () => ({ messages: [] })),
}));

vi.mock("@dantecode/core", () => ({
  readOrInitializeState: vi.fn(async () => ({
    model: { default: { modelId: "claude-sonnet-4-6", provider: "anthropic", maxTokens: 4096, temperature: 0.1, contextWindow: 200000, supportsVision: true, supportsToolCalls: true } },
    projectRoot: "/tmp/dc-bench-test",
  })),
}));

// node:child_process — mock execFileSync and execSync used in agentFn
vi.mock("node:child_process", () => ({
  execFileSync: vi.fn(),
  execSync: vi.fn(() => "--- mock diff ---"),
}));

// node:fs — mock mkdtempSync and rmSync
vi.mock("node:fs", () => ({
  mkdtempSync: vi.fn(() => "/tmp/dc-bench-test"),
  rmSync: vi.fn(),
  existsSync: vi.fn(() => false),
  readFileSync: vi.fn(),
}));

import { benchmarkCommand } from "./benchmark.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeMockHarnessResult(overrides?: {
  resolved?: number;
  total?: number;
  errors?: number;
  resolvedRate?: number;
}) {
  return {
    score: {
      resolved: overrides?.resolved ?? 2,
      total: overrides?.total ?? 5,
      failed: 2,
      errors: overrides?.errors ?? 1,
      resolvedRate: overrides?.resolvedRate ?? 0.4,
      instanceResults: new Map(),
    },
    durationMs: 3000,
    instanceResults: [],
  };
}

// ---------------------------------------------------------------------------
// Dispatch tests
// ---------------------------------------------------------------------------

describe("benchmarkCommand — dispatch", () => {
  it("shows usage when no subcommand is provided", async () => {
    const result = await benchmarkCommand("", "/proj");
    expect(result).toContain("Usage");
    expect(result).toContain("swe-bench");
  });

  it("shows usage when unknown subcommand provided", async () => {
    const result = await benchmarkCommand("unknown-cmd", "/proj");
    expect(result).toContain("Usage");
  });
});

// ---------------------------------------------------------------------------
// swe-bench subcommand — arg parsing
// ---------------------------------------------------------------------------

describe("benchmarkCommand — swe-bench arg parsing", () => {
  let harnessModule: { runSWEBenchHarness: ReturnType<typeof vi.fn> };

  beforeEach(async () => {
    harnessModule = await import("@dantecode/swe-bench") as unknown as typeof harnessModule;
    harnessModule.runSWEBenchHarness.mockResolvedValue(makeMockHarnessResult());
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("defaults to 5 instances when --instances not specified", async () => {
    await benchmarkCommand("swe-bench", "/proj");
    const call = harnessModule.runSWEBenchHarness.mock.calls[0]?.[0];
    expect(call?.maxInstances).toBe(5);
  });

  it("parses --instances flag correctly", async () => {
    await benchmarkCommand("swe-bench --instances 10", "/proj");
    const call = harnessModule.runSWEBenchHarness.mock.calls[0]?.[0];
    expect(call?.maxInstances).toBe(10);
  });

  it("parses --parallel flag correctly", async () => {
    await benchmarkCommand("swe-bench --parallel 3", "/proj");
    const call = harnessModule.runSWEBenchHarness.mock.calls[0]?.[0];
    expect(call?.parallel).toBe(3);
  });

  it("--local flag disables Docker", async () => {
    await benchmarkCommand("swe-bench --local", "/proj");
    const call = harnessModule.runSWEBenchHarness.mock.calls[0]?.[0];
    expect(call?.useDocker).toBe(false);
  });

  it("Docker is enabled by default (no --local flag)", async () => {
    await benchmarkCommand("swe-bench", "/proj");
    const call = harnessModule.runSWEBenchHarness.mock.calls[0]?.[0];
    expect(call?.useDocker).toBe(true);
  });

  it("uses projectRoot for cache dir", async () => {
    await benchmarkCommand("swe-bench", "/my/project");
    const call = harnessModule.runSWEBenchHarness.mock.calls[0]?.[0];
    expect(call?.datasetOptions?.cacheDir).toBe(
      join("/my/project", ".dantecode", "swe-bench-cache"),
    );
  });
});

// ---------------------------------------------------------------------------
// swe-bench subcommand — output
// ---------------------------------------------------------------------------

describe("benchmarkCommand — swe-bench output", () => {
  let harnessModule: { runSWEBenchHarness: ReturnType<typeof vi.fn> };

  beforeEach(async () => {
    harnessModule = await import("@dantecode/swe-bench") as unknown as typeof harnessModule;
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("reports correct resolve rate in output", async () => {
    harnessModule.runSWEBenchHarness.mockResolvedValue(
      makeMockHarnessResult({ resolved: 3, total: 5, resolvedRate: 0.6 }),
    );
    const result = await benchmarkCommand("swe-bench", "/proj");
    expect(result).toContain("3/5");
    expect(result).toContain("60.0%");
  });

  it("includes duration in output", async () => {
    harnessModule.runSWEBenchHarness.mockResolvedValue(
      makeMockHarnessResult(),
    );
    const result = await benchmarkCommand("swe-bench", "/proj");
    expect(result).toMatch(/Duration/);
  });
});
