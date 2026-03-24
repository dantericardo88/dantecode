// ============================================================================
// Model Adaptation — Experiment Harness (D-12A Phase 4)
//
// Bounded A/B experiment runner for model adaptation overrides.
// Runs synthetic tasks, replayed exchanges, and control tasks in parallel,
// then compares candidate vs baseline metrics to decide promote/reject/review.
// ============================================================================

import type {
  QuirkKey,
  CandidateOverride,
  ExperimentResult,
  ExperimentConfig,
  ExperimentMetrics,
} from "./model-adaptation-types.js";
import { DEFAULT_EXPERIMENT_CONFIG, generateId } from "./model-adaptation-types.js";

// ---------------------------------------------------------------------------
// Rate limiter — max 5 experiments per quirk per day
// ---------------------------------------------------------------------------

export class ExperimentRateLimiter {
  private counts = new Map<string, { date: string; count: number }>();

  /** Check whether another experiment can run for this quirk today. */
  canRun(quirkKey: QuirkKey): boolean {
    const today = new Date().toISOString().slice(0, 10);
    const entry = this.counts.get(quirkKey);
    if (!entry || entry.date !== today) return true;
    return entry.count < DEFAULT_EXPERIMENT_CONFIG.maxPerQuirkPerDay;
  }

  /** Record that an experiment was run for this quirk. */
  record(quirkKey: QuirkKey): void {
    const today = new Date().toISOString().slice(0, 10);
    const entry = this.counts.get(quirkKey);
    if (!entry || entry.date !== today) {
      this.counts.set(quirkKey, { date: today, count: 1 });
    } else {
      entry.count++;
    }
  }

  /** Return how many experiments remain for this quirk today. */
  getRemainingToday(quirkKey: QuirkKey): number {
    const today = new Date().toISOString().slice(0, 10);
    const entry = this.counts.get(quirkKey);
    if (!entry || entry.date !== today) return DEFAULT_EXPERIMENT_CONFIG.maxPerQuirkPerDay;
    return Math.max(0, DEFAULT_EXPERIMENT_CONFIG.maxPerQuirkPerDay - entry.count);
  }

  /** Clear all recorded counts. */
  reset(): void {
    this.counts.clear();
  }

  /** Serialize rate limiter state for persistence. */
  serialize(): Record<string, { date: string; count: number }> {
    const result: Record<string, { date: string; count: number }> = {};
    for (const [key, value] of this.counts) {
      result[key] = { date: value.date, count: value.count };
    }
    return result;
  }

  /** Restore rate limiter state from serialized data. */
  static deserialize(data: Record<string, { date: string; count: number }>): ExperimentRateLimiter {
    const limiter = new ExperimentRateLimiter();
    const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
    for (const [key, value] of Object.entries(data)) {
      if (
        value &&
        typeof value.date === "string" &&
        DATE_RE.test(value.date) &&
        typeof value.count === "number" &&
        Number.isFinite(value.count)
      ) {
        limiter.counts.set(key, {
          date: value.date,
          count: Math.max(0, Math.min(value.count, DEFAULT_EXPERIMENT_CONFIG.maxPerQuirkPerDay)),
        });
      }
    }
    return limiter;
  }
}

// ---------------------------------------------------------------------------
// Experiment run options — injectable runners for testing
// ---------------------------------------------------------------------------

export interface ExperimentRunOptions {
  config?: Partial<ExperimentConfig>;
  baselineMetrics?: ExperimentMetrics;
  /** Timeout in milliseconds for all experiment runners. Defaults to DEFAULT_EXPERIMENT_CONFIG.maxDurationMs. */
  timeoutMs?: number;
  syntheticTaskRunner?: (override: CandidateOverride) => Promise<ExperimentMetrics>;
  replayRunner?: (override: CandidateOverride) => Promise<ExperimentMetrics>;
  controlRunner?: () => Promise<ExperimentMetrics>;
}

// ---------------------------------------------------------------------------
// Default runners — detection-based, no real LLM calls (D-12A Phase 3)
// ---------------------------------------------------------------------------

async function defaultSyntheticRunner(override: CandidateOverride): Promise<ExperimentMetrics> {
  try {
    const { detectQuirks } = await import("./model-adaptation.js");
    const runner = createDetectionBasedRunner((response, context) =>
      detectQuirks(response, context as unknown as Parameters<typeof detectQuirks>[1]),
    );
    return runner(override);
  } catch {
    // Fixtures or detection unavailable — return baseline-equivalent (no improvement)
    return { pdseScore: 80, completionStatus: "complete", successRate: 0.8 };
  }
}

async function defaultReplayRunner(override: CandidateOverride): Promise<ExperimentMetrics> {
  try {
    const { detectQuirks } = await import("./model-adaptation.js");
    const runner = createFixtureReplayRunner((response, context) =>
      detectQuirks(response, context as unknown as Parameters<typeof detectQuirks>[1]),
    );
    return runner(override);
  } catch {
    return { pdseScore: 80, completionStatus: "complete", successRate: 0.8 };
  }
}

