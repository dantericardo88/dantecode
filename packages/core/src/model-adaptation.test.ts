// ============================================================================
// Model Adaptation Quirk Detector — Tests (D-12A expanded taxonomy)
// ============================================================================

import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  detectQuirks,
  generateOverride,
  applyOverrides,
  observeAndAdapt,
  promoteOverride,
} from "./model-adaptation.js";
import { ModelAdaptationStore } from "./model-adaptation-store.js";
import type { ModelAdaptationKey } from "./model-adaptation-store.js";
import type { QuirkKey, CandidateOverride, AdaptationEvent, AdaptationLogger } from "./model-adaptation-types.js";

// ---------------------------------------------------------------------------
// FS mock — ModelAdaptationStore uses node:fs/promises internally
// ---------------------------------------------------------------------------

vi.mock("node:fs/promises", () => ({
  readFile: vi.fn().mockRejectedValue(new Error("ENOENT")),
  writeFile: vi.fn().mockResolvedValue(undefined),
  mkdir: vi.fn().mockResolvedValue(undefined),
}));

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const TEST_KEY: ModelAdaptationKey = {
  provider: "anthropic",
  modelId: "claude-opus-4-6",
};

const BASE_CONTEXT = {
  modelKey: TEST_KEY,
  sessionId: "test-session-001",
} as const;

function makeStore(): ModelAdaptationStore {
  return new ModelAdaptationStore("/tmp/test-project");
}

// ---------------------------------------------------------------------------
// detectQuirks — 10 quirk classes
// ---------------------------------------------------------------------------

