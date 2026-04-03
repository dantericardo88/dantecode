/**
 * github-cli-engine.test.ts
 *
 * 30 Vitest unit tests for GitHubCLIEngine using execSyncFn injection.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { GitHubCLIEngine } from "./github-cli-engine.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeEngine(mockExec: ReturnType<typeof vi.fn>) {
  return new GitHubCLIEngine({ execSyncFn: mockExec as never });
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe("GitHubCLIEngine", () => {
  let mockExec: ReturnType<typeof vi.fn>;
  let engine: GitHubCLIEngine;

  beforeEach(() => {
    mockExec = vi.fn().mockReturnValue("{}");
    engine = makeEngine(mockExec);
  });

  // -------------------------------------------------------------------------
  // Auth
  // -------------------------------------------------------------------------

  it("1. ensureAuth() returns true on success", () => {
    mockExec.mockReturnValueOnce("Logged in to github.com");
    const result = engine.ensureAuth();
    expect(result).toBe(true);
  });

  it("2. ensureAuth() returns false on error", () => {
    mockExec.mockImplementationOnce(() => {
      throw new Error("You are not logged into any GitHub hosts.");
    });
    const result = engine.ensureAuth();
    expect(result).toBe(false);
  });

  // -------------------------------------------------------------------------
  // exec()
  // -------------------------------------------------------------------------

  it("3. exec() calls execSyncFn with command", () => {
    engine.exec("gh pr list --repo owner/repo");
    expect(mockExec).toHaveBeenCalledWith(
      "gh pr list --repo owner/repo",
      expect.objectContaining({ encoding: "utf8" }),
    );
  });

  it("4. exec() returns success result with stdout", () => {
    mockExec.mockReturnValueOnce('{"number":1}');
    const result = engine.exec("gh pr view 1 --repo owner/repo");
    expect(result.success).toBe(true);
    expect(result.stdout).toBe('{"number":1}');
  });

  it("5. exec() handles error gracefully", () => {
    mockExec.mockImplementationOnce(() => {
      throw new Error("command not found: gh");
    });
    const result = engine.exec("gh pr list");
    expect(result.success).toBe(false);
    expect(result.error).toContain("command not found");
  });

  // -------------------------------------------------------------------------
  // assessRisk()
  // -------------------------------------------------------------------------

  it("6. assessRisk() returns safe for search-repos", () => {
    expect(engine.assessRisk("search-repos")).toBe("safe");
  });

  it("7. assessRisk() returns medium for create-pr", () => {
    expect(engine.assessRisk("create-pr")).toBe("medium");
  });

  it("8. assessRisk() returns high for merge-pr", () => {
    expect(engine.assessRisk("merge-pr")).toBe("high");
  });

  it("9. assessRisk() returns high for trigger-workflow", () => {
    expect(engine.assessRisk("trigger-workflow")).toBe("high");
  });

  // -------------------------------------------------------------------------
  // createPR()
  // -------------------------------------------------------------------------

  it("10. createPR() calls gh pr create", () => {
    mockExec.mockReturnValueOnce("https://github.com/owner/repo/pull/42");
    engine.createPR("owner/repo", { title: "Fix bug", body: "Details" });
    const cmd = mockExec.mock.calls[0]![0] as string;
    expect(cmd).toContain("gh pr create");
    expect(cmd).toContain("--repo");
    expect(cmd).toContain("Fix bug");
  });

  it("11. createPR() returns GHResult with action field", () => {
    mockExec.mockReturnValueOnce("https://github.com/owner/repo/pull/42");
    const result = engine.createPR("owner/repo", { title: "My PR", body: "body" });
    expect(result.action).toBe("create-pr");
    expect(result.success).toBe(true);
  });

  // -------------------------------------------------------------------------
  // viewPR()
  // -------------------------------------------------------------------------

  it("12. viewPR() calls gh pr view with JSON flag", () => {
    mockExec.mockReturnValueOnce('{"number":5,"title":"Fix"}');
    engine.viewPR("owner/repo", 5);
    const cmd = mockExec.mock.calls[0]![0] as string;
    expect(cmd).toContain("gh pr view 5");
    expect(cmd).toContain("--json");
  });

  // -------------------------------------------------------------------------
  // reviewPR()
  // -------------------------------------------------------------------------

  it("13. reviewPR() approve calls correct command", () => {
    mockExec.mockReturnValueOnce("");
    engine.reviewPR("owner/repo", 7, "approve", "LGTM!");
    const cmd = mockExec.mock.calls[0]![0] as string;
    expect(cmd).toContain("gh pr review 7");
    expect(cmd).toContain("--approve");
    expect(cmd).toContain("LGTM!");
  });

  // -------------------------------------------------------------------------
  // mergePR()
  // -------------------------------------------------------------------------

  it("14. mergePR() calls gh pr merge", () => {
    mockExec.mockReturnValueOnce("");
    engine.mergePR("owner/repo", 3);
    const cmd = mockExec.mock.calls[0]![0] as string;
    expect(cmd).toContain("gh pr merge 3");
  });

  it("15. mergePR() uses strategy flag --squash", () => {
    mockExec.mockReturnValueOnce("");
    engine.mergePR("owner/repo", 3, "squash");
    const cmd = mockExec.mock.calls[0]![0] as string;
    expect(cmd).toContain("--squash");
  });

  // -------------------------------------------------------------------------
  // listPRs()
  // -------------------------------------------------------------------------

  it("16. listPRs() calls gh pr list", () => {
    mockExec.mockReturnValueOnce("[]");
    engine.listPRs("owner/repo");
    const cmd = mockExec.mock.calls[0]![0] as string;
    expect(cmd).toContain("gh pr list");
    expect(cmd).toContain("owner/repo");
  });

  // -------------------------------------------------------------------------
  // createIssue()
  // -------------------------------------------------------------------------

  it("17. createIssue() calls gh issue create", () => {
    mockExec.mockReturnValueOnce("https://github.com/owner/repo/issues/1");
    engine.createIssue("owner/repo", { title: "Bug", body: "It broke" });
    const cmd = mockExec.mock.calls[0]![0] as string;
    expect(cmd).toContain("gh issue create");
    expect(cmd).toContain("Bug");
  });

  // -------------------------------------------------------------------------
  // commentIssue()
  // -------------------------------------------------------------------------

  it("18. commentIssue() calls gh issue comment", () => {
    mockExec.mockReturnValueOnce("");
    engine.commentIssue("owner/repo", 10, "Thanks!");
    const cmd = mockExec.mock.calls[0]![0] as string;
    expect(cmd).toContain("gh issue comment 10");
    expect(cmd).toContain("Thanks!");
  });

  // -------------------------------------------------------------------------
  // closeIssue()
  // -------------------------------------------------------------------------

  it("19. closeIssue() calls gh issue close", () => {
    mockExec.mockReturnValueOnce("");
    engine.closeIssue("owner/repo", 99);
    const cmd = mockExec.mock.calls[0]![0] as string;
    expect(cmd).toContain("gh issue close 99");
  });

  // -------------------------------------------------------------------------
  // listIssues()
  // -------------------------------------------------------------------------

  it("20. listIssues() calls gh issue list", () => {
    mockExec.mockReturnValueOnce("[]");
    engine.listIssues("owner/repo");
    const cmd = mockExec.mock.calls[0]![0] as string;
    expect(cmd).toContain("gh issue list");
  });

  // -------------------------------------------------------------------------
  // searchRepos()
  // -------------------------------------------------------------------------

  it("21. searchRepos() calls gh search repos", () => {
    mockExec.mockReturnValueOnce("[]");
    engine.searchRepos("typescript lsp");
    const cmd = mockExec.mock.calls[0]![0] as string;
    expect(cmd).toContain("gh search repos");
    expect(cmd).toContain("typescript lsp");
  });

  // -------------------------------------------------------------------------
  // searchCode()
  // -------------------------------------------------------------------------

  it("22. searchCode() calls gh search code", () => {
    mockExec.mockReturnValueOnce("[]");
    engine.searchCode("useState hook");
    const cmd = mockExec.mock.calls[0]![0] as string;
    expect(cmd).toContain("gh search code");
    expect(cmd).toContain("useState hook");
  });

  // -------------------------------------------------------------------------
  // triggerWorkflow()
  // -------------------------------------------------------------------------

  it("23. triggerWorkflow() calls gh workflow run", () => {
    mockExec.mockReturnValueOnce("");
    engine.triggerWorkflow("owner/repo", "ci.yml", "main");
    const cmd = mockExec.mock.calls[0]![0] as string;
    expect(cmd).toContain("gh workflow run");
    expect(cmd).toContain("ci.yml");
    expect(cmd).toContain("--ref");
  });

  // -------------------------------------------------------------------------
  // handleRateLimit()
  // -------------------------------------------------------------------------

  it("24. handleRateLimit() detects rate limit error", () => {
    expect(engine.handleRateLimit("API rate limit exceeded for user")).toBe(true);
    expect(engine.handleRateLimit("secondary rate limit triggered")).toBe(true);
    expect(engine.handleRateLimit("HTTP 429 Too Many Requests")).toBe(true);
  });

  it("25. handleRateLimit() returns false for non-rate-limit error", () => {
    expect(engine.handleRateLimit("Not found")).toBe(false);
    expect(engine.handleRateLimit("Authentication failed")).toBe(false);
  });

  // -------------------------------------------------------------------------
  // Error propagation
  // -------------------------------------------------------------------------

  it("26. GHResult.success is false on exec error", () => {
    mockExec.mockImplementationOnce(() => {
      throw new Error("network timeout");
    });
    const result = engine.listPRs("owner/repo");
    expect(result.success).toBe(false);
    expect(result.error).toContain("network timeout");
  });

  it("27. GHResult includes action field on error", () => {
    mockExec.mockImplementationOnce(() => {
      throw new Error("oh no");
    });
    const result = engine.createIssue("owner/repo", { title: "T", body: "B" });
    expect(result.action).toBe("create-issue");
  });

  // -------------------------------------------------------------------------
  // Extra coverage
  // -------------------------------------------------------------------------

  it("28. listPRs() with closed state filter", () => {
    mockExec.mockReturnValueOnce("[]");
    engine.listPRs("owner/repo", "closed");
    const cmd = mockExec.mock.calls[0]![0] as string;
    expect(cmd).toContain("--state closed");
  });

  it("29. searchRepos() with limit parameter", () => {
    mockExec.mockReturnValueOnce("[]");
    engine.searchRepos("react hooks", 25);
    const cmd = mockExec.mock.calls[0]![0] as string;
    expect(cmd).toContain("--limit 25");
  });

  it("30. createPR() with draft flag", () => {
    mockExec.mockReturnValueOnce("https://github.com/owner/repo/pull/99");
    engine.createPR("owner/repo", {
      title: "WIP: Draft PR",
      body: "Not ready",
      draft: true,
    });
    const cmd = mockExec.mock.calls[0]![0] as string;
    expect(cmd).toContain("--draft");
  });
});