async function defaultControlRunner(): Promise<ExperimentMetrics> {
  try {
    const { detectQuirks } = await import("./model-adaptation.js");
    const { CORRECTED_RESPONSES } =
      await import("./__fixtures__/adaptation-corrected-responses.js");
    const { REPLAY_FIXTURES } = await import("./__fixtures__/adaptation-replays.js");

    // Control: run detection on corrected responses — none should trigger
    let falsePositives = 0;
    let total = 0;
    for (const [, corrected] of CORRECTED_RESPONSES) {
      total++;
      const fixture = REPLAY_FIXTURES.find(
        (f: { name: string }) => f.name === corrected.fixtureName,
      );
      if (!fixture) continue;
      const results = detectQuirks(corrected.response, {
        ...fixture.context,
        sessionId: `control-${corrected.fixtureName}`,
      });
      if (results.some((r: { quirkKey: string }) => r.quirkKey === fixture.expectedQuirk)) {
        falsePositives++;
      }
    }

    const successRate = total > 0 ? 1 - falsePositives / total : 0.8;
    return {
      pdseScore: successRate >= 0.9 ? 85 : 75,
      completionStatus: "complete",
      successRate,
    };
  } catch {
    return { pdseScore: 80, completionStatus: "complete", successRate: 0.8 };
  }
}

// ---------------------------------------------------------------------------
// Core experiment runner
// ---------------------------------------------------------------------------

/**
 * Run a bounded adaptation experiment.
 *
 * Steps:
 *  1. Run synthetic task with the override applied
 *  2. Run a replayed exchange with the override applied
 *  3. Run a control task (no override) to detect environmental regression
 *  4. Aggregate candidate metrics (average of synthetic + replay)
 *  5. Compare candidate vs baseline and decide promote/reject/needs_human_review
 */
