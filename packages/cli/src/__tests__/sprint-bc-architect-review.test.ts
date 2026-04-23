// ============================================================================
// Sprint BC — Dim 18: Two-pass Architect PR Review tests
// Tests:
//  1. parseArchitectIssues parses ISSUE: format correctly
//  2. parseArchitectIssues handles markdown list format
//  3. parseArchitectIssues returns empty array for non-matching text
//  4. parseArchitectIssues extracts location file and line correctly
//  5. architectToReviewComments maps critical→blocking, major→suggestion, minor→nitpick
//  6. architectToReviewComments extracts filePath from location
//  7. buildArchitectReviewPrompt returns non-empty string mentioning severity levels
//  8. buildEditorReviewPrompt contains the architect output in result
//  9. recordArchitectReviewPlan creates .danteforge/architect-review-log.json
// 10. getArchitectReviewStats returns correct criticalRate and topCategory
// ============================================================================

import { describe, it, expect } from "vitest";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import {
  parseArchitectIssues,
  architectToReviewComments,
  buildArchitectReviewPrompt,
  buildEditorReviewPrompt,
  recordArchitectReviewPlan,
  loadArchitectReviewLog,
  getArchitectReviewStats,
} from "@dantecode/core";
import type { ArchitectReviewPlan } from "@dantecode/core";

