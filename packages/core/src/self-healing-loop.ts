// ============================================================================
// @dantecode/core — SelfHealingLoop
//
// Closed verify→repair→verify loop that runs to completion without human
// intervention. Wraps VerificationEngine.selfCorrectLoop() with an async
// fixFn that injects targeted repair messages back into the agent context.
//
// Design origin:
//   - Aider: test-driven loop with error-aware fix prompts
//   - OpenHands: observation→action loop with stage gating
//   - Devin: environment.step() until green
//
// The SelfHealingLoop does NOT generate fixes itself — it bridges the
// gap between VerificationEngine's synchronous repair interface and the
// agent's async message-passing model.
// ============================================================================

import { VerificationEngine } from "./verification-engine.js";
import { RepairStrategyEngine } from "./repair-strategy-engine.js";
import type { VerificationReport, VerificationStage, VerificationStageResult } from "./verification-engine.js";

// ----------------------------------------------------------------------------
// Types
// ----------------------------------------------------------------------------

/** Callback the SelfHealingLoop calls when it needs a fix applied. */
export type AsyncFixFn = (
  stage: VerificationStage,
  prompt: string,
  attempt: number,
) => Promise<void>;

/** Options for SelfHealingLoop. */
export interface SelfHealingLoopOptions {
  /** Max repair attempts per stage. Default: 3. */
  maxAttemptsPerStage?: number;
  /** Max total attempts across all stages. Default: 9. */
  maxTotalAttempts?: number;
  /** PDSE passing threshold (0–1). Default: 0.85. */
  passingThreshold?: number;
  /** Whether to abort on first unrecoverable error signature. Default: true. */
  abortOnStuck?: boolean;
  /** Stages to attempt repair on. Default: ["typecheck", "lint", "unit"]. */
  stages?: VerificationStage[];
  /** Milliseconds to wait between repair attempts. Default: 0. */
  delayBetweenAttemptsMs?: number;
  /** Injectable sleep fn for testing. */
  sleepFn?: (ms: number) => Promise<void>;
}

/** Result of a single stage healing pass. */
export interface StageHealResult {
  stage: VerificationStage;
  healed: boolean;
  attempts: number;
  finalResult: VerificationStageResult;
  stuck: boolean;
}

/** Full result of a SelfHealingLoop run. */
export interface SelfHealingResult {
  /** Whether all targeted stages now pass. */
  allHealed: boolean;
  /** Per-stage results. */
  stageResults: StageHealResult[];
  /** Total repair attempts across all stages. */
  totalAttempts: number;
  /** Final full verification report (run after healing). */
  finalReport: VerificationReport;
  /** Whether the loop was aborted early due to stuck state. */
  abortedEarly: boolean;
  /** Human-readable summary. */
  summary: string;
}

// ----------------------------------------------------------------------------
// SelfHealingLoop
// ----------------------------------------------------------------------------

/**
 * SelfHealingLoop
 *
 * Runs a closed verify→repair→verify cycle for each failing stage.
 *
 * Usage:
 * ```ts
 * const loop = new SelfHealingLoop(engine, repairStrategy, {
 *   maxAttemptsPerStage: 3,
 * });
 * const result = await loop.run(asyncFixFn);
 * if (result.allHealed) { ... }
 * ```
 */
export class SelfHealingLoop {
  private readonly engine: VerificationEngine;
  private readonly repairStrategy: RepairStrategyEngine;
  private readonly maxAttemptsPerStage: number;
  private readonly maxTotalAttempts: number;
  private readonly abortOnStuck: boolean;
  private readonly stages: VerificationStage[];
  private readonly delayBetweenAttemptsMs: number;
  private readonly sleepFn: (ms: number) => Promise<void>;

  constructor(
    engine: VerificationEngine,
    repairStrategy: RepairStrategyEngine,
    options: SelfHealingLoopOptions = {},
  ) {
    this.engine = engine;
    this.repairStrategy = repairStrategy;
    this.maxAttemptsPerStage = options.maxAttemptsPerStage ?? 3;
    this.maxTotalAttempts = options.maxTotalAttempts ?? 9;
    this.abortOnStuck = options.abortOnStuck ?? true;
    this.stages = options.stages ?? ["typecheck", "lint", "unit"];
    this.delayBetweenAttemptsMs = options.delayBetweenAttemptsMs ?? 0;
    this.sleepFn = options.sleepFn ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  }

