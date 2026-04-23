// ============================================================================
// Sprint AJ — Dims 1+16: FIM Acceptance Wiring + Plan Edit Tracker
// Tests that:
//  - recordPlanEdit writes to .danteforge/plan-edit-log.json
//  - summarizePlanEdits computes confirmedEdits correctly
//  - summarizePlanEdits computes editRate (fraction with linesChanged > 0)
//  - summarizePlanEdits handles empty input
//  - computePlanDiff detects changed lines between two strings
//  - computePlanDiff returns 0 for identical strings
//  - computePlanDiff returns diff for appended line
//  - seeded plan-edit-log.json exists with 5+ entries
//  - FIM acceptance tracker records accepted completion (integration with Sprint AF)
//  - getLanguageAcceptanceRate improves as completions are accepted
// ============================================================================

import { describe, it, expect } from "vitest";
import { existsSync, readFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { resolve } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import {
  recordPlanEdit,
  summarizePlanEdits,
  computePlanDiff,
  type PlanEditEntry,
  recordFimAcceptance,
  getLanguageAcceptanceRate,
} from "@dantecode/core";

const repoRoot = resolve(__dirname, "../../../../");

function makeDir(): string {
  const dir = join(tmpdir(), `sprint-aj-${randomUUID()}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

// ─── Part 1: Plan Edit Tracker ────────────────────────────────────────────────

describe("PlanEditTracker — Sprint AJ (dim 16)", () => {
  // 1. recordPlanEdit writes file
  it("recordPlanEdit writes to .danteforge/plan-edit-log.json", () => {
    const dir = makeDir();
    recordPlanEdit({ sessionId: "s1", originalLineCount: 20, editedLineCount: 22, linesChanged: 4, confirmed: true, stepCount: 3 }, dir);
    expect(existsSync(join(dir, ".danteforge", "plan-edit-log.json"))).toBe(true);
  });

  // 2. summarizePlanEdits confirmedEdits
  it("summarizePlanEdits counts confirmedEdits correctly", () => {
    const entries: PlanEditEntry[] = [
      { timestamp: "t", sessionId: "s1", originalLineCount: 20, editedLineCount: 22, linesChanged: 4, confirmed: true, stepCount: 3 },
      { timestamp: "t", sessionId: "s2", originalLineCount: 20, editedLineCount: 0, linesChanged: 0, confirmed: false, stepCount: 3 },
    ];
    const s = summarizePlanEdits(entries);
    expect(s.confirmedEdits).toBe(1);
    expect(s.cancelledEdits).toBe(1);
  });

  // 3. summarizePlanEdits editRate
  it("summarizePlanEdits computes editRate as fraction with linesChanged > 0", () => {
    const entries: PlanEditEntry[] = [
      { timestamp: "t", sessionId: "s1", originalLineCount: 20, editedLineCount: 22, linesChanged: 4, confirmed: true, stepCount: 3 },
      { timestamp: "t", sessionId: "s2", originalLineCount: 20, editedLineCount: 20, linesChanged: 0, confirmed: true, stepCount: 3 },
    ];
    const s = summarizePlanEdits(entries);
    expect(s.editRate).toBe(0.5);
  });

  // 4. summarizePlanEdits handles empty input
  it("summarizePlanEdits handles empty input", () => {
    const s = summarizePlanEdits([]);
    expect(s.totalEdits).toBe(0);
    expect(s.editRate).toBe(0);
  });

  // 5. computePlanDiff detects changed lines
  it("computePlanDiff returns positive count for different strings", () => {
    const original = "line1\nline2\nline3";
    const edited = "line1\nmodified2\nline3";
    expect(computePlanDiff(original, edited)).toBe(1);
  });

  // 6. computePlanDiff returns 0 for identical
  it("computePlanDiff returns 0 for identical strings", () => {
    const plan = "line1\nline2\nline3";
    expect(computePlanDiff(plan, plan)).toBe(0);
  });

  // 7. computePlanDiff counts appended lines
  it("computePlanDiff counts appended lines as changed", () => {
    const original = "line1\nline2";
    const edited = "line1\nline2\nline3";
    expect(computePlanDiff(original, edited)).toBeGreaterThan(0);
  });

  // 8. seeded plan-edit-log.json exists
  it("seeded plan-edit-log.json exists at .danteforge/ with 5+ entries", () => {
    const logPath = join(repoRoot, ".danteforge", "plan-edit-log.json");
    expect(existsSync(logPath)).toBe(true);
    const lines = readFileSync(logPath, "utf-8").trim().split("\n").filter(Boolean);
    expect(lines.length).toBeGreaterThanOrEqual(5);
  });
});

// ─── Part 2: FIM acceptance grows from sessions ────────────────────────────────

describe("FIM Acceptance — Sprint AJ (dim 1)", () => {
  // 9. recordFimAcceptance writes and rate updates
  it("acceptance rate improves as more completions accepted", () => {
    const dir = makeDir();
    recordFimAcceptance("kotlin", false, {}, dir);
    recordFimAcceptance("kotlin", true, {}, dir);
    const rate = getLanguageAcceptanceRate("kotlin", dir);
    expect(rate).toBeCloseTo(0.5, 2);
  });

  // 10. each call to recordFimAcceptance is cumulative
  it("rate is 1.0 after three accepts with no rejects", () => {
    const dir = makeDir();
    recordFimAcceptance("swift", true, {}, dir);
    recordFimAcceptance("swift", true, {}, dir);
    recordFimAcceptance("swift", true, {}, dir);
    expect(getLanguageAcceptanceRate("swift", dir)).toBe(1.0);
  });
});
