import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockFetchPrDiff,
  mockFetchPrMeta,
  mockReviewPullRequest,
  mockRecordReviewOutcome,
} = vi.hoisted(() => ({
  mockFetchPrDiff: vi.fn(),
  mockFetchPrMeta: vi.fn(),
  mockReviewPullRequest: vi.fn(),
  mockRecordReviewOutcome: vi.fn(),
}));

vi.mock("@dantecode/core", () => ({
  fetchPrDiff: mockFetchPrDiff,
  fetchPrMeta: mockFetchPrMeta,
  reviewPullRequest: mockReviewPullRequest,
}));

vi.mock("@dantecode/danteforge", () => ({
  recordReviewOutcome: mockRecordReviewOutcome,
}));

import { cmdReview, fetchPrDiff, fetchPrMeta } from "../commands/review.js";

describe("PR review CLI wiring", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFetchPrDiff.mockReturnValue("diff --git a/src/foo.ts b/src/foo.ts\n+const x = 1;");
    mockFetchPrMeta.mockReturnValue({
      title: "Add feature",
      additions: 20,
      deletions: 5,
      files: ["src/feature.ts", "src/feature.test.ts"],
      url: "https://github.com/owner/repo/pull/1",
    });
    mockReviewPullRequest.mockResolvedValue({
      prNumber: 1,
      verdict: "changes-required",
      score: 7.1,
      summary: "Review complete",
      checklistPassed: 2,
      checklistTotal: 3,
      rawPrompt: "## PR Review Summary\n\n## PR Diff Evidence",
      comments: [
        { type: "blocking", category: "security", resolved: false },
        { type: "suggestion", category: "tests", resolved: true },
      ],
    });
  });

  it("re-exports fetchPrDiff from core", () => {
    const result = fetchPrDiff(42);
    expect(result).toContain("diff --git");
    expect(mockFetchPrDiff).toHaveBeenCalledWith(42);
  });

  it("re-exports fetchPrMeta from core", () => {
    const meta = fetchPrMeta(42);
    expect(meta.title).toBe("Add feature");
    expect(mockFetchPrMeta).toHaveBeenCalledWith(42);
  });

  it("cmdReview delegates to the shared core review runner", async () => {
    const result = await cmdReview({ prNumber: 7, repo: "owner/repo", maxDiffChars: 1234 });
    expect(mockReviewPullRequest).toHaveBeenCalledWith({
      prNumber: 7,
      repo: "owner/repo",
      maxDiffChars: 1234,
    });
    expect(result.rawPrompt).toContain("PR Diff Evidence");
    expect(mockRecordReviewOutcome).toHaveBeenCalledWith(
      expect.objectContaining({
        prNumber: 1,
        repo: "owner/repo",
        verdict: "changes-required",
        checklistPassed: 2,
        checklistTotal: 3,
        comments: expect.arrayContaining([
          expect.objectContaining({ category: "security" }),
        ]),
      }),
      expect.any(String),
    );
  });
});
