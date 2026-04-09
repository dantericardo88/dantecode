import { describe, it, expect } from "vitest";
import * as crypto from "node:crypto";
import { SlackWebhookProvider, LinearWebhookProvider } from "./webhook-providers.js";

// ─── Signature helpers ───────────────────────────────────────────────────────

function makeHmac(testKey: string, body: string): string {
  return crypto.createHmac("sha256", testKey).update(body).digest("hex");
}

// ─── SlackWebhookProvider tests ──────────────────────────────────────────────

describe("SlackWebhookProvider", () => {
  const slackTestKey = "slack-unit-test-key-xyz";

  it("parses a valid slash command payload and extracts the text", () => {
    const body = "command=%2Fdante&text=Fix+the+login+bug&user_id=U123&channel_id=C456&team_id=T789";
    const sig = makeHmac(slackTestKey, body);
    const provider = new SlackWebhookProvider(slackTestKey);
    const event = provider.parsePayload(body, sig);

    expect(event).not.toBeNull();
    expect(event!.source).toBe("slack");
    expect(event!.taskDescription).toBe("Fix the login bug");
    expect(event!.metadata["channel"]).toBe("C456");
    expect(event!.metadata["user"]).toBe("U123");
    expect(event!.metadata["command"]).toBe("/dante");
  });

  it("returns null when signature is invalid", () => {
    const body = "command=%2Fdante&text=Do+something";
    const provider = new SlackWebhookProvider(slackTestKey);
    const event = provider.parsePayload(body, "badsignature");

    expect(event).toBeNull();
  });

  it("returns null when signing key is not set", () => {
    // No signing key — provider has no key, should return null
    const provider = new SlackWebhookProvider(undefined);
    // Clear env var to ensure missing key
    const savedEnv = process.env["SLACK_WEBHOOK_SECRET"];
    delete process.env["SLACK_WEBHOOK_SECRET"];

    const body = "command=%2Fdante&text=Do+something";
    const event = provider.parsePayload(body);

    // Restore env
    if (savedEnv !== undefined) {
      process.env["SLACK_WEBHOOK_SECRET"] = savedEnv;
    }
    expect(event).toBeNull();
  });

  it("extracts task from Events API mention payload", () => {
    const payload = {
      type: "url_verification",
      event: {
        type: "app_mention",
        text: "<@U999> Please refactor the auth module",
        user: "U888",
        channel: "C111",
      },
      team_id: "T222",
    };
    const body = JSON.stringify(payload);
    const sig = makeHmac(slackTestKey, body);
    const provider = new SlackWebhookProvider(slackTestKey);
    const event = provider.parsePayload(body, sig);

    expect(event).not.toBeNull();
    expect(event!.taskDescription).toBe("Please refactor the auth module");
  });
});

// ─── LinearWebhookProvider tests ─────────────────────────────────────────────

describe("LinearWebhookProvider", () => {
  const linearTestKey = "linear-unit-test-key-abc";

  function makeLinearBody(overrides: Record<string, unknown> = {}): string {
    return JSON.stringify({
      type: "Issue",
      action: "create",
      createdAt: "2026-04-06T10:00:00.000Z",
      data: {
        id: "issue-001",
        number: 42,
        title: "Add dark mode support",
        description: "Users want dark mode. Please implement it across all screens.",
        teamId: "team-001",
        stateId: "state-open",
        url: "https://linear.app/acme/issue/issue-001",
      },
      ...overrides,
    });
  }

  it("parses a valid Issue.created payload", () => {
    const body = makeLinearBody();
    const sig = makeHmac(linearTestKey, body);
    const provider = new LinearWebhookProvider(linearTestKey);
    const event = provider.parsePayload(body, sig);

    expect(event).not.toBeNull();
    expect(event!.source).toBe("linear");
    expect(event!.taskDescription).toContain("Add dark mode support");
    expect(event!.metadata["issueId"]).toBe("issue-001");
    expect(event!.metadata["action"]).toBe("created");
    expect(event!.timestamp).toBe("2026-04-06T10:00:00.000Z");
  });

  it("parses a valid Issue.assigned payload", () => {
    const body = JSON.stringify({
      type: "Issue",
      action: "update",
      createdAt: "2026-04-06T11:00:00.000Z",
      updatedFrom: { assigneeId: null },
      data: {
        id: "issue-002",
        number: 43,
        title: "Fix the login redirect loop",
        teamId: "team-001",
        stateId: "state-in-progress",
        assignee: { id: "user-007", name: "Alice" },
        url: "https://linear.app/acme/issue/issue-002",
      },
    });
    const sig = makeHmac(linearTestKey, body);
    const provider = new LinearWebhookProvider(linearTestKey);
    const event = provider.parsePayload(body, sig);

    expect(event).not.toBeNull();
    expect(event!.source).toBe("linear");
    expect(event!.taskDescription).toBe("Fix the login redirect loop");
    expect(event!.metadata["action"]).toBe("assigned");
    expect(event!.metadata["assigneeId"]).toBe("user-007");
  });

  it("returns null for non-Issue action types (e.g. Comment.created)", () => {
    const body = JSON.stringify({
      type: "Comment",
      action: "create",
      createdAt: "2026-04-06T12:00:00.000Z",
      data: { id: "comment-001", body: "Looks good!" },
    });
    const sig = makeHmac(linearTestKey, body);
    const provider = new LinearWebhookProvider(linearTestKey);
    const event = provider.parsePayload(body, sig);

    expect(event).toBeNull();
  });

  it("returns null when signing key is not set", () => {
    const savedEnv = process.env["LINEAR_WEBHOOK_SECRET"];
    delete process.env["LINEAR_WEBHOOK_SECRET"];

    const provider = new LinearWebhookProvider(undefined);
    const body = makeLinearBody();
    const event = provider.parsePayload(body);

    // Restore env
    if (savedEnv !== undefined) {
      process.env["LINEAR_WEBHOOK_SECRET"] = savedEnv;
    }
    expect(event).toBeNull();
  });
});
