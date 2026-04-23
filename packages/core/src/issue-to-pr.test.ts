// ============================================================================
// @dantecode/core — Issue-to-PR Pipeline Tests
// ============================================================================

import { describe, it, expect, vi, beforeEach } from "vitest";
import { IssueToPRPipeline } from "./issue-to-pr.js";
import type { GitHubIssueInfo, PipelineProgress, AgentExecutor } from "./issue-to-pr.js";

// ---------------------------------------------------------------------------
// Mock child_process.exec so no real git commands are run
// ---------------------------------------------------------------------------
const mockExec = vi.fn();

vi.mock("node:child_process", () => ({
  exec: (...args: unknown[]) => mockExec(...args),
}));

// ---------------------------------------------------------------------------
// Mock global fetch for GitHub API calls
// ---------------------------------------------------------------------------
const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
const PROJECT_ROOT = "/workspace/dantecode";

function makeIssue(overrides: Partial<GitHubIssueInfo> = {}): GitHubIssueInfo {
  return {
    number: 42,
    title: "Fix authentication bug",
    body: "Users cannot log in when MFA is enabled.",
    labels: ["bug", "auth"],
    url: "https://github.com/acme/dantecode/issues/42",
    ...overrides,
  };
}

function makePipeline(overrides: Record<string, unknown> = {}): IssueToPRPipeline {
  return new IssueToPRPipeline(PROJECT_ROOT, {
    githubToken: "ghp_" + "test_token_123",
    repository: "acme/dantecode",
    baseBranch: "main",
    worktreeBase: ".worktrees",
    verifyBeforePR: true,
    verifyCommands: ["npm run typecheck", "npm run test -- --run"],
    agentTimeoutMs: 60_000,
    ...overrides,
  });
}

function mockExecSuccess(stdout = "", stderr = ""): void {
  mockExec.mockImplementation(
    (
      _cmd: string,
      _opts: unknown,
      cb?: (err: null, result: { stdout: string; stderr: string }) => void,
    ) => {
      if (cb) {
        cb(null, { stdout, stderr });
      }
      return { stdout, stderr };
    },
  );
}