function makeDir(): string {
  const dir = join(tmpdir(), `sprint-bc-${randomUUID()}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

function makePlan(overrides: Partial<ArchitectReviewPlan> = {}): ArchitectReviewPlan {
  return {
    issues: [],
    rawPlanText: "",
    filesReviewed: [],
    issueCount: 0,
    timestamp: new Date().toISOString(),
    ...overrides,
  };
}

// ─── Test 1: parseArchitectIssues parses ISSUE: format correctly ──────────────
describe("parseArchitectIssues — ISSUE: structured format", () => {
  it("parses a single ISSUE block with description and fix", () => {
    const input = `ISSUE: severity=critical location=src/auth.ts:45 category=security
  description: SQL injection via unescaped user input
  fix: Use parameterized queries`;

    const issues = parseArchitectIssues(input);
    expect(issues).toHaveLength(1);
    expect(issues[0]?.severity).toBe("critical");
    expect(issues[0]?.location).toBe("src/auth.ts:45");
    expect(issues[0]?.category).toBe("security");
    expect(issues[0]?.description).toContain("SQL injection");
    expect(issues[0]?.suggestedFix).toContain("parameterized");
  });

  it("parses multiple ISSUE blocks", () => {
    const input = `ISSUE: severity=major location=src/service.ts:10 category=logic
  description: Off-by-one error in loop
  fix: Change < to <=

ISSUE: severity=minor location=src/utils.ts category=style
  description: Missing trailing newline
  fix: Add newline`;

    const issues = parseArchitectIssues(input);
    expect(issues).toHaveLength(2);
    expect(issues[0]?.severity).toBe("major");
    expect(issues[1]?.severity).toBe("minor");
    expect(issues[1]?.location).toBe("src/utils.ts");
  });
});

// ─── Test 2: parseArchitectIssues handles markdown list format ────────────────
describe("parseArchitectIssues — markdown list format", () => {
  it("parses bold markdown list items", () => {
    const input = `- **critical** (security, auth.ts:45): SQL injection via unescaped input
- **major** (logic, service.ts:10): Off-by-one error in loop
- **minor** (style, utils.ts): Missing trailing newline`;

    const issues = parseArchitectIssues(input);
    expect(issues).toHaveLength(3);
    expect(issues[0]?.severity).toBe("critical");
    expect(issues[0]?.category).toBe("security");
    expect(issues[1]?.severity).toBe("major");
    expect(issues[2]?.severity).toBe("minor");
  });

  it("parses plain markdown list items (no bold)", () => {
    const input = `- critical (security, auth.ts:99): Hardcoded credentials`;
    const issues = parseArchitectIssues(input);
    expect(issues).toHaveLength(1);
    expect(issues[0]?.severity).toBe("critical");
    expect(issues[0]?.description).toContain("Hardcoded credentials");
  });
});

// ─── Test 3: returns empty array for non-matching text ───────────────────────
describe("parseArchitectIssues — non-matching text", () => {
  it("returns empty array for plain prose", () => {
    const input = "This code looks good overall. No issues found. Great work!";
    const issues = parseArchitectIssues(input);
    expect(issues).toHaveLength(0);
  });

  it("returns empty array for empty string", () => {
    expect(parseArchitectIssues("")).toHaveLength(0);
  });
});

// ─── Test 4: extracts location file and line correctly ───────────────────────
describe("parseArchitectIssues — location extraction", () => {
  it("extracts file and line from location=file:line", () => {
    const input = `ISSUE: severity=major location=packages/core/src/foo.ts:123 category=logic
  description: Incorrect null check`;

    const issues = parseArchitectIssues(input);
    expect(issues[0]?.location).toBe("packages/core/src/foo.ts:123");
  });

  it("handles location with no line number", () => {
    const input = `ISSUE: severity=minor location=src/bar.ts category=style
  description: Formatting issue`;

    const issues = parseArchitectIssues(input);
    expect(issues[0]?.location).toBe("src/bar.ts");
  });
});

// ─── Test 5: architectToReviewComments severity mapping ──────────────────────
describe("architectToReviewComments — severity → type mapping", () => {
  it("maps critical→blocking, major→suggestion, minor→nitpick", () => {
    const plan = makePlan({
      issues: [
        { severity: "critical", location: "src/a.ts:1", category: "security", description: "Severe issue" },
        { severity: "major", location: "src/b.ts:2", category: "logic", description: "Medium issue" },
        { severity: "minor", location: "src/c.ts:3", category: "style", description: "Small issue" },
      ],
      issueCount: 3,
    });

    const comments = architectToReviewComments(plan);
    expect(comments).toHaveLength(3);
    expect(comments[0]?.type).toBe("blocking");
    expect(comments[1]?.type).toBe("suggestion");
    expect(comments[2]?.type).toBe("nitpick");
  });

  it("includes suggestedFix in body when present", () => {
    const plan = makePlan({
      issues: [
        {
          severity: "critical",
          location: "src/a.ts:10",
          category: "security",
          description: "XSS vulnerability",
          suggestedFix: "Sanitize HTML output",
        },
      ],
      issueCount: 1,
    });
    const comments = architectToReviewComments(plan);
    expect(comments[0]?.body).toContain("XSS vulnerability");
    expect(comments[0]?.body).toContain("Sanitize HTML output");
  });
});

// ─── Test 6: architectToReviewComments extracts filePath from location ────────
describe("architectToReviewComments — filePath extraction", () => {
  it("splits location into filePath and line", () => {
    const plan = makePlan({
      issues: [
        { severity: "major", location: "src/service.ts:77", category: "logic", description: "Bad logic" },
      ],
      issueCount: 1,
    });
    const comments = architectToReviewComments(plan);
    expect(comments[0]?.filePath).toBe("src/service.ts");
    expect(comments[0]?.line).toBe(77);
  });

  it("handles location with no line number — sets filePath only", () => {
    const plan = makePlan({
      issues: [
        { severity: "minor", location: "src/utils.ts", category: "style", description: "Style issue" },
      ],
      issueCount: 1,
    });
    const comments = architectToReviewComments(plan);
    expect(comments[0]?.filePath).toBe("src/utils.ts");
    expect(comments[0]?.line).toBeUndefined();
  });
});

// ─── Test 7: buildArchitectReviewPrompt returns non-empty string ──────────────
describe("buildArchitectReviewPrompt", () => {
  it("returns non-empty string mentioning severity levels", () => {
    const prompt = buildArchitectReviewPrompt("+ const x = 1;\n- const y = 2;", ["src/foo.ts"]);
    expect(prompt.length).toBeGreaterThan(50);
    expect(prompt).toContain("critical");
    expect(prompt).toContain("major");
    expect(prompt).toContain("minor");
  });

  it("includes changed files in the prompt", () => {
    const prompt = buildArchitectReviewPrompt("diff", ["src/auth.ts", "src/api.ts"]);
    expect(prompt).toContain("src/auth.ts");
    expect(prompt).toContain("src/api.ts");
  });

  it("includes the diff summary", () => {
    const diffSummary = "unique-diff-content-xyz";
    const prompt = buildArchitectReviewPrompt(diffSummary, []);
    expect(prompt).toContain(diffSummary);
  });
});

// ─── Test 8: buildEditorReviewPrompt contains architect output ────────────────
describe("buildEditorReviewPrompt", () => {
  it("contains the architect output verbatim", () => {
    const architectOutput = "ISSUE: severity=critical location=auth.ts:1 category=security\n  description: Bad auth";
    const result = buildEditorReviewPrompt(architectOutput, "some diff");
    expect(result).toContain(architectOutput);
  });

  it("mentions output format (COMMENT:)", () => {
    const result = buildEditorReviewPrompt("some findings", "some diff");
    expect(result).toContain("COMMENT:");
  });
});

// ─── Test 9: recordArchitectReviewPlan creates log file ──────────────────────
describe("recordArchitectReviewPlan", () => {
  it("creates .danteforge/architect-review-log.json", () => {
    const dir = makeDir();
    const plan = makePlan({
      issues: [
        { severity: "critical", location: "src/a.ts:1", category: "security", description: "Issue A" },
      ],
      issueCount: 1,
      filesReviewed: ["src/a.ts"],
      rawPlanText: "ISSUE: severity=critical ...",
    });

    recordArchitectReviewPlan(plan, dir);

    const logPath = join(dir, ".danteforge", "architect-review-log.json");
    expect(existsSync(logPath)).toBe(true);

    const raw = readFileSync(logPath, "utf-8").trim();
    const parsed = JSON.parse(raw) as ArchitectReviewPlan;
    expect(parsed.issueCount).toBe(1);
    expect(parsed.issues[0]?.severity).toBe("critical");
  });

  it("loadArchitectReviewLog reads multiple entries", () => {
    const dir = makeDir();
    const plan1 = makePlan({ issueCount: 1, issues: [{ severity: "major", location: "a.ts", category: "logic", description: "D1" }] });
    const plan2 = makePlan({ issueCount: 2, issues: [
      { severity: "critical", location: "b.ts:5", category: "security", description: "D2" },
      { severity: "minor", location: "c.ts:10", category: "style", description: "D3" },
    ] });

    recordArchitectReviewPlan(plan1, dir);
    recordArchitectReviewPlan(plan2, dir);

    const loaded = loadArchitectReviewLog(dir);
    expect(loaded).toHaveLength(2);
    expect(loaded[0]?.issueCount).toBe(1);
    expect(loaded[1]?.issueCount).toBe(2);
  });
});

// ─── Test 10: getArchitectReviewStats ─────────────────────────────────────────
describe("getArchitectReviewStats", () => {
  it("returns correct criticalRate", () => {
    const plans: ArchitectReviewPlan[] = [
      makePlan({
        issueCount: 3,
        issues: [
          { severity: "critical", location: "a.ts", category: "security", description: "d1" },
          { severity: "major", location: "b.ts", category: "logic", description: "d2" },
          { severity: "minor", location: "c.ts", category: "style", description: "d3" },
        ],
      }),
    ];
    const stats = getArchitectReviewStats(plans);
    expect(stats.criticalRate).toBeCloseTo(1 / 3);
    expect(stats.totalReviews).toBe(1);
    expect(stats.avgIssueCount).toBe(3);
  });

  it("returns correct topCategory", () => {
    const plans: ArchitectReviewPlan[] = [
      makePlan({
        issueCount: 4,
        issues: [
          { severity: "critical", location: "a.ts", category: "security", description: "d1" },
          { severity: "critical", location: "b.ts", category: "security", description: "d2" },
          { severity: "major", location: "c.ts", category: "logic", description: "d3" },
          { severity: "minor", location: "d.ts", category: "security", description: "d4" },
        ],
      }),
    ];
    const stats = getArchitectReviewStats(plans);
    expect(stats.topCategory).toBe("security");
  });

  it("returns zero stats for empty plans array", () => {
    const stats = getArchitectReviewStats([]);
    expect(stats.totalReviews).toBe(0);
    expect(stats.avgIssueCount).toBe(0);
    expect(stats.criticalRate).toBe(0);
    expect(stats.topCategory).toBe("");
  });
});
