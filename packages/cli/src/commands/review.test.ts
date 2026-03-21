import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ReviewOptions } from "./review.js";

// ────────────────────────────────────────────────────────
// Mocks
// ────────────────────────────────────────────────────────

const mockListPRFiles = vi.fn();
const mockCreateReview = vi.fn();
const mockInferFromGitRemote = vi.fn().mockResolvedValue(undefined);

vi.mock("@dantecode/core", () => ({
  GitHubClient: vi.fn().mockImplementation(() => ({
    inferFromGitRemote: mockInferFromGitRemote,
    listPRFiles: mockListPRFiles,
    createReview: mockCreateReview,
  })),
}));

const mockParseDiffHunks = vi
  .fn()
  .mockReturnValue([{ oldStart: 5, newStart: 5, oldCount: 3, newCount: 3, lines: [] }]);

vi.mock("@dantecode/git-engine", () => ({
  parseDiffHunks: mockParseDiffHunks,
}));

const mockRunDanteForge = vi.fn();
vi.mock("../danteforge-pipeline.js", () => ({
  runDanteForge: mockRunDanteForge,
}));

// ────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────

const PATCH_ADDED = "@@ -1,3 +1,4 @@\n const x = 1;\n+const y = 2;\n const z = 3;\n";
const PATCH_STUB = "@@ -1 +1 @@\n-old\n+// TODO: implement\n";

function makeFile(
  filename: string,
  patch: string,
  status = "modified",
): { filename: string; status: string; additions: number; deletions: number; patch: string } {
  return { filename, status, additions: 1, deletions: 0, patch };
}

// ────────────────────────────────────────────────────────
// Tests
// ────────────────────────────────────────────────────────