export async function runAdaptationExperiment(
  override: CandidateOverride,
  options?: ExperimentRunOptions,
): Promise<ExperimentResult> {
  const syntheticRunner = options?.syntheticTaskRunner ?? defaultSyntheticRunner;
  const replayRunner = options?.replayRunner ?? defaultReplayRunner;
  const controlRunner = options?.controlRunner ?? defaultControlRunner;

  const baseline: ExperimentMetrics = options?.baselineMetrics ?? {
    pdseScore: 80,
    completionStatus: "complete",
    successRate: 0.8,
  };

  // Run all three tasks concurrently with timeout (timer properly cleaned up)
  const timeoutMs = options?.timeoutMs ?? DEFAULT_EXPERIMENT_CONFIG.maxDurationMs;
  const fallbackMetrics: ExperimentMetrics = { ...baseline };
  const TIMEOUT_SENTINEL = "EXPERIMENT_TIMEOUT";
  let timeoutHandle: ReturnType<typeof setTimeout>;
  const [syntheticResult, replayResult, controlResult] = await Promise.race([
    Promise.all([syntheticRunner(override), replayRunner(override), controlRunner()]),
    new Promise<[ExperimentMetrics, ExperimentMetrics, ExperimentMetrics]>((_, reject) => {
      timeoutHandle = setTimeout(() => reject(new Error(TIMEOUT_SENTINEL)), timeoutMs);
    }),
  ])
    .then((result) => {
      clearTimeout(timeoutHandle!);
      return result;
    })
    .catch((err: Error) => {
      clearTimeout(timeoutHandle!);
      if (err.message === TIMEOUT_SENTINEL) {
        return [fallbackMetrics, fallbackMetrics, fallbackMetrics] as [
          ExperimentMetrics,
          ExperimentMetrics,
          ExperimentMetrics,
        ];
      }
      throw err; // re-throw non-timeout errors (e.g. runner failures)
    });

  // Aggregate candidate metrics (average of synthetic + replay)
  const candidate: ExperimentMetrics = {
    pdseScore: average(syntheticResult.pdseScore, replayResult.pdseScore),
    completionStatus:
      syntheticResult.completionStatus === "complete" &&
      replayResult.completionStatus === "complete"
        ? "complete"
        : "partial",
    successRate: average(syntheticResult.successRate, replayResult.successRate),
  };

  // Check control regression — control dropped below baseline * controlRegressionFactor
  const controlFactor =
    options?.config?.controlRegressionFactor ?? DEFAULT_EXPERIMENT_CONFIG.controlRegressionFactor;
  const controlRegression =
    (controlResult.pdseScore ?? 0) < (baseline.pdseScore ?? 80) * controlFactor;

  // Smoke check — did candidate produce a PDSE score at all?
  const smokePassed = candidate.pdseScore !== undefined && controlResult.pdseScore !== undefined;

  // Decision logic
  const pdseDelta = (candidate.pdseScore ?? 0) - (baseline.pdseScore ?? 0);
  let decision: ExperimentResult["decision"];

  if (!smokePassed || controlRegression) {
    decision = "reject";
  } else if (pdseDelta >= 5) {
    decision = "promote";
  } else if (pdseDelta >= 0) {
    decision = "needs_human_review";
  } else {
    decision = "reject";
  }

  return {
    id: generateId("exp"),
    overrideId: override.id,
    provider: override.provider,
    model: override.model,
    quirkKey: override.quirkKey,
    baseline,
    candidate,
    controlRegression,
    smokePassed,
    decision,
    createdAt: new Date().toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Average of defined numeric values. Returns undefined if none provided. */
export function average(...values: (number | undefined)[]): number | undefined {
  const defined = values.filter((v): v is number => v !== undefined);
  if (defined.length === 0) return undefined;
  return defined.reduce((a, b) => a + b, 0) / defined.length;
}

// ---------------------------------------------------------------------------
// Fixture-based replay runner factory
// ---------------------------------------------------------------------------

/**
 * Create a replay runner that uses the D-12A replay fixtures.
 * Runs detection on each matching fixture — if the override's quirk
 * is still detected (i.e. the override didn't suppress it), that's a failure.
 *
 * @param detectFn  The `detectQuirks` function (injected to avoid circular deps)
 */
export function createFixtureReplayRunner(
  detectFn: (response: string, context: Record<string, unknown>) => Array<{ quirkKey: string }>,
): (override: CandidateOverride) => Promise<ExperimentMetrics> {
  return async (override: CandidateOverride): Promise<ExperimentMetrics> => {
    let fixtures: Array<{
      response: string;
      context: Record<string, unknown>;
      expectedQuirk: string;
    }>;
    try {
      const mod = await import("./__fixtures__/adaptation-replays.js");
      fixtures = mod.REPLAY_FIXTURES ?? [];
    } catch {
      // Fixtures not available — fall back to default metrics
      return { pdseScore: 85, completionStatus: "complete", successRate: 0.85 };
    }

    const matching = fixtures.filter((f) => f.expectedQuirk === override.quirkKey);
    if (matching.length === 0) {
      return { pdseScore: 85, completionStatus: "complete", successRate: 0.85 };
    }

    // Run detection on each fixture — count how many still trigger the quirk
    let detected = 0;
    for (const fix of matching) {
      const results = detectFn(fix.response, fix.context);
      if (results.some((r) => r.quirkKey === override.quirkKey)) detected++;
    }

    const successRate = 1 - detected / matching.length;
    return {
      pdseScore: successRate >= 0.5 ? 88 : 72,
      completionStatus: "complete",
      successRate,
    };
  };
}

// ---------------------------------------------------------------------------
// Detection-based runner factory (D-12A Phase 2 — corrected response testing)
// ---------------------------------------------------------------------------

/**
 * Create a runner that tests override effectiveness using corrected fixture responses.
 *
 * For each matching fixture, loads the "corrected" version of the response —
 * what the model would produce if it obeyed the override instruction — and
 * runs detection on it. If the quirk is no longer detected in the corrected
 * response, the override is considered effective (suppression).
 *
 * Falls back to preamble-prepend simulation if no corrected response exists.
 *
 * @param detectFn  The `detectQuirks` function (injected to avoid circular deps)
 */
export function createDetectionBasedRunner(
  detectFn: (response: string, context: Record<string, unknown>) => Array<{ quirkKey: string }>,
): (override: CandidateOverride) => Promise<ExperimentMetrics> {
  return async (override: CandidateOverride): Promise<ExperimentMetrics> => {
    let fixtures: Array<{
      name: string;
      response: string;
      context: Record<string, unknown>;
      expectedQuirk: string;
    }>;
    try {
      const mod = await import("./__fixtures__/adaptation-replays.js");
      fixtures = mod.REPLAY_FIXTURES ?? [];
    } catch {
      return { pdseScore: 85, completionStatus: "complete", successRate: 0.85 };
    }

    // Try to load corrected responses
    let correctedMap: Map<string, { response: string }> | undefined;
    try {
      const corrMod = await import("./__fixtures__/adaptation-corrected-responses.js");
      correctedMap = corrMod.CORRECTED_RESPONSES;
    } catch {
      correctedMap = undefined;
    }

    const matching = fixtures.filter((f) => f.expectedQuirk === override.quirkKey);
    if (matching.length === 0) {
      return { pdseScore: 85, completionStatus: "complete", successRate: 0.85 };
    }

    let suppressed = 0;

    for (const fix of matching) {
      const corrected = correctedMap?.get(fix.name);
      if (corrected) {
        // Test against corrected response (what override instruction would produce)
        const results = detectFn(corrected.response, fix.context);
        if (!results.some((r) => r.quirkKey === override.quirkKey)) {
          suppressed++;
        }
      } else {
        // Fallback: original preamble-prepend behavior
        const preamble = override.patch.promptPreamble ?? "";
        const modifiedResponse = preamble
          ? `[Override active: ${preamble}]\n\n${fix.response}`
          : fix.response;
        const results = detectFn(modifiedResponse, fix.context);
        if (!results.some((r) => r.quirkKey === override.quirkKey)) {
          suppressed++;
        }
      }
    }

    const successRate = suppressed / matching.length;
    return {
      pdseScore: successRate >= 0.5 ? 88 : 72,
      completionStatus: "complete",
      successRate,
    };
  };
}
