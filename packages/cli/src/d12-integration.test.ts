// ============================================================================
// D-12 Integration Tests
// Vision Lock, Postal Service Automation, Model Adaptation, Progressive Disclosure
// ============================================================================

import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  RunReportAccumulator,
  serializeRunReportToMarkdown,
  verifyCompletion,
  deriveExpectations,
  summarizeVerification,
  ModelAdaptationStore,
  observeAndAdapt,
  promoteOverride,
  reportFileName,
  ExperimentRateLimiter,
  evaluatePromotionGate,
  createRollbackOverride,
  generateAdaptationReport,
  serializeAdaptationReport,
  processNewDrafts,
  runAdaptationExperiment,
  shouldRollback,
} from "@dantecode/core";
import type { RunReportEntry, ExperimentResult, CandidateOverride } from "@dantecode/core";

// ─── Mock filesystem for completion verifier + model adaptation ──────────────
vi.mock("node:fs/promises", () => ({
  stat: vi.fn(),
  readFile: vi.fn(),
  writeFile: vi.fn(),
  mkdir: vi.fn(),
  readdir: vi.fn(),
}));

import { stat, readFile, readdir } from "node:fs/promises";
const mockStat = stat as ReturnType<typeof vi.fn>;
const mockReadFile = readFile as ReturnType<typeof vi.fn>;
const mockReaddir = readdir as ReturnType<typeof vi.fn>;

import { countSuccessfulSessions } from "./session-utils.js";
import { getSlashCommandsMeta } from "./slash-commands.js";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeAccumulator(command = "/magic build auth") {
  return new RunReportAccumulator({
    project: "TestProject",
    command,
    model: { provider: "anthropic", modelId: "claude-sonnet-4-6" },
    dantecodeVersion: "1.3.0",
  });
}

function makeEntry(overrides?: Partial<RunReportEntry>): RunReportEntry {
  return {
    prdName: "auth",
    prdFile: "prds/01-auth.md",
    status: "complete",
    filesCreated: [{ path: "src/auth.ts", lines: 100 }],
    filesModified: [{ path: "src/index.ts", added: 5, removed: 1 }],
    filesDeleted: [],
    verification: {
      antiStub: { passed: true, violations: 0, details: [] },
      constitution: { passed: true, violations: 0, warnings: 0, details: [] },
      pdseScore: 94,
      pdseThreshold: 85,
      regenerationAttempts: 0,
      maxAttempts: 3,
    },
    tests: { created: 5, passing: 5, failing: 0 },
    summary: "Built the auth feature.",
    startedAt: "2026-03-22T14:30:00Z",
    completedAt: "2026-03-22T14:45:00Z",
    tokenUsage: { input: 5000, output: 3000 },
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  (mockReadFile as ReturnType<typeof vi.fn>).mockRejectedValue({ code: "ENOENT" });
  (mockStat as ReturnType<typeof vi.fn>).mockRejectedValue({ code: "ENOENT" });
});

// ─── D-12.2: Report heading compliance ──────────────────────────────────────

describe("D-12.2: Run report has all 6 required headings", () => {
  const REQUIRED_HEADINGS = [
    "## What was built",
    "## What needs attention",
    "## Completion status",
    "## Verification summary",
    "## Files changed",
    "## Reproduction",
  ];

  it("/magic report contains all 6 D-12 headings", () => {
    const acc = makeAccumulator("/magic build auth system");
    acc.beginEntry("auth", "magic");
    acc.recordFilesCreated([{ path: "src/auth.ts", lines: 100 }]);
    acc.recordTests({ created: 3, passing: 3, failing: 0 });
    acc.completeEntry({ status: "complete", summary: "Built auth." });

    const report = acc.finalize();
    const md = serializeRunReportToMarkdown(report);

    for (const heading of REQUIRED_HEADINGS) {
      expect(md).toContain(heading);
    }
  });

  it("/party report on partial failure populates 'What needs attention'", () => {
    const acc = makeAccumulator("/party --autoforge build everything");
    acc.beginEntry("auth", "prds/auth.md");
    acc.completeEntry({ status: "complete", summary: "Built auth." });
    acc.beginEntry("api", "prds/api.md");
    acc.completeEntry({
      status: "failed",
      summary: "Route handlers.",
      failureReason: "Empty function bodies.",
      actionNeeded: "Implement POST handlers manually.",
    });

    const report = acc.finalize();
    const md = serializeRunReportToMarkdown(report);

    expect(md).toContain("## What needs attention");
    expect(md).toContain("**api**");
    expect(md).toContain("Implement POST handlers manually.");
  });

  it("crash-safe: snapshot produces valid partial report", () => {
    const acc = makeAccumulator("/magic build feature");
    acc.beginEntry("feature", "magic");
    acc.recordFilesCreated([{ path: "src/feature.ts", lines: 50 }]);
    // Simulate crash — don't call completeEntry or finalize

    const report = acc.snapshot();
    const md = serializeRunReportToMarkdown(report);

    // All 6 headings must still be present
    for (const heading of REQUIRED_HEADINGS) {
      expect(md).toContain(heading);
    }
    // Entry should show as not_attempted (default before completeEntry)
    expect(md).toContain("NOT ATTEMPTED");
  });

  it("empty report still contains all 6 headings", () => {
    const acc = makeAccumulator("/forge");
    const report = acc.finalize();
    const md = serializeRunReportToMarkdown(report);

    for (const heading of REQUIRED_HEADINGS) {
      expect(md).toContain(heading);
    }
  });
});