function mockFetchJSON(status: number, body: unknown): void {
  mockFetch.mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    headers: new Map([["content-type", "application/json"]]) as unknown as Headers,
    json: async () => body,
    text: async () => JSON.stringify(body),
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe("IssueToPRPipeline", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockExecSuccess();
    mockFetchJSON(201, { number: 99, html_url: "https://github.com/acme/dantecode/pull/99" });
  });

  // ── buildAgentPrompt ────────────────────────────────────────────────────

  describe("buildAgentPrompt", () => {
    it("includes issue number and title", () => {
      const pipeline = makePipeline();
      const issue = makeIssue();
      const prompt = pipeline.buildAgentPrompt(issue);

      expect(prompt).toContain("#42");
      expect(prompt).toContain("Fix authentication bug");
    });

    it("includes issue body", () => {
      const pipeline = makePipeline();
      const issue = makeIssue();
      const prompt = pipeline.buildAgentPrompt(issue);

      expect(prompt).toContain("Users cannot log in when MFA is enabled.");
    });

    it("includes labels when present", () => {
      const pipeline = makePipeline();
      const issue = makeIssue({ labels: ["bug", "auth"] });
      const prompt = pipeline.buildAgentPrompt(issue);

      expect(prompt).toContain("bug");
      expect(prompt).toContain("auth");
    });

    it("omits labels section when empty", () => {
      const pipeline = makePipeline();
      const issue = makeIssue({ labels: [] });
      const prompt = pipeline.buildAgentPrompt(issue);

      expect(prompt).not.toContain("Labels:");
    });

    it("includes repository name", () => {
      const pipeline = makePipeline();
      const issue = makeIssue();
      const prompt = pipeline.buildAgentPrompt(issue);

      expect(prompt).toContain("acme/dantecode");
    });

    it("includes the issue URL", () => {
      const pipeline = makePipeline();
      const issue = makeIssue();
      const prompt = pipeline.buildAgentPrompt(issue);

      expect(prompt).toContain("https://github.com/acme/dantecode/issues/42");
    });

    it("includes implementation instructions", () => {
      const pipeline = makePipeline();
      const issue = makeIssue();
      const prompt = pipeline.buildAgentPrompt(issue);

      expect(prompt).toContain("Implement the necessary code changes");
      expect(prompt).toContain("tests pass");
    });
  });

  // ── sanitizeBranchName ──────────────────────────────────────────────────

  describe("sanitizeBranchName", () => {
    it("converts title to lowercase kebab-case", () => {
      const pipeline = makePipeline();
      expect(pipeline.sanitizeBranchName("Fix Login Bug")).toBe("fix-login-bug");
    });

    it("removes special characters", () => {
      const pipeline = makePipeline();
      expect(pipeline.sanitizeBranchName("feat: add auth (v2)!")).toBe("feat-add-auth-v2");
    });

    it("collapses multiple dashes", () => {
      const pipeline = makePipeline();
      expect(pipeline.sanitizeBranchName("fix---broken---tests")).toBe("fix-broken-tests");
    });

    it("truncates to 60 characters", () => {
      const pipeline = makePipeline();
      const longTitle = "a".repeat(100);
      expect(pipeline.sanitizeBranchName(longTitle).length).toBeLessThanOrEqual(60);
    });

    it("strips leading and trailing dashes", () => {
      const pipeline = makePipeline();
      expect(pipeline.sanitizeBranchName("--hello--")).toBe("hello");
    });
  });

  // ── createBranch ────────────────────────────────────────────────────────

  describe("createBranch", () => {
    it("runs git fetch and git worktree add with correct arguments", async () => {
      const pipeline = makePipeline();
      const commands: string[] = [];

      mockExec.mockImplementation(
        (
          cmd: string,
          _opts: unknown,
          cb?: (err: null, result: { stdout: string; stderr: string }) => void,
        ) => {
          commands.push(cmd);
          if (cb) cb(null, { stdout: "", stderr: "" });
          return { stdout: "", stderr: "" };
        },
      );

      const result = await pipeline.createBranch(42, "Fix Login Bug");

      expect(result.branchName).toBe("issue-42/fix-login-bug");
      expect(result.worktreeDir).toContain(".worktrees/issue-42/fix-login-bug");

      expect(commands[0]).toContain("git fetch origin main");
      expect(commands[1]).toContain("git worktree add");
      expect(commands[1]).toContain("issue-42/fix-login-bug");
      expect(commands[1]).toContain("origin/main");
    });
  });

  // ── verify ──────────────────────────────────────────────────────────────

  describe("verify", () => {
    it("returns passed=true when all commands succeed", async () => {
      const pipeline = makePipeline();
      mockExecSuccess("All checks pass");

      const result = await pipeline.verify("/workspace/worktree");

      expect(result.passed).toBe(true);
      expect(result.output).toContain("npm run typecheck");
    });

    it("returns passed=false when a command fails", async () => {
      const pipeline = makePipeline();
      let callCount = 0;

      mockExec.mockImplementation(
        (
          _cmd: string,
          _opts: unknown,
          cb?: (err: Error | null, result?: { stdout: string; stderr: string }) => void,
        ) => {
          callCount++;
          if (callCount === 2 && cb) {
            const err = new Error("test failure") as Error & { stdout: string; stderr: string };
            err.stdout = "FAIL src/test.ts";
            err.stderr = "1 test failed";
            cb(err);
          } else if (cb) {
            cb(null, { stdout: "OK", stderr: "" });
          }
          return {};
        },
      );

      const result = await pipeline.verify("/workspace/worktree");

      expect(result.passed).toBe(false);
      expect(result.output).toContain("[FAILED]");
    });
  });

  // ── createPullRequest ───────────────────────────────────────────────────

  describe("createPullRequest", () => {
    it("calls GitHub API with correct parameters", async () => {
      const pipeline = makePipeline();
      const issue = makeIssue();

      mockFetchJSON(201, {
        number: 99,
        html_url: "https://github.com/acme/dantecode/pull/99",
      });

      const result = await pipeline.createPullRequest(
        "issue-42/fix-authentication-bug",
        issue,
        "All checks passed",
      );

      expect(result.prNumber).toBe(99);
      expect(result.prUrl).toBe("https://github.com/acme/dantecode/pull/99");

      expect(mockFetch).toHaveBeenCalledWith(
        "https://api.github.com/repos/acme/dantecode/pulls",
        expect.objectContaining({
          method: "POST",
          headers: expect.objectContaining({
            Authorization: "Bearer " + ("ghp_" + "test_token_123"),
          }),
        }),
      );

      // Verify the body contains issue reference
      const callBody = JSON.parse(
        (mockFetch.mock.calls[0] as [string, RequestInit])[1].body as string,
      );
      expect(callBody.head).toBe("issue-42/fix-authentication-bug");
      expect(callBody.base).toBe("main");
      expect(callBody.title).toContain("#42");
    });

    it("throws on API error", async () => {
      const pipeline = makePipeline();
      const issue = makeIssue();

      mockFetch.mockResolvedValue({
        ok: false,
        status: 422,
        headers: new Map([["content-type", "application/json"]]) as unknown as Headers,
        text: async () => '{"message":"Validation Failed"}',
      });

      await expect(pipeline.createPullRequest("issue-42/fix-bug", issue)).rejects.toThrow(
        "GitHub API POST",
      );
    });
  });

  // ── commentOnIssue ──────────────────────────────────────────────────────

  describe("commentOnIssue", () => {
    it("posts a comment via GitHub API", async () => {
      const pipeline = makePipeline();
      mockFetchJSON(201, { id: 1 });

      await pipeline.commentOnIssue(42, "https://github.com/acme/dantecode/pull/99", true);

      expect(mockFetch).toHaveBeenCalledWith(
        "https://api.github.com/repos/acme/dantecode/issues/42/comments",
        expect.objectContaining({ method: "POST" }),
      );

      const callBody = JSON.parse(
        (mockFetch.mock.calls[0] as [string, RequestInit])[1].body as string,
      );
      expect(callBody.body).toContain("pull/99");
    });

    it("includes success message when verification passed", async () => {
      const pipeline = makePipeline();
      mockFetchJSON(201, { id: 1 });

      await pipeline.commentOnIssue(42, "https://pr-url", true);

      const callBody = JSON.parse(
        (mockFetch.mock.calls[0] as [string, RequestInit])[1].body as string,
      );
      expect(callBody.body).toContain("verification checks passed");
    });

    it("includes warning message when verification failed", async () => {
      const pipeline = makePipeline();
      mockFetchJSON(201, { id: 1 });

      await pipeline.commentOnIssue(42, "https://pr-url", false);

      const callBody = JSON.parse(
        (mockFetch.mock.calls[0] as [string, RequestInit])[1].body as string,
      );
      expect(callBody.body).toContain("verification checks failed");
    });
  });

  // ── cleanupWorktree ─────────────────────────────────────────────────────

  describe("cleanupWorktree", () => {
    it("removes worktree and deletes branch", async () => {
      const pipeline = makePipeline();
      const commands: string[] = [];

      mockExec.mockImplementation(
        (
          cmd: string,
          _opts: unknown,
          cb?: (err: null, result: { stdout: string; stderr: string }) => void,
        ) => {
          commands.push(cmd);
          if (cb) cb(null, { stdout: "", stderr: "" });
          return {};
        },
      );

      await pipeline.cleanupWorktree("/workspace/.worktrees/issue-42/fix-bug", "issue-42/fix-bug");

      expect(commands).toHaveLength(2);
      expect(commands[0]).toContain("git worktree remove");
      expect(commands[0]).toContain("--force");
      expect(commands[1]).toContain("git branch -D issue-42/fix-bug");
    });
  });

  // ── Progress callback ──────────────────────────────────────────────────

  describe("progress callback", () => {
    it("emits progress for each pipeline stage on success", async () => {
      const pipeline = makePipeline();
      const stages: string[] = [];

      pipeline.setProgressCallback((progress: PipelineProgress) => {
        stages.push(progress.stage);
      });

      const agentExecutor: AgentExecutor = async () => ({
        output: "done",
        touchedFiles: ["src/auth.ts"],
      });

      mockExecSuccess();
      mockFetchJSON(201, {
        number: 99,
        html_url: "https://github.com/acme/dantecode/pull/99",
      });

      await pipeline.run(makeIssue(), agentExecutor);

      expect(stages).toContain("parsing");
      expect(stages).toContain("branching");
      expect(stages).toContain("executing");
      expect(stages).toContain("verifying");
      expect(stages).toContain("creating_pr");
      expect(stages).toContain("commenting");
      expect(stages).toContain("completed");
    });

    it("emits 'failed' stage on error", async () => {
      const pipeline = makePipeline();
      const stages: string[] = [];

      pipeline.setProgressCallback((progress: PipelineProgress) => {
        stages.push(progress.stage);
      });

      const agentExecutor: AgentExecutor = async () => {
        throw new Error("Agent crashed");
      };

      mockExecSuccess();

      const result = await pipeline.run(makeIssue(), agentExecutor);

      expect(result.success).toBe(false);
      expect(stages).toContain("failed");
    });

    it("includes timestamp in progress events", async () => {
      const pipeline = makePipeline();
      const timestamps: string[] = [];

      pipeline.setProgressCallback((progress: PipelineProgress) => {
        timestamps.push(progress.timestamp);
      });

      const agentExecutor: AgentExecutor = async () => ({
        output: "done",
        touchedFiles: ["file.ts"],
      });

      mockExecSuccess();
      mockFetchJSON(201, {
        number: 99,
        html_url: "https://github.com/acme/dantecode/pull/99",
      });

      await pipeline.run(makeIssue(), agentExecutor);

      expect(timestamps.length).toBeGreaterThan(0);
      for (const ts of timestamps) {
        expect(() => new Date(ts)).not.toThrow();
        expect(new Date(ts).toISOString()).toBe(ts);
      }
    });
  });

  // ── run (full pipeline) ────────────────────────────────────────────────

  describe("run", () => {
    it("completes full pipeline successfully", async () => {
      const pipeline = makePipeline();
      const agentExecutor: AgentExecutor = async () => ({
        output: "Implemented fix",
        touchedFiles: ["src/auth.ts", "src/auth.test.ts"],
      });

      mockExecSuccess();
      mockFetchJSON(201, {
        number: 99,
        html_url: "https://github.com/acme/dantecode/pull/99",
      });

      const result = await pipeline.run(makeIssue(), agentExecutor);

      expect(result.success).toBe(true);
      expect(result.issueNumber).toBe(42);
      expect(result.prNumber).toBe(99);
      expect(result.prUrl).toBe("https://github.com/acme/dantecode/pull/99");
      expect(result.branchName).toContain("issue-42");
      expect(result.durationMs).toBeGreaterThanOrEqual(0);
    });

    it("returns failure when agent produces no file changes", async () => {
      const pipeline = makePipeline();
      const agentExecutor: AgentExecutor = async () => ({
        output: "No changes needed",
        touchedFiles: [],
      });

      mockExecSuccess();

      const result = await pipeline.run(makeIssue(), agentExecutor);

      expect(result.success).toBe(false);
      expect(result.error).toContain("no file changes");
    });

    it("returns failure when agent throws", async () => {
      const pipeline = makePipeline();
      const agentExecutor: AgentExecutor = async () => {
        throw new Error("Agent crashed unexpectedly");
      };

      mockExecSuccess();

      const result = await pipeline.run(makeIssue(), agentExecutor);

      expect(result.success).toBe(false);
      expect(result.error).toContain("Agent crashed unexpectedly");
    });

    it("skips verification when verifyBeforePR is false", async () => {
      const pipeline = makePipeline({ verifyBeforePR: false });
      const stages: string[] = [];

      pipeline.setProgressCallback((progress: PipelineProgress) => {
        stages.push(progress.stage);
      });

      const agentExecutor: AgentExecutor = async () => ({
        output: "done",
        touchedFiles: ["file.ts"],
      });

      mockExecSuccess();
      mockFetchJSON(201, {
        number: 99,
        html_url: "https://github.com/acme/dantecode/pull/99",
      });

      const result = await pipeline.run(makeIssue(), agentExecutor);

      expect(result.success).toBe(true);
      expect(stages).not.toContain("verifying");
    });

    it("includes durationMs in result", async () => {
      const pipeline = makePipeline();
      const agentExecutor: AgentExecutor = async () => ({
        output: "done",
        touchedFiles: ["file.ts"],
      });

      mockExecSuccess();
      mockFetchJSON(201, {
        number: 99,
        html_url: "https://github.com/acme/dantecode/pull/99",
      });

      const result = await pipeline.run(makeIssue(), agentExecutor);

      expect(typeof result.durationMs).toBe("number");
      expect(result.durationMs).toBeGreaterThanOrEqual(0);
    });
  });

  // ── githubAPI ──────────────────────────────────────────────────────────

  describe("githubAPI", () => {
    it("sets correct authorization header", async () => {
      const pipeline = makePipeline();
      mockFetchJSON(200, { ok: true });

      await pipeline.githubAPI("GET", "/repos/acme/dantecode");

      expect(mockFetch).toHaveBeenCalledWith(
        "https://api.github.com/repos/acme/dantecode",
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: "Bearer " + ("ghp_" + "test_token_123"),
            Accept: "application/vnd.github+json",
          }),
        }),
      );
    });
  });
});
