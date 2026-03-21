import { describe, it, expect, vi, beforeEach } from "vitest";
import { GitHubClient } from "./github-client.js";
import type { GitHubClientConfig } from "./github-client.js";

// ────────────────────────────────────────────────────────
// Octokit mock — captured via stable container to avoid TDZ
// ────────────────────────────────────────────────────────

const mockOctokitContainer = {
  rest: {
    pulls: {
      create: vi.fn(),
      get: vi.fn(),
      listFiles: vi.fn(),
      createReview: vi.fn(),
      list: vi.fn(),
    },
    issues: {
      get: vi.fn(),
      listForRepo: vi.fn(),
      create: vi.fn(),
      addLabels: vi.fn(),
      createComment: vi.fn(),
      update: vi.fn(),
    },
    checks: {
      listForRef: vi.fn(),
    },
    actions: {
      listWorkflowRunsForRepo: vi.fn(),
    },
  },
  paginate: {
    iterator: vi.fn(),
  },
};

vi.mock("@octokit/rest", () => ({
  Octokit: vi.fn(() => mockOctokitContainer),
}));

// Alias for convenience in tests
const mockOctokit = mockOctokitContainer;

function makeClient(overrides?: Partial<GitHubClientConfig>): GitHubClient {
  return new GitHubClient({
    token: "test-token",
    owner: "testowner",
    repo: "testrepo",
    ...overrides,
  });
}

