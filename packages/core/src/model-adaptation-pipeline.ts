// ============================================================================
// Model Adaptation — Pipeline Orchestrator (D-12A Phase 6)
//
// Connects the full D-12A loop: observeAndAdapt → experiment → gate → promote.
// Processes draft candidate overrides through the experiment harness and
// promotion gate, then persists outcomes to the adaptation store.
// ============================================================================

import type {
  CandidateOverride,
  ExperimentResult,
  PromotionGateResult,
  AdaptationEvent,
  AdaptationLogger,
  AdaptationConfig,
  RollbackTrigger,
} from "./model-adaptation-types.js";
import type { ModelAdaptationStore } from "./model-adaptation-store.js";
import {
  ExperimentRateLimiter,
  runAdaptationExperiment,
  createFixtureReplayRunner,
} from "./model-adaptation-experiment.js";
import type { ExperimentRunOptions } from "./model-adaptation-experiment.js";
import { evaluatePromotionGate, shouldRollback } from "./model-adaptation-promotion.js";

// ---------------------------------------------------------------------------
// Pipeline result — one per draft processed
// ---------------------------------------------------------------------------

export interface PipelineResult {
  draft: CandidateOverride;
  experiment: ExperimentResult | null;
  gateResult: PromotionGateResult | null;
  action:
    | "promoted"
    | "rejected"
    | "needs_human_review"
    | "rate_limited"
    | "skipped";
  reason: string;
}

// ---------------------------------------------------------------------------
// Pipeline options
// ---------------------------------------------------------------------------

export interface PipelineOptions {
  rateLimiter: ExperimentRateLimiter;
  experimentOptions?: ExperimentRunOptions;
  dryRun?: boolean;
  /** DI logger callback. Called for each pipeline step. Non-fatal — throw is caught. */
  logger?: AdaptationLogger;
  /** Configurable thresholds for promotion gate. */
  config?: Partial<AdaptationConfig>;
}

function emitEvent(options: PipelineOptions, event: AdaptationEvent): void {
  try { options.logger?.(event); } catch { /* non-fatal */ }
}

// ---------------------------------------------------------------------------
// Pipeline orchestrator
// ---------------------------------------------------------------------------

/**
 * Process an array of draft candidate overrides through the full D-12A loop:
 *
 *   1. Rate-limit check per quirk key
 *   2. Transition draft to "testing" (unless dryRun)
 *   3. Run bounded A/B experiment
 *   4. Record experiment + consume rate-limit token (unless dryRun)
 *   5. Evaluate promotion gate
 *   6. Apply gate decision (promote / reject / needs_human_review)
 *   7. Persist store (unless dryRun)
 *
 * Drafts are processed sequentially to avoid race conditions on the store.
 */
export async function processNewDrafts(
  store: ModelAdaptationStore,
  drafts: CandidateOverride[],
  options: PipelineOptions,
): Promise<PipelineResult[]> {
  const results: PipelineResult[] = [];

  emitEvent(options, { kind: "adaptation:pipeline:start", timestamp: new Date().toISOString(), detail: { draftCount: drafts.length } });

  for (const draft of drafts) {
    // 1. Rate-limit check
    if (!options.rateLimiter.canRun(draft.quirkKey)) {
      results.push({
        draft,
        experiment: null,
        gateResult: null,
        action: "rate_limited",
        reason: `Rate limit reached for quirk "${draft.quirkKey}" today`,
      });
      emitEvent(options, { kind: "adaptation:rate_limited", quirkKey: draft.quirkKey, overrideId: draft.id, timestamp: new Date().toISOString() });
      continue;
    }

    // 2. Transition to "testing"
    if (!options.dryRun) {
      store.updateStatus(draft.id, "testing");
    }

    // 3. Run experiment (fail-safe: runner errors → skip)
    let experiment: ExperimentResult;
    try {
      experiment = await runAdaptationExperiment(
        draft,
        options.experimentOptions,
      );
    } catch (err) {
      const reason = `Experiment failed: ${err instanceof Error ? err.message : String(err)}`;
      emitEvent(options, { kind: "adaptation:experiment:complete", quirkKey: draft.quirkKey, overrideId: draft.id, timestamp: new Date().toISOString(), detail: { error: reason } });
      results.push({ draft, experiment: null, gateResult: null, action: "skipped", reason });
      continue;
    }

    emitEvent(options, { kind: "adaptation:experiment:complete", quirkKey: draft.quirkKey, overrideId: draft.id, timestamp: new Date().toISOString(), detail: { decision: experiment.decision, pdseScore: experiment.candidate.pdseScore } });

    // 4. Record experiment + consume rate-limit token
    if (!options.dryRun) {
      store.addExperiment(experiment);
      options.rateLimiter.record(draft.quirkKey);
    }

    // 5. Evaluate promotion gate
    const gateResult = evaluatePromotionGate(
      experiment,
      store.getPromotionCount(draft.quirkKey),
      options.config,
    );

    // 6. Apply gate decision
    let action: PipelineResult["action"];
    let reason: string;

    switch (gateResult.decision) {
      case "promote":
        if (!options.dryRun) {
          store.updateStatus(draft.id, "promoted");
        }
        action = "promoted";
        reason = gateResult.reasons.join("; ");
        break;

      case "reject":
        if (!options.dryRun) {
          store.updateStatus(draft.id, "rejected");
        }
        action = "rejected";
        reason = gateResult.reasons.join("; ");
        break;

      case "needs_human_review":
        // Set to awaiting_review — blocks re-processing until human approves/rejects
        if (!options.dryRun) {
          store.updateStatus(draft.id, "awaiting_review");
        }
        action = "needs_human_review";
        reason = gateResult.reasons.join("; ");
        break;

      default: {
        // Exhaustive guard — catches unhandled decision values at compile time
        const _exhaustive: never = gateResult.decision;
        action = "skipped";
        reason = `Unknown gate decision: ${String(_exhaustive)}`;
        break;
      }
    }

    emitEvent(options, { kind: "adaptation:gate:decision", quirkKey: draft.quirkKey, overrideId: draft.id, decision: action, reason, timestamp: new Date().toISOString() });

    // 7. Persist store (non-fatal)
    if (!options.dryRun) {
      await store.save(options.rateLimiter).catch(() => {});
    }

    results.push({
      draft,
      experiment,
      gateResult,
      action,
      reason,
    });
  }

  emitEvent(options, { kind: "adaptation:pipeline:complete", timestamp: new Date().toISOString(), detail: { resultCount: results.length } });

  return results;
}