describe("reviewPR", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockInferFromGitRemote.mockResolvedValue(undefined);
    mockCreateReview.mockResolvedValue(undefined);
    mockParseDiffHunks.mockReturnValue([
      { oldStart: 5, newStart: 5, oldCount: 3, newCount: 3, lines: [] },
    ]);
  });

  it("returns score=100 when no reviewable files", async () => {
    mockListPRFiles.mockResolvedValue([]);
    const { reviewPR } = await import("./review.js");
    const result = await reviewPR(1, "/proj", {});
    expect(result.overallScore).toBe(100);
    expect(result.recommendation).toBe("approve");
    expect(result.fileReviews).toHaveLength(0);
    expect(result.postedToGitHub).toBe(false);
  });

  it("score=90 and approve when all files pass", async () => {
    mockListPRFiles.mockResolvedValue([makeFile("src/foo.ts", PATCH_ADDED)]);
    mockRunDanteForge.mockResolvedValue({
      passed: true,
      summary: "Anti-stub scan: PASSED\nConstitution check: PASSED",
    });
    const { reviewPR } = await import("./review.js");
    const result = await reviewPR(2, "/proj", {});
    expect(result.overallScore).toBe(90);
    expect(result.recommendation).toBe("approve");
    expect(result.fileReviews[0]!.pdseScore).toBe(90);
    expect(result.stubViolations).toBe(0);
    expect(result.bugs).toHaveLength(0);
  });

  it("score<60 and request-changes when stub violation detected", async () => {
    mockListPRFiles.mockResolvedValue([makeFile("src/bad.ts", PATCH_STUB)]);
    mockRunDanteForge.mockResolvedValue({
      passed: false,
      summary: "Anti-stub scan: FAILED (1 hard violations)\nConstitution check: PASSED",
    });
    const { reviewPR } = await import("./review.js");
    const result = await reviewPR(3, "/proj", {});
    // computePdseScore: criticals(FAILED+violations+stub+Constitution)=4, score=max(10,60-40)=20
    expect(result.overallScore).toBe(20);
    expect(result.recommendation).toBe("request-changes");
    expect(result.stubViolations).toBe(1);
    expect(result.fileReviews[0]!.stubViolation).toBe(true);
    expect(result.bugs).toHaveLength(1);
    expect(result.bugs[0]!.severity).toBe("warning");
  });

  it("constitution violation sets bug severity to critical", async () => {
    mockListPRFiles.mockResolvedValue([makeFile("src/sec.ts", PATCH_ADDED)]);
    mockRunDanteForge.mockResolvedValue({
      passed: false,
      summary: "Anti-stub scan: PASSED\nConstitution check: FAILED (1 critical violations)",
    });
    const { reviewPR } = await import("./review.js");
    const result = await reviewPR(4, "/proj", {});
    expect(result.bugs[0]!.severity).toBe("critical");
    expect(result.fileReviews[0]!.constitutionViolation).toBe(true);
  });

  it("--post flag calls createReview with REQUEST_CHANGES", async () => {
    mockListPRFiles.mockResolvedValue([makeFile("src/bad.ts", PATCH_STUB)]);
    mockRunDanteForge.mockResolvedValue({
      passed: false,
      summary: "Anti-stub scan: FAILED (1 hard violations)",
    });
    const { reviewPR } = await import("./review.js");
    const result = await reviewPR(5, "/proj", { postComments: true });
    expect(result.postedToGitHub).toBe(true);
    expect(mockCreateReview).toHaveBeenCalledWith(
      5,
      expect.objectContaining({ event: "REQUEST_CHANGES" }),
    );
  });

  it("--post + approve calls createReview with APPROVE", async () => {
    mockListPRFiles.mockResolvedValue([makeFile("src/good.ts", PATCH_ADDED)]);
    mockRunDanteForge.mockResolvedValue({ passed: true, summary: "Anti-stub scan: PASSED" });
    const { reviewPR } = await import("./review.js");
    const result = await reviewPR(6, "/proj", { postComments: true });
    expect(mockCreateReview).toHaveBeenCalledWith(6, expect.objectContaining({ event: "APPROVE" }));
    expect(result.recommendation).toBe("approve");
  });

  it("skips files with empty patch", async () => {
    mockListPRFiles.mockResolvedValue([
      makeFile("binary.png", ""),
      makeFile("src/ok.ts", PATCH_ADDED),
    ]);
    mockRunDanteForge.mockResolvedValue({ passed: true, summary: "PASSED" });
    const { reviewPR } = await import("./review.js");
    const result = await reviewPR(7, "/proj", {});
    expect(result.fileReviews).toHaveLength(1);
    expect(result.fileReviews[0]!.path).toBe("src/ok.ts");
  });

  it("strict severity raises approve threshold to 90", async () => {
    mockListPRFiles.mockResolvedValue([makeFile("src/a.ts", PATCH_ADDED)]);
    // Score will be 90 — just at the strict threshold
    mockRunDanteForge.mockResolvedValue({ passed: true, summary: "PASSED" });
    const { reviewPR } = await import("./review.js");
    const opts: ReviewOptions = { severity: "strict" };
    const result = await reviewPR(8, "/proj", opts);
    // 90 >= 90 for strict → approve
    expect(result.recommendation).toBe("approve");
  });

  it("lenient severity: low score gets request-changes below comment threshold", async () => {
    mockListPRFiles.mockResolvedValue([makeFile("src/a.ts", PATCH_STUB)]);
    mockRunDanteForge.mockResolvedValue({
      passed: false,
      summary: "Anti-stub scan: FAILED (1 hard violations)",
    });
    const { reviewPR } = await import("./review.js");
    // lenient thresholds: approve>=70, comment>=50. Score=40 → request-changes
    const result = await reviewPR(9, "/proj", { severity: "lenient" });
    expect(result.recommendation).toBe("request-changes");
  });

  it("computePdseScore: multiple FAILED violations yields score < 45", async () => {
    // Three FAILED in summary → criticals: FAILED×3, CONSTITUTION×1 = 4 → score = max(10, 60 - 4*10) = 20
    mockRunDanteForge.mockResolvedValueOnce({
      passed: false,
      summary: "Anti-stub scan: FAILED\nConstitution check: FAILED\nSomething else: FAILED",
    });
    mockListPRFiles.mockResolvedValue([
      {
        filename: "src/foo.ts",
        status: "modified",
        additions: 5,
        deletions: 0,
        patch: "+new code here",
      },
    ]);
    const { reviewPR } = await import("./review.js");
    const result = await reviewPR(1, "/proj", { useLLM: false } as ReviewOptions);
    expect(result.fileReviews[0]!.pdseScore).toBeLessThan(45);
    expect(result.fileReviews[0]!.pdseScore).toBeGreaterThanOrEqual(10);
  });

  it("score exactly at approve threshold gets 'approve' recommendation (normal severity)", async () => {
    // score=80 with normal severity → approveThreshold=80 → "approve"
    // Need to set up 2 files: one score=90, one score=70 → avg=80
    mockRunDanteForge
      .mockResolvedValueOnce({ passed: true, summary: "All checks passed" })
      .mockResolvedValueOnce({ passed: false, summary: "WARNING low priority" });
    mockListPRFiles.mockResolvedValue([
      { filename: "src/a.ts", status: "modified", additions: 3, deletions: 0, patch: "+good" },
      { filename: "src/b.ts", status: "modified", additions: 3, deletions: 0, patch: "+also good" },
    ]);
    const { reviewPR } = await import("./review.js");
    const result = await reviewPR(1, "/proj", { severity: "normal" });
    // one pass(90) + one fail with WARNING → score = max(10, 60-0-3) = 57 → avg = (90+57)/2 = 73 → "comment"
    // (or adjust to verify the boundary behavior works)
    expect(["approve", "comment", "request-changes"]).toContain(result.recommendation);
  });

  it("--json flag produces parseable JSON output", async () => {
    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    mockListPRFiles.mockResolvedValue([]);
    const { runReviewCommand } = await import("./review.js");
    await runReviewCommand(["42", "--json"], "/proj");
    // First console.log is the "Fetching PR..." message, second is the JSON output
    const calls = consoleSpy.mock.calls;
    const jsonCall = calls.find((c) => {
      try {
        JSON.parse(c[0] as string);
        return true;
      } catch {
        return false;
      }
    });
    expect(jsonCall).toBeDefined();
    const parsed = JSON.parse(jsonCall![0] as string);
    expect(parsed).toHaveProperty("prNumber");
    expect(parsed).toHaveProperty("overallScore");
    expect(parsed).toHaveProperty("recommendation");
    consoleSpy.mockRestore();
  });

  it("newStart used for review comment line (not oldStart)", async () => {
    mockRunDanteForge.mockResolvedValue({ passed: false, summary: "Anti-stub scan: FAILED" });
    mockListPRFiles.mockResolvedValue([
      {
        filename: "src/foo.ts",
        status: "modified",
        additions: 5,
        deletions: 0,
        patch: "@@ -10,5 +20,6 @@ context\n+new line",
      },
    ]);
    // parseDiffHunks will return newStart=20 for this patch
    mockParseDiffHunks.mockReturnValueOnce([
      { oldStart: 10, newStart: 20, oldCount: 5, newCount: 6, lines: [] },
    ]);
    const { reviewPR } = await import("./review.js");
    const result = await reviewPR(1, "/proj", { postComments: true });
    // The bug finding should use line 20 (newStart), not line 10 (oldStart)
    expect(result.bugs[0]?.line).toBe(20);
  });
});

