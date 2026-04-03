import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("node:fs/promises", () => ({
  readFile: vi.fn(),
  writeFile: vi.fn(),
  mkdir: vi.fn(),
}));
import { readFile, writeFile, mkdir } from "node:fs/promises";
const mockReadFile = readFile as ReturnType<typeof vi.fn>;
const mockWriteFile = writeFile as ReturnType<typeof vi.fn>;
const mockMkdir = mkdir as ReturnType<typeof vi.fn>;

import { ModelAdaptationStore } from "./model-adaptation-store.js";
import { ExperimentRateLimiter } from "./model-adaptation-experiment.js";
import type {
  QuirkObservation,
  CandidateOverride,
  ExperimentResult,
  ModelAdaptationSnapshot,
} from "./model-adaptation-types.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const provider = "anthropic";
const model = "claude-opus-4";

function makeObsInput(
  overrides?: Partial<QuirkObservation>,
): Omit<QuirkObservation, "id" | "createdAt"> {
  return {
    quirkKey: overrides?.quirkKey ?? "stops_before_completion",
    provider: overrides?.provider ?? provider,
    model: overrides?.model ?? model,
    workflow: overrides?.workflow ?? "magic",
    promptTemplateVersion: overrides?.promptTemplateVersion ?? "v1",
    failureTags: overrides?.failureTags ?? ["stops_before_completion"],
    outputCharacteristics: overrides?.outputCharacteristics ?? [],
    evidenceRefs: overrides?.evidenceRefs ?? ["ref-1"],
  };
}

function makeDraftInput(
  overrides?: Partial<CandidateOverride>,
): Omit<CandidateOverride, "id" | "version" | "status" | "createdAt"> {
  return {
    provider: overrides?.provider ?? provider,
    model: overrides?.model ?? model,
    quirkKey: overrides?.quirkKey ?? "stops_before_completion",
    scope: overrides?.scope ?? {},
    patch: overrides?.patch ?? { promptPreamble: "Do not stop early" },
    basedOnObservationIds: overrides?.basedOnObservationIds ?? ["obs_abc"],
  };
}

