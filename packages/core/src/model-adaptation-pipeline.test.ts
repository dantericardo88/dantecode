// ============================================================================
// Model Adaptation Pipeline — Tests
// ============================================================================

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("node:fs/promises", () => ({
  readFile: vi.fn().mockRejectedValue({ code: "ENOENT" }),
  writeFile: vi.fn().mockResolvedValue(undefined),
  mkdir: vi.fn().mockResolvedValue(undefined),
}));

import type { CandidateOverride, AdaptationEvent } from "./model-adaptation-types.js";
import type { ExperimentRunOptions } from "./model-adaptation-experiment.js";
import { ExperimentRateLimiter } from "./model-adaptation-experiment.js";
import { ModelAdaptationStore } from "./model-adaptation-store.js";
import {
  processNewDrafts,
  getGlobalAdaptationRateLimiter,
  checkPromotedOverrides,
} from "./model-adaptation-pipeline.js";
import type { PipelineOptions } from "./model-adaptation-pipeline.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeDraft(overrides?: Partial<CandidateOverride>): CandidateOverride {
  return {
    id: `ovr_test_${Math.random().toString(36).slice(2, 10)}`,
    provider: "anthropic",
    model: "claude-opus-4-20250514",
    quirkKey: "stops_before_completion",
    status: "draft",
    scope: {},
    patch: { promptPreamble: "Do not stop early." },
    basedOnObservationIds: ["obs_a1"],
    version: 1,
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

/** Experiment options that yield a strong candidate (PDSE delta >= 5). */
const strongExperimentOptions: ExperimentRunOptions = {
  baselineMetrics: {
    pdseScore: 70,
    completionStatus: "complete",
    successRate: 0.7,
  },
  syntheticTaskRunner: async () => ({
    pdseScore: 85,
    completionStatus: "complete",
    successRate: 0.9,
  }),
  replayRunner: async () => ({
    pdseScore: 83,
    completionStatus: "complete",
    successRate: 0.85,
  }),
  controlRunner: async () => ({
    pdseScore: 72,
    completionStatus: "complete",
    successRate: 0.75,
  }),
};

/** Experiment options that yield a failing smoke test. */
const failingSmokeOptions: ExperimentRunOptions = {
  baselineMetrics: {
    pdseScore: 70,
    completionStatus: "complete",
    successRate: 0.7,
  },
  syntheticTaskRunner: async () => ({
    pdseScore: undefined,
    completionStatus: "failed",
    successRate: 0,
  }),
  replayRunner: async () => ({
    pdseScore: undefined,
    completionStatus: "failed",
    successRate: 0,
  }),
  controlRunner: async () => ({
    pdseScore: 72,
    completionStatus: "complete",
    successRate: 0.75,
  }),
};

/** Add N promoted overrides for a quirk key so promotionCount >= HUMAN_VETO_THRESHOLD. */
function seedPromotedOverrides(
  store: ModelAdaptationStore,
  quirkKey: CandidateOverride["quirkKey"],
  count: number,
): void {
  for (let i = 0; i < count; i++) {
    const draft = store.addDraft({
      provider: "anthropic",
      model: "claude-opus-4-20250514",
      quirkKey,
      scope: {},
      patch: { promptPreamble: `Historical override ${i}` },
      basedOnObservationIds: [],
    });
    store.updateStatus(draft.id, "promoted");
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("processNewDrafts", () => {
  let store: ModelAdaptationStore;
  let rateLimiter: ExperimentRateLimiter;

  beforeEach(async () => {
    store = new ModelAdaptationStore("/tmp/test-project");
    await store.load();
    rateLimiter = new ExperimentRateLimiter();
  });

  it("promotes draft when PDSE delta >= 5 and promotionCount >= 3", async () => {
    seedPromotedOverrides(store, "stops_before_completion", 3);
    const draft = makeDraft();
    const options: PipelineOptions = {
      rateLimiter,
      experimentOptions: strongExperimentOptions,
    };

    const results = await processNewDrafts(store, [draft], options);

    expect(results).toHaveLength(1);
    expect(results[0]!.action).toBe("promoted");
    expect(results[0]!.experiment).not.toBeNull();
    expect(results[0]!.gateResult!.decision).toBe("promote");
  });

  it("rejects draft when experiment smoke fails", async () => {
    seedPromotedOverrides(store, "stops_before_completion", 3);
    const draft = makeDraft();
    const options: PipelineOptions = {
      rateLimiter,
      experimentOptions: failingSmokeOptions,
    };

    const results = await processNewDrafts(store, [draft], options);

    expect(results).toHaveLength(1);
    expect(results[0]!.action).toBe("rejected");
    expect(results[0]!.gateResult!.decision).toBe("reject");
    expect(results[0]!.gateResult!.reasons).toEqual(
      expect.arrayContaining([expect.stringContaining("Smoke test failed")]),
    );
  });

  it("returns needs_human_review for first 3 promotions (promotionCount < 3)", async () => {
    // No prior promotions — promotionCount = 0, below HUMAN_VETO_THRESHOLD
    const draft = makeDraft();
    const options: PipelineOptions = {
      rateLimiter,
      experimentOptions: strongExperimentOptions,
    };

    const results = await processNewDrafts(store, [draft], options);

    expect(results).toHaveLength(1);
    expect(results[0]!.action).toBe("needs_human_review");
    expect(results[0]!.gateResult!.decision).toBe("needs_human_review");
    expect(results[0]!.gateResult!.requiresHumanApproval).toBe(true);
  });

  it("sets status to awaiting_review when gate returns needs_human_review", async () => {
    // Add the draft to the store first so updateStatus can find it
    const draftInput = makeDraft();
    const storedDraft = store.addDraft(draftInput);
    const options: PipelineOptions = {
      rateLimiter,
      experimentOptions: strongExperimentOptions,
    };

    await processNewDrafts(store, [storedDraft], options);

    // Verify the override status was set to awaiting_review (not left as testing)
    const snapshot = store.snapshot();
    const override = snapshot.overrides.find((o) => o.id === storedDraft.id);
    expect(override?.status).toBe("awaiting_review");
  });

  it("returns skipped when experiment runner throws", async () => {
    const draft = makeDraft();
    const options: PipelineOptions = {
      rateLimiter,
      experimentOptions: {
        syntheticTaskRunner: async () => { throw new Error("Runner exploded"); },
        replayRunner: async () => ({ pdseScore: 85, completionStatus: "complete", successRate: 0.9 }),
        controlRunner: async () => ({ pdseScore: 82, completionStatus: "complete", successRate: 0.8 }),
      },
    };

    const results = await processNewDrafts(store, [draft], options);

    expect(results).toHaveLength(1);
    expect(results[0]!.action).toBe("skipped");
    expect(results[0]!.reason).toContain("Runner exploded");
  });

  it("rate-limits after 5 experiments per quirk per day", async () => {
    // Exhaust rate limit by recording 5 experiments
    for (let i = 0; i < 5; i++) {
      rateLimiter.record("stops_before_completion");
    }

    const draft = makeDraft();
    const options: PipelineOptions = {
      rateLimiter,
      experimentOptions: strongExperimentOptions,
    };

    const results = await processNewDrafts(store, [draft], options);

    expect(results).toHaveLength(1);
    expect(results[0]!.action).toBe("rate_limited");
    expect(results[0]!.experiment).toBeNull();
    expect(results[0]!.gateResult).toBeNull();
    expect(results[0]!.reason).toContain("Rate limit");
  });

  it("handles empty drafts array", async () => {
    const options: PipelineOptions = {
      rateLimiter,
      experimentOptions: strongExperimentOptions,
    };

    const results = await processNewDrafts(store, [], options);

    expect(results).toEqual([]);
  });

  it("transitions draft to 'testing' before running experiment", async () => {
    const draft = makeDraft();
    const updateSpy = vi.spyOn(store, "updateStatus");
    const options: PipelineOptions = {
      rateLimiter,
      experimentOptions: strongExperimentOptions,
    };

    await processNewDrafts(store, [draft], options);

    // First call to updateStatus should be "testing"
    expect(updateSpy).toHaveBeenCalledWith(draft.id, "testing");
    // "testing" must be called before any terminal status
    const calls = updateSpy.mock.calls;
    const testingIdx = calls.findIndex(
      (c) => c[0] === draft.id && c[1] === "testing",
    );
    expect(testingIdx).toBe(0);
  });

  it("records experiment in store after running", async () => {
    const draft = makeDraft();
    const addExpSpy = vi.spyOn(store, "addExperiment");
    const options: PipelineOptions = {
      rateLimiter,
      experimentOptions: strongExperimentOptions,
    };

    await processNewDrafts(store, [draft], options);

    expect(addExpSpy).toHaveBeenCalledTimes(1);
    const recorded = addExpSpy.mock.calls[0]![0]!;
    expect(recorded.overrideId).toBe(draft.id);
    expect(recorded.quirkKey).toBe(draft.quirkKey);
  });

  it("singleton factory returns same instance", () => {
    const a = getGlobalAdaptationRateLimiter();
    const b = getGlobalAdaptationRateLimiter();

    expect(a).toBe(b);
    expect(a).toBeInstanceOf(ExperimentRateLimiter);
  });

  it("dryRun=true does not mutate store", async () => {
    const draft = makeDraft();
    const updateSpy = vi.spyOn(store, "updateStatus");
    const addExpSpy = vi.spyOn(store, "addExperiment");
    const saveSpy = vi.spyOn(store, "save");
    const options: PipelineOptions = {
      rateLimiter,
      experimentOptions: strongExperimentOptions,
      dryRun: true,
    };

    const results = await processNewDrafts(store, [draft], options);

    // Pipeline still produces a result
    expect(results).toHaveLength(1);
    expect(results[0]!.experiment).not.toBeNull();
    expect(results[0]!.gateResult).not.toBeNull();

    // But store was never touched
    expect(updateSpy).not.toHaveBeenCalled();
    expect(addExpSpy).not.toHaveBeenCalled();
    expect(saveSpy).not.toHaveBeenCalled();
  });

  it("processes multiple drafts sequentially with independent outcomes", async () => {
    seedPromotedOverrides(store, "stops_before_completion", 3);
    seedPromotedOverrides(store, "skips_synthesis", 3);

    const draftA = makeDraft({
      quirkKey: "stops_before_completion",
    });
    const draftB = makeDraft({
      quirkKey: "skips_synthesis",
    });

    // draftA gets strong experiment → promote
    // draftB gets failing smoke → reject
    let callCount = 0;
    const options: PipelineOptions = {
      rateLimiter,
      experimentOptions: {
        baselineMetrics: {
          pdseScore: 70,
          completionStatus: "complete",
          successRate: 0.7,
        },
        syntheticTaskRunner: async () => {
          callCount++;
          if (callCount <= 1) {
            return {
              pdseScore: 85,
              completionStatus: "complete",
              successRate: 0.9,
            };
          }
          return {
            pdseScore: undefined,
            completionStatus: "failed",
            successRate: 0,
          };
        },
        replayRunner: async () => {
          if (callCount <= 1) {
            return {
              pdseScore: 83,
              completionStatus: "complete",
              successRate: 0.85,
            };
          }
          return {
            pdseScore: undefined,
            completionStatus: "failed",
            successRate: 0,
          };
        },
        controlRunner: async () => ({
          pdseScore: 72,
          completionStatus: "complete",
          successRate: 0.75,
        }),
      },
    };

    const results = await processNewDrafts(
      store,
      [draftA, draftB],
      options,
    );

    expect(results).toHaveLength(2);
    expect(results[0]!.action).toBe("promoted");
    expect(results[0]!.draft.quirkKey).toBe("stops_before_completion");
    expect(results[1]!.action).toBe("rejected");
    expect(results[1]!.draft.quirkKey).toBe("skips_synthesis");
  });
});

// ---------------------------------------------------------------------------
// Pipeline logging and events (D-12A Production Hardening — Gaps 1 + 6)
// ---------------------------------------------------------------------------

describe("Pipeline logging and events", () => {
  let store: ModelAdaptationStore;
  let rateLimiter: ExperimentRateLimiter;

  beforeEach(async () => {
    store = new ModelAdaptationStore("/tmp/test-project-logging");
    await store.load();
    rateLimiter = new ExperimentRateLimiter();
  });

  it("calls logger for each pipeline step", async () => {
    seedPromotedOverrides(store, "stops_before_completion", 3);
    const draft = makeDraft();
    const events: AdaptationEvent[] = [];
    const options: PipelineOptions = {
      rateLimiter,
      experimentOptions: strongExperimentOptions,
      logger: (event) => { events.push(event); },
    };

    const results = await processNewDrafts(store, [draft], options);

    expect(results).toHaveLength(1);

    // Verify we received the expected event kinds in order
    const kinds = events.map((e) => e.kind);
    expect(kinds).toContain("adaptation:pipeline:start");
    expect(kinds).toContain("adaptation:experiment:complete");
    expect(kinds).toContain("adaptation:gate:decision");
    expect(kinds).toContain("adaptation:pipeline:complete");

    // pipeline:start is first, pipeline:complete is last
    expect(kinds[0]).toBe("adaptation:pipeline:start");
    expect(kinds[kinds.length - 1]).toBe("adaptation:pipeline:complete");

    // Verify event detail
    const startEvent = events.find((e) => e.kind === "adaptation:pipeline:start")!;
    expect(startEvent.detail).toEqual({ draftCount: 1 });
    expect(startEvent.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);

    const completeEvent = events.find((e) => e.kind === "adaptation:pipeline:complete")!;
    expect(completeEvent.detail).toEqual({ resultCount: 1 });

    const expEvent = events.find((e) => e.kind === "adaptation:experiment:complete")!;
    expect(expEvent.quirkKey).toBe(draft.quirkKey);
    expect(expEvent.overrideId).toBe(draft.id);

    const gateEvent = events.find((e) => e.kind === "adaptation:gate:decision")!;
    expect(gateEvent.quirkKey).toBe(draft.quirkKey);
    expect(gateEvent.decision).toBe("promoted");
  });

  it("logger failure does not break pipeline", async () => {
    seedPromotedOverrides(store, "stops_before_completion", 3);
    const draft = makeDraft();
    const options: PipelineOptions = {
      rateLimiter,
      experimentOptions: strongExperimentOptions,
      logger: () => { throw new Error("Logger exploded"); },
    };

    // Pipeline should still complete successfully
    const results = await processNewDrafts(store, [draft], options);

    expect(results).toHaveLength(1);
    expect(results[0]!.experiment).not.toBeNull();
    expect(results[0]!.gateResult).not.toBeNull();
    expect(results[0]!.action).toBe("promoted");
  });

  it("no logger (undefined) works fine", async () => {
    const draft = makeDraft();
    const options: PipelineOptions = {
      rateLimiter,
      experimentOptions: strongExperimentOptions,
      // logger is omitted — undefined
    };

    const results = await processNewDrafts(store, [draft], options);

    expect(results).toHaveLength(1);
    expect(results[0]!.experiment).not.toBeNull();
  });

  it("logger receives rate_limited event", async () => {
    // Exhaust rate limit
    for (let i = 0; i < 5; i++) {
      rateLimiter.record("stops_before_completion");
    }

    const draft = makeDraft();
    const events: AdaptationEvent[] = [];
    const options: PipelineOptions = {
      rateLimiter,
      experimentOptions: strongExperimentOptions,
      logger: (event) => { events.push(event); },
    };

    const results = await processNewDrafts(store, [draft], options);

    expect(results).toHaveLength(1);
    expect(results[0]!.action).toBe("rate_limited");

    const kinds = events.map((e) => e.kind);
    expect(kinds).toContain("adaptation:pipeline:start");
    expect(kinds).toContain("adaptation:rate_limited");
    expect(kinds).toContain("adaptation:pipeline:complete");

    // rate_limited event should NOT have experiment:complete or gate:decision
    expect(kinds).not.toContain("adaptation:experiment:complete");
    expect(kinds).not.toContain("adaptation:gate:decision");

    const rateLimitedEvent = events.find((e) => e.kind === "adaptation:rate_limited")!;
    expect(rateLimitedEvent.quirkKey).toBe("stops_before_completion");
    expect(rateLimitedEvent.overrideId).toBe(draft.id);
  });
});

// ---------------------------------------------------------------------------
// Automatic rollback detection (D-12A Gap 2)
// ---------------------------------------------------------------------------

describe("checkPromotedOverrides", () => {
  let store: ModelAdaptationStore;
  let rateLimiter: ExperimentRateLimiter;

  beforeEach(async () => {
    store = new ModelAdaptationStore("/tmp/test-project-rollback");
    await store.load();
    rateLimiter = new ExperimentRateLimiter();
  });

  it("does nothing when no promoted overrides exist", async () => {
    const results = await checkPromotedOverrides(
      store,
      { rateLimiter },
      () => [],
    );

    expect(results).toEqual([]);
  });

  it("does not roll back healthy overrides", async () => {
    // Create a promoted override
    const draft = store.addDraft({
      provider: "anthropic",
      model: "claude-opus-4-20250514",
      quirkKey: "stops_before_completion",
      scope: {},
      patch: { promptPreamble: "Do not stop early." },
      basedOnObservationIds: [],
    });
    store.updateStatus(draft.id, "promoted");

    // detectFn never detects the quirk (override is effective)
    const results = await checkPromotedOverrides(
      store,
      { rateLimiter },
      () => [],
    );

    expect(results).toEqual([]);
    // Override stays promoted
    const snapshot = store.snapshot();
    const override = snapshot.overrides.find((o) => o.id === draft.id);
    expect(override?.status).toBe("promoted");
  });

  it("rolls back when replay shows regression", async () => {
    const draft = store.addDraft({
      provider: "anthropic",
      model: "claude-opus-4-20250514",
      quirkKey: "stops_before_completion",
      scope: {},
      patch: { promptPreamble: "Do not stop early." },
      basedOnObservationIds: [],
    });
    store.updateStatus(draft.id, "promoted");

    // detectFn always detects the quirk (override has regressed — still triggers)
    const detectFn = (_response: string, _context: Record<string, unknown>) => [
      { quirkKey: "stops_before_completion" },
    ];

    const results = await checkPromotedOverrides(
      store,
      { rateLimiter },
      detectFn,
    );

    // Deterministic: detectFn always detects → detected=1/1 → successRate=0
    // → pdseScore=72 → delta (72-85) = -13 < -5 → rollback fires
    expect(results).toHaveLength(1);
    expect(results[0]!.trigger).toBe("pdse_regression");
    expect(results[0]!.overrideId).toBe(draft.id);

    // Verify status changed
    const snapshot = store.snapshot();
    const override = snapshot.overrides.find((o) => o.id === draft.id);
    expect(override?.status).toBe("rolled_back");
  });

  it("persists rollback to store", async () => {
    const draft = store.addDraft({
      provider: "anthropic",
      model: "claude-opus-4-20250514",
      quirkKey: "stops_before_completion",
      scope: {},
      patch: { promptPreamble: "Do not stop early." },
      basedOnObservationIds: [],
    });
    store.updateStatus(draft.id, "promoted");

    const saveSpy = vi.spyOn(store, "save");

    // Always detect quirk → regression
    const detectFn = () => [{ quirkKey: "stops_before_completion" }];

    await checkPromotedOverrides(store, { rateLimiter }, detectFn);

    // Rollback is deterministic — verify save was called and status changed
    const snapshot = store.snapshot();
    const override = snapshot.overrides.find((o) => o.id === draft.id);
    expect(override?.status).toBe("rolled_back");
    expect(saveSpy).toHaveBeenCalled();
  });

  it("emits rollback event via logger", async () => {
    const draft = store.addDraft({
      provider: "anthropic",
      model: "claude-opus-4-20250514",
      quirkKey: "stops_before_completion",
      scope: {},
      patch: { promptPreamble: "Do not stop early." },
      basedOnObservationIds: [],
    });
    store.updateStatus(draft.id, "promoted");

    const events: AdaptationEvent[] = [];
    const logger = (event: AdaptationEvent) => { events.push(event); };

    // Always detect quirk → regression
    const detectFn = () => [{ quirkKey: "stops_before_completion" }];

    await checkPromotedOverrides(store, { rateLimiter, logger }, detectFn);

    // Rollback is deterministic — verify event emitted
    const snapshot = store.snapshot();
    const override = snapshot.overrides.find((o) => o.id === draft.id);
    expect(override?.status).toBe("rolled_back");
    const rollbackEvents = events.filter((e) => e.kind === "adaptation:rollback");
    expect(rollbackEvents).toHaveLength(1);
    expect(rollbackEvents[0]!.quirkKey).toBe("stops_before_completion");
    expect(rollbackEvents[0]!.overrideId).toBe(draft.id);
    expect(rollbackEvents[0]!.detail?.trigger).toBe("pdse_regression");
  });

  it("rollback creates new draft in store (not just status change)", async () => {
    const store = new ModelAdaptationStore("/project");
    await store.load();
    const rateLimiter = new ExperimentRateLimiter();

    const draft = store.addDraft({
      provider: "anthropic",
      model: "claude-opus-4-20250514",
      quirkKey: "stops_before_completion",
      scope: {},
      patch: { promptPreamble: "Do not stop early." },
      basedOnObservationIds: [],
    });
    store.updateStatus(draft.id, "promoted");

    const detectFn = () => [{ quirkKey: "stops_before_completion" }];

    await checkPromotedOverrides(store, { rateLimiter }, detectFn);

    const snapshot = store.snapshot();
    // Original should be rolled_back
    expect(snapshot.overrides.find((o) => o.id === draft.id)?.status).toBe("rolled_back");
    // A new draft should exist with rollbackOfVersion
    const newDraft = snapshot.overrides.find(
      (o) => o.id !== draft.id && o.rollbackOfVersion !== undefined,
    );
    expect(newDraft).toBeDefined();
    expect(newDraft!.status).toBe("draft");
    expect(newDraft!.rollbackOfVersion).toBe(draft.version);
  });
});
