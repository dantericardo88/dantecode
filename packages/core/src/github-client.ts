// ============================================================================
// @dantecode/core — GitHubClient
// Structured GitHub API client using Octokit.
// Replaces ad-hoc gh CLI shell dispatch with typed, rate-limited, paginated calls.
// ============================================================================

import { execFileSync } from "node:child_process";
import { Octokit } from "@octokit/rest";

function translateOctokitError(err: unknown, context: string): never {
  const status = (err as { status?: number }).status;
  if (status === 401) throw new Error(`GitHub authentication failed — set GITHUB_TOKEN (${context})`);
  if (status === 403) throw new Error(`GitHub permission denied or rate limited (${context})`);
  if (status === 404) throw new Error(`GitHub resource not found (${context})`);
  if (status === 422) throw new Error(`GitHub validation error: ${err instanceof Error ? err.message : String(err)} (${context})`);
  throw new Error(`GitHub API error: ${err instanceof Error ? err.message : String(err)} (${context})`);
}

export interface GitHubClientConfig {
  token: string;
  owner?: string;
  repo?: string;
  /** Injected for testing; defaults to node:child_process execFileSync */
  execSyncFn?: typeof execFileSync;
}

export interface PRDetails {
  number: number;
  title: string;
  state: string;
  author: string;
  additions: number;
  deletions: number;
  changedFiles: number;
  mergeable: boolean | null;
  body: string;
  url: string;
  reviewDecision: string | null;
}

export interface PRFile {
  filename: string;
  status: string;
  additions: number;
  deletions: number;
  patch: string | undefined;
}

export interface Issue {
  number: number;
  title: string;
  state: string;
  body: string;
  labels: string[];
  url: string;
  author: string;
}

export interface CheckRun {
  name: string;
  status: string;
  conclusion: string | null;
  url: string;
}

export interface WorkflowRun {
  id: number;
  name: string;
  status: string;
  conclusion: string | null;
  headBranch: string;
  url: string;
}

export class GitHubClient {
  private readonly octokit: Octokit;
  private owner: string;
  private repo: string;
  private readonly execFn: typeof execFileSync;

  constructor(config: GitHubClientConfig) {
    if (!config.token?.trim()) {
      throw new Error("GitHubClient requires a non-empty token. Set GITHUB_TOKEN.");
    }
    this.octokit = new Octokit({ auth: config.token });
    this.owner = config.owner ?? "";
    this.repo = config.repo ?? "";
    this.execFn = config.execSyncFn ?? execFileSync;
  }