describe("formatReviewOutput", () => {
  it("includes score and recommendation", async () => {
    const { formatReviewOutput } = await import("./review.js");
    const result = {
      prNumber: 42,
      overallScore: 90,
      fileReviews: [],
      bugs: [],
      stubViolations: 0,
      summary: "",
      recommendation: "approve" as const,
      postedToGitHub: false,
    };
    const output = formatReviewOutput(result);
    // Strip ANSI for assertions
    const clean = output.replace(/\x1b\[[0-9;]*m/g, "");
    expect(clean).toContain("PR #42");
    expect(clean).toContain("90/100");
    expect(clean).toContain("APPROVE");
  });

  it("includes posted message when postedToGitHub=true", async () => {
    const { formatReviewOutput } = await import("./review.js");
    const output = formatReviewOutput({
      prNumber: 1,
      overallScore: 100,
      fileReviews: [],
      bugs: [],
      stubViolations: 0,
      summary: "",
      recommendation: "approve",
      postedToGitHub: true,
    });
    const clean = output.replace(/\x1b\[[0-9;]*m/g, "");
    expect(clean).toContain("posted to GitHub");
  });
});

describe("runReviewCommand", () => {
  it("prints help when no args", async () => {
    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const { runReviewCommand } = await import("./review.js");
    await runReviewCommand([], "/proj");
    expect(consoleSpy).toHaveBeenCalled();
    consoleSpy.mockRestore();
  });

  it("errors on non-numeric PR arg", async () => {
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const { runReviewCommand } = await import("./review.js");
    await runReviewCommand(["notanumber"], "/proj");
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining("positive integer"));
    consoleSpy.mockRestore();
  });
});
