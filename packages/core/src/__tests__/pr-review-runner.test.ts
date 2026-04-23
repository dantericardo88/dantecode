import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("node:child_process", () => ({
  execFileSync: vi.fn(),
}));

import { execFileSync } from "node:child_process";
import { fetchPrDiff, fetchPrMeta, reviewPullRequest } from "../pr-review-runner.js";

const mockExecFileSync = vi.mocked(execFileSync);

describe("pr-review-runner", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("fetchPrDiff truncates long diffs", () => {
    mockExecFileSync.mockReturnValue("x".repeat(5000));
    expect(fetchPrDiff(1, undefined, 100)).toHaveLength(100);
  });

  it("fetchPrMeta returns defaults on failure", () => {
    mockExecFileSync.mockImplementation(() => {
      throw new Error("gh missing");
    });
    expect(fetchPrMeta(9)).toEqual({
      title: "PR #9",
      additions: 0,
      deletions: 0,
      files: [],
      url: "",
    });
  });

  it("reviewPullRequest attaches diff evidence and diff-derived annotations", async () => {
    mockExecFileSync.mockImplementation((_cmd, args) => {
      if (args?.[1] === "view") {
        return JSON.stringify({
          title: "Add auth helper",
          additions: 10,
          deletions: 1,
          files: [{ path: "src/auth.ts" }],
          url: "https://github.com/org/repo/pull/12",
        });
      }
      return [
        "diff --git a/src/auth.ts b/src/auth.ts",
        "+++ b/src/auth.ts",
        "@@ -1,1 +1,2 @@",
        '+const password = "secret";',
        "+console.log(password);",
      ].join("\n");
    });

    const result = await reviewPullRequest({ prNumber: 12 });
    expect(result.rawPrompt).toContain("PR Diff Evidence");
    expect(result.rawPrompt).toContain("password = \"secret\"");
    expect(result.checklistTotal).toBeGreaterThan(0);
  });
});
