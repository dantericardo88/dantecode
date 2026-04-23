// ============================================================================
// Sprint BH — dim 18: reviewDepthScore tests for pr-review-architect.ts
// ============================================================================

import { describe, it, expect } from "vitest";
import {
  computeReviewDepth,
  buildArchitectReviewResult,
  parseArchitectIssues,
  architectToReviewComments,
  type ArchitectReviewPlan,
} from "./pr-review-architect.js";
import type { ReviewComment } from "./pr-review-orchestrator.js";

// ---------------------------------------------------------------------------
// Helper: build minimal ReviewComment
// ---------------------------------------------------------------------------

function makeComment(
  type: ReviewComment["type"],
  filePath: string,
  body: string,
): ReviewComment {
  return {
    id: `test-${Math.random().toString(36).slice(2)}`,
    type,
    category: "logic",
    body,
    resolved: false,
    createdAt: new Date().toISOString(),
    filePath,
  };
}

// ---------------------------------------------------------------------------
// computeReviewDepth
// ---------------------------------------------------------------------------

describe("computeReviewDepth", () => {
  it("returns 0 fileCoverageRate and 0 reviewDepthScore when no comments", () => {
    const depth = computeReviewDepth([], 5);
    expect(depth.fileCoverageRate).toBe(0);
    expect(depth.softBlockingComments).toBe(0);
    expect(depth.reviewDepthScore).toBe(0);
  });

  it("counts only substantive comments (body > 20 chars) for coverage", () => {
    const comments: ReviewComment[] = [
      makeComment("suggestion", "src/auth.ts", "short"), // body length 5 — not substantive
      makeComment("suggestion", "src/auth.ts", "This is a longer substantive comment about the code"), // substantive
    ];
    const depth = computeReviewDepth(comments, 3);
    // Only 1 distinct file has substantive comment out of 3 total
    expect(depth.fileCoverageRate).toBeCloseTo(1 / 3, 5);
    expect(depth.softBlockingComments).toBe(0);
  });

  it("computes fileCoverageRate correctly across multiple distinct files", () => {
    const comments: ReviewComment[] = [
      makeComment("suggestion", "src/auth.ts", "This auth function is missing error handling boundary"),
      makeComment("nitpick", "src/models.ts", "The variable naming convention should follow camelCase"),
      makeComment("blocking", "src/api.ts", "SQL injection vulnerability in raw query construction"),
    ];
    const depth = computeReviewDepth(comments, 3);
    // 3 distinct files with substantive comments out of 3 total changed files
    expect(depth.fileCoverageRate).toBe(1);
    expect(depth.softBlockingComments).toBe(1);
  });

  it("applies blocking comment penalty correctly", () => {
    // 5 blocking comments, 100% file coverage → penalty = 1 - 5/10 = 0.5
    const comments: ReviewComment[] = Array.from({ length: 5 }, (_, i) =>
      makeComment("blocking", `src/file${i}.ts`, `Critical security issue in this authentication path that needs fixing`),
    );
    const depth = computeReviewDepth(comments, 5);
    expect(depth.fileCoverageRate).toBe(1);
    expect(depth.softBlockingComments).toBe(5);
    // reviewDepthScore = 1.0 * (1 - 5/10) = 0.5
    expect(depth.reviewDepthScore).toBeCloseTo(0.5, 5);
  });

  it("clamps reviewDepthScore to 0 when softBlockingComments >= 10", () => {
    const comments: ReviewComment[] = Array.from({ length: 10 }, (_, i) =>
      makeComment("blocking", `src/file${i}.ts`, `Critical issue in this important security function that must be fixed`),
    );
    const depth = computeReviewDepth(comments, 10);
    expect(depth.softBlockingComments).toBe(10);
    // penalty factor = max(0, 1 - 10/10) = 0
    expect(depth.reviewDepthScore).toBe(0);
  });

  it("handles totalChangedFiles=0 without division by zero", () => {
    const comments: ReviewComment[] = [
      makeComment("suggestion", "src/utils.ts", "This function should handle null input gracefully"),
    ];
    const depth = computeReviewDepth(comments, 0);
    // denominator = max(1, 0) = 1, so coverage = 1/1 = 1.0
    expect(depth.fileCoverageRate).toBe(1);
    expect(depth.reviewDepthScore).toBe(1);
  });

  it("does not count comments without filePath toward file coverage", () => {
    const commentWithFile = makeComment("suggestion", "src/auth.ts", "This needs proper error handling logic here");
    const commentWithoutFile: ReviewComment = {
      id: "nf-1",
      type: "nitpick",
      category: "style",
      body: "General style comment about the overall approach used throughout",
      resolved: false,
      createdAt: new Date().toISOString(),
      // No filePath
    };
    const depth = computeReviewDepth([commentWithFile, commentWithoutFile], 4);
    // Only 1 file with substantive comment out of 4
    expect(depth.fileCoverageRate).toBeCloseTo(1 / 4, 5);
  });
});

