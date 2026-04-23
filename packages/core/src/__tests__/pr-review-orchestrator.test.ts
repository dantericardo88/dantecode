// packages/core/src/__tests__/pr-review-orchestrator.test.ts
import { describe, it, expect, beforeEach } from "vitest";
import {
  generateReviewChecklist,
  classifyChangedFiles,
  classifyRisk,
  buildChangeImpact,
  buildReviewComment,
  scoreReview,
  computeVerdict,
  findStaleComments,
  generateReviewSummary,
  PrReviewOrchestrator,
  type ChangeImpact,
  type ReviewComment,
} from "../pr-review-orchestrator.js";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeImpact(overrides: Partial<ChangeImpact> = {}): ChangeImpact {
  return {
    risk: "low",
    fileCount: 3,
    linesAdded: 50,
    linesDeleted: 10,
    touchesPublicApi: false,
    hasTestChanges: true,
    hasMigrations: false,
    touchesSecurityCode: false,
    ...overrides,
  };
}

function makeComment(type: ReviewComment["type"] = "suggestion"): ReviewComment {
  return buildReviewComment(type, "logic", `Test comment (${type})`, {
    filePath: "src/foo.ts",
    line: 42,
  });
}

// ─── generateReviewChecklist ──────────────────────────────────────────────────

describe("generateReviewChecklist", () => {
  it("generates at least 10 checklist items", () => {
    expect(generateReviewChecklist().length).toBeGreaterThanOrEqual(10);
  });

  it("adds migration item when hasMigrations=true", () => {
    const items = generateReviewChecklist({ hasMigrations: true });
    expect(items.some((i) => i.description.toLowerCase().includes("migration"))).toBe(true);
  });

  it("adds API compatibility item when touchesPublicApi=true", () => {
    const items = generateReviewChecklist({ touchesPublicApi: true });
    expect(items.some((i) => i.category === "breaking-change")).toBe(true);
  });

  it("every item has id, category, description", () => {
    for (const item of generateReviewChecklist()) {
      expect(item.id).toBeTruthy();
      expect(item.category).toBeTruthy();
      expect(item.description).toBeTruthy();
    }
  });
});

// ─── classifyChangedFiles ─────────────────────────────────────────────────────

describe("classifyChangedFiles", () => {
  it("detects test files", () => {
    const result = classifyChangedFiles(["src/foo.test.ts", "src/bar.ts"]);
    expect(result.hasTestChanges).toBe(true);
  });

  it("detects migration files", () => {
    const result = classifyChangedFiles(["db/migrations/20241201_add_users.sql"]);
    expect(result.hasMigrations).toBe(true);
  });

  it("detects public API (index.ts)", () => {
    const result = classifyChangedFiles(["packages/core/src/index.ts"]);
    expect(result.touchesPublicApi).toBe(true);
  });

  it("detects security-sensitive files", () => {
    const result = classifyChangedFiles(["src/auth/token-validator.ts"]);
    expect(result.touchesSecurityCode).toBe(true);
  });

  it("returns false for normal source files", () => {
    const result = classifyChangedFiles(["src/utils/string.ts"]);
    expect(result.touchesPublicApi).toBe(false);
    expect(result.hasMigrations).toBe(false);
    expect(result.touchesSecurityCode).toBe(false);
  });
});

// ─── classifyRisk ─────────────────────────────────────────────────────────────

describe("classifyRisk", () => {
  it("returns critical for security code changes", () => {
    expect(classifyRisk({ ...makeImpact(), touchesSecurityCode: true })).toBe("critical");
  });

  it("returns high for migration changes", () => {
    expect(classifyRisk({ ...makeImpact(), hasMigrations: true })).toBe("high");
  });

  it("returns high for large changesets", () => {
    expect(classifyRisk({ ...makeImpact(), linesAdded: 400, linesDeleted: 200 })).toBe("high");
  });

  it("returns low for small changes", () => {
    // 60+10=70 > 50 → low
    expect(classifyRisk({ ...makeImpact(), linesAdded: 60, linesDeleted: 10 })).toBe("low");
  });

  it("returns trivial for tiny changes", () => {
    expect(classifyRisk({ ...makeImpact(), linesAdded: 5, linesDeleted: 2 })).toBe("trivial");
  });
});