  private async withRetry<T>(fn: () => Promise<T>, maxRetries = 3): Promise<T> {
    let lastErr: unknown;
    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        return await fn();
      } catch (err) {
        lastErr = err;
        const status = (err as { status?: number }).status;
        if ((status === 403 || status === 429) && attempt < maxRetries - 1) {
          const backoff = Math.pow(2, attempt) * 1000 + Math.random() * 500;
          await new Promise<void>((r) => setTimeout(r, backoff));
          continue;
        }
        break;
      }
    }
    translateOctokitError(lastErr, "withRetry");
  }

  /**
   * Infers owner/repo from the git remote origin URL.
   * Supports both https://github.com/owner/repo.git and git@github.com:owner/repo.git
   */
  async inferFromGitRemote(projectRoot: string): Promise<void> {
    try {
      const raw = this.execFn("git", ["remote", "get-url", "origin"], {
        cwd: projectRoot,
        encoding: "utf8",
        stdio: ["pipe", "pipe", "pipe"],
      }) as string;
      const url = raw.trim();
      const match = /github\.com[:/]([^/]+)\/([^/.]+)/.exec(url);
      if (match) {
        this.owner = match[1]!;
        this.repo = match[2]!;
      }
    } catch {
      // If inference fails, owner/repo stay as provided in config or empty
    }
  }

  // ---------------------------------------------------------------------------
  // PR Operations
  // ---------------------------------------------------------------------------

  async createPR(params: {
    title: string;
    body?: string;
    base?: string;
    head?: string;
    draft?: boolean;
  }): Promise<{ number: number; url: string }> {
    try {
      const { data } = await this.octokit.rest.pulls.create({
        owner: this.owner,
        repo: this.repo,
        title: params.title,
        body: params.body,
        base: params.base ?? "main",
        head: params.head ?? "",
        draft: params.draft,
      });
      return { number: data.number, url: data.html_url };
    } catch (err) {
      translateOctokitError(err, "createPR");
    }
  }

  async getPR(number: number): Promise<PRDetails> {
    return this.withRetry(async () => {
      try {
        const { data } = await this.octokit.rest.pulls.get({
          owner: this.owner,
          repo: this.repo,
          pull_number: number,
        });
        return {
          number: data.number,
          title: data.title,
          state: data.state,
          author: data.user?.login ?? "unknown",
          additions: data.additions,
          deletions: data.deletions,
          changedFiles: data.changed_files,
          mergeable: data.mergeable ?? null,
          body: data.body ?? "",
          url: data.html_url,
          reviewDecision: data.mergeable_state ?? null,
        };
      } catch (err) {
        translateOctokitError(err, "getPR");
      }
    });
  }

  async getPRDiff(number: number): Promise<string> {
    try {
      const { data } = await this.octokit.rest.pulls.get({
        owner: this.owner,
        repo: this.repo,
        pull_number: number,
        mediaType: { format: "diff" },
      });
      return data as unknown as string;
    } catch (err) {
      translateOctokitError(err, "getPRDiff");
    }
  }

  async listPRFiles(number: number): Promise<PRFile[]> {
    try {
      const allFiles: PRFile[] = [];
      const iterator = this.octokit.paginate.iterator(this.octokit.rest.pulls.listFiles, {
        owner: this.owner,
        repo: this.repo,
        pull_number: number,
        per_page: 100,
      });
      for await (const { data } of iterator) {
        for (const f of data) {
          allFiles.push({
            filename: f.filename,
            status: f.status,
            additions: f.additions,
            deletions: f.deletions,
            patch: f.patch,
          });
        }
      }
      return allFiles;
    } catch (err) {
      translateOctokitError(err, "listPRFiles");
    }
  }

  async createReview(
    number: number,
    params: {
      event: "APPROVE" | "REQUEST_CHANGES" | "COMMENT";
      body: string;
      comments?: Array<{ path: string; line: number; body: string }>;
    },
  ): Promise<void> {
    try {
      await this.octokit.rest.pulls.createReview({
        owner: this.owner,
        repo: this.repo,
        pull_number: number,
        event: params.event,
        body: params.body,
        comments: params.comments?.map((c) => ({
          path: c.path,
          line: c.line,
          body: c.body,
          side: "RIGHT" as const,
        })),
      });
    } catch (err) {
      translateOctokitError(err, "createReview");
    }
  }

  async listPRs(state: "open" | "closed" | "all" = "open"): Promise<PRDetails[]> {
    try {
      const allPRs: PRDetails[] = [];
      const iterator = this.octokit.paginate.iterator(this.octokit.rest.pulls.list, {
        owner: this.owner,
        repo: this.repo,
        state: state === "all" ? "all" : state === "closed" ? "closed" : "open",
        per_page: 50,
      });
      for await (const { data } of iterator) {
        for (const pr of data) {
          allPRs.push({
            number: pr.number,
            title: pr.title,
            state: pr.state,
            author: pr.user?.login ?? "unknown",
            additions: 0,
            deletions: 0,
            changedFiles: 0,
            mergeable: null,
            body: pr.body ?? "",
            url: pr.html_url,
            reviewDecision: null,
          });
        }
      }
      return allPRs;
    } catch (err) {
      translateOctokitError(err, "listPRs");
    }
  }

  // ---------------------------------------------------------------------------
  // Issue Operations
  // ---------------------------------------------------------------------------

  async getIssue(number: number): Promise<Issue> {
    try {
      const { data } = await this.octokit.rest.issues.get({
        owner: this.owner,
        repo: this.repo,
        issue_number: number,
      });
      return {
        number: data.number,
        title: data.title,
        state: data.state,
        body: data.body ?? "",
        labels: data.labels
          .map((l) => (typeof l === "string" ? l : (l.name ?? "")))
          .filter(Boolean),
        url: data.html_url,
        author: data.user?.login ?? "unknown",
      };
    } catch (err) {
      translateOctokitError(err, "getIssue");
    }
  }

  async listIssues(state: "open" | "closed" | "all" = "open"): Promise<Issue[]> {
    try {
      const allIssues: Issue[] = [];
      const iterator = this.octokit.paginate.iterator(this.octokit.rest.issues.listForRepo, {
        owner: this.owner,
        repo: this.repo,
        state,
        per_page: 50,
      });
      for await (const { data } of iterator) {
        for (const i of data) {
          if (i.pull_request) continue; // exclude PRs from issue list
          allIssues.push({
            number: i.number,
            title: i.title,
            state: i.state,
            body: i.body ?? "",
            labels: i.labels
              .map((l) => (typeof l === "string" ? l : (l.name ?? "")))
              .filter(Boolean),
            url: i.html_url,
            author: i.user?.login ?? "unknown",
          });
        }
      }
      return allIssues;
    } catch (err) {
      translateOctokitError(err, "listIssues");
    }
  }

  async createIssue(params: {
    title: string;
    body?: string;
    labels?: string[];
  }): Promise<{ number: number; url: string }> {
    try {
      const { data } = await this.octokit.rest.issues.create({
        owner: this.owner,
        repo: this.repo,
        title: params.title,
        body: params.body,
        labels: params.labels,
      });
      return { number: data.number, url: data.html_url };
    } catch (err) {
      translateOctokitError(err, "createIssue");
    }
  }

  async addLabels(issueNumber: number, labels: string[]): Promise<void> {
    try {
      await this.octokit.rest.issues.addLabels({
        owner: this.owner,
        repo: this.repo,
        issue_number: issueNumber,
        labels,
      });
    } catch (err) {
      translateOctokitError(err, "addLabels");
    }
  }

  async commentIssue(number: number, body: string): Promise<void> {
    try {
      await this.octokit.rest.issues.createComment({
        owner: this.owner,
        repo: this.repo,
        issue_number: number,
        body,
      });
    } catch (err) {
      translateOctokitError(err, "commentIssue");
    }
  }

  async closeIssue(number: number): Promise<void> {
    try {
      await this.octokit.rest.issues.update({
        owner: this.owner,
        repo: this.repo,
        issue_number: number,
        state: "closed",
      });
    } catch (err) {
      translateOctokitError(err, "closeIssue");
    }
  }

  // ---------------------------------------------------------------------------
  // CI Status
  // ---------------------------------------------------------------------------

  async getCheckRuns(ref: string): Promise<CheckRun[]> {
    try {
      const { data } = await this.octokit.rest.checks.listForRef({
        owner: this.owner,
        repo: this.repo,
        ref,
        per_page: 100,
      });
      return data.check_runs.map((c) => ({
        name: c.name,
        status: c.status,
        conclusion: c.conclusion ?? null,
        url: c.html_url ?? "",
      }));
    } catch (err) {
      translateOctokitError(err, "getCheckRuns");
    }
  }

  async getWorkflowRuns(branch?: string): Promise<WorkflowRun[]> {
    try {
      const { data } = await this.octokit.rest.actions.listWorkflowRunsForRepo({
        owner: this.owner,
        repo: this.repo,
        branch,
        per_page: 20,
      });
      return data.workflow_runs.map((r) => ({
        id: r.id,
        name: r.name ?? "unknown",
        status: r.status ?? "unknown",
        conclusion: r.conclusion ?? null,
        headBranch: r.head_branch ?? "",
        url: r.html_url,
      }));
    } catch (err) {
      translateOctokitError(err, "getWorkflowRuns");
    }
  }
}
