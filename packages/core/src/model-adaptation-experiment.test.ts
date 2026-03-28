import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  ExperimentRateLimiter,
  runAdaptationExperiment,
  average,
} from "./model-adaptation-experiment.js";
import type { CandidateOverride } from "./model-adaptation-types.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeOverride(overrides?: Partial<CandidateOverride>): CandidateOverride {
  return {
    id: "ovr_test1",
    provider: "anthropic",
    model: "claude-opus-4",
    quirkKey: "tool_call_format_error",
    status: "testing",
    scope: {},
    patch: { promptPreamble: "fix tool calls" },
    basedOnObservationIds: ["obs_1"],
    version: 1,
    createdAt: "2026-03-23T00:00:00.000Z",
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// ExperimentRateLimiter
// ---------------------------------------------------------------------------

describe("ExperimentRateLimiter", () => {
  let limiter: ExperimentRateLimiter;

  beforeEach(() => {
    limiter = new ExperimentRateLimiter();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-23T12:00:00Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("canRun returns true initially", () => {
    expect(limiter.canRun("tool_call_format_error")).toBe(true);
  });

  it("getRemainingToday returns max initially", () => {
    expect(limiter.getRemainingToday("tool_call_format_error")).toBe(5);
  });

  it("returns false after 5 experiments on the same day", () => {
    for (let i = 0; i < 5; i++) {
      limiter.record("tool_call_format_error");
    }
    expect(limiter.canRun("tool_call_format_error")).toBe(false);
    expect(limiter.getRemainingToday("tool_call_format_error")).toBe(0);
  });

  it("resets count on a new day", () => {
    for (let i = 0; i < 5; i++) {
      limiter.record("tool_call_format_error");
    }
    expect(limiter.canRun("tool_call_format_error")).toBe(false);

    // Advance to the next day
    vi.setSystemTime(new Date("2026-03-24T12:00:00Z"));
    expect(limiter.canRun("tool_call_format_error")).toBe(true);
    expect(limiter.getRemainingToday("tool_call_format_error")).toBe(5);
  });

  it("reset() clears all counts", () => {
    limiter.record("tool_call_format_error");
    limiter.record("stops_before_completion");
    limiter.reset();
    expect(limiter.getRemainingToday("tool_call_format_error")).toBe(5);
    expect(limiter.getRemainingToday("stops_before_completion")).toBe(5);
  });

  it("tracks quirks independently", () => {
    for (let i = 0; i < 5; i++) {
      limiter.record("tool_call_format_error");
    }
    expect(limiter.canRun("tool_call_format_error")).toBe(false);
    expect(limiter.canRun("stops_before_completion")).toBe(true);
  });

  it("serialize returns current state", () => {
    limiter.record("tool_call_format_error");
    limiter.record("tool_call_format_error");
    limiter.record("stops_before_completion");
    const serialized = limiter.serialize();
    expect(serialized["tool_call_format_error"]).toBeDefined();
    expect(serialized["tool_call_format_error"]!.count).toBe(2);
    expect(serialized["stops_before_completion"]!.count).toBe(1);
  });

  it("deserialize restores rate limiter state", () => {
    limiter.record("tool_call_format_error");
    limiter.record("tool_call_format_error");
    const serialized = limiter.serialize();
    const restored = ExperimentRateLimiter.deserialize(serialized);
    expect(restored.getRemainingToday("tool_call_format_error")).toBe(3);
    expect(restored.canRun("tool_call_format_error")).toBe(true);
  });

  it("deserialize handles empty/malformed data gracefully", () => {
    const restored = ExperimentRateLimiter.deserialize({});
    expect(restored.canRun("tool_call_format_error")).toBe(true);
    expect(restored.getRemainingToday("tool_call_format_error")).toBe(5);

    const badData = ExperimentRateLimiter.deserialize({ bad: { date: 123, count: "x" } as any });
    expect(badData.canRun("tool_call_format_error")).toBe(true);
  });

  it("serialize/deserialize roundtrip preserves counts", () => {
    for (let i = 0; i < 3; i++) limiter.record("tool_call_format_error");
    const serialized = limiter.serialize();
    const restored = ExperimentRateLimiter.deserialize(serialized);
    expect(restored.getRemainingToday("tool_call_format_error")).toBe(2);
    expect(restored.canRun("tool_call_format_error")).toBe(true);
    restored.record("tool_call_format_error");
    restored.record("tool_call_format_error");
    expect(restored.canRun("tool_call_format_error")).toBe(false);
  });

  it("deserialize rejects invalid date format", () => {
    const restored = ExperimentRateLimiter.deserialize({
      tool_call_format_error: { date: "not-a-date", count: 3 },
    });
    // Invalid date silently ignored — limiter behaves as fresh
    expect(restored.canRun("tool_call_format_error")).toBe(true);
    expect(restored.getRemainingToday("tool_call_format_error")).toBe(5);
  });

  it("deserialize clamps negative count to 0", () => {
    const today = new Date().toISOString().slice(0, 10);
    const restored = ExperimentRateLimiter.deserialize({
      tool_call_format_error: { date: today, count: -5 },
    });
    // Negative count clamped to 0 — all 5 experiments available
    expect(restored.getRemainingToday("tool_call_format_error")).toBe(5);
  });

  it("deserialize clamps count above max to maxPerQuirkPerDay", () => {
    const today = new Date().toISOString().slice(0, 10);
    const restored = ExperimentRateLimiter.deserialize({
      tool_call_format_error: { date: today, count: 999 },
    });
    // Count clamped to maxPerQuirkPerDay (5) — no experiments remaining
    expect(restored.getRemainingToday("tool_call_format_error")).toBe(0);
    expect(restored.canRun("tool_call_format_error")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// average helper
// ---------------------------------------------------------------------------

describe("average", () => {
  it("returns average of defined values", () => {
    expect(average(10, 20)).toBe(15);
    expect(average(80, 90, 100)).toBe(90);
  });

  it("returns undefined when all values are undefined", () => {
    expect(average(undefined, undefined)).toBeUndefined();
  });

  it("filters out undefined values", () => {
    expect(average(10, undefined, 30)).toBe(20);
  });

  it("returns the single value when only one defined", () => {
    expect(average(undefined, 42, undefined)).toBe(42);
  });

  it("returns undefined for empty arguments", () => {
    expect(average()).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// runAdaptationExperiment
// ---------------------------------------------------------------------------

describe("runAdaptationExperiment", () => {
  it("returns ExperimentResult with all required fields", async () => {
    const override = makeOverride();
    const result = await runAdaptationExperiment(override);

    expect(result.id).toMatch(/^exp_/);
    expect(result.overrideId).toBe("ovr_test1");
    expect(result.provider).toBe("anthropic");
    expect(result.model).toBe("claude-opus-4");
    expect(result.quirkKey).toBe("tool_call_format_error");
    expect(result.baseline).toBeDefined();
    expect(result.candidate).toBeDefined();
    expect(typeof result.controlRegression).toBe("boolean");
    expect(typeof result.smokePassed).toBe("boolean");
    expect(["promote", "reject", "needs_human_review"]).toContain(result.decision);
    expect(result.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("uses custom runners when provided", async () => {
    const override = makeOverride();
    const syntheticTaskRunner = vi.fn(async () => ({
      pdseScore: 95,
      completionStatus: "complete" as const,
      successRate: 0.95,
    }));
    const replayRunner = vi.fn(async () => ({
      pdseScore: 93,
      completionStatus: "complete" as const,
      successRate: 0.92,
    }));
    const controlRunner = vi.fn(async () => ({
      pdseScore: 81,
      completionStatus: "complete" as const,
      successRate: 0.8,
    }));

    const result = await runAdaptationExperiment(override, {
      syntheticTaskRunner,
      replayRunner,
      controlRunner,
    });

    expect(syntheticTaskRunner).toHaveBeenCalledWith(override);
    expect(replayRunner).toHaveBeenCalledWith(override);
    expect(controlRunner).toHaveBeenCalled();
    // Candidate PDSE = average(95, 93) = 94
    expect(result.candidate.pdseScore).toBe(94);
  });

  it("decides 'promote' when PDSE improves by >= 5", async () => {
    const override = makeOverride();
    const result = await runAdaptationExperiment(override, {
      baselineMetrics: { pdseScore: 80, completionStatus: "complete", successRate: 0.8 },
      syntheticTaskRunner: async () => ({
        pdseScore: 90,
        completionStatus: "complete",
        successRate: 0.9,
      }),
      replayRunner: async () => ({
        pdseScore: 88,
        completionStatus: "complete",
        successRate: 0.85,
      }),
      controlRunner: async () => ({
        pdseScore: 82,
        completionStatus: "complete",
        successRate: 0.8,
      }),
    });

    // Candidate PDSE = average(90, 88) = 89; delta = 89 - 80 = 9 >= 5
    expect(result.decision).toBe("promote");
    expect(result.candidate.pdseScore).toBe(89);
    expect(result.smokePassed).toBe(true);
    expect(result.controlRegression).toBe(false);
  });

  it("decides 'reject' when control regresses", async () => {
    const override = makeOverride();
    const result = await runAdaptationExperiment(override, {
      baselineMetrics: { pdseScore: 80, completionStatus: "complete", successRate: 0.8 },
      syntheticTaskRunner: async () => ({
        pdseScore: 90,
        completionStatus: "complete",
        successRate: 0.9,
      }),
      replayRunner: async () => ({
        pdseScore: 88,
        completionStatus: "complete",
        successRate: 0.85,
      }),
      // Control dropped below 80 * 0.95 = 76
      controlRunner: async () => ({
        pdseScore: 70,
        completionStatus: "complete",
        successRate: 0.7,
      }),
    });

    expect(result.decision).toBe("reject");
    expect(result.controlRegression).toBe(true);
  });

  it("decides 'reject' when smoke fails (undefined PDSE)", async () => {
    const override = makeOverride();
    const result = await runAdaptationExperiment(override, {
      baselineMetrics: { pdseScore: 80, completionStatus: "complete", successRate: 0.8 },
      syntheticTaskRunner: async () => ({ completionStatus: "failed" }),
      replayRunner: async () => ({ completionStatus: "failed" }),
      controlRunner: async () => ({
        pdseScore: 82,
        completionStatus: "complete",
        successRate: 0.8,
      }),
    });

    expect(result.decision).toBe("reject");
    expect(result.smokePassed).toBe(false);
    expect(result.candidate.pdseScore).toBeUndefined();
  });

  it("decides 'needs_human_review' when PDSE improves but < 5", async () => {
    const override = makeOverride();
    const result = await runAdaptationExperiment(override, {
      baselineMetrics: { pdseScore: 80, completionStatus: "complete", successRate: 0.8 },
      syntheticTaskRunner: async () => ({
        pdseScore: 83,
        completionStatus: "complete",
        successRate: 0.85,
      }),
      replayRunner: async () => ({
        pdseScore: 81,
        completionStatus: "complete",
        successRate: 0.82,
      }),
      controlRunner: async () => ({
        pdseScore: 81,
        completionStatus: "complete",
        successRate: 0.8,
      }),
    });

    // Candidate PDSE = average(83, 81) = 82; delta = 82 - 80 = 2 (0 <= 2 < 5)
    expect(result.decision).toBe("needs_human_review");
  });

  it("decides 'reject' when candidate is worse than baseline", async () => {
    const override = makeOverride();
    const result = await runAdaptationExperiment(override, {
      baselineMetrics: { pdseScore: 80, completionStatus: "complete", successRate: 0.8 },
      syntheticTaskRunner: async () => ({
        pdseScore: 75,
        completionStatus: "partial",
        successRate: 0.6,
      }),
      replayRunner: async () => ({ pdseScore: 73, completionStatus: "partial", successRate: 0.55 }),
      controlRunner: async () => ({
        pdseScore: 81,
        completionStatus: "complete",
        successRate: 0.8,
      }),
    });

    // Candidate PDSE = average(75, 73) = 74; delta = 74 - 80 = -6 < 0
    expect(result.decision).toBe("reject");
  });

  it("uses default baseline when none provided", async () => {
    const override = makeOverride();
    const result = await runAdaptationExperiment(override);

    // Default baseline: pdseScore=80, completionStatus="complete", successRate=0.8
    expect(result.baseline.pdseScore).toBe(80);
    expect(result.baseline.completionStatus).toBe("complete");
    expect(result.baseline.successRate).toBe(0.8);
  });

  it("aggregates completion status correctly", async () => {
    const override = makeOverride();

    // One partial = candidate is partial
    const result = await runAdaptationExperiment(override, {
      syntheticTaskRunner: async () => ({
        pdseScore: 90,
        completionStatus: "complete",
        successRate: 0.9,
      }),
      replayRunner: async () => ({ pdseScore: 88, completionStatus: "partial", successRate: 0.85 }),
      controlRunner: async () => ({
        pdseScore: 82,
        completionStatus: "complete",
        successRate: 0.8,
      }),
    });

    expect(result.candidate.completionStatus).toBe("partial");
  });
});

// ---------------------------------------------------------------------------
// Fixture validation — replay fixtures trigger their expected quirks
// ---------------------------------------------------------------------------

describe("createFixtureReplayRunner", () => {
  it("returns metrics based on detection results", async () => {
    const { createFixtureReplayRunner } = await import("./model-adaptation-experiment.js");

    // Mock detectFn that always finds the quirk → successRate = 0 (quirk not suppressed)
    const alwaysDetect = (_response: string, _context: Record<string, unknown>) => [
      { quirkKey: "katex_format_requirement" },
    ];

    const runner = createFixtureReplayRunner(alwaysDetect);
    const override = makeOverride({ quirkKey: "katex_format_requirement" });
    const metrics = await runner(override);

    expect(metrics.completionStatus).toBe("complete");
    // successRate = 0 (all fixtures still trigger), pdseScore = 72
    expect(metrics.successRate).toBe(0);
    expect(metrics.pdseScore).toBe(72);
  });

  it("returns high score when detection is suppressed", async () => {
    const { createFixtureReplayRunner } = await import("./model-adaptation-experiment.js");

    // Mock detectFn that never detects → successRate = 1 (quirk fully suppressed)
    const neverDetect = () => [] as Array<{ quirkKey: string }>;

    const runner = createFixtureReplayRunner(neverDetect);
    const override = makeOverride({ quirkKey: "katex_format_requirement" });
    const metrics = await runner(override);

    expect(metrics.successRate).toBe(1);
    expect(metrics.pdseScore).toBe(88);
  });

  it("returns default metrics for unmatched quirk", async () => {
    const { createFixtureReplayRunner } = await import("./model-adaptation-experiment.js");

    const neverDetect = () => [] as Array<{ quirkKey: string }>;
    const runner = createFixtureReplayRunner(neverDetect);
    // Use a quirk key that has no fixture — all 10 real keys now have fixtures
    const override = makeOverride({ quirkKey: "stops_before_completion" });
     
    (override as any).quirkKey = "nonexistent_quirk_for_test";
    const metrics = await runner(override);

    // No matching fixtures → default metrics
    expect(metrics.pdseScore).toBe(85);
    expect(metrics.successRate).toBe(0.85);
  });
});

describe("Replay fixtures trigger expected quirks", () => {
  it("formatting-quirk fixture triggers katex_format_requirement", async () => {
    const { detectQuirks } = await import("./model-adaptation.js");
    const { REPLAY_FIXTURES } = await import("./__fixtures__/adaptation-replays.js");

    const fixture = REPLAY_FIXTURES.find((f) => f.name === "formatting-quirk")!;
    const observations = detectQuirks(fixture.response, {
      ...fixture.context,
      sessionId: fixture.context.sessionId,
    });

    const match = observations.find((o) => o.quirkKey === fixture.expectedQuirk);
    expect(match).toBeDefined();
  });

  it("early-stop-quirk fixture triggers stops_before_completion", async () => {
    const { detectQuirks } = await import("./model-adaptation.js");
    const { REPLAY_FIXTURES } = await import("./__fixtures__/adaptation-replays.js");

    const fixture = REPLAY_FIXTURES.find((f) => f.name === "early-stop-quirk")!;
    const observations = detectQuirks(fixture.response, {
      ...fixture.context,
      sessionId: fixture.context.sessionId,
    });

    const match = observations.find((o) => o.quirkKey === fixture.expectedQuirk);
    expect(match).toBeDefined();
  });

  it("schema-mismatch-quirk fixture triggers schema_argument_mismatch", async () => {
    const { detectQuirks } = await import("./model-adaptation.js");
    const { REPLAY_FIXTURES } = await import("./__fixtures__/adaptation-replays.js");

    const fixture = REPLAY_FIXTURES.find((f) => f.name === "schema-mismatch-quirk")!;
    const observations = detectQuirks(fixture.response, {
      ...fixture.context,
      sessionId: fixture.context.sessionId,
    });

    const match = observations.find((o) => o.quirkKey === fixture.expectedQuirk);
    expect(match).toBeDefined();
  });

  it("overly-verbose-preface fixture triggers overly_verbose_preface", async () => {
    const { detectQuirks } = await import("./model-adaptation.js");
    const { REPLAY_FIXTURES } = await import("./__fixtures__/adaptation-replays.js");

    const fixture = REPLAY_FIXTURES.find((f) => f.name === "overly-verbose-preface")!;
    expect(fixture).toBeDefined();
    const observations = detectQuirks(fixture.response, {
      ...fixture.context,
      sessionId: fixture.context.sessionId,
    });

    const match = observations.find((o) => o.quirkKey === fixture.expectedQuirk);
    expect(match).toBeDefined();
  });

  it("tool-call-format-error fixture triggers tool_call_format_error", async () => {
    const { detectQuirks } = await import("./model-adaptation.js");
    const { REPLAY_FIXTURES } = await import("./__fixtures__/adaptation-replays.js");

    const fixture = REPLAY_FIXTURES.find((f) => f.name === "tool-call-format-error")!;
    expect(fixture).toBeDefined();
    const observations = detectQuirks(fixture.response, {
      ...fixture.context,
      sessionId: fixture.context.sessionId,
    });

    const match = observations.find((o) => o.quirkKey === fixture.expectedQuirk);
    expect(match).toBeDefined();
  });

  it("skips-synthesis fixture triggers skips_synthesis", async () => {
    const { detectQuirks } = await import("./model-adaptation.js");
    const { REPLAY_FIXTURES } = await import("./__fixtures__/adaptation-replays.js");

    const fixture = REPLAY_FIXTURES.find((f) => f.name === "skips-synthesis")!;
    expect(fixture).toBeDefined();
    const observations = detectQuirks(fixture.response, {
      ...fixture.context,
      sessionId: fixture.context.sessionId,
    });

    const match = observations.find((o) => o.quirkKey === fixture.expectedQuirk);
    expect(match).toBeDefined();
  });

  it("ignores-prd-section-order fixture triggers ignores_prd_section_order", async () => {
    const { detectQuirks } = await import("./model-adaptation.js");
    const { REPLAY_FIXTURES } = await import("./__fixtures__/adaptation-replays.js");

    const fixture = REPLAY_FIXTURES.find((f) => f.name === "ignores-prd-section-order")!;
    expect(fixture).toBeDefined();
    const observations = detectQuirks(fixture.response, {
      ...fixture.context,
      sessionId: fixture.context.sessionId,
    });

    const match = observations.find((o) => o.quirkKey === fixture.expectedQuirk);
    expect(match).toBeDefined();
  });

  it("markdown-wrapper-issue fixture triggers markdown_wrapper_issue", async () => {
    const { detectQuirks } = await import("./model-adaptation.js");
    const { REPLAY_FIXTURES } = await import("./__fixtures__/adaptation-replays.js");

    const fixture = REPLAY_FIXTURES.find((f) => f.name === "markdown-wrapper-issue")!;
    expect(fixture).toBeDefined();
    const observations = detectQuirks(fixture.response, {
      ...fixture.context,
      sessionId: fixture.context.sessionId,
    });

    const match = observations.find((o) => o.quirkKey === fixture.expectedQuirk);
    expect(match).toBeDefined();
  });

  it("regeneration-trigger-pattern fixture triggers regeneration_trigger_pattern", async () => {
    const { detectQuirks } = await import("./model-adaptation.js");
    const { REPLAY_FIXTURES } = await import("./__fixtures__/adaptation-replays.js");

    const fixture = REPLAY_FIXTURES.find((f) => f.name === "regeneration-trigger-pattern")!;
    expect(fixture).toBeDefined();
    const observations = detectQuirks(fixture.response, {
      ...fixture.context,
      sessionId: fixture.context.sessionId,
    });

    const match = observations.find((o) => o.quirkKey === fixture.expectedQuirk);
    expect(match).toBeDefined();
  });

  it("provider-specific-dispatch-shape fixture triggers provider_specific_dispatch_shape", async () => {
    const { detectQuirks } = await import("./model-adaptation.js");
    const { REPLAY_FIXTURES } = await import("./__fixtures__/adaptation-replays.js");

    const fixture = REPLAY_FIXTURES.find((f) => f.name === "provider-specific-dispatch-shape")!;
    expect(fixture).toBeDefined();
    const observations = detectQuirks(fixture.response, {
      ...fixture.context,
      sessionId: fixture.context.sessionId,
    });

    const match = observations.find((o) => o.quirkKey === fixture.expectedQuirk);
    expect(match).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// createDetectionBasedRunner
// ---------------------------------------------------------------------------

describe("createDetectionBasedRunner", () => {
  it("uses corrected responses to measure override effectiveness", async () => {
    const { createDetectionBasedRunner } = await import("./model-adaptation-experiment.js");
    const { detectQuirks } = await import("./model-adaptation.js");

    // Use real detectQuirks — corrected response for katex has no KaTeX notation
    const detectFn = (response: string, context: Record<string, unknown>) =>
      detectQuirks(response, { ...context, sessionId: "test" } as Parameters<
        typeof detectQuirks
      >[1]);

    const runner = createDetectionBasedRunner(detectFn);
    const override = makeOverride({
      quirkKey: "katex_format_requirement",
      patch: { promptPreamble: "Do not use KaTeX." },
    });
    const metrics = await runner(override);

    // Corrected response has no KaTeX → quirk not detected → suppressed
    expect(metrics.successRate).toBe(1);
    expect(metrics.pdseScore).toBe(88);
  });

  it("returns low score when corrected response still triggers quirk", async () => {
    const { createDetectionBasedRunner } = await import("./model-adaptation-experiment.js");

    // detectFn always detects the quirk regardless of response content
    const alwaysDetect = (_response: string, _context: Record<string, unknown>) => [
      { quirkKey: "katex_format_requirement" },
    ];

    const runner = createDetectionBasedRunner(alwaysDetect);
    const override = makeOverride({ quirkKey: "katex_format_requirement" });
    const metrics = await runner(override);

    expect(metrics.successRate).toBe(0);
    expect(metrics.pdseScore).toBe(72);
  });

  it("returns default metrics when no fixtures match the quirk", async () => {
    const { createDetectionBasedRunner } = await import("./model-adaptation-experiment.js");

    const neverDetect = () => [] as Array<{ quirkKey: string }>;
    const runner = createDetectionBasedRunner(neverDetect);
    // Use a made-up quirk key that definitely has no fixture
    const override = makeOverride({ quirkKey: "tool_call_format_error" });
     
    (override as any).quirkKey = "nonexistent_quirk_key";
    const metrics = await runner(override);

    expect(metrics.pdseScore).toBe(85);
    expect(metrics.successRate).toBe(0.85);
  });

  it("corrected responses do not trigger their respective quirks", async () => {
    const { detectQuirks } = await import("./model-adaptation.js");
    const { REPLAY_FIXTURES } = await import("./__fixtures__/adaptation-replays.js");
    const { CORRECTED_RESPONSES } =
      await import("./__fixtures__/adaptation-corrected-responses.js");

    for (const fixture of REPLAY_FIXTURES) {
      const corrected = CORRECTED_RESPONSES.get(fixture.name);
      expect(corrected, `Corrected response for "${fixture.name}" must exist`).toBeDefined();
      const observations = detectQuirks(corrected!.response, {
        ...fixture.context,
        sessionId: fixture.context.sessionId,
      });
      const match = observations.find((o) => o.quirkKey === fixture.expectedQuirk);
      expect(
        match,
        `Corrected response for "${fixture.name}" should NOT trigger ${fixture.expectedQuirk}`,
      ).toBeUndefined();
    }
  });

  it("original fixtures still trigger their quirks (baseline validation)", async () => {
    const { detectQuirks } = await import("./model-adaptation.js");
    const { REPLAY_FIXTURES } = await import("./__fixtures__/adaptation-replays.js");

    for (const fixture of REPLAY_FIXTURES) {
      const observations = detectQuirks(fixture.response, {
        ...fixture.context,
        sessionId: fixture.context.sessionId,
      });
      const match = observations.find((o) => o.quirkKey === fixture.expectedQuirk);
      expect(
        match,
        `Original fixture "${fixture.name}" should trigger ${fixture.expectedQuirk}`,
      ).toBeDefined();
    }
  });
});

// ---------------------------------------------------------------------------
// D-12A Phase 4 — Control default + timeout tests
// ---------------------------------------------------------------------------

describe("runAdaptationExperiment — control default fix", () => {
  it("undefined control PDSE triggers control regression", async () => {
    const override = makeOverride();
    const result = await runAdaptationExperiment(override, {
      syntheticTaskRunner: async () => ({
        pdseScore: 90,
        completionStatus: "complete",
        successRate: 0.9,
      }),
      replayRunner: async () => ({ pdseScore: 88, completionStatus: "complete", successRate: 0.9 }),
      controlRunner: async () => ({ completionStatus: "failed" }), // no pdseScore
    });
    expect(result.controlRegression).toBe(true);
  });

  it("undefined control PDSE fails smoke check", async () => {
    const override = makeOverride();
    const result = await runAdaptationExperiment(override, {
      syntheticTaskRunner: async () => ({
        pdseScore: 90,
        completionStatus: "complete",
        successRate: 0.9,
      }),
      replayRunner: async () => ({ pdseScore: 88, completionStatus: "complete", successRate: 0.9 }),
      controlRunner: async () => ({ completionStatus: "failed" }), // no pdseScore
    });
    expect(result.smokePassed).toBe(false);
    expect(result.decision).toBe("reject");
  });
});

describe("runAdaptationExperiment — timeout", () => {
  it("experiment completes within timeout when runner hangs", async () => {
    const override = makeOverride();
    const result = await runAdaptationExperiment(override, {
      timeoutMs: 50, // 50ms timeout
      syntheticTaskRunner: async () => {
        await new Promise((resolve) => setTimeout(resolve, 5000)); // hangs 5s
        return { pdseScore: 95, completionStatus: "complete", successRate: 1 };
      },
      replayRunner: async () => ({ pdseScore: 88, completionStatus: "complete", successRate: 0.9 }),
      controlRunner: async () => ({
        pdseScore: 82,
        completionStatus: "complete",
        successRate: 0.8,
      }),
    });
    // Should have fallen back to baseline-equivalent metrics → delta=0 → needs_human_review (no improvement)
    expect(["reject", "needs_human_review"]).toContain(result.decision);
    // Key assertion: experiment completed without hanging
    expect(result.id).toMatch(/^exp_/);
  }, 10_000);
});

// ---------------------------------------------------------------------------
// D-12A Phase 5 — Configurable controlRegressionFactor
// ---------------------------------------------------------------------------

describe("runAdaptationExperiment — custom controlRegressionFactor", () => {
  it("uses custom controlRegressionFactor from config", async () => {
    const override = makeOverride();
    // Control PDSE = 74, baseline = 80. Default factor 0.95 → threshold = 76 → 74 < 76 = regression
    const resultDefault = await runAdaptationExperiment(override, {
      syntheticTaskRunner: async () => ({
        pdseScore: 90,
        completionStatus: "complete",
        successRate: 0.9,
      }),
      replayRunner: async () => ({ pdseScore: 88, completionStatus: "complete", successRate: 0.9 }),
      controlRunner: async () => ({
        pdseScore: 74,
        completionStatus: "complete",
        successRate: 0.7,
      }),
    });
    expect(resultDefault.controlRegression).toBe(true);

    // Custom factor 0.8 → threshold = 64 → 74 > 64 = NO regression
    const resultRelaxed = await runAdaptationExperiment(override, {
      config: { controlRegressionFactor: 0.8 },
      syntheticTaskRunner: async () => ({
        pdseScore: 90,
        completionStatus: "complete",
        successRate: 0.9,
      }),
      replayRunner: async () => ({ pdseScore: 88, completionStatus: "complete", successRate: 0.9 }),
      controlRunner: async () => ({
        pdseScore: 74,
        completionStatus: "complete",
        successRate: 0.7,
      }),
    });
    expect(resultRelaxed.controlRegression).toBe(false);
  });
});