describe("GitHubClient", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // inferFromGitRemote
  describe("inferFromGitRemote", () => {
    it("parses HTTPS remote URL", async () => {
      const mockExec = vi.fn().mockReturnValue("https://github.com/myorg/myrepo.git\n");
      const client = new GitHubClient({ token: "tk", execSyncFn: mockExec as never });
      await client.inferFromGitRemote("/project");
      // Access via createPR to verify owner/repo was set
      const { Octokit } = await import("@octokit/rest");
      const oc = (Octokit as unknown as ReturnType<typeof vi.fn>).mock.results[0]?.value;
      oc.rest.pulls.create.mockResolvedValue({ data: { number: 1, html_url: "u" } });
      const result = await client.createPR({ title: "t" });
      expect(oc.rest.pulls.create).toHaveBeenCalledWith(expect.objectContaining({ owner: "myorg", repo: "myrepo" }));
      expect(result.number).toBe(1);
    });

    it("parses SSH remote URL", async () => {
      const mockExec = vi.fn().mockReturnValue("git@github.com:acme/widget.git\n");
      const client = new GitHubClient({ token: "tk", execSyncFn: mockExec as never });
      await client.inferFromGitRemote("/project");
      const { Octokit } = await import("@octokit/rest");
      const oc = (Octokit as unknown as ReturnType<typeof vi.fn>).mock.results[0]?.value;
      oc.rest.pulls.create.mockResolvedValue({ data: { number: 2, html_url: "u2" } });
      await client.createPR({ title: "t" });
      expect(oc.rest.pulls.create).toHaveBeenCalledWith(expect.objectContaining({ owner: "acme", repo: "widget" }));
    });

    it("does not throw when git command fails", async () => {
      const mockExec = vi.fn().mockImplementation(() => { throw new Error("no git"); });
      const client = new GitHubClient({ token: "tk", execSyncFn: mockExec as never });
      await expect(client.inferFromGitRemote("/project")).resolves.toBeUndefined();
    });
  });

  // createPR
  describe("createPR", () => {
    it("returns number and url", async () => {
      const client = makeClient();
      mockOctokit.rest.pulls.create.mockResolvedValue({ data: { number: 42, html_url: "https://github.com/testowner/testrepo/pull/42" } });
      const result = await client.createPR({ title: "My PR", body: "desc", base: "main" });
      expect(result).toEqual({ number: 42, url: "https://github.com/testowner/testrepo/pull/42" });
      expect(mockOctokit.rest.pulls.create).toHaveBeenCalledWith(expect.objectContaining({ title: "My PR", base: "main" }));
    });
  });

  // getPR
  describe("getPR", () => {
    it("maps PR data to PRDetails", async () => {
      const client = makeClient();
      mockOctokit.rest.pulls.get.mockResolvedValue({
        data: {
          number: 5, title: "Fix bug", state: "open",
          user: { login: "devuser" }, additions: 10, deletions: 3,
          changed_files: 2, mergeable: true, body: "fixes #3",
          html_url: "https://github.com/testowner/testrepo/pull/5",
          mergeable_state: "clean",
        },
      });
      const pr = await client.getPR(5);
      expect(pr.author).toBe("devuser");
      expect(pr.additions).toBe(10);
      expect(pr.mergeable).toBe(true);
      expect(pr.reviewDecision).toBe("clean");
    });
  });

  // getPRDiff
  describe("getPRDiff", () => {
    it("returns raw diff string", async () => {
      const client = makeClient();
      mockOctokit.rest.pulls.get.mockResolvedValue({ data: "--- a/foo.ts\n+++ b/foo.ts\n@@ -1 +1 @@\n-old\n+new\n" });
      const diff = await client.getPRDiff(5);
      expect(diff).toContain("--- a/foo.ts");
    });
  });

  // listPRFiles
  describe("listPRFiles", () => {
    it("maps files array", async () => {
      const client = makeClient();
      mockOctokit.paginate.iterator.mockReturnValue(
        (async function* () {
          yield { data: [{ filename: "src/foo.ts", status: "modified", additions: 5, deletions: 2, patch: "@@ -1 +1 @@\n-x\n+y" }] };
        })()
      );
      const files = await client.listPRFiles(3);
      expect(files).toHaveLength(1);
      expect(files[0]!.filename).toBe("src/foo.ts");
      expect(files[0]!.patch).toContain("-x");
    });
  });

  // createReview
  describe("createReview", () => {
    it("calls createReview with correct event", async () => {
      const client = makeClient();
      mockOctokit.rest.pulls.createReview.mockResolvedValue({ data: {} });
      await client.createReview(7, { event: "APPROVE", body: "LGTM" });
      expect(mockOctokit.rest.pulls.createReview).toHaveBeenCalledWith(expect.objectContaining({ event: "APPROVE", pull_number: 7 }));
    });
  });

  // getIssue
  describe("getIssue", () => {
    it("maps issue data", async () => {
      const client = makeClient();
      mockOctokit.rest.issues.get.mockResolvedValue({
        data: {
          number: 12, title: "Bug report", state: "open", body: "steps to repro",
          labels: [{ name: "bug" }, { name: "priority" }],
          html_url: "https://github.com/testowner/testrepo/issues/12",
          user: { login: "reporter" },
        },
      });
      const issue = await client.getIssue(12);
      expect(issue.title).toBe("Bug report");
      expect(issue.labels).toEqual(["bug", "priority"]);
      expect(issue.author).toBe("reporter");
    });
  });

  // addLabels
  describe("addLabels", () => {
    it("calls addLabels with correct args", async () => {
      const client = makeClient();
      mockOctokit.rest.issues.addLabels.mockResolvedValue({ data: {} });
      await client.addLabels(15, ["bug", "help wanted"]);
      expect(mockOctokit.rest.issues.addLabels).toHaveBeenCalledWith(expect.objectContaining({
        issue_number: 15,
        labels: ["bug", "help wanted"],
      }));
    });
  });

  // getCheckRuns
  describe("getCheckRuns", () => {
    it("maps check runs", async () => {
      const client = makeClient();
      mockOctokit.rest.checks.listForRef.mockResolvedValue({
        data: {
          check_runs: [
            { name: "CI", status: "completed", conclusion: "success", html_url: "https://gh/check/1" },
          ],
        },
      });
      const runs = await client.getCheckRuns("abc123");
      expect(runs).toHaveLength(1);
      expect(runs[0]!.conclusion).toBe("success");
    });
  });

  // getWorkflowRuns
  describe("getWorkflowRuns", () => {
    it("maps workflow runs", async () => {
      const client = makeClient();
      mockOctokit.rest.actions.listWorkflowRunsForRepo.mockResolvedValue({
        data: {
          workflow_runs: [
            { id: 999, name: "CI", status: "completed", conclusion: "success", head_branch: "main", html_url: "https://gh/run/999" },
          ],
        },
      });
      const runs = await client.getWorkflowRuns("main");
      expect(runs).toHaveLength(1);
      expect(runs[0]!.id).toBe(999);
      expect(runs[0]!.headBranch).toBe("main");
    });
  });

  describe("GitHubClient v2 hardening", () => {
    it("constructor throws when token is empty", () => {
      expect(() => new GitHubClient({ token: "" })).toThrow("non-empty token");
    });

    it("constructor throws when token is whitespace", () => {
      expect(() => new GitHubClient({ token: "   " })).toThrow("non-empty token");
    });

    it("401 response → user-friendly auth error message", async () => {
      const err = Object.assign(new Error("Unauthorized"), { status: 401 });
      mockOctokit.rest.pulls.create.mockRejectedValueOnce(err);
      const client = new GitHubClient({ token: "test-token" });
      (client as any).owner = "owner";
      (client as any).repo = "repo";
      await expect(client.createPR({ title: "Test" })).rejects.toThrow("authentication failed");
    });

    it("404 response → 'not found' error message", async () => {
      const err = Object.assign(new Error("Not Found"), { status: 404 });
      mockOctokit.rest.pulls.get.mockRejectedValueOnce(err);
      const client = new GitHubClient({ token: "test-token" });
      (client as any).owner = "owner";
      (client as any).repo = "repo";
      await expect(client.getPR(999)).rejects.toThrow("not found");
    });

    it("listPRFiles paginates across multiple pages", async () => {
      // Mock iterator returning 3 pages of 100 files each
      mockOctokit.paginate.iterator.mockReturnValueOnce(
        (async function* () {
          yield { data: Array.from({ length: 100 }, (_, i) => ({ filename: `file-page1-${i}.ts`, status: "modified", additions: 1, deletions: 0, patch: "+new" })) };
          yield { data: Array.from({ length: 100 }, (_, i) => ({ filename: `file-page2-${i}.ts`, status: "modified", additions: 1, deletions: 0, patch: "+new" })) };
          yield { data: Array.from({ length: 100 }, (_, i) => ({ filename: `file-page3-${i}.ts`, status: "modified", additions: 1, deletions: 0, patch: "+new" })) };
        })()
      );
      const client = new GitHubClient({ token: "test-token" });
      (client as any).owner = "owner";
      (client as any).repo = "repo";
      const files = await client.listPRFiles(42);
      expect(files).toHaveLength(300);
      expect(files[0]!.filename).toBe("file-page1-0.ts");
      expect(files[299]!.filename).toBe("file-page3-99.ts");
    });

    it("listIssues paginates and filters out PRs", async () => {
      mockOctokit.paginate.iterator.mockReturnValueOnce(
        (async function* () {
          yield { data: [
            { number: 1, title: "Issue 1", state: "open", body: "body1", labels: [], html_url: "url1", user: { login: "alice" }, pull_request: undefined },
            { number: 2, title: "PR not issue", state: "open", body: "", labels: [], html_url: "url2", user: { login: "bob" }, pull_request: { url: "pr-url" } },
            { number: 3, title: "Issue 3", state: "open", body: "body3", labels: [], html_url: "url3", user: { login: "carol" }, pull_request: undefined },
          ]};
        })()
      );
      const client = new GitHubClient({ token: "test-token" });
      (client as any).owner = "owner";
      (client as any).repo = "repo";
      const issues = await client.listIssues();
      expect(issues).toHaveLength(2);
      expect(issues.map(i => i.number)).toEqual([1, 3]);
    });
  });
});