// ─── buildChangeImpact ────────────────────────────────────────────────────────

describe("buildChangeImpact", () => {
  it("builds impact with correct file count", () => {
    const impact = buildChangeImpact(["a.ts", "b.ts"], 100, 20);
    expect(impact.fileCount).toBe(2);
    expect(impact.linesAdded).toBe(100);
    expect(impact.linesDeleted).toBe(20);
  });

  it("infers risk from file classification", () => {
    const impact = buildChangeImpact(["src/auth.ts"], 10, 5);
    expect(impact.risk).toBe("critical");
    expect(impact.touchesSecurityCode).toBe(true);
  });
});

// ─── buildReviewComment ───────────────────────────────────────────────────────

describe("buildReviewComment", () => {
  it("creates comment with correct fields", () => {
    const cmt = buildReviewComment("blocking", "security", "XSS vulnerability", { filePath: "src/ui.tsx", line: 10 });
    expect(cmt.type).toBe("blocking");
    expect(cmt.category).toBe("security");
    expect(cmt.body).toBe("XSS vulnerability");
    expect(cmt.filePath).toBe("src/ui.tsx");
    expect(cmt.line).toBe(10);
    expect(cmt.resolved).toBe(false);
    expect(cmt.id).toBeTruthy();
  });
});

// ─── scoreReview ─────────────────────────────────────────────────────────────

describe("scoreReview", () => {
  it("returns high overall score for clean review", () => {
    const score = scoreReview({
      prTitle: "Add feature",
      verdict: "approved",
      impact: makeImpact(),
      comments: [],
      checklist: [],
    });
    expect(score.overall).toBeGreaterThanOrEqual(7);
  });

  it("penalizes unchecked checklist items", () => {
    const checklist = generateReviewChecklist().map((c) => c); // no .passed set
    const score = scoreReview({
      prTitle: "PR",
      verdict: "draft",
      impact: makeImpact(),
      comments: [],
      checklist,
    });
    expect(score.coverage).toBeLessThan(10);
  });

  it("returns 0–10 range for all scores", () => {
    const score = scoreReview({
      prTitle: "PR",
      verdict: "draft",
      impact: makeImpact(),
      comments: [makeComment("blocking")],
      checklist: generateReviewChecklist(),
    });
    const values = Object.values(score);
    values.forEach((v) => {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(10);
    });
  });
});

// ─── computeVerdict ───────────────────────────────────────────────────────────

describe("computeVerdict", () => {
  it("returns changes-required for unresolved blocking comment", () => {
    const cmt = buildReviewComment("blocking", "logic", "Must fix");
    const verdict = computeVerdict([cmt], makeImpact(), []);
    expect(verdict).toBe("changes-required");
  });

  it("returns approved when no blocking comments", () => {
    const cmt = buildReviewComment("suggestion", "style", "Consider renaming");
    const verdict = computeVerdict([cmt], makeImpact(), []);
    expect(verdict).toBe("approved");
  });

  it("returns needs-discussion for high risk with unresolved questions", () => {
    const cmt = buildReviewComment("question", "logic", "Why this approach?");
    const verdict = computeVerdict([cmt], makeImpact({ risk: "high" }), []);
    expect(verdict).toBe("needs-discussion");
  });

  it("returns changes-required for failed security checklist", () => {
    const checklist = generateReviewChecklist().map((c) => ({
      ...c,
      passed: c.category === "security" ? false : true,
    }));
    const verdict = computeVerdict([], makeImpact(), checklist);
    expect(verdict).toBe("changes-required");
  });
});

// ─── findStaleComments ────────────────────────────────────────────────────────

describe("findStaleComments", () => {
  it("returns comments older than maxDays", () => {
    const old = buildReviewComment("suggestion", "style", "Old comment");
    // Manually set old date
    (old as unknown as { createdAt: string }).createdAt = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString();
    const fresh = buildReviewComment("suggestion", "style", "Fresh comment");
    const stale = findStaleComments([old, fresh], 7);
    expect(stale).toContain(old);
    expect(stale).not.toContain(fresh);
  });

  it("returns empty when no stale comments", () => {
    const fresh = buildReviewComment("suggestion", "style", "Fresh");
    expect(findStaleComments([fresh], 7)).toHaveLength(0);
  });

  it("excludes resolved comments from stale list", () => {
    const old = buildReviewComment("suggestion", "style", "Old resolved");
    old.resolved = true;
    (old as unknown as { createdAt: string }).createdAt = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString();
    expect(findStaleComments([old], 7)).toHaveLength(0);
  });
});

