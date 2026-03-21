/**
 * ux-benchmark.ts — @dantecode/ux-polish
 *
 * G18 — Dogfooding benchmark harness.
 * Time-to-first-success, long-running flow, error-recovery, and
 * preview-feel audit rubric benchmarks.
 */

import type { ProgressOrchestrator } from "../progress-orchestrator.js";
import type { ErrorHelper } from "../error-helper.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Result of a single benchmark run. */
export interface BenchmarkResult {
  /** Benchmark name. */
  name: string;
  /** Whether the benchmark passed. */
  passed: boolean;
  /** Elapsed time in milliseconds. */
  durationMs: number;
  /** Target threshold in milliseconds (if applicable). */
  thresholdMs?: number;
  /** Human-readable observations. */
  observations: string[];
  /** Score 0–100 (higher = better). */
  score: number;
}

/** Result of the preview-feel rubric audit. */
export interface PreviewFeelScore {
  /** Overall feel score 0–100. */
  overall: number;
  /** Per-dimension scores. */
  dimensions: {
    immediacy: number;
    clarity: number;
    consistency: number;
    recovery: number;
    completeness: number;
  };
  /** Whether the product "feels preview" (score < 70). */
  feelsPreview: boolean;
  /** Observations and improvement suggestions. */
  observations: string[];
}

/** Configuration for a long-running flow benchmark. */
export interface FlowBenchmarkOptions {
  /** Phase names to simulate. */
  phases: string[];
  /** Simulated duration per phase in milliseconds. Default: 0 (instant). */
  phaseDelayMs?: number;
  /** Progress orchestrator to drive. */
  orchestrator?: ProgressOrchestrator;
}

/** Configuration for an error-recovery benchmark. */
export interface ErrorRecoveryBenchmarkOptions {
  /** Errors to classify and format. */
  errors: Error[];
  /** ErrorHelper instance to drive. */
  errorHelper?: ErrorHelper;
}

// ---------------------------------------------------------------------------
// UXBenchmark
// ---------------------------------------------------------------------------

export class UXBenchmark {
  /**
   * Measures time-to-first-success for a given async operation.
   * Target: < 300ms for first visible feedback, < 5000ms for completion.
   */
  async timeToFirstSuccess(
    fn: () => Promise<void>,
    opts: { name?: string; thresholdMs?: number } = {},
  ): Promise<BenchmarkResult> {
    const name = opts.name ?? "time-to-first-success";
    const thresholdMs = opts.thresholdMs ?? 5000;
    const start = Date.now();
    const observations: string[] = [];
    let passed = false;

    try {
      await fn();
      const elapsed = Date.now() - start;
      passed = elapsed <= thresholdMs;
      observations.push(`Completed in ${elapsed}ms (threshold: ${thresholdMs}ms).`);
      if (!passed) {
        observations.push(`SLOW: exceeded threshold by ${elapsed - thresholdMs}ms.`);
      }
      const score = Math.max(0, Math.round(100 - (elapsed / thresholdMs - 1) * 50));
      return {
        name,
        passed,
        durationMs: elapsed,
        thresholdMs,
        observations,
        score: Math.min(100, score),
      };
    } catch (err) {
      const elapsed = Date.now() - start;
      observations.push(`FAILED with error: ${err instanceof Error ? err.message : String(err)}`);
      return { name, passed: false, durationMs: elapsed, thresholdMs, observations, score: 0 };
    }
  }

  /**
   * Benchmarks a long-running multi-phase flow.
   * Verifies that each phase produces visible progress output.
   */
  async longRunningFlowBenchmark(opts: FlowBenchmarkOptions): Promise<BenchmarkResult> {
    const name = "long-running-flow";
    const { phases, phaseDelayMs = 0 } = opts;
    const observations: string[] = [];
    const start = Date.now();
    let phaseCount = 0;
    let allVisible = true;

    for (const phase of phases) {
      if (opts.orchestrator) {
        const phaseId = `bench-phase-${phaseCount}`;
        opts.orchestrator.startProgress(phaseId, { phase, message: `Running ${phase}` });
        if (phaseDelayMs > 0) {
          await new Promise((r) => setTimeout(r, phaseDelayMs));
        }
        const state = opts.orchestrator.getProgress(phaseId);
        if (!state) {
          observations.push(`Phase "${phase}" produced no visible progress state.`);
          allVisible = false;
        } else {
          observations.push(`Phase "${phase}" → status: ${state.status}`);
          opts.orchestrator.completeProgress(phaseId);
        }
      } else {
        observations.push(`Phase "${phase}" simulated (no orchestrator provided).`);
      }
      phaseCount++;
    }

    const elapsed = Date.now() - start;
    const passed = allVisible && phaseCount === phases.length;
    const score = passed ? Math.round(100 - elapsed / 100) : 30;

    observations.push(`${phaseCount}/${phases.length} phases completed.`);
    return {
      name,
      passed,
      durationMs: elapsed,
      observations,
      score: Math.max(0, Math.min(100, score)),
    };
  }