  /**
   * Run the full self-healing loop.
   *
   * For each stage (in order):
   *  1. Run the stage.
   *  2. If it passes, move to the next stage.
   *  3. If it fails, call asyncFixFn with a targeted repair prompt.
   *  4. Retry up to maxAttemptsPerStage.
   *  5. If stuck (same error signature repeating), abort if abortOnStuck=true.
   *
   * @param fixFn - Async function that applies a fix given a stage and prompt.
   */
  async run(fixFn: AsyncFixFn): Promise<SelfHealingResult> {
    const stageResults: StageHealResult[] = [];
    let totalAttempts = 0;
    let abortedEarly = false;

    for (const stage of this.stages) {
      if (totalAttempts >= this.maxTotalAttempts) {
        // Budget exhausted — record remaining stages as not attempted
        stageResults.push({
          stage,
          healed: false,
          attempts: 0,
          finalResult: this.skippedResult(stage, "Total attempt budget exhausted"),
          stuck: false,
        });
        continue;
      }

      const stageResult = await this.healStage(stage, fixFn, this.maxTotalAttempts - totalAttempts);
      stageResults.push(stageResult);
      totalAttempts += stageResult.attempts;

      if (stageResult.stuck && this.abortOnStuck) {
        abortedEarly = true;
        // Record remaining stages as skipped
        for (const remaining of this.stages.slice(this.stages.indexOf(stage) + 1)) {
          stageResults.push({
            stage: remaining,
            healed: false,
            attempts: 0,
            finalResult: this.skippedResult(remaining, "Aborted — prior stage stuck"),
            stuck: false,
          });
        }
        break;
      }

      // Critical stages (typecheck, lint) block subsequent stages if they fail
      if (!stageResult.healed && (stage === "typecheck" || stage === "lint")) {
        for (const remaining of this.stages.slice(this.stages.indexOf(stage) + 1)) {
          stageResults.push({
            stage: remaining,
            healed: false,
            attempts: 0,
            finalResult: this.skippedResult(remaining, `Blocked by failing ${stage} stage`),
            stuck: false,
          });
        }
        break;
      }
    }

    // Run a final full verification to get an accurate PDSE score
    const finalReport = this.engine.verify();
    const allHealed = stageResults.every((r) => r.healed);

    return {
      allHealed,
      stageResults,
      totalAttempts,
      finalReport,
      abortedEarly,
      summary: this.buildSummary(stageResults, totalAttempts, allHealed, finalReport),
    };
  }

  // --------------------------------------------------------------------------
  // Private
  // --------------------------------------------------------------------------

  /** Heal a single stage up to budgetAttempts, respecting maxAttemptsPerStage. */
  private async healStage(
    stage: VerificationStage,
    fixFn: AsyncFixFn,
    budgetAttempts: number,
  ): Promise<StageHealResult> {
    const maxAttempts = Math.min(this.maxAttemptsPerStage, budgetAttempts);
    const seenSignatures = new Set<string>();
    let attempts = 0;
    let lastResult = this.engine.runStage(stage);

    // Already passing — no repair needed
    if (lastResult.passed) {
      return { stage, healed: true, attempts: 1, finalResult: lastResult, stuck: false };
    }
    attempts++;

    for (let i = 0; i < maxAttempts - 1; i++) {
      // Build repair prompt via RepairStrategyEngine (type-aware routing)
      const prompt = this.repairStrategy.buildRepairPrompt(stage, lastResult);
      const signature = this.computeSignature(lastResult);

      if (seenSignatures.has(signature)) {
        // Same error set — further fixes won't help
        return { stage, healed: false, attempts, finalResult: lastResult, stuck: true };
      }
      seenSignatures.add(signature);

      // Apply fix async
      await fixFn(stage, prompt, i + 1);

      if (this.delayBetweenAttemptsMs > 0) {
        await this.sleepFn(this.delayBetweenAttemptsMs);
      }

      // Re-run the stage
      lastResult = this.engine.runStage(stage);
      attempts++;

      if (lastResult.passed) {
        return { stage, healed: true, attempts, finalResult: lastResult, stuck: false };
      }

      // Check if the new result has the same signature as a previous one
      const newSig = this.computeSignature(lastResult);
      if (seenSignatures.has(newSig)) {
        return { stage, healed: false, attempts, finalResult: lastResult, stuck: true };
      }
    }

    return { stage, healed: false, attempts, finalResult: lastResult, stuck: false };
  }

  /** Compute a fingerprint for an error set to detect stuck loops. */
  private computeSignature(result: VerificationStageResult): string {
    const msgs = result.parsedErrors.map((e) => `${e.file ?? ""}:${e.line ?? 0}:${e.message.slice(0, 80)}`);
    return msgs.sort().join("|") || result.stderr.slice(0, 200);
  }

  /** Create a skipped stage result. */
  private skippedResult(stage: VerificationStage, reason: string): VerificationStageResult {
    return {
      stage,
      passed: false,
      exitCode: -1,
      stdout: "",
      stderr: reason,
      durationMs: 0,
      errorCount: 0,
      parsedErrors: [],
    };
  }

  private buildSummary(
    results: StageHealResult[],
    totalAttempts: number,
    allHealed: boolean,
    report: VerificationReport,
  ): string {
    const lines: string[] = [];
    lines.push(allHealed ? "Self-healing: ALL STAGES PASSED" : "Self-healing: some stages still failing");
    lines.push(`  PDSE: ${(report.pdseScore * 100).toFixed(1)}/100`);
    lines.push(`  Total repair attempts: ${totalAttempts}`);
    for (const r of results) {
      const icon = r.healed ? "✓" : r.stuck ? "⚡" : "✗";
      lines.push(`  ${icon} ${r.stage}: ${r.healed ? "healed" : r.stuck ? "stuck" : "failed"} (${r.attempts} attempts)`);
    }
    return lines.join("\n");
  }
}

// ----------------------------------------------------------------------------
// Factory
// ----------------------------------------------------------------------------

/**
 * Create a SelfHealingLoop preconfigured for a project root.
 *
 * @param projectRoot - The project root directory.
 * @param options - Optional configuration overrides.
 */
export function createSelfHealingLoop(
  projectRoot: string,
  options: SelfHealingLoopOptions = {},
): SelfHealingLoop {
  const engine = new VerificationEngine(projectRoot, {
    stages: options.stages ?? ["typecheck", "lint", "unit"],
    maxFixAttempts: options.maxAttemptsPerStage ?? 3,
  });
  const repairStrategy = new RepairStrategyEngine();
  return new SelfHealingLoop(engine, repairStrategy, options);
}
