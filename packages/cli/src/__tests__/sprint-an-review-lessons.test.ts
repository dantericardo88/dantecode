// ============================================================================
// Sprint AN — Dims 18+21: Review Summary/Coverage + Lesson Brief
// Tests that:
//  - buildReviewSummary counts blockers/suggestions/nitpicks correctly
//  - buildReviewSummary rankedActions puts blockers first
//  - buildReviewSummary overallActionability is 0 for empty comments
//  - computeReviewCoverage returns 0 with no comments
//  - computeReviewCoverage returns 1.0 when all diff lines have comments
//  - computeReviewCoverage ignores low-actionability comments
//  - buildLessonBrief returns empty string when no lessons file
//  - buildLessonBrief returns [Lesson brief] message with lesson patterns
//  - emitLessonBrief writes to .danteforge/lesson-brief.json
//  - seeded lesson-brief.json exists with 5+ entries
//  - loadLessons reads from .danteforge/lessons.json
// ============================================================================

import { describe, it, expect } from "vitest";
import { existsSync, readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { resolve } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import {
  buildReviewSummary,
  computeReviewCoverage,
  buildLessonBrief,
  emitLessonBrief,
  loadLessons,
  buildReviewComment,
} from "@dantecode/core";

const repoRoot = resolve(__dirname, "../../../../");

function makeDir(): string {
  const dir = join(tmpdir(), `sprint-an-${randomUUID()}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

// ─── Part 1: Review Summary + Coverage ────────────────────────────────────────

describe("Review Summary + Coverage — Sprint AN (dim 18)", () => {
  // 1. buildReviewSummary counts comment types
  it("buildReviewSummary counts blockers/suggestions/nitpicks correctly", () => {
    const comments = [
      buildReviewComment("blocking", "security", "Validate input before use", { filePath: "src/auth.ts", line: 10 }),
      buildReviewComment("suggestion", "performance", "Consider caching this result"),
      buildReviewComment("nitpick", "style", "Missing semicolon"),
    ];
    const summary = buildReviewSummary(comments);
    expect(summary.blockers).toBe(1);
    expect(summary.suggestions).toBe(1);
    expect(summary.nitpicks).toBe(1);
    expect(summary.totalComments).toBe(3);
  });

  // 2. blockers come before suggestions in rankedActions
  it("buildReviewSummary rankedActions puts blockers before suggestions", () => {
    const comments = [
      buildReviewComment("suggestion", "performance", "Consider caching the result here"),
      buildReviewComment("blocking", "security", "SQL injection at line 42 — use parameterized queries", { filePath: "src/db.ts", line: 42 }),
    ];
    const summary = buildReviewSummary(comments);
    expect(summary.rankedActions[0]).toContain("[blocking]");
  });

  // 3. overallActionability is 0 for empty
  it("buildReviewSummary overallActionability is 0 for empty comments", () => {
    const summary = buildReviewSummary([]);
    expect(summary.overallActionability).toBe(0);
    expect(summary.totalComments).toBe(0);
  });

  // 4. computeReviewCoverage returns 0 with no comments
  it("computeReviewCoverage returns 0 when no comments", () => {
    expect(computeReviewCoverage([10, 11, 12], [])).toBe(0);
  });

  // 5. computeReviewCoverage returns 1.0 when all diff lines covered
  it("computeReviewCoverage returns 1.0 when all diff lines have actionable comments", () => {
    const comments = [
      buildReviewComment("blocking", "security", "Fix the null check here — it will throw on undefined input", { filePath: "src/x.ts", line: 10 }),
      buildReviewComment("blocking", "logic", "Missing return statement causes incorrect behavior here", { filePath: "src/x.ts", line: 11 }),
      buildReviewComment("suggestion", "performance", "Consider using a Map instead of repeated array.find() calls here", { filePath: "src/x.ts", line: 12 }),
    ];
    expect(computeReviewCoverage([10, 11, 12], comments)).toBe(1.0);
  });

  // 6. computeReviewCoverage ignores lines with no comment
  it("computeReviewCoverage is < 1.0 when some lines have no comments", () => {
    const comments = [
      buildReviewComment("blocking", "security", "Use parameterized queries to prevent SQL injection here", { filePath: "src/db.ts", line: 10 }),
    ];
    const coverage = computeReviewCoverage([10, 11, 12], comments);
    expect(coverage).toBeCloseTo(1 / 3, 2);
  });
});

// ─── Part 2: Lesson Brief ─────────────────────────────────────────────────────

describe("LessonBrief — Sprint AN (dim 21)", () => {
  // 7. buildLessonBrief returns empty for missing lessons
  it("buildLessonBrief returns empty string when no lessons file exists", () => {
    const dir = makeDir(); // fresh dir with no lessons.json
    const brief = buildLessonBrief(dir);
    expect(brief).toBe("");
  });

  // 8. buildLessonBrief returns [Lesson brief] message with patterns
  it("buildLessonBrief returns [Lesson brief] message when lessons exist", () => {
    const dir = makeDir();
    const lessons = [
      { pattern: "Always typecheck before completing", score: 0.95 },
      { pattern: "Use narrow repairs", score: 0.9 },
    ];
    mkdirSync(join(dir, ".danteforge"), { recursive: true });
    writeFileSync(join(dir, ".danteforge", "lessons.json"), JSON.stringify(lessons), "utf-8");
    const brief = buildLessonBrief(dir);
    expect(brief).toContain("[Lesson brief]");
    expect(brief).toContain("Always typecheck before completing");
  });

  // 9. emitLessonBrief writes to .danteforge/lesson-brief.json
  it("emitLessonBrief writes to .danteforge/lesson-brief.json", () => {
    const dir = makeDir();
    const lessons = [{ pattern: "Narrow repairs are better", score: 0.88 }];
    mkdirSync(join(dir, ".danteforge"), { recursive: true });
    writeFileSync(join(dir, ".danteforge", "lessons.json"), JSON.stringify(lessons), "utf-8");
    emitLessonBrief(dir);
    expect(existsSync(join(dir, ".danteforge", "lesson-brief.json"))).toBe(true);
  });

  // 10. seeded lesson-brief.json exists
  it("seeded lesson-brief.json exists at .danteforge/ with 5+ entries", () => {
    const path = join(repoRoot, ".danteforge", "lesson-brief.json");
    expect(existsSync(path)).toBe(true);
    const lines = readFileSync(path, "utf-8").trim().split("\n").filter(Boolean);
    expect(lines.length).toBeGreaterThanOrEqual(5);
  });

  // 11. loadLessons reads from lessons.json
  it("loadLessons reads lessons from .danteforge/lessons.json", () => {
    const lessons = loadLessons(repoRoot);
    expect(lessons.length).toBeGreaterThan(0);
    expect(typeof lessons[0]?.pattern).toBe("string");
  });
});
