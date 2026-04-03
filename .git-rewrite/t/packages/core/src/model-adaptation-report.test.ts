import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  generateAdaptationReport,
  serializeAdaptationReport,
  writeAdaptationReport,
} from "./model-adaptation-report.js";
import type {
  QuirkObservation,
  CandidateOverride,
  ExperimentResult,
} from "./model-adaptation-types.js";

vi.mock("node:fs/promises", () => ({
  writeFile: vi.fn(),
  mkdir: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

function makeObservation(overrides?: Partial<QuirkObservation>): QuirkObservation {
  return {
    id: "obs_1",
    quirkKey: "stops_before_completion",
    provider: "anthropic",
    model: "claude-sonnet-4-6",
    workflow: "magic",
    promptTemplateVersion: "1.3.0",
    failureTags: [],
    outputCharacteristics: [],
    evidenceRefs: [],
    createdAt: "2026-03-23T10:00:00Z",
    ...overrides,
  };
}

function makeOverride(overrides?: Partial<CandidateOverride>): CandidateOverride {
  return {
    id: "ovr_1",
    provider: "anthropic",
    model: "claude-sonnet-4-6",
    quirkKey: "stops_before_completion",
    status: "draft",
    scope: {},
    patch: { promptPreamble: "Do not summarize early." },
    basedOnObservationIds: ["obs_1"],
    version: 1,
    createdAt: "2026-03-23T10:00:00Z",
    ...overrides,
  };
}

function makeExperiment(overrides?: Partial<ExperimentResult>): ExperimentResult {
  return {
    id: "exp_1",
    overrideId: "ovr_1",
    provider: "anthropic",
    model: "claude-sonnet-4-6",
    quirkKey: "stops_before_completion",
    baseline: { pdseScore: 80, completionStatus: "complete", successRate: 0.8 },
    candidate: {
      pdseScore: 88,
      completionStatus: "complete",
      successRate: 0.9,
    },
    controlRegression: false,
    smokePassed: true,
    decision: "promote",
    createdAt: "2026-03-23T11:00:00Z",
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// generateAdaptationReport
// ---------------------------------------------------------------------------

describe("generateAdaptationReport", () => {
  it("produces all 7 sections", () => {
    const report = generateAdaptationReport(
      "stops_before_completion",
      [makeObservation()],
      makeOverride(),
      [makeExperiment()],
      [],
    );
    expect(report.quirkDetected).toContain("stops_before_completion");
    expect(report.evidence.length).toBeGreaterThan(0);
    expect(report.candidateOverride).toContain("ovr_1");
    expect(report.experimentsRun.length).toBeGreaterThan(0);
    expect(report.promotionDecision.length).toBeGreaterThan(0);
    expect(report.rollbackStatus.length).toBeGreaterThan(0);
    expect(report.plainEnglish.length).toBeGreaterThan(0);
  });

  it("handles no override gracefully", () => {
    const report = generateAdaptationReport(
      "tool_call_format_error",
      [makeObservation()],
      null,
      [],
      [],
    );
    expect(report.candidateOverride).toContain("No candidate override");
    expect(report.promotionDecision).toContain("No override exists");
  });

  it("handles no experiments gracefully", () => {
    const report = generateAdaptationReport("tool_call_format_error", [], makeOverride(), [], []);
    expect(report.experimentsRun).toEqual(["No experiments have been run."]);
  });

  it("handles no observations gracefully", () => {
    const report = generateAdaptationReport("skips_synthesis", [], null, [], []);
    expect(report.quirkDetected).toContain("Total observations: 0");
    expect(report.quirkDetected).toContain("No observations recorded.");
    expect(report.evidence).toEqual([]);
  });

  it("describes promoted override in plain English", () => {
    const report = generateAdaptationReport(
      "stops_before_completion",
      [makeObservation()],
      makeOverride({
        status: "promoted",
        promotedAt: "2026-03-23T12:00:00Z",
      }),
      [makeExperiment()],
      [],
    );
    expect(report.plainEnglish).toContain("promoted to active use");
    expect(report.promotionDecision).toContain("promoted at");
  });

  it("describes rejected override in plain English", () => {
    const report = generateAdaptationReport(
      "stops_before_completion",
      [makeObservation()],
      makeOverride({
        status: "rejected",
        rejectedAt: "2026-03-23T13:00:00Z",
      }),
      [makeExperiment({ decision: "reject" })],
      [],
    );
    expect(report.plainEnglish).toContain("rejected");
    expect(report.promotionDecision).toContain("rejected at");
  });

  it("describes rolled_back override in plain English", () => {
    const report = generateAdaptationReport(
      "stops_before_completion",
      [],
      makeOverride({ status: "rolled_back", rollbackOfVersion: 2 }),
      [],
      [],
    );
    expect(report.plainEnglish).toContain("rolled back");
    expect(report.promotionDecision).toContain("rolled back");
    expect(report.promotionDecision).toContain("version 2");
  });

  it("describes testing override in plain English", () => {
    const report = generateAdaptationReport(
      "stops_before_completion",
      [makeObservation()],
      makeOverride({ status: "testing" }),
      [],
      [],
    );
    expect(report.plainEnglish).toContain("experiment results");
  });

  it("describes draft override in plain English", () => {
    const report = generateAdaptationReport(
      "stops_before_completion",
      [makeObservation()],
      makeOverride({ status: "draft" }),
      [],
      [],
    );
    expect(report.plainEnglish).toContain("review");
  });

  it("describes rollback history", () => {
    const rolledBack = makeOverride({
      id: "rb_1",
      status: "rolled_back",
      rollbackOfVersion: 1,
      rejectedAt: "2026-03-23T13:00:00Z",
    });
    const report = generateAdaptationReport(
      "stops_before_completion",
      [],
      makeOverride(),
      [],
      [rolledBack],
    );
    expect(report.rollbackStatus).toContain("rolled back");
    expect(report.rollbackStatus).toContain("Version 1");
  });

  it("includes failure tags in evidence", () => {
    const obs = makeObservation({ failureTags: ["missing-json", "truncated"] });
    const report = generateAdaptationReport("tool_call_format_error", [obs], null, [], []);
    expect(report.evidence[0]).toContain("tags: missing-json, truncated");
  });

  it("includes PDSE and completion status in evidence", () => {
    const obs = makeObservation({
      pdseScore: 72,
      completionStatus: "partial",
    });
    const report = generateAdaptationReport("stops_before_completion", [obs], null, [], []);
    expect(report.evidence[0]).toContain("PDSE: 72");
    expect(report.evidence[0]).toContain("partial");
  });

  it("includes command name in evidence when present", () => {
    const obs = makeObservation({ commandName: "plan" });
    const report = generateAdaptationReport("stops_before_completion", [obs], null, [], []);
    expect(report.evidence[0]).toContain("(plan)");
  });

  it("limits evidence to last 5 observations", () => {
    const observations = Array.from({ length: 10 }, (_, i) =>
      makeObservation({ id: `obs_${i}`, createdAt: `2026-03-23T1${i}:00:00Z` }),
    );
    const report = generateAdaptationReport("stops_before_completion", observations, null, [], []);
    expect(report.evidence.length).toBe(5);
  });

  it("formats experiment deltas correctly", () => {
    const expPositive = makeExperiment({
      baseline: { pdseScore: 70 },
      candidate: { pdseScore: 85 },
    });
    const expNegative = makeExperiment({
      id: "exp_2",
      baseline: { pdseScore: 85 },
      candidate: { pdseScore: 78 },
      decision: "reject",
    });
    const report = generateAdaptationReport(
      "stops_before_completion",
      [],
      makeOverride(),
      [expPositive, expNegative],
      [],
    );
    expect(report.experimentsRun[0]).toContain("+15.0");
    expect(report.experimentsRun[1]).toContain("-7.0");
  });

  it("shows override patch details", () => {
    const ovr = makeOverride({
      patch: {
        promptPreamble: "Be thorough.",
        orderingHints: ["Plan first", "Then execute"],
        toolFormattingHints: ["Use JSON"],
        synthesisRequirements: ["Summarize at end"],
      },
    });
    const report = generateAdaptationReport("stops_before_completion", [], ovr, [], []);
    expect(report.candidateOverride).toContain("Prompt preamble");
    expect(report.candidateOverride).toContain("Ordering hints");
    expect(report.candidateOverride).toContain("Tool formatting hints");
    expect(report.candidateOverride).toContain("Synthesis requirements");
  });
});

// ---------------------------------------------------------------------------
// serializeAdaptationReport
// ---------------------------------------------------------------------------

describe("serializeAdaptationReport", () => {
  const REQUIRED_HEADINGS = [
    "## Quirk detected",
    "## Evidence",
    "## Candidate override",
    "## Experiments run",
    "## Promotion decision",
    "## Rollback status",
    "## What changed in plain English",
  ];

  it("contains all 7 required headings", () => {
    const report = generateAdaptationReport(
      "stops_before_completion",
      [makeObservation()],
      makeOverride(),
      [],
      [],
    );
    const md = serializeAdaptationReport(report);
    for (const heading of REQUIRED_HEADINGS) {
      expect(md).toContain(heading);
    }
  });

  it("starts with the top-level heading", () => {
    const report = generateAdaptationReport("stops_before_completion", [], null, [], []);
    const md = serializeAdaptationReport(report);
    expect(md).toMatch(/^# Model Adaptation Report\n/);
  });

  it("is valid markdown with reasonable length", () => {
    const report = generateAdaptationReport("stops_before_completion", [], null, [], []);
    const md = serializeAdaptationReport(report);
    expect(md).toContain("# Model Adaptation Report");
    expect(md.length).toBeGreaterThan(100);
  });

  it("includes evidence fallback when no observations", () => {
    const report = generateAdaptationReport("stops_before_completion", [], null, [], []);
    const md = serializeAdaptationReport(report);
    expect(md).toContain("No evidence recorded.");
  });
});

// ---------------------------------------------------------------------------
// writeAdaptationReport
// ---------------------------------------------------------------------------

describe("writeAdaptationReport", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("writes report to .dantecode/reports directory", async () => {
    const { writeFile: mockWrite, mkdir: mockMkdir } = await import("node:fs/promises");
    const report = generateAdaptationReport("stops_before_completion", [], null, [], []);
    const filePath = await writeAdaptationReport("/project", report, "stops_before_completion");
    expect(mockMkdir).toHaveBeenCalledWith(expect.stringContaining("reports"), { recursive: true });
    expect(mockWrite).toHaveBeenCalledWith(
      expect.stringContaining("adaptation"),
      expect.stringContaining("# Model Adaptation Report"),
      "utf-8",
    );
    expect(filePath).toContain("adaptation");
    expect(filePath).toContain("stops_before_completion");
  });

  it("sanitizes quirk key in filename", async () => {
    const report = generateAdaptationReport("tool_call_format_error", [], null, [], []);
    const filePath = await writeAdaptationReport("/project", report, "tool_call_format_error");
    expect(filePath).toContain("tool_call_format_error");
    expect(filePath).not.toContain(":");
  });

  it("works without quirk key", async () => {
    const report = generateAdaptationReport("tool_call_format_error", [], null, [], []);
    const filePath = await writeAdaptationReport("/project", report);
    expect(filePath).toContain("adaptation");
    expect(filePath).toMatch(/adaptation\.md$/);
  });
});