function makeExperiment(overrides?: Partial<ExperimentResult>): ExperimentResult {
  return {
    id: overrides?.id ?? "exp_test1",
    overrideId: overrides?.overrideId ?? "ovr_abc",
    provider: overrides?.provider ?? provider,
    model: overrides?.model ?? model,
    quirkKey: overrides?.quirkKey ?? "stops_before_completion",
    baseline: overrides?.baseline ?? { pdseScore: 70, successRate: 0.8 },
    candidate: overrides?.candidate ?? { pdseScore: 85, successRate: 0.95 },
    controlRegression: overrides?.controlRegression ?? false,
    smokePassed: overrides?.smokePassed ?? true,
    decision: overrides?.decision ?? "promote",
    createdAt: overrides?.createdAt ?? new Date().toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("ModelAdaptationStore", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockMkdir.mockResolvedValue(undefined);
    mockWriteFile.mockResolvedValue(undefined);
    mockReadFile.mockRejectedValue(new Error("ENOENT"));
  });

  // -----------------------------------------------------------------------
  // Basic construction + snapshot
  // -----------------------------------------------------------------------

  it("constructor creates valid store", () => {
    const store = new ModelAdaptationStore("/project");
    expect(store).toBeDefined();
    const snap = store.snapshot();
    expect(snap.observations).toHaveLength(0);
    expect(snap.overrides).toHaveLength(0);
    expect(snap.experiments).toHaveLength(0);
    expect(snap.version).toBe(2);
  });

  // -----------------------------------------------------------------------
  // Observations
  // -----------------------------------------------------------------------

  it("addObservation stores observation with generated id and timestamp", () => {
    const store = new ModelAdaptationStore("/project");
    const obs = store.addObservation(makeObsInput());
    expect(obs.id).toMatch(/^obs_/);
    expect(obs.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(store.snapshot().observations).toHaveLength(1);
  });

  it("countObservations filters by quirkKey, provider, and model", () => {
    const store = new ModelAdaptationStore("/project");
    store.addObservation(
      makeObsInput({
        quirkKey: "stops_before_completion",
        failureTags: ["stops_before_completion"],
      }),
    );
    store.addObservation(
      makeObsInput({ quirkKey: "markdown_wrapper_issue", failureTags: ["markdown_wrapper_issue"] }),
    );
    expect(store.countObservations("stops_before_completion", provider, model)).toBe(1);
    expect(store.countObservations("markdown_wrapper_issue", provider, model)).toBe(1);
  });

  it("countObservations returns 0 for non-matching provider/model", () => {
    const store = new ModelAdaptationStore("/project");
    store.addObservation(makeObsInput());
    expect(store.countObservations("stops_before_completion", "openai", "gpt-4o")).toBe(0);
  });

  it("LRU eviction when observations exceed 200", () => {
    const store = new ModelAdaptationStore("/project");
    for (let i = 0; i < 205; i++) {
      store.addObservation(
        makeObsInput({
          failureTags: [`tag-${i}`],
          evidenceRefs: [`ref-${i}`],
        }),
      );
    }
    const snap = store.snapshot();
    expect(snap.observations).toHaveLength(200);
    // Oldest 5 should be evicted
    expect(snap.observations[0]!.failureTags[0]).toBe("tag-5");
    expect(snap.observations[199]!.failureTags[0]).toBe("tag-204");
  });

  // -----------------------------------------------------------------------
  // Overrides
  // -----------------------------------------------------------------------

  it("addDraft creates override with draft status and version 1", () => {
    const store = new ModelAdaptationStore("/project");
    const o = store.addDraft(makeDraftInput({ quirkKey: "tool_call_format_error" }));
    expect(o.status).toBe("draft");
    expect(o.version).toBe(1);
    expect(o.id).toMatch(/^ovr_/);
    expect(o.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(o.patch).toEqual({ promptPreamble: "Do not stop early" });
  });

  it("updateStatus transitions draft to testing", () => {
    const store = new ModelAdaptationStore("/project");
    const o = store.addDraft(makeDraftInput());
    expect(store.updateStatus(o.id, "testing")).toBe(true);
    expect(store.getOverrides(provider, model).find((x) => x.id === o.id)?.status).toBe("testing");
  });

  it("updateStatus transitions testing to promoted with timestamp", () => {
    const store = new ModelAdaptationStore("/project");
    const o = store.addDraft(makeDraftInput());
    store.updateStatus(o.id, "testing");
    expect(store.updateStatus(o.id, "promoted")).toBe(true);
    const found = store.getOverrides(provider, model).find((x) => x.id === o.id);
    expect(found?.status).toBe("promoted");
    expect(found?.promotedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("updateStatus returns false for non-existent id", () => {
    const store = new ModelAdaptationStore("/project");
    expect(store.updateStatus("nonexistent", "testing")).toBe(false);
  });

  it("getActiveOverrides returns only promoted", () => {
    const store = new ModelAdaptationStore("/project");
    const d = store.addDraft(makeDraftInput());
    store.addDraft(makeDraftInput({ quirkKey: "markdown_wrapper_issue" }));
    store.updateStatus(d.id, "promoted");
    const active = store.getActiveOverrides(provider, model);
    expect(active).toHaveLength(1);
    expect(active[0]!.status).toBe("promoted");
  });

  it("getOverrides filters by status", () => {
    const store = new ModelAdaptationStore("/project");
    store.addDraft(makeDraftInput());
    store.addDraft(makeDraftInput({ quirkKey: "markdown_wrapper_issue" }));
    expect(store.getOverrides(provider, model, "draft")).toHaveLength(2);
    expect(store.getOverrides(provider, model, "promoted")).toHaveLength(0);
  });

  // -----------------------------------------------------------------------
  // Persistence — load/save
  // -----------------------------------------------------------------------

  it("load/save roundtrip with v2 snapshot", async () => {
    const store = new ModelAdaptationStore("/project");
    store.addObservation(makeObsInput());
    store.addDraft(makeDraftInput());
    store.addExperiment(makeExperiment());
    await store.save();
    expect(mockWriteFile).toHaveBeenCalledTimes(1);
    const written = JSON.parse(
      mockWriteFile.mock.calls[0]![1] as string,
    ) as ModelAdaptationSnapshot;
    expect(written.observations).toHaveLength(1);
    expect(written.overrides).toHaveLength(1);
    expect(written.experiments).toHaveLength(1);
    expect(written.version).toBe(2);
    // Load into a fresh store
    mockReadFile.mockResolvedValue(JSON.stringify(written));
    const store2 = new ModelAdaptationStore("/project");
    await store2.load();
    const snap = store2.snapshot();
    expect(snap.observations).toHaveLength(1);
    expect(snap.overrides).toHaveLength(1);
    expect(snap.experiments).toHaveLength(1);
  });

  it("load idempotent — second call is no-op", async () => {
    const v2: ModelAdaptationSnapshot = {
      version: 2,
      observations: [],
      overrides: [],
      experiments: [],
    };
    mockReadFile.mockResolvedValue(JSON.stringify(v2));
    const store = new ModelAdaptationStore("/project");
    await store.load();
    await store.load();
    await store.load();
    expect(mockReadFile).toHaveBeenCalledTimes(1);
  });

  it("snapshot returns consistent copy — mutations do not leak", () => {
    const store = new ModelAdaptationStore("/project");
    store.addObservation(makeObsInput());
    store.addDraft(makeDraftInput());
    const snap = store.snapshot();
    expect(snap.version).toBe(2);
    expect(snap.observations).toHaveLength(1);
    expect(snap.overrides).toHaveLength(1);
    // Mutation on snapshot must not affect store
    snap.observations.push(snap.observations[0]!);
    expect(store.snapshot().observations).toHaveLength(1);
  });

  // -----------------------------------------------------------------------
  // V1 migration
  // -----------------------------------------------------------------------

  it("load migrates v1 observations to v2 shape", async () => {
    const v1 = {
      version: 1,
      observations: [
        {
          quirkClass: "premature-summary",
          description: "stopped early",
          evidence: "anthropic claude-opus-4 run-1",
          observedAt: "2026-03-20T00:00:00.000Z",
          sessionId: "s1",
        },
      ],
      overrides: [],
    };
    mockReadFile.mockResolvedValue(JSON.stringify(v1));
    const store = new ModelAdaptationStore("/project");
    await store.load();
    const snap = store.snapshot();
    expect(snap.version).toBe(2);
    expect(snap.observations).toHaveLength(1);
    const obs = snap.observations[0]!;
    expect(obs.id).toMatch(/^obs_/);
    expect(obs.workflow).toBe("other");
    expect(obs.failureTags).toContain("premature-summary");
    expect(obs.createdAt).toBe("2026-03-20T00:00:00.000Z");
  });

  it("load migrates v1 overrides to v2 shape", async () => {
    const v1 = {
      version: 1,
      observations: [],
      overrides: [
        {
          id: "abc123",
          key: { provider: "anthropic", modelId: "claude-opus-4" },
          quirkClass: "tool-call-json-formatting",
          quirkSignature: "json-fix",
          overrideType: "tool-call-repair",
          payload: "Fix JSON formatting",
          version: 1,
          evidenceCount: 3,
          status: "promoted",
          createdAt: "2026-03-20T00:00:00.000Z",
          updatedAt: "2026-03-20T01:00:00.000Z",
          promotionEvidence: { testsPass: true, smokePass: true, pdseScore: 90 },
        },
      ],
    };
    mockReadFile.mockResolvedValue(JSON.stringify(v1));
    const store = new ModelAdaptationStore("/project");
    await store.load();
    const snap = store.snapshot();
    expect(snap.overrides).toHaveLength(1);
    const ovr = snap.overrides[0]!;
    expect(ovr.id).toBe("abc123");
    expect(ovr.provider).toBe("anthropic");
    expect(ovr.model).toBe("claude-opus-4");
    expect(ovr.quirkKey).toBe("tool_call_format_error");
    expect(ovr.status).toBe("promoted");
    expect(ovr.patch.promptPreamble).toBe("Fix JSON formatting");
    expect(ovr.promotedAt).toBe("2026-03-20T01:00:00.000Z");
  });

  it("load migrates unversioned data as v1", async () => {
    const noVersion = { observations: [], overrides: [] };
    mockReadFile.mockResolvedValue(JSON.stringify(noVersion));
    const store = new ModelAdaptationStore("/project");
    await store.load();
    const snap = store.snapshot();
    expect(snap.version).toBe(2);
    expect(snap.experiments).toHaveLength(0);
  });

  // -----------------------------------------------------------------------
  // Experiments
  // -----------------------------------------------------------------------

  it("addExperiment stores and getExperiments returns all", () => {
    const store = new ModelAdaptationStore("/project");
    store.addExperiment(makeExperiment({ id: "exp_1" }));
    store.addExperiment(makeExperiment({ id: "exp_2", overrideId: "ovr_xyz" }));
    expect(store.getExperiments()).toHaveLength(2);
  });

  it("getExperiments filters by overrideId", () => {
    const store = new ModelAdaptationStore("/project");
    store.addExperiment(makeExperiment({ id: "exp_1", overrideId: "ovr_abc" }));
    store.addExperiment(makeExperiment({ id: "exp_2", overrideId: "ovr_xyz" }));
    store.addExperiment(makeExperiment({ id: "exp_3", overrideId: "ovr_abc" }));
    expect(store.getExperiments("ovr_abc")).toHaveLength(2);
    expect(store.getExperiments("ovr_xyz")).toHaveLength(1);
    expect(store.getExperiments("ovr_none")).toHaveLength(0);
  });

  it("getExperimentsByQuirk filters by quirkKey", () => {
    const store = new ModelAdaptationStore("/project");
    store.addExperiment(makeExperiment({ quirkKey: "stops_before_completion" }));
    store.addExperiment(makeExperiment({ quirkKey: "markdown_wrapper_issue" }));
    store.addExperiment(makeExperiment({ quirkKey: "stops_before_completion" }));
    expect(store.getExperimentsByQuirk("stops_before_completion")).toHaveLength(2);
    expect(store.getExperimentsByQuirk("markdown_wrapper_issue")).toHaveLength(1);
    expect(store.getExperimentsByQuirk("tool_call_format_error")).toHaveLength(0);
  });

  // -----------------------------------------------------------------------
  // Rollback
  // -----------------------------------------------------------------------

  it("rollbackOverride sets original to rolled_back and creates new draft", () => {
    const store = new ModelAdaptationStore("/project");
    const o = store.addDraft(makeDraftInput());
    store.updateStatus(o.id, "promoted");
    const rollback = store.rollbackOverride(o.id);
    expect(rollback).not.toBeNull();
    // Original is now rolled_back
    const original = store.getOverrides(provider, model).find((x) => x.id === o.id);
    expect(original?.status).toBe("rolled_back");
    // New override is a draft with rollbackOfVersion
    expect(rollback!.status).toBe("draft");
    expect(rollback!.version).toBe(2);
    expect(rollback!.rollbackOfVersion).toBe(1);
    expect(rollback!.quirkKey).toBe(o.quirkKey);
  });

  it("rollbackOverride returns null for non-existent id", () => {
    const store = new ModelAdaptationStore("/project");
    expect(store.rollbackOverride("nonexistent")).toBeNull();
  });

  // -----------------------------------------------------------------------
  // Promotion count
  // -----------------------------------------------------------------------

  it("getPromotionCount counts only promoted overrides for a quirkKey", () => {
    const store = new ModelAdaptationStore("/project");
    const a = store.addDraft(makeDraftInput({ quirkKey: "stops_before_completion" }));
    const b = store.addDraft(makeDraftInput({ quirkKey: "stops_before_completion" }));
    const c = store.addDraft(makeDraftInput({ quirkKey: "markdown_wrapper_issue" }));
    store.updateStatus(a.id, "promoted");
    store.updateStatus(b.id, "promoted");
    store.updateStatus(c.id, "promoted");
    expect(store.getPromotionCount("stops_before_completion")).toBe(2);
    expect(store.getPromotionCount("markdown_wrapper_issue")).toBe(1);
    expect(store.getPromotionCount("tool_call_format_error")).toBe(0);
  });

  it("getPromotionCount excludes rolled_back overrides", () => {
    const store = new ModelAdaptationStore("/project");
    const o = store.addDraft(makeDraftInput({ quirkKey: "stops_before_completion" }));
    store.updateStatus(o.id, "promoted");
    expect(store.getPromotionCount("stops_before_completion")).toBe(1);
    store.rollbackOverride(o.id);
    // Original is rolled_back, new one is draft — neither counts as promoted
    expect(store.getPromotionCount("stops_before_completion")).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Write mutex and rate limiter persistence (D-12A Gaps 3 + 4)
// ---------------------------------------------------------------------------

describe("Write mutex and rate limiter persistence", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockMkdir.mockResolvedValue(undefined);
    mockWriteFile.mockResolvedValue(undefined);
    mockReadFile.mockRejectedValue(new Error("ENOENT"));
  });

  it("save with rateLimiter persists rateLimiterState in snapshot", async () => {
    const store = new ModelAdaptationStore("/tmp/test-mutex");
    const limiter = new ExperimentRateLimiter();
    limiter.record("stops_before_completion");
    limiter.record("stops_before_completion");

    await store.save(limiter);

    // Verify writeFile was called with rateLimiterState
    const writeCall = (writeFile as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(writeCall).toBeDefined();
    const written = JSON.parse(writeCall![1] as string);
    expect(written.rateLimiterState).toBeDefined();
    expect(written.rateLimiterState["stops_before_completion"].count).toBe(2);
  });

  it("save without rateLimiter does not include rateLimiterState", async () => {
    const store = new ModelAdaptationStore("/tmp/test-mutex");
    await store.save();

    const writeCall = (writeFile as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(writeCall).toBeDefined();
    const written = JSON.parse(writeCall![1] as string);
    expect(written.rateLimiterState).toBeUndefined();
  });

  it("loadRateLimiterState returns null when no state present", async () => {
    (readFile as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      JSON.stringify({
        version: 2,
        observations: [],
        overrides: [],
        experiments: [],
      }),
    );
    const store = new ModelAdaptationStore("/tmp/test-mutex");
    await store.load();
    expect(store.loadRateLimiterState()).toBeNull();
  });

  it("loadRateLimiterState restores persisted rate limiter", async () => {
    (readFile as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      JSON.stringify({
        version: 2,
        observations: [],
        overrides: [],
        experiments: [],
        rateLimiterState: {
          stops_before_completion: { date: new Date().toISOString().slice(0, 10), count: 3 },
        },
      }),
    );
    const store = new ModelAdaptationStore("/tmp/test-mutex");
    await store.load();
    const restored = store.loadRateLimiterState();
    expect(restored).not.toBeNull();
    expect(restored!.getRemainingToday("stops_before_completion")).toBe(2);
  });

  it("concurrent save calls serialize through write mutex", async () => {
    const store = new ModelAdaptationStore("/tmp/test-mutex");
    let writeCount = 0;
    (writeFile as ReturnType<typeof vi.fn>).mockImplementation(async () => {
      writeCount++;
      await new Promise((resolve) => setTimeout(resolve, 10));
    });

    // Launch 3 concurrent saves
    const p1 = store.save();
    const p2 = store.save();
    const p3 = store.save();
    await Promise.all([p1, p2, p3]);

    // All 3 should complete (write mutex serializes them)
    expect(writeCount).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// Error logging (D-12A Phase 3 — Issue 4)
// ---------------------------------------------------------------------------

describe("Store error logging", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockMkdir.mockResolvedValue(undefined);
    mockWriteFile.mockResolvedValue(undefined);
    mockReadFile.mockRejectedValue(new Error("ENOENT"));
  });

  it("error logger receives save failures", async () => {
    const errors: Array<Error | string> = [];
    const store = new ModelAdaptationStore("/tmp/test-errlog", (err) => {
      errors.push(err);
    });
    mockWriteFile.mockRejectedValue(new Error("EPERM"));

    await store.save();

    expect(errors.length).toBeGreaterThanOrEqual(1);
    const hasEperm = errors.some((e) =>
      typeof e === "string" ? e.includes("EPERM") : e.message.includes("EPERM"),
    );
    expect(hasEperm).toBe(true);
  });

  it("load with corrupted JSON initializes empty store", async () => {
    mockReadFile.mockResolvedValue("not valid json at all {{{");
    const store = new ModelAdaptationStore("/project");
    await store.load();
    const snap = store.snapshot();
    expect(snap.version).toBe(2);
    expect(snap.observations).toHaveLength(0);
    expect(snap.overrides).toHaveLength(0);
    expect(snap.experiments).toHaveLength(0);
  });

  it("reload() picks up changes written to disk between calls", async () => {
    // First load — empty
    mockReadFile.mockRejectedValue({ code: "ENOENT" });
    const store = new ModelAdaptationStore("/project");
    await store.load();
    expect(store.snapshot().observations).toHaveLength(0);

    // Simulate external change (CLI approve/reject wrote new data to disk)
    const externalData = JSON.stringify({
      version: 2,
      observations: [
        {
          id: "obs_external",
          quirkKey: "stops_before_completion",
          provider: "anthropic",
          model: "claude-sonnet-4-6",
          workflow: "magic",
          promptTemplateVersion: "1.0",
          failureTags: [],
          outputCharacteristics: [],
          evidenceRefs: [],
          createdAt: "2026-03-24T00:00:00Z",
        },
      ],
      overrides: [],
      experiments: [],
    });
    mockReadFile.mockResolvedValue(externalData);

    // Regular load() is idempotent — won't pick up changes
    await store.load();
    expect(store.snapshot().observations).toHaveLength(0);

    // reload() resets and reloads
    await store.reload();
    expect(store.snapshot().observations).toHaveLength(1);
    expect(store.snapshot().observations[0]!.id).toBe("obs_external");
  });
});
