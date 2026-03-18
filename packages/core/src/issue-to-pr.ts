// ============================================================================
// @dantecode/core — Issue-to-PR Pipeline
// Automated pipeline that converts GitHub issues into pull requests.
// Parses the issue, creates a worktree, runs the agent, verifies with
// DanteForge, creates a PR, and comments back on the issue.
// ============================================================================

import { exec } from "node:child_process";
import { promisify } from "node:util";

const execAsync = promisify(exec);

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export interface IssueToPRConfig {
  /** GitHub personal access token or app token */
  githubToken: string;
  /** Repository owner/name (e.g., "dantecode/dantecode") */
  repository: string;
  /** Base branch to create worktree from */
  baseBranch?: string;
  /** Directory for worktrees */
  worktreeBase?: string;
  /** Whether to run DanteForge verification before creating PR */
  verifyBeforePR?: boolean;
  /** Verification commands to run */
  verifyCommands?: string[];
  /** Maximum time in ms for the agent to work */
  agentTimeoutMs?: number;
}

export interface GitHubIssueInfo {
  number: number;
  title: string;
  body: string;
  labels: string[];
  url: string;
}

export interface IssueToPRResult {
  success: boolean;
  issueNumber: number;
  prNumber?: number;
  prUrl?: string;
  branchName?: string;
  verificationPassed?: boolean;
  error?: string;
  durationMs: number;
}

export type PipelineStage =
  | "parsing"
  | "branching"
  | "executing"
  | "verifying"
  | "creating_pr"
  | "commenting"
  | "completed"
  | "failed";

export interface PipelineProgress {
  stage: PipelineStage;
  message: string;
  timestamp: string;
}

export type AgentExecutor = (
  prompt: string,
  workdir: string,
) => Promise<{ output: string; touchedFiles: string[] }>;

/**
 * Converts a GitHub issue into a pull request through an automated pipeline.
 */
export class IssueToPRPipeline {
  private readonly config: Required<IssueToPRConfig>;
  private readonly projectRoot: string;
  private onProgress?: (progress: PipelineProgress) => void;

  constructor(projectRoot: string, config: IssueToPRConfig) {
    this.projectRoot = projectRoot;
    this.config = {
      githubToken: config.githubToken,
      repository: config.repository,
      baseBranch: config.baseBranch ?? "main",
      worktreeBase: config.worktreeBase ?? ".worktrees",
      verifyBeforePR: config.verifyBeforePR ?? true,
      verifyCommands: config.verifyCommands ?? [
        "npm run typecheck",
        "npm run test -- --run",
        "npm run lint",
      ],
      agentTimeoutMs: config.agentTimeoutMs ?? 600_000,
    };
  }

  /** Set a progress callback */
  setProgressCallback(cb: (progress: PipelineProgress) => void): void {
    this.onProgress = cb;
  }

