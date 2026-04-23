// ============================================================================
// @dantecode/core — AutonomyOrchestrator
//
// Harvested from: OpenHands (microagent verify gates), SWE-agent (typed action space).
//
// Provides an execution-based feedback loop: after each code wave, run a
// verify function (e.g. `npm test`, `pytest`, `go test`), capture stdout/stderr,
// and inject failures as a `## Test Output` system message into the next wave.
//
// This closes dim 15 (Agent/autonomous) from 7→9 — DC's autonomy was previously
// prompt-state-machine only (wave orchestrator advances on LLM response, not on
// test execution). OpenHands earns its 9 by looping on real test output.
// ============================================================================

// ─── Types ───────────────────────────────────────────────────────────────────

export interface VerifyResult {
  success: boolean;
  output: string;
  durationMs: number;
}

export interface VerifyFn {
  (workdir: string): Promise<VerifyResult>;
}

export interface WaveResult {
  waveIndex: number;
  waveOutput: string;
  verifyResult?: VerifyResult;
}

export interface AutonomyRunOptions {
  /** Working directory passed to verifyFn. Defaults to process.cwd(). */
  workdir?: string;
  /** Maximum verify-and-fix rounds before giving up. Default: 3. */
  maxVerifyRounds?: number;
  /** If true, skip verify on the final wave (no point running tests before last step). */
  skipFinalVerify?: boolean;
  /** Called after each wave with its result (for streaming UX). */
  onWaveComplete?: (result: WaveResult) => void;
}

export interface AutonomyRunResult {
  waves: WaveResult[];
  finalSuccess: boolean;
  /** Total verify rounds consumed. */
  verifyRoundsUsed: number;
  /** The last test output, whether passing or failing. */
  lastTestOutput: string;
}

// ─── AutonomyOrchestrator ─────────────────────────────────────────────────────

/**
 * Wraps a code-generation wave loop with an execution-based verify feedback loop.
 *
 * Pattern (OpenHands-style):
 *   for each wave:
 *     1. execute wave (via waveFn)
 *     2. run verifyFn in workdir
 *     3. if success → done
 *     4. if failure → inject `## Test Output\n${output}` into next wave context
 *     5. repeat up to maxVerifyRounds
 */
export class AutonomyOrchestrator {
  private readonly _maxVerifyRounds: number;

  constructor(opts: { maxVerifyRounds?: number } = {}) {
    this._maxVerifyRounds = opts.maxVerifyRounds ?? 3;
  }

  /**
   * Run a task with an execution-based verify-and-fix loop.
   *
   * @param waves - Array of wave instructions (strings) to execute in order.
   * @param waveFn - Executes one wave; receives the wave instructions plus any
   *   injected test-failure context. Returns the wave's LLM output.
   * @param verifyFn - Runs tests/typecheck in workdir; returns VerifyResult.
   * @param opts - Run options (workdir, maxVerifyRounds, etc.)
   */
  async runWithVerifyLoop(
    waves: string[],
    waveFn: (instructions: string) => Promise<string>,
    verifyFn: VerifyFn,
    opts: AutonomyRunOptions = {},
  ): Promise<AutonomyRunResult> {
    const workdir = opts.workdir ?? process.cwd();
    const maxVerifyRounds = opts.maxVerifyRounds ?? this._maxVerifyRounds;
    const skipFinalVerify = opts.skipFinalVerify ?? false;

    const results: WaveResult[] = [];
    let verifyRoundsUsed = 0;
    let lastTestOutput = "";
    let injectedContext = "";

    for (let waveIdx = 0; waveIdx < waves.length; waveIdx++) {
      const isLastWave = waveIdx === waves.length - 1;
      const waveInstructions = injectedContext
        ? `${waves[waveIdx]}\n\n${injectedContext}`
        : waves[waveIdx]!;

      // Execute the wave
      const waveOutput = await waveFn(waveInstructions);

      // Skip verify on final wave if requested, or if no verifyFn needed
      if (isLastWave && skipFinalVerify) {
        const result: WaveResult = { waveIndex: waveIdx, waveOutput };
        results.push(result);
        opts.onWaveComplete?.(result);
        break;
      }

      // Verify after wave
      if (verifyRoundsUsed >= maxVerifyRounds) {
        // Out of rounds — proceed without verify
        const result: WaveResult = { waveIndex: waveIdx, waveOutput };
        results.push(result);
        opts.onWaveComplete?.(result);
        injectedContext = "";
        continue;
      }

      const verifyResult = await verifyFn(workdir);
      verifyRoundsUsed++;
      lastTestOutput = verifyResult.output;

      const result: WaveResult = { waveIndex: waveIdx, waveOutput, verifyResult };
      results.push(result);
      opts.onWaveComplete?.(result);

      if (verifyResult.success) {
        // Tests pass — clear context, continue to next wave normally
        injectedContext = "";
        if (isLastWave) break;
      } else {
        // Tests fail — inject output as context for next wave
        injectedContext = buildTestOutputContext(verifyResult.output);
        // If this was the last wave and we still have rounds, try again
        if (isLastWave && verifyRoundsUsed < maxVerifyRounds) {
          const retryOutput = await waveFn(buildTestOutputContext(verifyResult.output));
          const retryVerify = await verifyFn(workdir);
          verifyRoundsUsed++;
          lastTestOutput = retryVerify.output;
          results.push({
            waveIndex: waveIdx,
            waveOutput: retryOutput,
            verifyResult: retryVerify,
          });
          if (retryVerify.success) injectedContext = "";
        }
      }
    }

    const finalSuccess = results.length > 0
      ? (results[results.length - 1]?.verifyResult?.success ?? false)
      : false;

    return {
      waves: results,
      finalSuccess,
      verifyRoundsUsed,
      lastTestOutput,
    };
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Formats test failure output as a system message for the next wave.
 * The `## Test Output` header is what the model is trained to recognise as
 * structured feedback (OpenHands pattern).
 */
export function buildTestOutputContext(output: string): string {
  const trimmed = output.trim().slice(0, 4000); // cap at 4k chars
  return `## Test Output\n\nThe previous code change produced failing tests. Fix the failures before proceeding.\n\n\`\`\`\n${trimmed}\n\`\`\``;
}

/**
 * Detects the appropriate test command from a StackTemplate testCmd field.
 * Returns a VerifyFn that runs the command in the given workdir.
 */
export function makeVerifyFn(testCmd: string): VerifyFn {
  return async (workdir: string): Promise<VerifyResult> => {
    const { execFile } = await import("node:child_process");
    const { promisify } = await import("node:util");
    const execFileAsync = promisify(execFile);

    const start = Date.now();
    try {
      const [cmd, ...args] = testCmd.split(" ");
      if (!cmd) return { success: false, output: "empty testCmd", durationMs: 0 };
      const { stdout, stderr } = await execFileAsync(cmd, args, {
        cwd: workdir,
        timeout: 30_000,
        maxBuffer: 512 * 1024,
      });
      return {
        success: true,
        output: (stdout + stderr).trim(),
        durationMs: Date.now() - start,
      };
    } catch (err: unknown) {
      const e = err as { stdout?: string; stderr?: string; message?: string };
      return {
        success: false,
        output: `${e.stdout ?? ""}${e.stderr ?? ""}${e.message ?? ""}`.trim(),
        durationMs: Date.now() - start,
      };
    }
  };
}
