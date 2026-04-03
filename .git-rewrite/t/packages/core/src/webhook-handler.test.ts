import { createHmac } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { WebhookHandler, verifyWebhookSignature } from "./webhook-handler.js";

describe("WebhookHandler", () => {
  const enqueue = vi.fn();
  let handler: WebhookHandler;

  beforeEach(() => {
    enqueue.mockReset();
    enqueue.mockReturnValue("task-123");
    handler = new WebhookHandler({ enqueue });
  });

  it("enqueues opened issues", async () => {
    const result = await handler.handleGitHubWebhook("issues", {
      action: "opened",
      repository: { full_name: "acme/dantecode" },
      issue: {
        number: 42,
        title: "Fix login loop",
        body: "Users are getting bounced back to the sign-in page.",
        html_url: "https://github.com/acme/dantecode/issues/42",
      },
    });

    expect(result.enqueued).toBe(true);
    expect(result.taskId).toBe("task-123");
    expect(enqueue).toHaveBeenCalledWith(expect.stringContaining("Fix login loop"));
    expect(enqueue).toHaveBeenCalledWith(expect.stringContaining("issue #42"));
  });

  it("ignores issue comments that do not mention the trigger handle", async () => {
    const result = await handler.handleGitHubWebhook("issue_comment", {
      action: "created",
      repository: { full_name: "acme/dantecode" },
      issue: { number: 7, title: "Intermittent CI failure" },
      comment: {
        body: "I can still reproduce this locally.",
      },
    });

    expect(result).toEqual({ enqueued: false, reason: "no_trigger" });
    expect(enqueue).not.toHaveBeenCalled();
  });

  it("enqueues issue comments that mention the trigger handle", async () => {
    const result = await handler.handleGitHubWebhook("issue_comment", {
      action: "created",
      repository: { full_name: "acme/dantecode" },
      issue: {
        number: 7,
        title: "Intermittent CI failure",
        body: "Happens only on Windows runners.",
      },
      comment: {
        body: "@dantecode please investigate the failing upload step.",
      },
    });

    expect(result.enqueued).toBe(true);
    expect(enqueue).toHaveBeenCalledWith(expect.stringContaining("Intermittent CI failure"));
    expect(enqueue).toHaveBeenCalledWith(
      expect.stringContaining("please investigate the failing upload step."),
    );
  });

  it("enqueues opened pull requests", async () => {
    const result = await handler.handleGitHubWebhook("pull_request", {
      action: "opened",
      repository: { full_name: "acme/dantecode" },
      pull_request: {
        number: 19,
        title: "Refactor background agent lifecycle",
        body: "This refactor prepares Docker-backed tasks.",
        html_url: "https://github.com/acme/dantecode/pull/19",
      },
    });

    expect(result.enqueued).toBe(true);
    expect(enqueue).toHaveBeenCalledWith(
      expect.stringContaining("Refactor background agent lifecycle"),
    );
    expect(enqueue).toHaveBeenCalledWith(expect.stringContaining("pull request #19"));
  });

  it("enqueues pull request reviews when they mention the trigger handle", async () => {
    const result = await handler.handleGitHubWebhook("pull_request_review", {
      action: "submitted",
      repository: { full_name: "acme/dantecode" },
      pull_request: {
        number: 21,
        title: "Improve MCP coverage",
      },
      review: {
        body: "@dantecode address the missing test coverage before merge.",
      },
    });

    expect(result.enqueued).toBe(true);
    expect(enqueue).toHaveBeenCalledWith(expect.stringContaining("Improve MCP coverage"));
    expect(enqueue).toHaveBeenCalledWith(
      expect.stringContaining("address the missing test coverage before merge."),
    );
  });

  it("enqueues deployment events", async () => {
    const result = await handler.handleGitHubWebhook("deployment", {
      action: "created",
      repository: { full_name: "acme/dantecode" },
      deployment: {
        environment: "production",
        description: "Deploy v1.0.0",
        sha: "abc123",
      },
    });

    expect(result.enqueued).toBe(true);
    expect(result.reason).toBe("deployment_created");
    expect(enqueue).toHaveBeenCalledWith(expect.stringContaining("production"));
  });

  it("enqueues push events", async () => {
    const result = await handler.handleGitHubWebhook("push", {
      ref: "refs/heads/main",
      repository: { full_name: "acme/dantecode" },
      head_commit: {
        message: "fix: resolve race condition",
        url: "https://github.com/acme/dantecode/commit/abc123",
      },
      compare: "https://github.com/acme/dantecode/compare/abc...def",
    });

    expect(result.enqueued).toBe(true);
    expect(result.reason).toBe("push");
    expect(enqueue).toHaveBeenCalledWith(expect.stringContaining("fix: resolve race condition"));
  });

  it("ignores push events without ref", async () => {
    const result = await handler.handleGitHubWebhook("push", {
      repository: { full_name: "acme/dantecode" },
    });

    expect(result.enqueued).toBe(false);
    expect(result.reason).toBe("ignored_push_event");
  });

  it("enqueues failed workflow run events", async () => {
    const result = await handler.handleGitHubWebhook("workflow_run", {
      action: "completed",
      repository: { full_name: "acme/dantecode" },
      workflow_run: {
        name: "CI Pipeline",
        conclusion: "failure",
        html_url: "https://github.com/acme/dantecode/actions/runs/12345",
      },
    });

    expect(result.enqueued).toBe(true);
    expect(result.reason).toBe("workflow_run_failure");
    expect(enqueue).toHaveBeenCalledWith(expect.stringContaining("CI Pipeline"));
  });

  it("ignores successful workflow runs", async () => {
    const result = await handler.handleGitHubWebhook("workflow_run", {
      action: "completed",
      repository: { full_name: "acme/dantecode" },
      workflow_run: {
        name: "CI Pipeline",
        conclusion: "success",
      },
    });

    expect(result.enqueued).toBe(false);
    expect(result.reason).toBe("ignored_workflow_run");
  });

  it("verifies webhook signature and processes event", async () => {
    const payload = JSON.stringify({ action: "opened", issue: { number: 1, title: "Test" } });
    const secret = "webhook-secret-123";
    const signature = "sha256=" + createHmac("sha256", secret).update(payload).digest("hex");

    const result = await handler.handleGitHubWebhookVerified(
      "issues",
      JSON.parse(payload),
      payload,
      signature,
      secret,
    );

    expect(result.enqueued).toBe(true);
  });

  it("rejects invalid webhook signatures", async () => {
    const result = await handler.handleGitHubWebhookVerified(
      "issues",
      { action: "opened", issue: { number: 1, title: "Test" } },
      '{"action":"opened"}',
      "sha256=invalid-signature-value",
      "my-secret",
    );

    expect(result.enqueued).toBe(false);
    expect(result.reason).toBe("invalid_signature");
    expect(enqueue).not.toHaveBeenCalled();
  });
});

describe("verifyWebhookSignature", () => {
  const secret = "test-secret-42";

  function sign(payload: string): string {
    return "sha256=" + createHmac("sha256", secret).update(payload).digest("hex");
  }

  it("returns true for valid signatures", () => {
    const payload = '{"action":"opened"}';
    expect(verifyWebhookSignature(payload, sign(payload), secret)).toBe(true);
  });

  it("returns false for invalid signatures", () => {
    expect(verifyWebhookSignature('{"data":true}', "sha256=bad", secret)).toBe(false);
  });

  it("returns false for empty payload", () => {
    expect(verifyWebhookSignature("", sign(""), secret)).toBe(false);
  });

  it("returns false for empty signature", () => {
    expect(verifyWebhookSignature("payload", "", secret)).toBe(false);
  });

  it("returns false for empty secret", () => {
    expect(verifyWebhookSignature("payload", "sha256=abc", "")).toBe(false);
  });

  it("returns false for mismatched length signatures", () => {
    expect(verifyWebhookSignature("payload", "sha256=short", secret)).toBe(false);
  });
});