// ---------------------------------------------------------------------------
// buildArchitectReviewResult
// ---------------------------------------------------------------------------

describe("buildArchitectReviewResult", () => {
  it("builds a complete ArchitectReviewResult from a plan", () => {
    const plan: ArchitectReviewPlan = {
      issues: [
        {
          severity: "critical",
          location: "src/auth.ts:45",
          category: "security",
          description: "SQL injection vulnerability in raw user input query",
          suggestedFix: "Use parameterized queries instead of string concatenation",
        },
        {
          severity: "major",
          location: "src/models.ts:12",
          category: "types",
          description: "Missing TypeScript return type annotation on public API function",
        },
      ],
      rawPlanText: "Review found 2 issues.",
      filesReviewed: ["src/auth.ts", "src/models.ts"],
      issueCount: 2,
      timestamp: new Date().toISOString(),
    };

    const result = buildArchitectReviewResult(plan, 3);

    expect(result.plan).toBe(plan);
    // auth.ts has a blocking comment (critical), models.ts has a suggestion
    expect(result.fileCoverageRate).toBeCloseTo(2 / 3, 5);
    expect(result.softBlockingComments).toBe(1); // one critical→blocking
    // reviewDepthScore = (2/3) * (1 - 1/10) = (2/3) * 0.9
    expect(result.reviewDepthScore).toBeCloseTo((2 / 3) * 0.9, 5);
  });

  it("returns reviewDepthScore=0 when no issues and totalChangedFiles > 0", () => {
    const plan: ArchitectReviewPlan = {
      issues: [],
      rawPlanText: "",
      filesReviewed: [],
      issueCount: 0,
      timestamp: new Date().toISOString(),
    };

    const result = buildArchitectReviewResult(plan, 5);
    expect(result.fileCoverageRate).toBe(0);
    expect(result.softBlockingComments).toBe(0);
    expect(result.reviewDepthScore).toBe(0);
  });

  it("achieves high reviewDepthScore for full coverage with no blocking", () => {
    const plan: ArchitectReviewPlan = {
      issues: [
        {
          severity: "minor",
          location: "src/a.ts:1",
          category: "style",
          description: "Minor style issue with variable naming convention throughout",
        },
        {
          severity: "minor",
          location: "src/b.ts:5",
          category: "naming",
          description: "Function name does not follow the established camelCase convention",
        },
        {
          severity: "minor",
          location: "src/c.ts:10",
          category: "docs",
          description: "Missing JSDoc comment for this exported public function",
        },
      ],
      rawPlanText: "3 minor issues",
      filesReviewed: ["src/a.ts", "src/b.ts", "src/c.ts"],
      issueCount: 3,
      timestamp: new Date().toISOString(),
    };

    const result = buildArchitectReviewResult(plan, 3);
    // 3 files covered, 3 total changed, no blocking → coverage=1, penalty=0 → score=1
    expect(result.fileCoverageRate).toBe(1);
    expect(result.softBlockingComments).toBe(0);
    expect(result.reviewDepthScore).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// End-to-end: parseArchitectIssues → architectToReviewComments → computeReviewDepth
// ---------------------------------------------------------------------------

describe("end-to-end reviewDepthScore pipeline", () => {
  it("produces correct depth from raw architect output text", () => {
    const architectOutput = [
      "ISSUE: severity=critical location=src/api.ts:88 category=security",
      "  description: Unvalidated redirect to user-supplied URL allows open redirect attacks",
      "  fix: Validate redirect targets against an allowlist",
      "",
      "ISSUE: severity=major location=src/utils.ts:22 category=performance",
      "  description: Synchronous file I/O blocks the event loop during request processing",
      "  fix: Use async fs.readFile instead of fs.readFileSync",
      "",
      "ISSUE: severity=minor location=src/config.ts:5 category=style",
      "  description: Configuration constants should use SCREAMING_SNAKE_CASE by convention",
      "",
    ].join("\n");

    const issues = parseArchitectIssues(architectOutput);
    const plan: ArchitectReviewPlan = {
      issues,
      rawPlanText: architectOutput,
      filesReviewed: ["src/api.ts", "src/utils.ts", "src/config.ts"],
      issueCount: issues.length,
      timestamp: new Date().toISOString(),
    };

    const comments = architectToReviewComments(plan);
    const depth = computeReviewDepth(comments, 4); // 4 changed files, 3 with comments

    expect(depth.fileCoverageRate).toBeCloseTo(3 / 4, 5);
    expect(depth.softBlockingComments).toBe(1); // critical → blocking
    // reviewDepthScore = (3/4) * (1 - 1/10) = 0.75 * 0.9 = 0.675
    expect(depth.reviewDepthScore).toBeCloseTo(0.675, 5);
  });
});
