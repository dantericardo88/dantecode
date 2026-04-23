// packages/cli/src/__tests__/sprint-dim30-trust.test.ts
// Dim 30 — UX trust / explainability
// Tests: labelConfidence, narrateDecision, rateActionRisk, renderActionBadge,
//        renderContextAttribution, renderSessionSummary, JSONL persistence

import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  labelConfidence,
  narrateDecision,
  rateActionRisk,
  renderActionBadge,
  renderContextAttribution,
  renderSessionSummary,
  recordDecisionNarrative,
  loadDecisionNarratives,
  type DecisionNarrative,
} from "@dantecode/core";

// ── labelConfidence ───────────────────────────────────────────────────────────

describe("labelConfidence", () => {
  it("returns 'high' for score >= 0.85", () => {
    expect(labelConfidence(0.9)).toBe("high");
    expect(labelConfidence(0.85)).toBe("high");
    expect(labelConfidence(1.0)).toBe("high");
  });

  it("returns 'moderate' for score in [0.65, 0.85)", () => {
    expect(labelConfidence(0.75)).toBe("moderate");
    expect(labelConfidence(0.65)).toBe("moderate");
    expect(labelConfidence(0.84)).toBe("moderate");
  });

  it("returns 'exploratory' for score < 0.65", () => {
    expect(labelConfidence(0.5)).toBe("exploratory");
    expect(labelConfidence(0.0)).toBe("exploratory");
    expect(labelConfidence(0.64)).toBe("exploratory");
  });
});

// ── rateActionRisk ────────────────────────────────────────────────────────────

describe("rateActionRisk", () => {
  it("returns 'safe' for read_file", () => {
    expect(rateActionRisk("read_file", {})).toBe("safe");
  });

  it("returns 'safe' for glob", () => {
    expect(rateActionRisk("glob", {})).toBe("safe");
  });

  it("returns 'safe' for grep", () => {
    expect(rateActionRisk("grep", {})).toBe("safe");
  });

  it("returns 'safe' for web_search", () => {
    expect(rateActionRisk("web_search", {})).toBe("safe");
  });

  it("returns 'risky' for bash", () => {
    expect(rateActionRisk("bash", {})).toBe("risky");
  });

  it("returns 'risky' for git_push", () => {
    expect(rateActionRisk("git_push", {})).toBe("risky");
  });

  it("returns 'risky' for execute_command", () => {
    expect(rateActionRisk("execute_command", {})).toBe("risky");
  });

  it("returns 'review' for write_file", () => {
    expect(rateActionRisk("write_file", {})).toBe("review");
  });

  it("returns 'review' for unknown tool names", () => {
    expect(rateActionRisk("some_custom_tool", {})).toBe("review");
  });

  it("returns 'risky' for delete_file", () => {
    expect(rateActionRisk("delete_file", {})).toBe("risky");
  });
});

// ── renderActionBadge ─────────────────────────────────────────────────────────

describe("renderActionBadge", () => {
  it("returns '[safe]' for safe actions", () => {
    expect(renderActionBadge("safe")).toBe("[safe]");
  });

  it("returns '[review]' for review actions", () => {
    expect(renderActionBadge("review")).toBe("[review]");
  });

  it("returns a string containing 'risky' for risky actions", () => {
    expect(renderActionBadge("risky")).toContain("risky");
  });
});

// ── narrateDecision ───────────────────────────────────────────────────────────

describe("narrateDecision", () => {
  it("returns a DecisionNarrative with non-empty formattedLine", () => {
    const result = narrateDecision("decompose", 0.9, ["src/auth.ts"]);
    expect(result.formattedLine.length).toBeGreaterThan(0);
  });

  it("includes strategy in formattedLine", () => {
    const result = narrateDecision("decompose", 0.9, ["src/auth.ts"]);
    expect(result.formattedLine).toContain("decompose");
  });

  it("includes '[Exploratory]' prefix for low confidence", () => {
    const result = narrateDecision("explore", 0.5, []);
    expect(result.formattedLine).toContain("[Exploratory]");
  });

  it("does NOT include '[Exploratory]' for high confidence", () => {
    const result = narrateDecision("direct", 0.92, ["src/foo.ts"]);
    expect(result.formattedLine).not.toContain("[Exploratory]");
  });

  it("includes 'review output' hint for moderate confidence", () => {
    const result = narrateDecision("direct", 0.72, ["src/foo.ts"]);
    expect(result.formattedLine).toContain("review output");
  });

  it("sets confidenceLabel correctly from score", () => {
    expect(narrateDecision("direct", 0.9, []).confidenceLabel).toBe("high");
    expect(narrateDecision("direct", 0.72, []).confidenceLabel).toBe("moderate");
    expect(narrateDecision("direct", 0.5, []).confidenceLabel).toBe("exploratory");
  });

  it("includes context files in rationale", () => {
    const result = narrateDecision("decompose", 0.9, ["src/auth.ts", "src/db.ts"]);
    expect(result.rationale).toContain("src/auth.ts");
  });

  it("has a valid ISO recordedAt timestamp", () => {
    const result = narrateDecision("direct", 0.8, []);
    expect(() => new Date(result.recordedAt)).not.toThrow();
  });

  it("falls back to 'general context' when no context files provided", () => {
    const result = narrateDecision("direct", 0.88, []);
    expect(result.rationale).toBe("general context");
  });
});