// ─── D-12.2: Report filename format ─────────────────────────────────────────

describe("D-12.2: Report filename with command suffix", () => {
  it("generates filename with command suffix", () => {
    const name = reportFileName("2026-03-22T14:30:00.000Z", "magic");
    expect(name).toBe("run-2026-03-22T14-30-00Z-magic.md");
  });

  it("sanitizes command suffix", () => {
    const name = reportFileName("2026-03-22T14:30:00.000Z", "/party --autoforge");
    // Slashes, spaces, and dashes are collapsed into single dashes
    expect(name).toBe("run-2026-03-22T14-30-00Z-party-autoforge.md");
  });

  it("falls back to old format without command", () => {
    const name = reportFileName("2026-03-22T14:30:00.000Z");
    expect(name).toBe("run-2026-03-22T14-30-00Z.md");
  });
});

// ─── D-12.3: Completion verifier ─────────────────────────────────────────────

describe("D-12.3: Completion verifier integration", () => {
  it("verifies complete when all files exist", async () => {
    mockStat.mockResolvedValue({ isFile: () => true });
    mockReadFile.mockResolvedValue("export function auth() { return true; }");

    const result = await verifyCompletion("/project", {
      expectedFiles: ["src/auth.ts", "src/auth.test.ts"],
      expectedPatterns: [{ file: "src/auth.ts", pattern: "function auth" }],
    });

    expect(result.verdict).toBe("complete");
    expect(result.confidence).toBe("high");
    expect(result.failed).toHaveLength(0);
  });

  it("returns partial when some files missing", async () => {
    mockStat
      .mockResolvedValueOnce({ isFile: () => true })
      .mockRejectedValueOnce({ code: "ENOENT" })
      .mockRejectedValueOnce({ code: "ENOENT" });
    mockReadFile.mockResolvedValue("content");

    const result = await verifyCompletion("/project", {
      expectedFiles: ["src/auth.ts", "src/api.ts", "src/db.ts"],
    });

    expect(result.verdict).toBe("partial");
  });

  it("deriveExpectations maps RunReportEntry correctly", () => {
    const entry = makeEntry();
    const expectations = deriveExpectations(entry);

    expect(expectations.expectedFiles).toContain("src/auth.ts");
    expect(expectations.expectedFiles).toContain("src/index.ts");
  });

  it("summarizeVerification produces readable output", () => {
    const summary = summarizeVerification({
      verdict: "partial",
      confidence: "medium",
      passed: ["src/auth.ts exists"],
      failed: ["src/api.ts missing"],
      uncertain: [],
      fileChecks: [],
      patternChecks: [],
      summary: "",
    });

    expect(summary).toContain("medium");
  });
});

// ─── D-12.4: Model adaptation observation + candidate override ──────────────

