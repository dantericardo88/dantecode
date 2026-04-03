// ============================================================================
// @dantecode/danteforge-action - GitHub API Helpers
// Wraps Octokit calls for creating check runs with inline annotations,
// posting PR summary comments, and posting PR review comments.
// ============================================================================

import type { CheckRunAnnotation, PRReviewComment } from "./annotations.js";

/** Minimal Octokit shape so we do not depend on the full type at compile time. */
interface OctokitLike {
  rest: {
    checks: {
      create(params: Record<string, unknown>): Promise<unknown>;
    };
    issues: {
      createComment(params: Record<string, unknown>): Promise<unknown>;
    };
    pulls: {
      createReview(params: Record<string, unknown>): Promise<unknown>;
    };
  };
}

interface RepoContext {
  owner: string;
  repo: string;
  sha: string;
  pullNumber?: number;
}

/**
 * Create a GitHub Check Run with inline annotations.
 *
 * Check runs support up to 50 annotations per request. When there are more
 * than 50 we batch them into multiple calls (updating the same check run).
 */
export async function createCheckRun(
  octokit: OctokitLike,
  context: RepoContext,
  annotations: CheckRunAnnotation[],
  conclusion: "success" | "failure" | "neutral",
  summaryMarkdown: string,
): Promise<void> {
  const BATCH_SIZE = 50;
  const batches: CheckRunAnnotation[][] = [];

  for (let i = 0; i < annotations.length; i += BATCH_SIZE) {
    batches.push(annotations.slice(i, i + BATCH_SIZE));
  }

  // If there are no annotations we still create the check run for the summary.
  if (batches.length === 0) {
    batches.push([]);
  }

  for (let batchIndex = 0; batchIndex < batches.length; batchIndex++) {
    const batch = batches[batchIndex]!;
    await octokit.rest.checks.create({
      owner: context.owner,
      repo: context.repo,
      head_sha: context.sha,
      name: "DanteForge Verification",
      status: "completed",
      conclusion,
      output: {
        title: conclusion === "success" ? "All checks passed" : "Verification failures detected",
        summary: summaryMarkdown,
        annotations: batch,
      },
    });
  }
}

/**
 * Post a summary comment on a pull request.
 * Uses the Issues API (PR comments are issue comments in the GitHub API).
 */
export async function postPRComment(
  octokit: OctokitLike,
  context: RepoContext,
  body: string,
): Promise<void> {
  if (context.pullNumber === undefined) {
    return;
  }

  await octokit.rest.issues.createComment({
    owner: context.owner,
    repo: context.repo,
    issue_number: context.pullNumber,
    body,
  });
}

/**
 * Post inline review comments on a pull request via the Pulls Review API.
 */
export async function postPRReview(
  octokit: OctokitLike,
  context: RepoContext,
  comments: PRReviewComment[],
): Promise<void> {
  if (context.pullNumber === undefined || comments.length === 0) {
    return;
  }

  await octokit.rest.pulls.createReview({
    owner: context.owner,
    repo: context.repo,
    pull_number: context.pullNumber,
    event: "COMMENT",
    comments,
  });
}
