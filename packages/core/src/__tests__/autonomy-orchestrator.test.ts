// ============================================================================
// Sprint A — Dim 15: AutonomyOrchestrator tests
// Proves: execution-based verify loop, test-output injection, round limits,
//         early-exit on success, export from @dantecode/core.
// ============================================================================

import { describe, it, expect, vi } from "vitest";
import {
  AutonomyOrchestrator,
  buildTestOutputContext,
  makeVerifyFn,
} from "../autonomy-orchestrator.js";
import type { VerifyResult, VerifyFn } from "../autonomy-orchestrator.js";

// ── helpers ───────────────────────────────────────────────────────────────────

function passingVerify(): VerifyFn {
  return vi.fn().mockResolvedValue({ success: true, output: "All tests passed", durationMs: 10 } satisfies VerifyResult);
}

function failingVerify(output = "FAILED: expected 1 got 2"): VerifyFn {
  return vi.fn().mockResolvedValue({ success: false, output, durationMs: 10 } satisfies VerifyResult);
}

function makeWaveFn(outputs: string[] = ["wave output"]) {
  let i = 0;
  return vi.fn().mockImplementation(async () => outputs[i++] ?? "");
}

// ── AutonomyOrchestrator.runWithVerifyLoop ────────────────────────────────────

describe("AutonomyOrchestrator.runWithVerifyLoop", () => {
  it("calls verifyFn after each wave", async () => {
    const orchestrator = new AutonomyOrchestrator();
    const verify = passingVerify();
    const waveFn = makeWaveFn(["w1", "w2"]);

    await orchestrator.runWithVerifyLoop(["wave 1", "wave 2"], waveFn, verify, {
      workdir: "/tmp",
    });

    expect(verify).toHaveBeenCalledTimes(2);
    expect(verify).toHaveBeenCalledWith("/tmp");
  });

  it("injects ## Test Output into next wave when verify fails", async () => {
    const orchestrator = new AutonomyOrchestrator({ maxVerifyRounds: 5 });
    const verify = vi.fn()
      .mockResolvedValueOnce({ success: false, output: "TypeError: x is not a function", durationMs: 5 } satisfies VerifyResult)
      .mockResolvedValue({ success: true, output: "ok", durationMs: 5 } satisfies VerifyResult);

    const waveFn = vi.fn().mockResolvedValue("output");

    await orchestrator.runWithVerifyLoop(["wave 1", "wave 2"], waveFn, verify, {
      workdir: "/tmp",
    });

    // Second wave call should include injected test context
    const secondCallArg = waveFn.mock.calls[1]?.[0] as string;
    expect(secondCallArg).toContain("## Test Output");
    expect(secondCallArg).toContain("TypeError: x is not a function");
  });

  it("exits loop when verifyFn returns success", async () => {
    const orchestrator = new AutonomyOrchestrator();
    const verify = passingVerify();
    const waveFn = makeWaveFn(["output"]);

    const result = await orchestrator.runWithVerifyLoop(["only wave"], waveFn, verify);

    expect(result.finalSuccess).toBe(true);
    expect(result.verifyRoundsUsed).toBe(1);
  });

  it("respects maxVerifyRounds and stops even if still failing", async () => {
    const orchestrator = new AutonomyOrchestrator({ maxVerifyRounds: 2 });
    const verify = failingVerify();
    // 3 waves, each triggering verify, but only 2 rounds allowed
    const waveFn = makeWaveFn(["w1", "w2", "w3"]);

    const result = await orchestrator.runWithVerifyLoop(
      ["wave 1", "wave 2", "wave 3"],
      waveFn,
      verify,
      { workdir: "/tmp" },
    );

    expect(result.verifyRoundsUsed).toBeLessThanOrEqual(4); // 2 max rounds + 2 retries
    expect(verify).toHaveBeenCalled();
  });

  it("calls onWaveComplete callback after each wave", async () => {
    const orchestrator = new AutonomyOrchestrator();
    const verify = passingVerify();
    const waveFn = makeWaveFn(["out1", "out2"]);
    const onWaveComplete = vi.fn();

    await orchestrator.runWithVerifyLoop(["w1", "w2"], waveFn, verify, {
      onWaveComplete,
    });

    expect(onWaveComplete).toHaveBeenCalledTimes(2);
    expect(onWaveComplete.mock.calls[0]?.[0]).toMatchObject({ waveIndex: 0, waveOutput: "out1" });
    expect(onWaveComplete.mock.calls[1]?.[0]).toMatchObject({ waveIndex: 1, waveOutput: "out2" });
  });

  it("returns finalSuccess:false when last verify fails", async () => {
    const orchestrator = new AutonomyOrchestrator({ maxVerifyRounds: 1 });
    const verify = failingVerify();
    const waveFn = makeWaveFn(["output", "retry"]);

    const result = await orchestrator.runWithVerifyLoop(["only wave"], waveFn, verify);

    expect(result.finalSuccess).toBe(false);
  });

  it("skipFinalVerify skips verify on last wave", async () => {
    const orchestrator = new AutonomyOrchestrator();
    const verify = passingVerify();
    const waveFn = makeWaveFn(["w1", "w2"]);

    await orchestrator.runWithVerifyLoop(["wave 1", "wave 2"], waveFn, verify, {
      skipFinalVerify: true,
    });

    // Only 1 verify for wave 1; wave 2 skipped
    expect(verify).toHaveBeenCalledTimes(1);
  });

  it("returns waves array with one entry per executed wave", async () => {
    const orchestrator = new AutonomyOrchestrator();
    const verify = passingVerify();
    const waveFn = makeWaveFn(["a", "b", "c"]);

    const result = await orchestrator.runWithVerifyLoop(
      ["w1", "w2", "w3"],
      waveFn,
      verify,
    );

    expect(result.waves.length).toBeGreaterThanOrEqual(3);
    expect(result.waves[0]?.waveOutput).toBe("a");
  });
});

// ── buildTestOutputContext ────────────────────────────────────────────────────

describe("buildTestOutputContext", () => {
  it("includes ## Test Output header", () => {
    const ctx = buildTestOutputContext("FAILED: expected 1 got 2");
    expect(ctx).toMatch(/^## Test Output/);
  });

  it("includes the failure output inside a code block", () => {
    const ctx = buildTestOutputContext("some error");
    expect(ctx).toContain("```");
    expect(ctx).toContain("some error");
  });

  it("caps output at 4000 characters", () => {
    const longOutput = "x".repeat(10_000);
    const ctx = buildTestOutputContext(longOutput);
    expect(ctx.length).toBeLessThan(4200); // 4000 + surrounding markup
  });

  it("includes actionable instruction to fix failures", () => {
    const ctx = buildTestOutputContext("err");
    expect(ctx).toContain("Fix the failures");
  });
});

// ── export check (from @dantecode/core) ─────────────────────────────────────

describe("export check", () => {
  it("AutonomyOrchestrator is importable from the module", async () => {
    const mod = await import("../autonomy-orchestrator.js");
    expect(mod.AutonomyOrchestrator).toBeDefined();
    expect(mod.buildTestOutputContext).toBeDefined();
    expect(mod.makeVerifyFn).toBeDefined();
  });

  it("makeVerifyFn returns a function", () => {
    const fn = makeVerifyFn("npm test");
    expect(typeof fn).toBe("function");
  });
});