// ─── generateReviewSummary ────────────────────────────────────────────────────

describe("generateReviewSummary", () => {
  it("includes verdict in summary", () => {
    const summary = generateReviewSummary({
      verdict: "approved",
      impact: makeImpact(),
      comments: [],
      checklist: [],
      score: { overall: 9, coverage: 9, signalToNoise: 9, actionability: 9, resolutionRate: 10 },
    });
    expect(summary).toContain("APPROVED");
  });

  it("shows blocking issue count", () => {
    const cmt = buildReviewComment("blocking", "security", "XSS");
    const summary = generateReviewSummary({
      verdict: "changes-required",
      impact: makeImpact(),
      comments: [cmt],
      checklist: [],
      score: { overall: 5, coverage: 5, signalToNoise: 5, actionability: 5, resolutionRate: 5 },
    });
    expect(summary).toContain("blocking");
  });

  it("shows public API warning when relevant", () => {
    const summary = generateReviewSummary({
      verdict: "needs-discussion",
      impact: makeImpact({ touchesPublicApi: true }),
      comments: [],
      checklist: [],
      score: { overall: 7, coverage: 7, signalToNoise: 7, actionability: 7, resolutionRate: 7 },
    });
    expect(summary).toContain("Public API");
  });
});

// ─── PrReviewOrchestrator ─────────────────────────────────────────────────────

describe("PrReviewOrchestrator", () => {
  let orchestrator: PrReviewOrchestrator;

  beforeEach(() => { orchestrator = new PrReviewOrchestrator(); });

  it("createReview returns a review with draft verdict", () => {
    const review = orchestrator.createReview("Add feature", ["src/foo.ts"], 50, 10);
    expect(review.verdict).toBe("draft");
    expect(review.id).toBeTruthy();
  });

  it("addComment updates verdict to changes-required on blocking", () => {
    const review = orchestrator.createReview("PR", ["src/a.ts"], 10, 2);
    const cmt = buildReviewComment("blocking", "logic", "Must fix");
    orchestrator.addComment(review.id, cmt);
    expect(orchestrator.getReview(review.id)!.verdict).toBe("changes-required");
  });

  it("resolveComment marks comment as resolved", () => {
    const review = orchestrator.createReview("PR", ["src/a.ts"], 10, 2);
    const cmt = buildReviewComment("blocking", "logic", "Fix this");
    orchestrator.addComment(review.id, cmt);
    orchestrator.resolveComment(review.id, cmt.id);
    const updated = orchestrator.getReview(review.id)!;
    expect(updated.comments[0]!.resolved).toBe(true);
  });

  it("resolveComment changes verdict to approved when all blockers resolved", () => {
    const review = orchestrator.createReview("PR", ["src/a.ts"], 10, 2);
    const cmt = buildReviewComment("blocking", "logic", "Fix");
    orchestrator.addComment(review.id, cmt);
    orchestrator.resolveComment(review.id, cmt.id);
    expect(orchestrator.getReview(review.id)!.verdict).toBe("approved");
  });

  it("updateChecklistItem marks item passed", () => {
    const review = orchestrator.createReview("PR", [], 5, 1);
    const item = review.checklist[0]!;
    orchestrator.updateChecklistItem(review.id, item.id, true, "Verified in code");
    expect(orchestrator.getReview(review.id)!.checklist[0]!.passed).toBe(true);
  });

  it("formatForPrompt returns summary text", () => {
    const review = orchestrator.createReview("PR", ["src/auth.ts"], 30, 5);
    const out = orchestrator.formatForPrompt(review.id);
    expect(out).toContain("PR Review Summary");
  });

  it("totalReviews tracks created reviews", () => {
    orchestrator.createReview("PR 1", [], 10, 2);
    orchestrator.createReview("PR 2", [], 20, 3);
    expect(orchestrator.totalReviews).toBe(2);
  });
});