// ---------------------------------------------------------------------------
// Automatic rollback detection (D-12A Gap 2)
// ---------------------------------------------------------------------------

export interface RollbackCheckResult {
  overrideId: string;
  trigger: RollbackTrigger;
  reason: string;
}

/**
 * Check all promoted overrides for regression via lightweight replay experiments.
 *
 * For each promoted override:
 *  1. Run a fixture-based replay experiment using `detectFn`
 *  2. Build a synthetic ExperimentResult
 *  3. Call `shouldRollback()` to evaluate
 *  4. If triggered: mark rolled_back, persist store, emit rollback event
 *
 * Returns an array of rollback results (empty if everything is healthy).
 */
export async function checkPromotedOverrides(
  store: ModelAdaptationStore,
  options: Pick<PipelineOptions, "logger" | "rateLimiter">,
  detectFn: (response: string, context: Record<string, unknown>) => Array<{ quirkKey: string }>,
): Promise<RollbackCheckResult[]> {
  const results: RollbackCheckResult[] = [];

  // Get all unique provider+model combos from promoted overrides
  const snapshot = store.snapshot();
  const promoted = snapshot.overrides.filter((o) => o.status === "promoted");

  if (promoted.length === 0) return results;

  const replayRunner = createFixtureReplayRunner(detectFn);

  for (const override of promoted) {
    // Run a lightweight replay experiment
    const candidateMetrics = await replayRunner(override);

    // Look up the original experiment baseline for this override
    const priorExperiments = store.getExperiments(override.id);
    const actualBaseline = priorExperiments.length > 0
      ? priorExperiments[0]!.baseline
      : { pdseScore: 85, completionStatus: "complete", successRate: 0.85 };

    // Build a synthetic experiment result for shouldRollback evaluation
    const syntheticExperiment: ExperimentResult = {
      id: `rollback_check_${override.id}`,
      overrideId: override.id,
      provider: override.provider,
      model: override.model,
      quirkKey: override.quirkKey,
      baseline: actualBaseline,
      candidate: candidateMetrics,
      controlRegression: false,
      smokePassed: candidateMetrics.pdseScore !== undefined,
      decision: "reject", // placeholder, not used by shouldRollback
      createdAt: new Date().toISOString(),
    };

    const rollbackCheck = shouldRollback([syntheticExperiment]);

    if (rollbackCheck.shouldRollback && rollbackCheck.trigger) {
      // Mark the override as rolled back and create new draft in store
      store.rollbackOverride(override.id);

      // Persist
      await store.save(options.rateLimiter).catch(() => {});

      // Emit event
      emitEvent(
        options as PipelineOptions,
        {
          kind: "adaptation:rollback",
          quirkKey: override.quirkKey,
          overrideId: override.id,
          reason: rollbackCheck.reason,
          timestamp: new Date().toISOString(),
          detail: { trigger: rollbackCheck.trigger },
        },
      );

      results.push({
        overrideId: override.id,
        trigger: rollbackCheck.trigger,
        reason: rollbackCheck.reason,
      });
    }
  }

  return results;
}

// ---------------------------------------------------------------------------
// Singleton rate limiter factory
// ---------------------------------------------------------------------------

let _globalRateLimiter: ExperimentRateLimiter | null = null;

/**
 * Return the global singleton ExperimentRateLimiter.
 * Creates one on first call; subsequent calls return the same instance.
 */
export function getGlobalAdaptationRateLimiter(
  fromStore?: ExperimentRateLimiter | null,
): ExperimentRateLimiter {
  if (!_globalRateLimiter) {
    _globalRateLimiter = fromStore ?? new ExperimentRateLimiter();
  }
  return _globalRateLimiter;
}