  /**
   * Benchmarks error classification and recovery guidance.
   * Verifies that all errors produce non-empty next-steps (no dead-ends).
   */
  async errorRecoveryBenchmark(opts: ErrorRecoveryBenchmarkOptions): Promise<BenchmarkResult> {
    const name = "error-recovery";
    const { errors, errorHelper } = opts;
    const observations: string[] = [];
    const start = Date.now();
    let deadEnds = 0;

    for (const err of errors) {
      if (errorHelper) {
        const classified = errorHelper.classify(err.message);
        const result = errorHelper.format(classified);
        if (classified.nextSteps.length === 0) {
          observations.push(`DEAD-END: "${err.message}" produced no next steps.`);
          deadEnds++;
        } else {
          observations.push(
            `"${err.message}" → ${result.length > 0 ? classified.nextSteps.length : 0} next step(s).`,
          );
        }
      } else {
        observations.push(`Error "${err.message}" simulated (no helper provided).`);
      }
    }

    const elapsed = Date.now() - start;
    const passed = deadEnds === 0 && errors.length > 0;
    const score =
      errors.length > 0 ? Math.round(((errors.length - deadEnds) / errors.length) * 100) : 100;

    if (deadEnds > 0) {
      observations.push(`${deadEnds}/${errors.length} errors produced dead-end output.`);
    }
    return { name, passed, durationMs: elapsed, observations, score };
  }

  /**
   * Computes a preview-feel rubric score across five dimensions.
   * A score < 70 overall means the product "feels preview".
   *
   * Dimensions:
   *   immediacy    — does progress appear instantly?
   *   clarity      — are messages unambiguous?
   *   consistency  — are surfaces consistent?
   *   recovery     — do errors lead to recovery?
   *   completeness — are all flows complete?
   */
  previewFeelRubric(
    opts: {
      immediacyMs?: number;
      allFlowsComplete?: boolean;
      noDeadEndErrors?: boolean;
      surfacesConsistent?: boolean;
      messagesAmbiguous?: number;
      totalMessages?: number;
    } = {},
  ): PreviewFeelScore {
    const {
      immediacyMs = 0,
      allFlowsComplete = true,
      noDeadEndErrors = true,
      surfacesConsistent = true,
      messagesAmbiguous = 0,
      totalMessages = 1,
    } = opts;

    // Immediacy: 100 if < 100ms, degrades linearly to 0 at 3000ms
    const immediacy = Math.max(0, Math.round(100 - immediacyMs / 30));

    // Clarity: 100 - (ambiguous/total * 100)
    const clarity = Math.round(100 - (messagesAmbiguous / Math.max(1, totalMessages)) * 100);

    // Consistency: binary
    const consistency = surfacesConsistent ? 100 : 40;

    // Recovery: binary
    const recovery = noDeadEndErrors ? 100 : 20;

    // Completeness: binary
    const completeness = allFlowsComplete ? 100 : 30;

    const overall = Math.round((immediacy + clarity + consistency + recovery + completeness) / 5);
    const feelsPreview = overall < 70;

    const observations: string[] = [];
    if (immediacy < 70)
      observations.push(`Immediacy low (${immediacy}/100): feedback takes > ${immediacyMs}ms.`);
    if (clarity < 80)
      observations.push(`Clarity low (${clarity}/100): ${messagesAmbiguous} ambiguous messages.`);
    if (!surfacesConsistent) observations.push("Consistency: surface drift detected.");
    if (!noDeadEndErrors) observations.push("Recovery: dead-end errors detected — add next steps.");
    if (!allFlowsComplete) observations.push("Completeness: some flows are incomplete.");
    if (feelsPreview) {
      observations.push(`Overall ${overall}/100 — product feels PREVIEW. Target: 70+.`);
    } else {
      observations.push(`Overall ${overall}/100 — product feels PRODUCTION-READY.`);
    }

    return {
      overall,
      dimensions: { immediacy, clarity, consistency, recovery, completeness },
      feelsPreview,
      observations,
    };
  }

  /**
   * Formats a BenchmarkResult for display.
   */
  formatResult(result: BenchmarkResult): string {
    const icon = result.passed ? "✓" : "✗";
    const lines = [
      `${icon} ${result.name} — score: ${result.score}/100 (${result.durationMs}ms)`,
      ...result.observations.map((o) => `  ${o}`),
    ];
    return lines.join("\n");
  }

  /**
   * Formats a PreviewFeelScore for display.
   */
  formatPreviewFeel(score: PreviewFeelScore): string {
    const icon = score.feelsPreview ? "⚠" : "✓";
    const lines = [
      `${icon} Preview-Feel Score: ${score.overall}/100 (${score.feelsPreview ? "PREVIEW" : "PRODUCTION-READY"})`,
      `  Immediacy:    ${score.dimensions.immediacy}/100`,
      `  Clarity:      ${score.dimensions.clarity}/100`,
      `  Consistency:  ${score.dimensions.consistency}/100`,
      `  Recovery:     ${score.dimensions.recovery}/100`,
      `  Completeness: ${score.dimensions.completeness}/100`,
      ...score.observations.map((o) => `  → ${o}`),
    ];
    return lines.join("\n");
  }
}