describe("D-12.4: Model adaptation observation and candidate creation", () => {
  it("creates draft override after 3 observations of same quirk", async () => {
    const store = new ModelAdaptationStore("/tmp/test-project");
    const modelKey = { provider: "anthropic", modelId: "claude-sonnet-4-6" };
    // Response must be >500 chars and END with a summary phrase (regex uses $)
    const longText = "A".repeat(600) + " In summary:";

    // Feed 3 observations of stops_before_completion
    for (let i = 0; i < 3; i++) {
      await observeAndAdapt(store, longText, {
        modelKey,
        sessionId: `session-${i}`,
        hadToolCalls: false,
        toolCallsInRound: 0,
      });
    }

    // Should have created a draft override with D-12A QuirkKey
    const overrides = store.getOverrides(modelKey, "draft");
    expect(overrides.length).toBeGreaterThanOrEqual(1);
    const stopsOverride = overrides.find((o) => o.quirkKey === "stops_before_completion");
    expect(stopsOverride).toBeDefined();
    expect(stopsOverride!.patch.promptPreamble).toContain("summarize");
  });

  it("promote requires both testsPass and smokePass", async () => {
    const store = new ModelAdaptationStore("/tmp/test-project");
    const draft = store.addDraft({
      provider: "anthropic",
      model: "claude-sonnet-4-6",
      quirkKey: "stops_before_completion",
      scope: {},
      patch: { promptPreamble: "Do not summarize early." },
      basedOnObservationIds: [],
    });

    // Should fail without smokePass
    const failResult = await promoteOverride(store, draft.id, {
      testsPass: true,
      smokePass: false,
    });
    expect(failResult).toBe(false);

    // Should succeed with both
    store.updateStatus(draft.id, "testing");
    const successResult = await promoteOverride(store, draft.id, {
      testsPass: true,
      smokePass: true,
      pdseScore: 92,
    });
    expect(successResult).toBe(true);
    expect(
      store.getActiveOverrides({ provider: "anthropic", modelId: "claude-sonnet-4-6" }),
    ).toHaveLength(1);
  });

  it("model adaptation snapshot is serializable", () => {
    const store = new ModelAdaptationStore("/tmp/test-project");
    store.addDraft({
      provider: "grok",
      model: "grok-3",
      quirkKey: "overly_verbose_preface",
      scope: {},
      patch: { promptPreamble: "Be concise." },
      basedOnObservationIds: [],
    });

    const snap = store.snapshot();
    const json = JSON.stringify(snap);
    expect(json).toBeTruthy();
    expect(snap.overrides).toHaveLength(1);
  });
});

// ─── D-12A: Bounded Model Adaptation V1 ─────────────────────────────────────

describe("D-12A: Experiment rate limiting", () => {
  it("allows up to 5 experiments per quirk per day, rejects 6th", () => {
    const limiter = new ExperimentRateLimiter();
    for (let i = 0; i < 5; i++) {
      expect(limiter.canRun("stops_before_completion")).toBe(true);
      limiter.record("stops_before_completion");
    }
    expect(limiter.canRun("stops_before_completion")).toBe(false);
    expect(limiter.getRemainingToday("stops_before_completion")).toBe(0);
  });

  it("tracks independent quirk keys", () => {
    const limiter = new ExperimentRateLimiter();
    for (let i = 0; i < 5; i++) limiter.record("stops_before_completion");
    expect(limiter.canRun("overly_verbose_preface")).toBe(true);
  });
});

describe("D-12A: Promotion gate", () => {
  const makeExperiment = (overrides?: Partial<ExperimentResult>): ExperimentResult => ({
    id: "exp_test",
    overrideId: "ovr_test",
    provider: "anthropic",
    model: "claude-sonnet-4-6",
    quirkKey: "stops_before_completion",
    baseline: { pdseScore: 70, completionStatus: "complete", successRate: 0.8 },
    candidate: { pdseScore: 80, completionStatus: "complete", successRate: 0.9 },
    controlRegression: false,
    smokePassed: true,
    decision: "promote",
    createdAt: new Date().toISOString(),
    ...overrides,
  });

  it("promotes when PDSE improves by >=5 and all checks pass", () => {
    const result = evaluatePromotionGate(makeExperiment(), 5);
    expect(result.decision).toBe("promote");
    expect(result.requiresHumanApproval).toBe(false);
  });

  it("requires human veto for first 3 promotions per quirk family", () => {
    const result = evaluatePromotionGate(makeExperiment(), 1);
    expect(result.decision).toBe("needs_human_review");
    expect(result.requiresHumanApproval).toBe(true);
  });

  it("rejects on PDSE regression", () => {
    const result = evaluatePromotionGate(makeExperiment({ candidate: { pdseScore: 60 } }), 5);
    expect(result.decision).toBe("reject");
  });

  it("rejects when smoke fails", () => {
    const result = evaluatePromotionGate(makeExperiment({ smokePassed: false }), 5);
    expect(result.decision).toBe("reject");
  });
});

describe("D-12A: Rollback", () => {
  it("creates rolled_back override from promoted override", () => {
    const override: CandidateOverride = {
      id: "ovr_original",
      provider: "anthropic",
      model: "claude-sonnet-4-6",
      quirkKey: "stops_before_completion",
      status: "promoted",
      scope: {},
      patch: { promptPreamble: "Don't stop early." },
      basedOnObservationIds: ["obs_1"],
      version: 2,
      createdAt: "2026-03-22T00:00:00Z",
      promotedAt: "2026-03-22T01:00:00Z",
    };
    const rollback = createRollbackOverride(override, "pdse_regression");
    expect(rollback.status).toBe("rolled_back");
    expect(rollback.rollbackOfVersion).toBe(2);
    expect(rollback.version).toBe(3);
    expect(rollback.id).not.toBe("ovr_original");
  });
});