// ── renderContextAttribution ──────────────────────────────────────────────────

describe("renderContextAttribution", () => {
  it("includes file names in output", () => {
    const line = renderContextAttribution(["src/auth.ts", "src/db.ts"], 0, 0);
    expect(line).toContain("src/auth.ts");
  });

  it("includes lesson count when > 0", () => {
    const line = renderContextAttribution([], 3, 0);
    expect(line).toContain("3 lessons");
  });

  it("includes diagnostic count when > 0", () => {
    const line = renderContextAttribution([], 0, 5);
    expect(line).toContain("5 LSP diagnostics");
  });

  it("returns empty string when all inputs are empty/zero", () => {
    expect(renderContextAttribution([], 0, 0)).toBe("");
  });

  it("starts with 'Context:' prefix", () => {
    const line = renderContextAttribution(["src/foo.ts"], 1, 0);
    expect(line).toMatch(/^Context:/);
  });
});

// ── renderSessionSummary ──────────────────────────────────────────────────────

describe("renderSessionSummary", () => {
  it("includes file names in the summary", () => {
    const summary = renderSessionSummary({
      filesEdited: ["src/auth.ts", "src/db.ts"],
      confidence: 0.9,
    });
    expect(summary).toContain("src/auth.ts");
  });

  it("includes confidence label", () => {
    const summary = renderSessionSummary({ filesEdited: [], confidence: 0.91 });
    expect(summary).toContain("high");
  });

  it("includes 'Session complete' header", () => {
    const summary = renderSessionSummary({ filesEdited: [], confidence: 0.8 });
    expect(summary).toContain("Session complete");
  });

  it("includes tests result when provided", () => {
    const summary = renderSessionSummary({
      filesEdited: [],
      testsResult: "14 passed",
      confidence: 0.9,
    });
    expect(summary).toContain("14 passed");
  });
});

// ── recordDecisionNarrative + loadDecisionNarratives ─────────────────────────

describe("recordDecisionNarrative and loadDecisionNarratives", () => {
  let tmpDir: string;

  afterEach(() => {
    try { rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ok */ }
  });

  it("persists a narrative to JSONL and reads it back", () => {
    tmpDir = mkdtempSync(join(tmpdir(), "dim30-narr-"));
    const narrative: DecisionNarrative = {
      strategy: "decompose",
      confidenceLabel: "high",
      confidenceScore: 0.91,
      rationale: "src/auth.ts",
      formattedLine: "Approach: decompose (high confidence, 91%)",
      recordedAt: new Date().toISOString(),
    };
    recordDecisionNarrative(narrative, tmpDir);
    const entries = loadDecisionNarratives(tmpDir);
    expect(entries).toHaveLength(1);
    expect(entries[0]!.strategy).toBe("decompose");
    expect(entries[0]!.confidenceScore).toBe(0.91);
  });

  it("returns empty array when no log file exists", () => {
    tmpDir = mkdtempSync(join(tmpdir(), "dim30-narr-"));
    expect(loadDecisionNarratives(tmpDir)).toHaveLength(0);
  });

  it("appends multiple narratives", () => {
    tmpDir = mkdtempSync(join(tmpdir(), "dim30-narr-"));
    const base: DecisionNarrative = {
      strategy: "direct", confidenceLabel: "high", confidenceScore: 0.9,
      rationale: "src/foo.ts", formattedLine: "Approach: direct (high confidence, 90%)",
      recordedAt: new Date().toISOString(),
    };
    recordDecisionNarrative(base, tmpDir);
    recordDecisionNarrative({ ...base, strategy: "explore", confidenceScore: 0.72 }, tmpDir);
    const entries = loadDecisionNarratives(tmpDir);
    expect(entries).toHaveLength(2);
    expect(entries[1]!.strategy).toBe("explore");
  });
});