describe("detectQuirks", () => {
  it("detects stops_before_completion from premature summary", () => {
    const response = "A".repeat(501) + "\nIn summary:";
    const results = detectQuirks(response, BASE_CONTEXT);
    const found = results.find((r) => r.quirkKey === "stops_before_completion");
    expect(found).toBeDefined();
    expect(found!.failureTags).toContain("premature-summary");
  });

  it("detects stops_before_completion from stopping after tool acknowledgement", () => {
    const response = "I ran the search command and found 3 files.";
    const results = detectQuirks(response, { ...BASE_CONTEXT, hadToolCalls: true });
    const found = results.find(
      (r) => r.quirkKey === "stops_before_completion" && r.failureTags.includes("stops-after-tool"),
    );
    expect(found).toBeDefined();
  });

  it("does NOT detect stops-after-tool when hadToolCalls is false", () => {
    const response = "I ran the search command and found 3 files.";
    const results = detectQuirks(response, { ...BASE_CONTEXT, hadToolCalls: false });
    const found = results.find(
      (r) => r.failureTags.includes("stops-after-tool"),
    );
    expect(found).toBeUndefined();
  });

  it("does NOT detect stops-after-tool when response continues after acknowledgement", () => {
    const response = "I ran the search command and found 3 files. " + "Here is a detailed analysis of each file: ".repeat(10);
    const results = detectQuirks(response, { ...BASE_CONTEXT, hadToolCalls: true });
    const found = results.find(
      (r) => r.failureTags.includes("stops-after-tool"),
    );
    expect(found).toBeUndefined();
  });

  it("detects skips_synthesis when planning without tool calls", () => {
    const response = "Here is the plan:\n1. First we create a file\n2. Then we edit it";
    const ctx = { ...BASE_CONTEXT, promptType: "implementation" as const, hadToolCalls: false };
    const results = detectQuirks(response, ctx);
    const found = results.find((r) => r.quirkKey === "skips_synthesis");
    expect(found).toBeDefined();
    expect(found!.failureTags).toContain("planning-without-execution");
  });

  it("detects overly_verbose_preface for >1000 words", () => {
    const words = Array.from({ length: 1001 }, (_, i) => `word${i}`);
    const response = words.join(" ");
    const ctx = { ...BASE_CONTEXT, promptType: "implementation" as const };
    const results = detectQuirks(response, ctx);
    const found = results.find((r) => r.quirkKey === "overly_verbose_preface");
    expect(found).toBeDefined();
  });

  it("detects tool_call_format_error for malformed JSON", () => {
    const response = 'Call this tool: {"name": "bash", "args": unquoted_value}';
    const results = detectQuirks(response, BASE_CONTEXT);
    const found = results.find((r) => r.quirkKey === "tool_call_format_error");
    expect(found).toBeDefined();
  });

  it("does NOT detect tool_call_format_error for valid JSON", () => {
    const response = 'Here is the config: {"name": "bash", "args": "echo hello"}';
    const results = detectQuirks(response, BASE_CONTEXT);
    const found = results.find((r) => r.quirkKey === "tool_call_format_error");
    expect(found).toBeUndefined();
  });

  it("detects markdown_wrapper_issue in tool-call context", () => {
    const response = "## Heading\nSome tool call content";
    const ctx = { ...BASE_CONTEXT, promptType: "tool-call" as const };
    const results = detectQuirks(response, ctx);
    const found = results.find((r) => r.quirkKey === "markdown_wrapper_issue");
    expect(found).toBeDefined();
  });

  it("detects ignores_prd_section_order for long response with stage refs but no numbers", () => {
    const response = "X".repeat(801) + "\nWe should handle stage 1 carefully and move to step 2 after that.";
    const ctx = { ...BASE_CONTEXT, promptType: "implementation" as const };
    const results = detectQuirks(response, ctx);
    const found = results.find((r) => r.quirkKey === "ignores_prd_section_order");
    expect(found).toBeDefined();
  });

  it("does NOT detect ignores_prd_section_order for short responses", () => {
    const response = "We should handle stage 1 carefully.";
    const ctx = { ...BASE_CONTEXT, promptType: "implementation" as const };
    const results = detectQuirks(response, ctx);
    const found = results.find((r) => r.quirkKey === "ignores_prd_section_order");
    expect(found).toBeUndefined();
  });

  it("detects schema_argument_mismatch", () => {
    const response = "Error: unknown parameter 'fileName' was provided to the tool.";
    const results = detectQuirks(response, BASE_CONTEXT);
    const found = results.find((r) => r.quirkKey === "schema_argument_mismatch");
    expect(found).toBeDefined();
  });

  it("detects katex_format_requirement", () => {
    const response = "The formula is: $$E = mc^2$$";
    const ctx = { ...BASE_CONTEXT, promptType: "implementation" as const };
    const results = detectQuirks(response, ctx);
    const found = results.find((r) => r.quirkKey === "katex_format_requirement");
    expect(found).toBeDefined();
  });

  it("does NOT detect katex in planning context", () => {
    const response = "$$E = mc^2$$";
    const ctx = { ...BASE_CONTEXT, promptType: "planning" as const };
    const results = detectQuirks(response, ctx);
    const found = results.find((r) => r.quirkKey === "katex_format_requirement");
    expect(found).toBeUndefined();
  });

  it("detects regeneration_trigger_pattern with multiple retries", () => {
    const response = "The build failed. Let me try again with different settings. Attempting again with a new approach.";
    const results = detectQuirks(response, BASE_CONTEXT);
    const found = results.find((r) => r.quirkKey === "regeneration_trigger_pattern");
    expect(found).toBeDefined();
  });

  it("does NOT detect regeneration_trigger_pattern for single mention", () => {
    const response = "Let me try again.";
    const results = detectQuirks(response, BASE_CONTEXT);
    const found = results.find((r) => r.quirkKey === "regeneration_trigger_pattern");
    expect(found).toBeUndefined();
  });

  it("detects provider_specific_dispatch_shape for XML tool format", () => {
    const response = "Calling tool now:\n<function_call>bash</function_call>";
    const ctx = { ...BASE_CONTEXT, promptType: "tool-call" as const };
    const results = detectQuirks(response, ctx);
    const found = results.find((r) => r.quirkKey === "provider_specific_dispatch_shape");
    expect(found).toBeDefined();
  });

  it("detects multiple quirks from a single response", () => {
    const body =
      "Here is the approach:\n" +
      "word ".repeat(1001) +
      "\nWe need to complete stage 1 and stage 2 properly.\nTo summarize:";
    const ctx = { ...BASE_CONTEXT, promptType: "implementation" as const, hadToolCalls: false };
    const results = detectQuirks(body, ctx);
    const keys = results.map((r) => r.quirkKey);
    expect(keys).toContain("stops_before_completion");
    expect(keys).toContain("skips_synthesis");
    expect(keys).toContain("overly_verbose_preface");
    expect(keys).toContain("ignores_prd_section_order");
    expect(results.length).toBeGreaterThanOrEqual(4);
  });

  it("returns empty array for clean response", () => {
    const response = "Here is a short, clean response with no quirks.";
    const ctx = { ...BASE_CONTEXT, promptType: "planning" as const, hadToolCalls: true };
    const results = detectQuirks(response, ctx);
    expect(results).toEqual([]);
  });

  it("observations include provider, model, and workflow", () => {
    const response = "A".repeat(501) + "\nTo recap:";
    const ctx = { ...BASE_CONTEXT, workflow: "magic" as const };
    const results = detectQuirks(response, ctx);
    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(results[0]!.provider).toBe("anthropic");
    expect(results[0]!.model).toBe("claude-opus-4-6");
    expect(results[0]!.workflow).toBe("magic");
  });

  it("does NOT detect premature-summary for short responses", () => {
    const response = "Short response. In summary:";
    expect(response.length).toBeLessThan(500);
    const results = detectQuirks(response, BASE_CONTEXT);
    const found = results.find((r) => r.quirkKey === "stops_before_completion" && r.failureTags.includes("premature-summary"));
    expect(found).toBeUndefined();
  });

  it("returns empty array for empty string input", () => {
    const results = detectQuirks("", BASE_CONTEXT);
    expect(results).toEqual([]);
  });

  it("boundary: 999 words does NOT trigger overly_verbose_preface", () => {
    const words = Array.from({ length: 999 }, (_, i) => `word${i}`);
    const response = words.join(" ");
    const ctx = { ...BASE_CONTEXT, promptType: "implementation" as const };
    const results = detectQuirks(response, ctx);
    const found = results.find((r) => r.quirkKey === "overly_verbose_preface");
    expect(found).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// generateOverride
// ---------------------------------------------------------------------------

describe("generateOverride", () => {
  it("produces correct override for stops_before_completion", () => {
    const result = generateOverride("stops_before_completion", TEST_KEY, 5);
    expect(result.quirkKey).toBe("stops_before_completion");
    expect(result.provider).toBe("anthropic");
    expect(result.model).toBe("claude-opus-4-6");
    expect(result.patch.promptPreamble).toContain("summarize");
  });

  it("produces valid override for each quirk key", () => {
    const allKeys: QuirkKey[] = [
      "tool_call_format_error",
      "schema_argument_mismatch",
      "markdown_wrapper_issue",
      "katex_format_requirement",
      "stops_before_completion",
      "skips_synthesis",
      "ignores_prd_section_order",
      "overly_verbose_preface",
      "regeneration_trigger_pattern",
      "provider_specific_dispatch_shape",
    ];

    for (const qk of allKeys) {
      const result = generateOverride(qk, TEST_KEY, 3);
      expect(result.quirkKey).toBe(qk);
      expect(result.patch).toBeDefined();
      // At least one patch field should be non-empty
      const hasPatch = !!(
        result.patch.promptPreamble ||
        (result.patch.orderingHints && result.patch.orderingHints.length > 0) ||
        (result.patch.toolFormattingHints && result.patch.toolFormattingHints.length > 0) ||
        (result.patch.synthesisRequirements && result.patch.synthesisRequirements.length > 0)
      );
      expect(hasPatch).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// applyOverrides
// ---------------------------------------------------------------------------

describe("applyOverrides", () => {
  const basePrompt = "You are a helpful assistant.";

  it("appends promptPreamble to system prompt", () => {
    const overrides: CandidateOverride[] = [
      {
        id: "abc123",
        provider: "anthropic",
        model: "claude-opus-4-6",
        quirkKey: "stops_before_completion",
        status: "promoted",
        scope: {},
        patch: { promptPreamble: "Do not summarize early." },
        basedOnObservationIds: [],
        version: 1,
        createdAt: "2026-03-23T00:00:00.000Z",
      },
    ];

    const result = applyOverrides(basePrompt, overrides);
    expect(result).toContain(basePrompt);
    expect(result).toContain("## Model Adaptation Overrides");
    expect(result).toContain("Do not summarize early.");
  });

  it("returns unchanged prompt for empty overrides", () => {
    const result = applyOverrides(basePrompt, []);
    expect(result).toBe(basePrompt);
  });

  it("includes toolFormattingHints in output", () => {
    const overrides: CandidateOverride[] = [
      {
        id: "abc123",
        provider: "anthropic",
        model: "claude-opus-4-6",
        quirkKey: "tool_call_format_error",
        status: "promoted",
        scope: {},
        patch: { toolFormattingHints: ["Quote all JSON values."] },
        basedOnObservationIds: [],
        version: 1,
        createdAt: "2026-03-23T00:00:00.000Z",
      },
    ];

    const result = applyOverrides(basePrompt, overrides);
    expect(result).toContain("Quote all JSON values.");
  });

  it("concatenates multiple overrides", () => {
    const overrides: CandidateOverride[] = [
      {
        id: "a1",
        provider: "anthropic",
        model: "claude-opus-4-6",
        quirkKey: "stops_before_completion",
        status: "promoted",
        scope: {},
        patch: { promptPreamble: "First instruction." },
        basedOnObservationIds: [],
        version: 1,
        createdAt: "2026-03-23T00:00:00.000Z",
      },
      {
        id: "a2",
        provider: "anthropic",
        model: "claude-opus-4-6",
        quirkKey: "overly_verbose_preface",
        status: "promoted",
        scope: {},
        patch: { promptPreamble: "Second instruction." },
        basedOnObservationIds: [],
        version: 1,
        createdAt: "2026-03-23T00:00:00.000Z",
      },
    ];

    const result = applyOverrides(basePrompt, overrides);
    expect(result).toContain("First instruction.");
    expect(result).toContain("Second instruction.");
  });

  it("returns unchanged prompt when overrides have no content", () => {
    const overrides: CandidateOverride[] = [
      {
        id: "abc",
        provider: "anthropic",
        model: "claude-opus-4-6",
        quirkKey: "stops_before_completion",
        status: "promoted",
        scope: {},
        patch: {},
        basedOnObservationIds: [],
        version: 1,
        createdAt: "2026-03-23T00:00:00.000Z",
      },
    ];

    const result = applyOverrides(basePrompt, overrides);
    expect(result).toBe(basePrompt);
  });
});

// ---------------------------------------------------------------------------
// observeAndAdapt
// ---------------------------------------------------------------------------

describe("observeAndAdapt", () => {
  let store: ModelAdaptationStore;

  beforeEach(() => {
    store = makeStore();
  });

  it("stores observations and creates drafts at threshold (3)", async () => {
    const longResponseWithSummary = "A".repeat(501) + "\nIn summary:";

    for (let i = 0; i < 3; i++) {
      await observeAndAdapt(store, longResponseWithSummary, {
        ...BASE_CONTEXT,
        sessionId: `session-${i}`,
      });
    }

    const overrides = store.getOverrides(TEST_KEY);
    const draft = overrides.find((o) => o.quirkKey === "stops_before_completion");
    expect(draft).toBeDefined();
    expect(draft!.status).toBe("draft");
  });

  it("does NOT create duplicate draft for same quirk+key", async () => {
    const longResponseWithSummary = "A".repeat(501) + "\nIn summary:";

    for (let i = 0; i < 5; i++) {
      await observeAndAdapt(store, longResponseWithSummary, {
        ...BASE_CONTEXT,
        sessionId: `session-${i}`,
      });
    }

    const overrides = store.getOverrides(TEST_KEY);
    const drafts = overrides.filter((o) => o.quirkKey === "stops_before_completion");
    expect(drafts).toHaveLength(1);
  });

  it("returns newly created drafts", async () => {
    const longResponseWithSummary = "A".repeat(501) + "\nIn summary:";

    for (let i = 0; i < 2; i++) {
      const drafts = await observeAndAdapt(store, longResponseWithSummary, {
        ...BASE_CONTEXT,
        sessionId: `session-${i}`,
      });
      expect(drafts).toHaveLength(0);
    }

    const drafts = await observeAndAdapt(store, longResponseWithSummary, {
      ...BASE_CONTEXT,
      sessionId: "session-2",
    });
    expect(drafts.length).toBeGreaterThanOrEqual(1);
    expect(drafts[0]!.quirkKey).toBe("stops_before_completion");
  });

  it("does not create drafts when below threshold", async () => {
    const longResponseWithSummary = "A".repeat(501) + "\nIn summary:";
    const drafts = await observeAndAdapt(store, longResponseWithSummary, BASE_CONTEXT);
    expect(drafts).toHaveLength(0);
    const overrides = store.getOverrides(TEST_KEY);
    expect(overrides).toHaveLength(0);
  });

  it("does NOT create duplicate draft when status is awaiting_review", async () => {
    const longResponseWithSummary = "A".repeat(501) + "\nIn summary:";

    // Trigger 3 observations to create a draft
    for (let i = 0; i < 3; i++) {
      await observeAndAdapt(store, longResponseWithSummary, {
        ...BASE_CONTEXT,
        sessionId: `session-${i}`,
      });
    }

    // Set the draft to awaiting_review
    const overrides = store.getOverrides(TEST_KEY);
    const draft = overrides.find((o) => o.quirkKey === "stops_before_completion");
    expect(draft).toBeDefined();
    store.updateStatus(draft!.id, "awaiting_review");

    // 3 more observations should NOT create a new draft (awaiting_review blocks it)
    for (let i = 3; i < 6; i++) {
      await observeAndAdapt(store, longResponseWithSummary, {
        ...BASE_CONTEXT,
        sessionId: `session-${i}`,
      });
    }

    const allOverrides = store.getOverrides(TEST_KEY);
    const draftsForQuirk = allOverrides.filter((o) => o.quirkKey === "stops_before_completion");
    expect(draftsForQuirk).toHaveLength(1);
  });

  it("boundary: exactly 3 observations creates draft, 2 does not", async () => {
    const longResponseWithSummary = "A".repeat(501) + "\nIn summary:";

    // 2 observations — no draft
    for (let i = 0; i < 2; i++) {
      await observeAndAdapt(store, longResponseWithSummary, {
        ...BASE_CONTEXT,
        sessionId: `boundary-${i}`,
      });
    }
    expect(store.getOverrides(TEST_KEY)).toHaveLength(0);

    // 3rd observation — draft created
    const drafts = await observeAndAdapt(store, longResponseWithSummary, {
      ...BASE_CONTEXT,
      sessionId: "boundary-2",
    });
    expect(drafts.length).toBeGreaterThanOrEqual(1);
    expect(store.getOverrides(TEST_KEY).length).toBeGreaterThanOrEqual(1);
  });

  it("respects custom draftThreshold config", async () => {
    const longResponseWithSummary = "A".repeat(501) + "\nIn summary:";

    // With draftThreshold=5, 3 observations should NOT create a draft
    for (let i = 0; i < 3; i++) {
      await observeAndAdapt(
        store,
        longResponseWithSummary,
        { ...BASE_CONTEXT, sessionId: `custom-${i}` },
        undefined,
        { draftThreshold: 5 },
      );
    }
    expect(store.getOverrides(TEST_KEY)).toHaveLength(0);

    // 5th observation should create the draft
    for (let i = 3; i < 5; i++) {
      await observeAndAdapt(
        store,
        longResponseWithSummary,
        { ...BASE_CONTEXT, sessionId: `custom-${i}` },
        undefined,
        { draftThreshold: 5 },
      );
    }
    expect(store.getOverrides(TEST_KEY).length).toBeGreaterThanOrEqual(1);
  });
});

// ---------------------------------------------------------------------------
// promoteOverride
// ---------------------------------------------------------------------------

describe("promoteOverride", () => {
  let store: ModelAdaptationStore;

  beforeEach(() => {
    store = makeStore();
  });

  it("succeeds with valid evidence", async () => {
    const draft = store.addDraft(generateOverride("stops_before_completion", TEST_KEY, 3));
    const result = await promoteOverride(store, draft.id, {
      testsPass: true,
      smokePass: true,
      pdseScore: 0.9,
    });
    expect(result).toBe(true);
    const promoted = store.getActiveOverrides(TEST_KEY);
    expect(promoted).toHaveLength(1);
    expect(promoted[0]!.status).toBe("promoted");
  });

  it("fails without test pass", async () => {
    const draft = store.addDraft(generateOverride("stops_before_completion", TEST_KEY, 3));
    const result = await promoteOverride(store, draft.id, {
      testsPass: false,
      smokePass: true,
    });
    expect(result).toBe(false);
  });

  it("fails without smoke pass", async () => {
    const draft = store.addDraft(generateOverride("stops_before_completion", TEST_KEY, 3));
    const result = await promoteOverride(store, draft.id, {
      testsPass: true,
      smokePass: false,
    });
    expect(result).toBe(false);
  });

  it("returns false for non-existent override id", async () => {
    const result = await promoteOverride(store, "non-existent-id", {
      testsPass: true,
      smokePass: true,
    });
    expect(result).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Confidence scoring (D-12A Lane C — Gap 7)
// ---------------------------------------------------------------------------

describe("Confidence scoring", () => {
  it("observations include confidence field", () => {
    const response = "A".repeat(600) + " In summary:";
    const observations = detectQuirks(response, {
      ...BASE_CONTEXT,
      sessionId: "conf-test-1",
      hadToolCalls: false,
      toolCallsInRound: 0,
    });

    // Should detect stops_before_completion
    const obs = observations.find(o => o.quirkKey === "stops_before_completion");
    expect(obs).toBeDefined();
    expect(obs!.confidence).toBeDefined();
    expect(typeof obs!.confidence).toBe("number");
    expect(obs!.confidence).toBeGreaterThan(0);
    expect(obs!.confidence).toBeLessThanOrEqual(1);
  });

  it("tool_call_format_error has higher confidence than markdown_wrapper_issue", () => {
    // Trigger tool_call_format_error
    const jsonResponse = '{"name": "test", "value": /bad/}';
    const jsonObs = detectQuirks(jsonResponse, {
      ...BASE_CONTEXT,
      sessionId: "conf-test-2",
      hadToolCalls: true,
      toolCallsInRound: 1,
      promptType: "tool-call",
    });
    const jsonMatch = jsonObs.find(o => o.quirkKey === "tool_call_format_error");

    // Trigger markdown_wrapper_issue
    const mdResponse = "# Header\n## Subheader\nContent here";
    const mdObs = detectQuirks(mdResponse, {
      ...BASE_CONTEXT,
      sessionId: "conf-test-3",
      hadToolCalls: false,
      toolCallsInRound: 0,
      promptType: "tool-call",
    });
    const mdMatch = mdObs.find(o => o.quirkKey === "markdown_wrapper_issue");

    expect(jsonMatch, "tool_call_format_error should be detected").toBeDefined();
    expect(mdMatch, "markdown_wrapper_issue should be detected").toBeDefined();
    expect(jsonMatch!.confidence).toBeGreaterThan(mdMatch!.confidence!);
  });
});

// ---------------------------------------------------------------------------
// observeAndAdapt logger (D-12A Phase 2 — Issue 5)
// ---------------------------------------------------------------------------

describe("observeAndAdapt logger", () => {
  let store: ModelAdaptationStore;

  beforeEach(async () => {
    store = new ModelAdaptationStore("/tmp/test-logger");
    await store.load();
  });

  it("calls logger when store.save fails", async () => {
    vi.spyOn(store, "save").mockRejectedValue(new Error("disk full"));

    const events: AdaptationEvent[] = [];
    const logger: AdaptationLogger = (event) => { events.push(event); };

    // Response that triggers at least one detection (>500 chars + summary)
    const longResponse = "A".repeat(501) + "\nIn summary:";
    await observeAndAdapt(store, longResponse, { ...BASE_CONTEXT, sessionId: "logger-test-1" }, logger);

    const saveErrorEvent = events.find(
      (e) => e.kind === "adaptation:save_error" && e.reason?.includes("Save failed"),
    );
    expect(saveErrorEvent).toBeDefined();
    expect(saveErrorEvent!.reason).toContain("disk full");
  });

  it("does not throw when logger itself throws on save error", async () => {
    vi.spyOn(store, "save").mockRejectedValue(new Error("disk full"));

    const badLogger: AdaptationLogger = () => { throw new Error("logger broken"); };

    const longResponse = "A".repeat(501) + "\nIn summary:";
    // Should not throw even when both save and logger fail
    await expect(
      observeAndAdapt(store, longResponse, { ...BASE_CONTEXT, sessionId: "logger-test-2" }, badLogger),
    ).resolves.toBeDefined();
  });

  it("works without logger (backward compatibility)", async () => {
    // No logger passed — should not throw
    const longResponse = "A".repeat(501) + "\nIn summary:";
    const drafts = await observeAndAdapt(store, longResponse, { ...BASE_CONTEXT, sessionId: "logger-test-3" });
    expect(drafts).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// D-12A Phase 4 — Confidence gate cumulative fix (Issue 3)
// ---------------------------------------------------------------------------

describe("observeAndAdapt — confidence gate cumulative", () => {
  let store: ModelAdaptationStore;

  beforeEach(async () => {
    store = makeStore();
    await store.load();
  });

  it("skips gate when threshold already crossed by prior observations", async () => {
    const longResponseWithSummary = "A".repeat(501) + "\nIn summary:";

    // Build up 3 prior observations (threshold = 3)
    for (let i = 0; i < 3; i++) {
      await observeAndAdapt(store, longResponseWithSummary, {
        ...BASE_CONTEXT,
        sessionId: `prior-${i}`,
      });
    }

    // Should have created a draft on the 3rd observation
    const overrides = store.getOverrides(TEST_KEY);
    expect(overrides.length).toBeGreaterThanOrEqual(1);
  });
});

// ---------------------------------------------------------------------------
// D-12A Phase 4 — Detection false positive fix (Issue 7)
// ---------------------------------------------------------------------------

describe("detectQuirks — false positive reduction", () => {
  it("does NOT detect stops_before_completion for short but correct tool response with follow-up action", () => {
    // 120 chars, contains follow-up action verb — should NOT be detected as false positive
    const response = "I ran the search command and found 3 files. Let me now fix the issue by updating the configuration file.";
    const results = detectQuirks(response, { ...BASE_CONTEXT, hadToolCalls: true });
    const found = results.find(
      (r) => r.quirkKey === "stops_before_completion" && r.failureTags.includes("stops-after-tool"),
    );
    expect(found).toBeUndefined();
  });

  it("does NOT detect stops_before_completion for response with follow-up 'next' verb", () => {
    const response = "I ran the search command and found 3 files. Next I'll update them.";
    const results = detectQuirks(response, { ...BASE_CONTEXT, hadToolCalls: true });
    const found = results.find(
      (r) => r.failureTags.includes("stops-after-tool"),
    );
    expect(found).toBeUndefined();
  });
});