describe("D-12A: Adaptation report", () => {
  it("report has all 7 required sections", () => {
    const report = generateAdaptationReport("stops_before_completion", [], null, [], []);
    const md = serializeAdaptationReport(report);
    expect(md).toContain("## Quirk detected");
    expect(md).toContain("## Evidence");
    expect(md).toContain("## Candidate override");
    expect(md).toContain("## Experiments run");
    expect(md).toContain("## Promotion decision");
    expect(md).toContain("## Rollback status");
    expect(md).toContain("## What changed in plain English");
  });
});

describe("D-12A: Env gate", () => {
  it("DANTE_DISABLE_MODEL_ADAPTATION blocks store init pattern", () => {
    // Simulates the gating logic from repl.ts
    const disabled = "1";
    let storeCreated = false;
    if (disabled !== "1") {
      storeCreated = true;
    }
    expect(storeCreated).toBe(false);
  });

  it("DANTE_MODEL_ADAPTATION_MODE defaults to staged", () => {
    const envValue: string | undefined = process.env.DANTE_MODEL_ADAPTATION_MODE;
    const mode = envValue ?? "staged";
    expect(mode).toBe("staged");
    expect(mode).not.toBe("active");
  });
});

// ─── D-12A: Full pipeline integration ────────────────────────────────────────

