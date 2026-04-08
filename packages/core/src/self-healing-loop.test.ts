// ============================================================================
// SelfHealingLoop — unit tests
// ============================================================================

import { describe, it, expect, vi } from "vitest";
import { SelfHealingLoop } from "./self-healing-loop.js";
import { RepairStrategyEngine } from "./repair-strategy-engine.js";
import type { VerificationEngine, VerificationReport, VerificationStageResult } from "./verification-engine.js";
import type { AsyncFixFn } from "./self-healing-loop.js";

// ---------------------------------------------------------------------------
// Helpers / mock VerificationEngine
// ---------------------------------------------------------------------------

function makeStageResult(
  stage: VerificationStageResult["stage"],
  passed: boolean,
  errorMsg?: string,
): VerificationStageResult {
  return {
    stage,
    passed,
    exitCode: passed ? 0 : 1,
    stdout: "",
    stderr: passed ? "" : (errorMsg ?? "error"),
    durationMs: 10,
    errorCount: passed ? 0 : 1,
    parsedErrors: passed
      ? []
      : [{ file: "src/a.ts", line: 1, column: null, message: errorMsg ?? "error", errorType: "typescript", code: null }],
  };
}

function makeReport(passed: boolean): VerificationReport {
  return {
    stages: [],
    overallPassed: passed,
    pdseScore: passed ? 1 : 0.3,
    fixSuggestions: [],
    totalDurationMs: 0,
    timestamp: new Date().toISOString(),
  };
}

type MockEngine = {
  runStage: ReturnType<typeof vi.fn>;
  verify: ReturnType<typeof vi.fn>;
  generateFixPrompt: ReturnType<typeof vi.fn>;
};

function makeMockEngine(runStageResponses: VerificationStageResult[][]): MockEngine & VerificationEngine {
  const perStageQueue = new Map<string, VerificationStageResult[]>();
  for (const responses of runStageResponses) {
    if (responses.length > 0) {
      const stage = responses[0]!.stage;
      perStageQueue.set(stage, [...responses]);
    }
  }

  return {
    runStage: vi.fn((stage: string) => {
      const queue = perStageQueue.get(stage);
      if (!queue || queue.length === 0) return makeStageResult(stage as VerificationStageResult["stage"], true);
      if (queue.length === 1) return queue[0]!;
      return queue.shift()!;
    }),
    verify: vi.fn(() => makeReport(true)),
    generateFixPrompt: vi.fn(() => "Fix this"),
    // Other required VerificationEngine methods (unused by SelfHealingLoop)
    getStageCommand: vi.fn(() => "echo ok"),
    detectTestRunner: vi.fn(() => ({ runner: "vitest", command: "npx vitest run" })),
    computePDSEScore: vi.fn(() => 1),
    passesGate: vi.fn(() => true),
    selfCorrectLoop: vi.fn(() => ({ corrected: false, attempts: 1, finalResult: makeStageResult("typecheck", false), errorSignatures: [] })),
  } as unknown as MockEngine & VerificationEngine;
}

// ---------------------------------------------------------------------------
// describe: all stages already passing
// ---------------------------------------------------------------------------

describe("SelfHealingLoop — all stages passing", () => {
  it("returns allHealed=true with zero attempts per stage", async () => {
    const engine = makeMockEngine([
      [makeStageResult("typecheck", true)],
      [makeStageResult("lint", true)],
      [makeStageResult("unit", true)],
    ]);
    const loop = new SelfHealingLoop(engine, new RepairStrategyEngine(), { stages: ["typecheck", "lint", "unit"] });
    const fixFn: AsyncFixFn = vi.fn().mockResolvedValue(undefined);

    const result = await loop.run(fixFn);

    expect(result.allHealed).toBe(true);
    expect(fixFn).not.toHaveBeenCalled();
    expect(result.totalAttempts).toBe(3); // 1 attempt each (passing on first run)
  });
});

// ---------------------------------------------------------------------------
// describe: one stage heals on first retry
// ---------------------------------------------------------------------------

describe("SelfHealingLoop — single stage heals", () => {
  it("calls fixFn once and reports healed=true", async () => {
    const engine = makeMockEngine([
      [makeStageResult("typecheck", false, "Type error"), makeStageResult("typecheck", true)],
      [makeStageResult("lint", true)],
      [makeStageResult("unit", true)],
    ]);
    const loop = new SelfHealingLoop(engine, new RepairStrategyEngine(), {
      stages: ["typecheck", "lint", "unit"],
      maxAttemptsPerStage: 3,
    });
    const fixFn: AsyncFixFn = vi.fn().mockResolvedValue(undefined);

    const result = await loop.run(fixFn);

    expect(result.allHealed).toBe(true);
    const typecheckResult = result.stageResults.find((r) => r.stage === "typecheck");
    expect(typecheckResult?.healed).toBe(true);
    expect(typecheckResult?.attempts).toBe(2); // initial fail + 1 fix + re-run
    expect(fixFn).toHaveBeenCalledTimes(1);
    expect(fixFn).toHaveBeenCalledWith("typecheck", expect.any(String), 1);
  });
});