  /**
   * Run the full pipeline for an issue.
   * Steps: parse -> branch -> execute -> verify -> PR -> comment
   */
  async run(
    issue: GitHubIssueInfo,
    agentExecutor: AgentExecutor,
  ): Promise<IssueToPRResult> {
    const startTime = Date.now();
    let branchName: string | undefined;
    let worktreeDir: string | undefined;

    try {
      // Step 1: Parse issue
      this.emitProgress("parsing", `Parsing issue #${issue.number}: ${issue.title}`);
      const prompt = this.buildAgentPrompt(issue);

      // Step 2: Create branch and worktree
      this.emitProgress("branching", `Creating worktree branch for issue #${issue.number}`);
      const branchResult = await this.createBranch(issue.number, issue.title);
      branchName = branchResult.branchName;
      worktreeDir = branchResult.worktreeDir;

      // Step 3: Execute the agent
      this.emitProgress("executing", `Running agent on issue #${issue.number}`);
      const agentPromise = agentExecutor(prompt, worktreeDir);
      const timeoutPromise = new Promise<never>((_resolve, reject) => {
        setTimeout(
          () => reject(new Error(`Agent timed out after ${this.config.agentTimeoutMs}ms`)),
          this.config.agentTimeoutMs,
        );
      });
      const agentResult = await Promise.race([agentPromise, timeoutPromise]);

      // Step 4: Commit changes in the worktree
      if (agentResult.touchedFiles.length > 0) {
        await execAsync("git add -A && git commit -m \"fix: automated changes for issue\"", {
          cwd: worktreeDir,
        });
        await execAsync(`git push origin ${branchName}`, {
          cwd: worktreeDir,
        });
      } else {
        return {
          success: false,
          issueNumber: issue.number,
          branchName,
          error: "Agent produced no file changes",
          durationMs: Date.now() - startTime,
        };
      }

      // Step 5: Verify
      let verificationPassed = true;
      let verificationOutput = "";
      if (this.config.verifyBeforePR) {
        this.emitProgress("verifying", "Running verification commands");
        const verifyResult = await this.verify(worktreeDir);
        verificationPassed = verifyResult.passed;
        verificationOutput = verifyResult.output;
      }

      // Step 6: Create PR
      this.emitProgress(
        "creating_pr",
        `Creating pull request for issue #${issue.number}`,
      );
      const prResult = await this.createPullRequest(
        branchName,
        issue,
        verificationOutput,
      );

      // Step 7: Comment on issue
      this.emitProgress(
        "commenting",
        `Commenting on issue #${issue.number} with PR link`,
      );
      await this.commentOnIssue(issue.number, prResult.prUrl, verificationPassed);

      this.emitProgress("completed", `Pipeline complete for issue #${issue.number}`);

      return {
        success: true,
        issueNumber: issue.number,
        prNumber: prResult.prNumber,
        prUrl: prResult.prUrl,
        branchName,
        verificationPassed,
        durationMs: Date.now() - startTime,
      };
    } catch (err: unknown) {
      this.emitProgress("failed", `Pipeline failed: ${errorMessage(err)}`);

      // Attempt cleanup on failure
      if (worktreeDir && branchName) {
        try {
          await this.cleanupWorktree(worktreeDir, branchName);
        } catch {
          // Best-effort cleanup — ignore errors
        }
      }

      return {
        success: false,
        issueNumber: issue.number,
        branchName,
        error: errorMessage(err),
        durationMs: Date.now() - startTime,
      };
    }
  }

  /**
   * Create a worktree branch for the issue.
   */
  async createBranch(
    issueNumber: number,
    title: string,
  ): Promise<{ branchName: string; worktreeDir: string }> {
    const sanitized = this.sanitizeBranchName(title);
    const branchName = `issue-${issueNumber}/${sanitized}`;
    const worktreeDir = `${this.projectRoot}/${this.config.worktreeBase}/${branchName}`;

    // Fetch latest from remote
    await execAsync(`git fetch origin ${this.config.baseBranch}`, {
      cwd: this.projectRoot,
    });

    // Create the worktree with a new branch based on the base branch
    await execAsync(
      `git worktree add -b ${branchName} "${worktreeDir}" origin/${this.config.baseBranch}`,
      { cwd: this.projectRoot },
    );

    return { branchName, worktreeDir };
  }

  /**
   * Build the agent prompt from the issue context.
   */
  buildAgentPrompt(issue: GitHubIssueInfo): string {
    const labelStr =
      issue.labels.length > 0 ? `Labels: ${issue.labels.join(", ")}` : "";

    const lines = [
      `You are working on GitHub issue #${issue.number} in the repository ${this.config.repository}.`,
      "",
      `## Issue Title`,
      issue.title,
      "",
      `## Issue Body`,
      issue.body,
      "",
    ];

    if (labelStr) {
      lines.push(labelStr, "");
    }

    lines.push(
      `## Instructions`,
      `- Read the issue carefully and understand the requested changes.`,
      `- Implement the necessary code changes to resolve this issue.`,
      `- Write or update tests to cover your changes.`,
      `- Ensure the code compiles and tests pass.`,
      `- Keep changes minimal and focused on the issue.`,
      "",
      `Issue URL: ${issue.url}`,
    );

    return lines.join("\n");
  }

