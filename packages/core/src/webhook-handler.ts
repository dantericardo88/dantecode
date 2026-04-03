// ============================================================================
// @dantecode/core - GitHub Webhook Handler
// Maps GitHub issues, comments, pull requests, and review events to
// background-agent tasks. Supports HMAC-SHA256 signature verification.
// ============================================================================

import { createHmac, timingSafeEqual } from "node:crypto";

export interface WebhookTaskEnqueuer {
  enqueue(prompt: string): string;
}

export interface WebhookDispatchResult {
  enqueued: boolean;
  reason: string;
  taskId?: string;
  prompt?: string;
}

/**
 * Verify a GitHub webhook signature using HMAC-SHA256.
 * Uses timing-safe comparison to prevent timing attacks.
 */
export function verifyWebhookSignature(
  payload: string,
  signature: string,
  secret: string,
): boolean {
  if (!payload || !signature || !secret) {
    return false;
  }

  const expected = "sha256=" + createHmac("sha256", secret).update(payload).digest("hex");

  if (expected.length !== signature.length) {
    return false;
  }

  try {
    return timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
  } catch {
    return false;
  }
}

interface GitHubRepositoryPayload {
  full_name?: string;
}

interface GitHubIssuePayload {
  number?: number;
  title?: string;
  body?: string;
  html_url?: string;
}

interface GitHubPullRequestPayload {
  number?: number;
  title?: string;
  body?: string;
  html_url?: string;
}

interface GitHubCommentPayload {
  body?: string;
}

interface GitHubReviewPayload {
  body?: string;
}

interface GitHubDeploymentPayload {
  environment?: string;
  description?: string;
  sha?: string;
}

interface GitHubPushPayload {
  ref?: string;
  compare?: string;
  head_commit?: { message?: string; url?: string };
}

interface GitHubWorkflowRunPayload {
  name?: string;
  conclusion?: string;
  html_url?: string;
}

interface GitHubWebhookPayload {
  action?: string;
  repository?: GitHubRepositoryPayload;
  issue?: GitHubIssuePayload;
  pull_request?: GitHubPullRequestPayload;
  comment?: GitHubCommentPayload;
  review?: GitHubReviewPayload;
  deployment?: GitHubDeploymentPayload;
  push?: GitHubPushPayload;
  ref?: string;
  compare?: string;
  head_commit?: { message?: string; url?: string };
  workflow_run?: GitHubWorkflowRunPayload;
}

export class WebhookHandler {
  private readonly triggerHandle: string;
  private readonly taskEnqueuer: WebhookTaskEnqueuer;

  constructor(taskEnqueuer: WebhookTaskEnqueuer, triggerHandle = "@dantecode") {
    this.taskEnqueuer = taskEnqueuer;
    this.triggerHandle = triggerHandle.toLowerCase();
  }

  /**
   * Handle a GitHub webhook with optional HMAC signature verification.
   * If `rawBody` and `signature` and `secret` are all provided, the signature
   * is verified before processing. Invalid signatures are rejected immediately.
   */
  async handleGitHubWebhookVerified(
    eventName: string,
    payload: GitHubWebhookPayload,
    rawBody: string,
    signature: string,
    secret: string,
  ): Promise<WebhookDispatchResult> {
    if (!verifyWebhookSignature(rawBody, signature, secret)) {
      return { enqueued: false, reason: "invalid_signature" };
    }
    return this.handleGitHubWebhook(eventName, payload);
  }

  async handleGitHubWebhook(
    eventName: string,
    payload: GitHubWebhookPayload,
  ): Promise<WebhookDispatchResult> {
    switch (eventName) {
      case "issues":
        return this.handleIssueOpened(payload);
      case "issue_comment":
        return this.handleIssueComment(payload);
      case "pull_request":
        return this.handlePullRequestOpened(payload);
      case "pull_request_review":
        return this.handlePullRequestReview(payload);
      case "deployment":
        return this.handleDeployment(payload);
      case "push":
        return this.handlePush(payload);
      case "workflow_run":
        return this.handleWorkflowRun(payload);
      default:
        return { enqueued: false, reason: "unsupported_event" };
    }
  }

  private handleIssueOpened(payload: GitHubWebhookPayload): WebhookDispatchResult {
    if (payload.action !== "opened" || !payload.issue) {
      return { enqueued: false, reason: "ignored_issue_event" };
    }

    const prompt = this.buildPrompt({
      repository: payload.repository?.full_name,
      sourceLabel: `GitHub issue #${payload.issue.number ?? "unknown"}`,
      title: payload.issue.title,
      body: payload.issue.body,
      url: payload.issue.html_url,
    });

    return this.enqueuePrompt(prompt, "issue_opened");
  }

  private handleIssueComment(payload: GitHubWebhookPayload): WebhookDispatchResult {
    if (payload.action !== "created" || !payload.comment || !payload.issue) {
      return { enqueued: false, reason: "ignored_issue_comment" };
    }

    const instruction = this.extractInstruction(payload.comment.body);
    if (!instruction) {
      return { enqueued: false, reason: "no_trigger" };
    }

    const prompt = this.buildPrompt({
      repository: payload.repository?.full_name,
      sourceLabel: `GitHub issue #${payload.issue.number ?? "unknown"}`,
      title: payload.issue.title,
      body: payload.issue.body,
      url: payload.issue.html_url,
      instruction,
    });

    return this.enqueuePrompt(prompt, "issue_comment_trigger");
  }