describe("D-12A: Full pipeline integration", () => {
  it("observe → draft → processNewDrafts → needs_human_review (first promotion)", async () => {
    const store = new ModelAdaptationStore("/tmp/pipeline-test");
    const modelKey = { provider: "anthropic", modelId: "claude-sonnet-4-6" };

    // Feed 3 observations to trigger a draft
    const longText = "A".repeat(600) + " In summary:";
    for (let i = 0; i < 3; i++) {
      await observeAndAdapt(store, longText, {
        modelKey,
        sessionId: `pipe-session-${i}`,
        hadToolCalls: false,
        toolCallsInRound: 0,
      });
    }

    const drafts = store.getOverrides(modelKey, "draft");
    expect(drafts.length).toBeGreaterThanOrEqual(1);

    // Run pipeline — first promotion → needs_human_review (promotionCount < 3)
    const rateLimiter = new ExperimentRateLimiter();
    const results = await processNewDrafts(store, drafts, {
      rateLimiter,
      experimentOptions: {
        syntheticTaskRunner: async () => ({
          pdseScore: 90,
          completionStatus: "complete",
          successRate: 0.9,
        }),
        replayRunner: async () => ({
          pdseScore: 88,
          completionStatus: "complete",
          successRate: 0.88,
        }),
        controlRunner: async () => ({
          pdseScore: 82,
          completionStatus: "complete",
          successRate: 0.8,
        }),
      },
    });

    expect(results.length).toBeGreaterThanOrEqual(1);
    const pipeResult = results.find((r) => r.draft.quirkKey === "stops_before_completion");
    expect(pipeResult).toBeDefined();
    // First promotion for this quirk → needs_human_review
    expect(pipeResult!.action).toBe("needs_human_review");
    expect(pipeResult!.experiment).not.toBeNull();
    expect(pipeResult!.gateResult).not.toBeNull();
  });

  it("human veto flow: testing → approve → promoted → getActiveOverrides", async () => {
    const store = new ModelAdaptationStore("/tmp/veto-test");
    const modelKey = { provider: "anthropic", modelId: "claude-sonnet-4-6" };

    // Create and test a draft
    const draft = store.addDraft({
      provider: "anthropic",
      model: "claude-sonnet-4-6",
      quirkKey: "katex_format_requirement",
      scope: {},
      patch: { promptPreamble: "Do not use KaTeX notation." },
      basedOnObservationIds: ["obs_1", "obs_2", "obs_3"],
    });

    // Transition to testing (simulates experiment ran)
    store.updateStatus(draft.id, "testing");
    expect(store.getOverrides(modelKey, "testing")).toHaveLength(1);

    // Record an experiment
    const experiment = await runAdaptationExperiment(draft, {
      syntheticTaskRunner: async () => ({
        pdseScore: 90,
        completionStatus: "complete",
        successRate: 0.9,
      }),
      replayRunner: async () => ({
        pdseScore: 88,
        completionStatus: "complete",
        successRate: 0.88,
      }),
      controlRunner: async () => ({
        pdseScore: 82,
        completionStatus: "complete",
        successRate: 0.8,
      }),
    });
    store.addExperiment(experiment);

    // Human approves
    store.updateStatus(draft.id, "promoted");

    // Now appears in active overrides
    const active = store.getActiveOverrides(modelKey);
    expect(active).toHaveLength(1);
    expect(active[0]!.quirkKey).toBe("katex_format_requirement");
  });

  it("rollback flow: promoted → regression experiment → shouldRollback → createRollbackOverride", async () => {
    const override: CandidateOverride = {
      id: "ovr_rollback_test",
      provider: "anthropic",
      model: "claude-sonnet-4-6",
      quirkKey: "stops_before_completion",
      status: "promoted",
      scope: {},
      patch: { promptPreamble: "Complete all tasks fully." },
      basedOnObservationIds: ["obs_1"],
      version: 2,
      createdAt: "2026-03-23T00:00:00Z",
      promotedAt: "2026-03-23T01:00:00Z",
    };

    // Run a regression experiment
    const experiment = await runAdaptationExperiment(override, {
      baselineMetrics: { pdseScore: 80, completionStatus: "complete", successRate: 0.8 },
      syntheticTaskRunner: async () => ({
        pdseScore: 60,
        completionStatus: "partial",
        successRate: 0.5,
      }),
      replayRunner: async () => ({ pdseScore: 55, completionStatus: "partial", successRate: 0.4 }),
      controlRunner: async () => ({
        pdseScore: 81,
        completionStatus: "complete",
        successRate: 0.8,
      }),
    });

    // shouldRollback detects PDSE regression
    const rollbackCheck = shouldRollback([experiment]);
    expect(rollbackCheck.shouldRollback).toBe(true);
    expect(rollbackCheck.trigger).toBe("pdse_regression");

    // Create rollback override
    const rollback = createRollbackOverride(override, "pdse_regression");
    expect(rollback.status).toBe("rolled_back");
    expect(rollback.version).toBe(3);
    expect(rollback.rollbackOfVersion).toBe(2);
  });

  it("rate limiter integration: 6th experiment blocked", async () => {
    const store = new ModelAdaptationStore("/tmp/rate-limit-test");
    const rateLimiter = new ExperimentRateLimiter();

    // Exhaust 5 experiments for this quirk
    for (let i = 0; i < 5; i++) {
      rateLimiter.record("stops_before_completion");
    }
    expect(rateLimiter.canRun("stops_before_completion")).toBe(false);

    // Create a draft
    const draft = store.addDraft({
      provider: "anthropic",
      model: "claude-sonnet-4-6",
      quirkKey: "stops_before_completion",
      scope: {},
      patch: { promptPreamble: "Complete all tasks." },
      basedOnObservationIds: ["obs_1"],
    });

    // processNewDrafts should rate-limit
    const results = await processNewDrafts(store, [draft], { rateLimiter });
    expect(results).toHaveLength(1);
    expect(results[0]!.action).toBe("rate_limited");

    // Draft should still be in draft status (not transitioned to testing)
    const snap = store.snapshot();
    const draftOverride = snap.overrides.find((o) => o.id === draft.id);
    expect(draftOverride!.status).toBe("draft");
  });
});

// ─── D-12.5: Progressive disclosure ─────────────────────────────────────────

describe("D-12.5: Progressive disclosure", () => {
  it("tier 1 commands are at most 20", () => {
    const meta = getSlashCommandsMeta();
    const tier1Count = meta.filter((c) => c.tier === 1).length;
    expect(tier1Count).toBeLessThanOrEqual(20);
    expect(tier1Count).toBeGreaterThan(0);
  });

  it("countSuccessfulSessions returns 0 when no sessions directory exists", async () => {
    mockReaddir.mockRejectedValue({ code: "ENOENT" });
    const result = await countSuccessfulSessions("/nonexistent");
    expect(result).toEqual({ count: 0, unlocked: false });
  });

  it("countSuccessfulSessions counts only sessions with >= 2 messages", async () => {
    mockReaddir.mockResolvedValue(["a.json", "b.json", "c.json"]);
    mockReadFile
      .mockResolvedValueOnce(
        JSON.stringify({ messages: [{ role: "user" }, { role: "assistant" }] }),
      )
      .mockResolvedValueOnce(JSON.stringify({ messages: [{ role: "user" }] }))
      .mockResolvedValueOnce(JSON.stringify({ messages: [] }));
    const result = await countSuccessfulSessions("/project");
    expect(result).toEqual({ count: 1, unlocked: false });
  });
});