  /**
   * Run verification commands (typecheck, test, lint).
   */
  async verify(
    worktreeDir: string,
  ): Promise<{ passed: boolean; output: string }> {
    const outputs: string[] = [];
    let allPassed = true;

    for (const command of this.config.verifyCommands) {
      try {
        const { stdout, stderr } = await execAsync(command, {
          cwd: worktreeDir,
          timeout: 120_000,
        });
        outputs.push(`$ ${command}\n${stdout}${stderr ? `\nSTDERR: ${stderr}` : ""}`);
      } catch (err: unknown) {
        allPassed = false;
        const execErr = err as Error & { stdout?: string; stderr?: string };
        outputs.push(
          `$ ${command} [FAILED]\n${execErr.stdout ?? ""}${execErr.stderr ? `\nSTDERR: ${execErr.stderr}` : ""}\nError: ${errorMessage(err)}`,
        );
      }
    }

    return { passed: allPassed, output: outputs.join("\n\n") };
  }

  /**
   * Create a pull request using the GitHub API.
   * Uses fetch() to call the GitHub REST API.
   */
  async createPullRequest(
    branchName: string,
    issue: GitHubIssueInfo,
    verificationOutput?: string,
  ): Promise<{ prNumber: number; prUrl: string }> {
    const title = `fix: resolve issue #${issue.number} — ${issue.title}`;

    const bodyLines = [
      `## Summary`,
      `Automated PR to resolve [#${issue.number}](${issue.url}).`,
      "",
      `### Issue`,
      `> ${issue.title}`,
      "",
      issue.body ? `${issue.body.slice(0, 500)}${issue.body.length > 500 ? "..." : ""}` : "",
      "",
    ];

    if (verificationOutput) {
      bodyLines.push(
        `### Verification`,
        "```",
        verificationOutput.slice(0, 2000),
        "```",
        "",
      );
    }

    bodyLines.push("---", "Generated by DanteCode Issue-to-PR Pipeline");

    const body = bodyLines.join("\n");

    const response = (await this.githubAPI(
      "POST",
      `/repos/${this.config.repository}/pulls`,
      {
        title,
        body,
        head: branchName,
        base: this.config.baseBranch,
      },
    )) as { number: number; html_url: string };

    return { prNumber: response.number, prUrl: response.html_url };
  }

  /**
   * Comment on the original issue with the PR link and status.
   */
  async commentOnIssue(
    issueNumber: number,
    prUrl: string,
    success: boolean,
  ): Promise<void> {
    const statusEmoji = success ? "white_check_mark" : "warning";
    const statusText = success
      ? "All verification checks passed."
      : "Some verification checks failed. Please review the PR.";

    const body = [
      `**DanteCode Automation** created a pull request for this issue:`,
      "",
      `PR: ${prUrl}`,
      "",
      `:${statusEmoji}: ${statusText}`,
    ].join("\n");

    await this.githubAPI(
      "POST",
      `/repos/${this.config.repository}/issues/${issueNumber}/comments`,
      { body },
    );
  }

  /**
   * Clean up the worktree after pipeline completion.
   */
  async cleanupWorktree(
    worktreeDir: string,
    branchName: string,
  ): Promise<void> {
    await execAsync(`git worktree remove "${worktreeDir}" --force`, {
      cwd: this.projectRoot,
    });
    await execAsync(`git branch -D ${branchName}`, {
      cwd: this.projectRoot,
    });
  }

  private emitProgress(stage: PipelineStage, message: string): void {
    this.onProgress?.({
      stage,
      message,
      timestamp: new Date().toISOString(),
    });
  }

  sanitizeBranchName(title: string): string {
    return title
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, "")
      .replace(/\s+/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 60);
  }

  async githubAPI(
    method: string,
    path: string,
    body?: unknown,
  ): Promise<unknown> {
    const url = `https://api.github.com${path}`;
    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.config.githubToken}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
    };

    if (body !== undefined) {
      headers["Content-Type"] = "application/json";
    }

    const response = await fetch(url, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });

    if (!response.ok) {
      const errorBody = await response.text();
      throw new Error(
        `GitHub API ${method} ${path} failed (${response.status}): ${errorBody}`,
      );
    }

    const contentType = response.headers.get("content-type") ?? "";
    if (contentType.includes("application/json")) {
      return response.json();
    }
    return undefined;
  }
}