  private handlePullRequestOpened(payload: GitHubWebhookPayload): WebhookDispatchResult {
    if (payload.action !== "opened" || !payload.pull_request) {
      return { enqueued: false, reason: "ignored_pull_request_event" };
    }

    const prompt = this.buildPrompt({
      repository: payload.repository?.full_name,
      sourceLabel: `GitHub pull request #${payload.pull_request.number ?? "unknown"}`,
      title: payload.pull_request.title,
      body: payload.pull_request.body,
      url: payload.pull_request.html_url,
    });

    return this.enqueuePrompt(prompt, "pull_request_opened");
  }

  private handlePullRequestReview(payload: GitHubWebhookPayload): WebhookDispatchResult {
    if (payload.action !== "submitted" || !payload.review || !payload.pull_request) {
      return { enqueued: false, reason: "ignored_pull_request_review" };
    }

    const instruction = this.extractInstruction(payload.review.body);
    if (!instruction) {
      return { enqueued: false, reason: "no_trigger" };
    }

    const prompt = this.buildPrompt({
      repository: payload.repository?.full_name,
      sourceLabel: `GitHub pull request #${payload.pull_request.number ?? "unknown"}`,
      title: payload.pull_request.title,
      body: payload.pull_request.body,
      url: payload.pull_request.html_url,
      instruction,
    });

    return this.enqueuePrompt(prompt, "pull_request_review_trigger");
  }

  private handleDeployment(payload: GitHubWebhookPayload): WebhookDispatchResult {
    if (payload.action !== "created" || !payload.deployment) {
      return { enqueued: false, reason: "ignored_deployment_event" };
    }

    const prompt = this.buildPrompt({
      repository: payload.repository?.full_name,
      sourceLabel: `GitHub deployment to ${payload.deployment.environment ?? "unknown"}`,
      title: payload.deployment.description ?? "Deployment triggered",
      body: payload.deployment.sha ? `Commit SHA: ${payload.deployment.sha}` : undefined,
    });

    return this.enqueuePrompt(prompt, "deployment_created");
  }

  private handlePush(payload: GitHubWebhookPayload): WebhookDispatchResult {
    const ref = payload.ref;
    const headCommit = payload.head_commit;
    if (!ref) {
      return { enqueued: false, reason: "ignored_push_event" };
    }

    const prompt = this.buildPrompt({
      repository: payload.repository?.full_name,
      sourceLabel: `GitHub push to ${ref}`,
      title: headCommit?.message ?? "Push event",
      body: headCommit?.url ? `Commit URL: ${headCommit.url}` : undefined,
      url: payload.compare,
    });

    return this.enqueuePrompt(prompt, "push");
  }

  private handleWorkflowRun(payload: GitHubWebhookPayload): WebhookDispatchResult {
    if (!payload.workflow_run) {
      return { enqueued: false, reason: "ignored_workflow_run" };
    }

    const wf = payload.workflow_run;
    if (payload.action === "completed" && wf.conclusion === "failure") {
      const prompt = this.buildPrompt({
        repository: payload.repository?.full_name,
        sourceLabel: `GitHub workflow "${wf.name ?? "unknown"}" failed`,
        title: `Workflow failure: ${wf.name ?? "unknown"}`,
        body: `The workflow run concluded with status: ${wf.conclusion}.`,
        url: wf.html_url,
      });

      return this.enqueuePrompt(prompt, "workflow_run_failure");
    }

    return { enqueued: false, reason: "ignored_workflow_run" };
  }

  private extractInstruction(body?: string): string | null {
    const text = body?.trim();
    if (!text) {
      return null;
    }

    const lowered = text.toLowerCase();
    if (!lowered.includes(this.triggerHandle)) {
      return null;
    }

    const instruction = text
      .replace(new RegExp(this.escapeRegExp(this.triggerHandle), "ig"), "")
      .trim();
    return instruction.length > 0 ? instruction : "Please investigate and act on this request.";
  }

  private buildPrompt(input: {
    repository?: string;
    sourceLabel: string;
    title?: string;
    body?: string;
    url?: string;
    instruction?: string;
  }): string {
    const lines = [
      "Handle this GitHub event in the repository.",
      `Repository: ${input.repository ?? "unknown"}`,
      `Source: ${input.sourceLabel}`,
      `Title: ${input.title ?? "(untitled)"}`,
      `Context: ${input.body?.trim() || "(no additional description provided)"}`,
    ];

    if (input.instruction) {
      lines.push(`Requested action: ${input.instruction}`);
    }
    if (input.url) {
      lines.push(`URL: ${input.url}`);
    }

    return lines.join("\n");
  }

  private enqueuePrompt(prompt: string, reason: string): WebhookDispatchResult {
    const taskId = this.taskEnqueuer.enqueue(prompt);
    return {
      enqueued: true,
      reason,
      taskId,
      prompt,
    };
  }

  private escapeRegExp(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }
}
