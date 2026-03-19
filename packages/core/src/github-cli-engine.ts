/**
 * github-cli-engine.ts
 *
 * Full GitHub CLI orchestrator wrapping the `gh` command.
 * Uses execSyncFn injection for testability.
 */

import { execSync } from "node:child_process";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type GHAction =
  | "search-repos"
  | "search-code"
  | "search-issues"
  | "search-prs"
  | "create-pr"
  | "view-pr"
  | "review-pr"
  | "merge-pr"
  | "list-prs"
  | "create-issue"
  | "comment-issue"
  | "close-issue"
  | "list-issues"
  | "view-issue"
  | "trigger-workflow"
  | "view-workflow"
  | "list-workflows"
  | "get-repo"
  | "clone-repo";

export interface GHRequest {
  action: GHAction;
  args: Record<string, string | number | boolean | undefined>;
  repo?: string;
  json?: boolean;
}

export interface GHResult {
  success: boolean;
  data?: unknown;
  raw?: string;
  error?: string;
  action: GHAction;
}

export interface PRCreateArgs {
  title: string;
  body: string;
  base?: string;
  draft?: boolean;
  labels?: string[];
}

export interface IssueCreateArgs {
  title: string;
  body: string;
  labels?: string[];
  assignees?: string[];
}

export interface GitHubCLIEngineOptions {
  /** Injectable execSync for testing. */
  execSyncFn?: typeof execSync;
  /** Default repo (owner/name). */
  defaultRepo?: string;
  /** Timeout per command in ms. Default: 30000 */
  timeout?: number;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Escape a shell argument by wrapping in double quotes and escaping inner quotes. */
function shellArg(value: string): string {
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

// ---------------------------------------------------------------------------
// GitHubCLIEngine
// ---------------------------------------------------------------------------

/**
 * Orchestrates the `gh` CLI for all GitHub operations.
 *
 * @example
 * ```ts
 * const engine = new GitHubCLIEngine({ defaultRepo: "owner/repo" });
 * const result = engine.searchRepos("typescript lsp", 5);
 * ```
 */
export class GitHubCLIEngine {
  private readonly execFn: typeof execSync;
  private readonly timeout: number;

  constructor(options: GitHubCLIEngineOptions = {}) {
    this.execFn = options.execSyncFn ?? execSync;
    this.timeout = options.timeout ?? 30_000;
  }

  // -------------------------------------------------------------------------
  // Auth
  // -------------------------------------------------------------------------

  /**
   * Verify that `gh` is authenticated.
   * Runs `gh auth status` and returns true if the command exits cleanly.
   */
  ensureAuth(): boolean {
    const result = this.exec("gh auth status");
    return result.success;
  }

  // -------------------------------------------------------------------------
  // Core exec
  // -------------------------------------------------------------------------

  /**
   * Execute a raw `gh` command string.
   *
   * @param command - Full gh command (e.g. `"gh pr list --repo owner/repo"`)
   * @param json    - Whether to append `--json` parsing (caller is responsible for flag)
   * @returns stdout string + success flag + optional error message
   */
  exec(
    command: string,
    _json?: boolean,
  ): { stdout: string; success: boolean; error?: string } {
    try {
      const stdout = this.execFn(command, {
        encoding: "utf8",
        timeout: this.timeout,
        stdio: ["pipe", "pipe", "pipe"],
      }) as string;
      return { stdout: stdout ?? "", success: true };
    } catch (err: unknown) {
      const error =
        err instanceof Error
          ? err.message
          : String(err);
      return { stdout: "", success: false, error };
    }
  }

  // -------------------------------------------------------------------------
  // Risk assessment
  // -------------------------------------------------------------------------

  /**
   * Classify the risk level of a GitHub action.
   *
   * - **safe**   — read-only: search, view, list
   * - **medium** — creates/reviews content: create-pr, review-pr, create-issue, comment-issue, clone-repo
   * - **high**   — destructive or side-effecting: merge-pr, close-issue, trigger-workflow
   */
  assessRisk(action: GHAction): "safe" | "medium" | "high" {
    const HIGH: GHAction[] = ["merge-pr", "close-issue", "trigger-workflow"];
    const MEDIUM: GHAction[] = [
      "create-pr",
      "review-pr",
      "create-issue",
      "comment-issue",
      "clone-repo",
    ];
    if (HIGH.includes(action)) return "high";
    if (MEDIUM.includes(action)) return "medium";
    return "safe";
  }

  // -------------------------------------------------------------------------
  // Pull Requests
  // -------------------------------------------------------------------------

  /**
   * Create a pull request.
   *
   * @param repo - Repository in `owner/repo` format
   * @param args - PR creation arguments
   */
  createPR(repo: string, args: PRCreateArgs): GHResult {
    const parts: string[] = [
      "gh pr create",
      `--repo ${shellArg(repo)}`,
      `--title ${shellArg(args.title)}`,
      `--body ${shellArg(args.body)}`,
    ];
    if (args.base) parts.push(`--base ${shellArg(args.base)}`);
    if (args.draft) parts.push("--draft");
    if (args.labels && args.labels.length > 0) {
      parts.push(`--label ${shellArg(args.labels.join(","))}`);
    }

    const command = parts.join(" ");
    const result = this.exec(command);
    return this.toGHResult("create-pr", result);
  }

  /**
   * View details of a pull request as JSON.
   *
   * @param repo   - Repository in `owner/repo` format
   * @param number - PR number
   */
  viewPR(repo: string, number: number): GHResult {
    const command = `gh pr view ${number} --repo ${shellArg(repo)} --json number,title,body,state,author,labels,url`;
    const result = this.exec(command, true);
    return this.toGHResult("view-pr", result, true);
  }

  /**
   * Review a pull request.
   *
   * @param repo   - Repository in `owner/repo` format
   * @param number - PR number
   * @param event  - Review decision
   * @param body   - Optional review comment body
   */
  reviewPR(
    repo: string,
    number: number,
    event: "approve" | "request-changes" | "comment",
    body?: string,
  ): GHResult {
    const parts: string[] = [
      `gh pr review ${number}`,
      `--repo ${shellArg(repo)}`,
      `--${event}`,
    ];
    if (body) parts.push(`--body ${shellArg(body)}`);

    const command = parts.join(" ");
    const result = this.exec(command);
    return this.toGHResult("review-pr", result);
  }

  /**
   * Merge a pull request.
   *
   * @param repo     - Repository in `owner/repo` format
   * @param number   - PR number
   * @param strategy - Merge strategy (defaults to "merge")
   */
  mergePR(
    repo: string,
    number: number,
    strategy: "merge" | "squash" | "rebase" = "merge",
  ): GHResult {
    const flag =
      strategy === "squash"
        ? "--squash"
        : strategy === "rebase"
          ? "--rebase"
          : "--merge";
    const command = `gh pr merge ${number} --repo ${shellArg(repo)} ${flag}`;
    const result = this.exec(command);
    return this.toGHResult("merge-pr", result);
  }

  /**
   * List pull requests for a repository.
   *
   * @param repo  - Repository in `owner/repo` format
   * @param state - Filter by state (defaults to "open")
   */
  listPRs(repo: string, state: "open" | "closed" | "merged" = "open"): GHResult {
    const command = `gh pr list --repo ${shellArg(repo)} --state ${state} --json number,title,state,author,url`;
    const result = this.exec(command, true);
    return this.toGHResult("list-prs", result, true);
  }

  // -------------------------------------------------------------------------
  // Issues
  // -------------------------------------------------------------------------

  /**
   * Create a new issue.
   *
   * @param repo - Repository in `owner/repo` format
   * @param args - Issue creation arguments
   */
  createIssue(repo: string, args: IssueCreateArgs): GHResult {
    const parts: string[] = [
      "gh issue create",
      `--repo ${shellArg(repo)}`,
      `--title ${shellArg(args.title)}`,
      `--body ${shellArg(args.body)}`,
    ];
    if (args.labels && args.labels.length > 0) {
      parts.push(`--label ${shellArg(args.labels.join(","))}`);
    }
    if (args.assignees && args.assignees.length > 0) {
      parts.push(`--assignee ${shellArg(args.assignees.join(","))}`);
    }

    const command = parts.join(" ");
    const result = this.exec(command);
    return this.toGHResult("create-issue", result);
  }

  /**
   * Post a comment on an issue.
   *
   * @param repo   - Repository in `owner/repo` format
   * @param number - Issue number
   * @param body   - Comment body
   */
  commentIssue(repo: string, number: number, body: string): GHResult {
    const command = `gh issue comment ${number} --repo ${shellArg(repo)} --body ${shellArg(body)}`;
    const result = this.exec(command);
    return this.toGHResult("comment-issue", result);
  }

  /**
   * Close an issue.
   *
   * @param repo   - Repository in `owner/repo` format
   * @param number - Issue number
   */
  closeIssue(repo: string, number: number): GHResult {
    const command = `gh issue close ${number} --repo ${shellArg(repo)}`;
    const result = this.exec(command);
    return this.toGHResult("close-issue", result);
  }

  /**
   * List issues for a repository.
   *
   * @param repo  - Repository in `owner/repo` format
   * @param state - Filter by state (defaults to "open")
   */
  listIssues(repo: string, state: "open" | "closed" = "open"): GHResult {
    const command = `gh issue list --repo ${shellArg(repo)} --state ${state} --json number,title,state,author,url`;
    const result = this.exec(command, true);
    return this.toGHResult("list-issues", result, true);
  }

  // -------------------------------------------------------------------------
  // Search
  // -------------------------------------------------------------------------

  /**
   * Search GitHub repositories.
   *
   * @param query - Search query string
   * @param limit - Max results to return (default 10)
   */
  searchRepos(query: string, limit = 10): GHResult {
    const command = `gh search repos ${shellArg(query)} --limit ${limit} --json fullName,description,url,stargazersCount,language`;
    const result = this.exec(command, true);
    return this.toGHResult("search-repos", result, true);
  }

  /**
   * Search code across GitHub.
   *
   * @param query - Code search query
   * @param repo  - Optional repo scope in `owner/repo` format
   */
  searchCode(query: string, repo?: string): GHResult {
    const parts: string[] = [
      `gh search code ${shellArg(query)}`,
      "--json path,repository,url",
    ];
    if (repo) parts.push(`--repo ${shellArg(repo)}`);

    const command = parts.join(" ");
    const result = this.exec(command, true);
    return this.toGHResult("search-code", result, true);
  }

  // -------------------------------------------------------------------------
  // Workflows
  // -------------------------------------------------------------------------

  /**
   * Trigger a GitHub Actions workflow.
   *
   * @param repo     - Repository in `owner/repo` format
   * @param workflow - Workflow file name or ID
   * @param ref      - Branch or tag to run on (defaults to default branch)
   */
  triggerWorkflow(repo: string, workflow: string, ref?: string): GHResult {
    const parts: string[] = [
      `gh workflow run ${shellArg(workflow)}`,
      `--repo ${shellArg(repo)}`,
    ];
    if (ref) parts.push(`--ref ${shellArg(ref)}`);

    const command = parts.join(" ");
    const result = this.exec(command);
    return this.toGHResult("trigger-workflow", result);
  }

  /**
   * View a workflow run.
   *
   * @param repo     - Repository in `owner/repo` format
   * @param runId    - Workflow run ID
   */
  viewWorkflow(repo: string, runId: number): GHResult {
    const command = `gh run view ${runId} --repo ${shellArg(repo)} --json status,conclusion,name,startedAt,updatedAt,url`;
    const result = this.exec(command, true);
    return this.toGHResult("view-workflow", result, true);
  }

  /**
   * List workflows for a repository.
   *
   * @param repo - Repository in `owner/repo` format
   */
  listWorkflows(repo: string): GHResult {
    const command = `gh workflow list --repo ${shellArg(repo)} --json id,name,state`;
    const result = this.exec(command, true);
    return this.toGHResult("list-workflows", result, true);
  }

  // -------------------------------------------------------------------------
  // Rate limit detection
  // -------------------------------------------------------------------------

  /**
   * Detect whether an error string indicates a GitHub API rate limit.
   *
   * @param error - Error message or stderr output
   * @returns true if the error is a rate-limit response
   */
  handleRateLimit(error: string): boolean {
    const lower = error.toLowerCase();
    return (
      lower.includes("rate limit") ||
      lower.includes("rate_limit") ||
      lower.includes("429") ||
      lower.includes("api rate limit exceeded") ||
      lower.includes("secondary rate limit")
    );
  }

  // -------------------------------------------------------------------------
  // Private helpers
  // -------------------------------------------------------------------------

  /**
   * Convert a raw exec result into a typed GHResult.
   *
   * @param action     - The action that produced this result
   * @param execResult - Raw exec return value
   * @param parseJson  - Whether to attempt JSON.parse on stdout
   */
  private toGHResult(
    action: GHAction,
    execResult: { stdout: string; success: boolean; error?: string },
    parseJson = false,
  ): GHResult {
    if (!execResult.success) {
      return {
        success: false,
        error: execResult.error,
        raw: execResult.stdout || undefined,
        action,
      };
    }

    const raw = execResult.stdout.trim();

    if (parseJson && raw) {
      try {
        const data = JSON.parse(raw) as unknown;
        return { success: true, data, raw, action };
      } catch {
        // Fall through to raw-only result
      }
    }

    return { success: true, raw, action };
  }
}