// ---------------------------------------------------------------------------
// describe: critical stage blocks subsequent stages
// ---------------------------------------------------------------------------

describe("SelfHealingLoop — critical stage blocks subsequent", () => {
  it("skips lint and unit when typecheck cannot be healed", async () => {
    // typecheck always fails (stuck)
    const engine = makeMockEngine([
      [
        makeStageResult("typecheck", false, "Type error A"),
        makeStageResult("typecheck", false, "Type error A"), // same error → stuck
      ],
    ]);
    const loop = new SelfHealingLoop(engine, new RepairStrategyEngine(), {
      stages: ["typecheck", "lint", "unit"],
      maxAttemptsPerStage: 2,
      abortOnStuck: true,
    });
    const fixFn: AsyncFixFn = vi.fn().mockResolvedValue(undefined);

    const result = await loop.run(fixFn);

    expect(result.allHealed).toBe(false);
    expect(result.abortedEarly).toBe(true);

    // lint and unit should be skipped
    const lintResult = result.stageResults.find((r) => r.stage === "lint");
    const unitResult = result.stageResults.find((r) => r.stage === "unit");
    expect(lintResult?.attempts).toBe(0);
    expect(unitResult?.attempts).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// describe: total attempt budget is respected
// ---------------------------------------------------------------------------

describe("SelfHealingLoop — budget enforcement", () => {
  it("does not exceed maxTotalAttempts", async () => {
    // Each stage fails and needs 2 attempts
    const engine = makeMockEngine([
      [makeStageResult("typecheck", false), makeStageResult("typecheck", false)],
      [makeStageResult("lint", false), makeStageResult("lint", false)],
      [makeStageResult("unit", false), makeStageResult("unit", false)],
    ]);
    const loop = new SelfHealingLoop(engine, new RepairStrategyEngine(), {
      stages: ["typecheck", "lint", "unit"],
      maxAttemptsPerStage: 3,
      maxTotalAttempts: 4,
      abortOnStuck: false,
    });
    const fixFn: AsyncFixFn = vi.fn().mockResolvedValue(undefined);

    const result = await loop.run(fixFn);

    expect(result.totalAttempts).toBeLessThanOrEqual(4);
  });
});

// ---------------------------------------------------------------------------
// describe: summary string
// ---------------------------------------------------------------------------

describe("SelfHealingLoop — summary", () => {
  it("summary contains PDSE score", async () => {
    const engine = makeMockEngine([
      [makeStageResult("typecheck", true)],
    ]);
    engine.verify = vi.fn(() => ({ ...makeReport(true), pdseScore: 0.92 }));
    const loop = new SelfHealingLoop(engine, new RepairStrategyEngine(), {
      stages: ["typecheck"],
    });

    const result = await loop.run(vi.fn().mockResolvedValue(undefined));
    expect(result.summary).toContain("92");
  });

  it("summary contains healed status for each stage", async () => {
    const engine = makeMockEngine([
      [makeStageResult("typecheck", true)],
      [makeStageResult("lint", false), makeStageResult("lint", false)],
    ]);
    const loop = new SelfHealingLoop(engine, new RepairStrategyEngine(), {
      stages: ["typecheck", "lint"],
      maxAttemptsPerStage: 2,
      abortOnStuck: false,
    });

    const result = await loop.run(vi.fn().mockResolvedValue(undefined));
    expect(result.summary).toContain("typecheck");
    expect(result.summary).toContain("lint");
  });
});

// ---------------------------------------------------------------------------
// describe: delay between attempts
// ---------------------------------------------------------------------------

describe("SelfHealingLoop — delay", () => {
  it("calls sleepFn between repair attempts", async () => {
    const engine = makeMockEngine([
      [makeStageResult("typecheck", false, "err"), makeStageResult("typecheck", true)],
    ]);
    const sleepFn = vi.fn().mockResolvedValue(undefined);
    const loop = new SelfHealingLoop(engine, new RepairStrategyEngine(), {
      stages: ["typecheck"],
      delayBetweenAttemptsMs: 100,
      sleepFn,
    });

    await loop.run(vi.fn().mockResolvedValue(undefined));

    expect(sleepFn).toHaveBeenCalledWith(100);
  });

  it("does not call sleepFn when delay is 0", async () => {
    const engine = makeMockEngine([
      [makeStageResult("typecheck", false, "err"), makeStageResult("typecheck", true)],
    ]);
    const sleepFn = vi.fn().mockResolvedValue(undefined);
    const loop = new SelfHealingLoop(engine, new RepairStrategyEngine(), {
      stages: ["typecheck"],
      delayBetweenAttemptsMs: 0,
      sleepFn,
    });

    await loop.run(vi.fn().mockResolvedValue(undefined));

    expect(sleepFn).not.toHaveBeenCalled();
  });
});
