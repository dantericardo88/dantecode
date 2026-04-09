/**
 * Webhook payload parsers for Slack and Linear integrations.
 * Pure parsing — no HTTP calls, no side effects.
 */

import * as crypto from "node:crypto";

// ─── AutomationTriggerEvent ──────────────────────────────────────────────────

export interface AutomationTriggerEvent {
  source: "slack" | "linear" | "github" | "schedule" | "watch";
  taskDescription: string;
  metadata: Record<string, unknown>;
  timestamp: string;
}

// ─── Signature Helpers ───────────────────────────────────────────────────────

function verifyHmacSha256(secret: string, body: string, signature: string): boolean {
  try {
    const expected = crypto.createHmac("sha256", secret).update(body).digest("hex");
    // Normalize: strip any "sha256=" prefix
    const normalized = signature.startsWith("sha256=") ? signature.slice(7) : signature;
    if (expected.length !== normalized.length) return false;
    return crypto.timingSafeEqual(Buffer.from(expected, "hex"), Buffer.from(normalized, "hex"));
  } catch {
    return false;
  }
}

// ─── SlackWebhookProvider ────────────────────────────────────────────────────

/**
 * Parses incoming Slack slash command or mention payloads.
 * Requires SLACK_WEBHOOK_SECRET env var for signature verification.
 */
export class SlackWebhookProvider {
  private readonly secret: string | undefined;

  constructor(secret?: string) {
    this.secret = secret ?? process.env["SLACK_WEBHOOK_SECRET"];
  }

  /**
   * Parse a Slack webhook payload.
   * Returns null if:
   *   - SLACK_WEBHOOK_SECRET is not set
   *   - signature is present but invalid
   *   - payload cannot be parsed
   */
  parsePayload(body: string, signature?: string): AutomationTriggerEvent | null {
    if (!this.secret) {
      return null;
    }

    if (signature !== undefined) {
      if (!verifyHmacSha256(this.secret, body, signature)) {
        return null;
      }
    }

    let payload: Record<string, unknown>;
    try {
      // Slack sends either JSON (Events API) or URL-encoded (slash commands)
      if (body.trimStart().startsWith("{")) {
        payload = JSON.parse(body) as Record<string, unknown>;
      } else {
        // URL-encoded form data
        const params = new URLSearchParams(body);
        payload = Object.fromEntries(params.entries());
      }
    } catch {
      return null;
    }

    // Extract task description from common Slack payload shapes:
    // - Slash command: "text" field
    // - Events API mention: event.text
    // - Block actions: actions[0].value
    let taskDescription: string | undefined;

    if (typeof payload["text"] === "string" && payload["text"].trim()) {
      taskDescription = payload["text"].trim();
    } else if (
      payload["event"] !== null &&
      typeof payload["event"] === "object" &&
      typeof (payload["event"] as Record<string, unknown>)["text"] === "string"
    ) {
      const eventText = ((payload["event"] as Record<string, unknown>)["text"] as string).trim();
      // Strip bot mention prefix (e.g. "<@U12345> ")
      taskDescription = eventText.replace(/^<@[A-Z0-9]+>\s*/i, "").trim();
    } else if (Array.isArray(payload["actions"]) && payload["actions"].length > 0) {
      const firstAction = payload["actions"][0] as Record<string, unknown> | undefined;
      if (typeof firstAction?.["value"] === "string") {
        taskDescription = firstAction["value"].trim();
      }
    }

    if (!taskDescription) {
      return null;
    }

    return {
      source: "slack",
      taskDescription,
      metadata: {
        channel: payload["channel_id"] ?? payload["channel"] ?? null,
        user: payload["user_id"] ?? payload["user"] ?? null,
        team: payload["team_id"] ?? payload["team"] ?? null,
        command: payload["command"] ?? null,
        triggerId: payload["trigger_id"] ?? null,
      },
      timestamp: new Date().toISOString(),
    };
  }
}

// ─── LinearWebhookProvider ───────────────────────────────────────────────────

/**
 * Parses Linear Issue.created and Issue.assigned webhook payloads.
 * Requires LINEAR_WEBHOOK_SECRET env var for signature verification.
 */
export class LinearWebhookProvider {
  private readonly secret: string | undefined;

  constructor(secret?: string) {
    this.secret = secret ?? process.env["LINEAR_WEBHOOK_SECRET"];
  }

  /**
   * Parse a Linear webhook payload.
   * Returns null if:
   *   - LINEAR_WEBHOOK_SECRET is not set
   *   - signature is present but invalid
   *   - action type is not Issue.created or Issue.assigned
   *   - payload cannot be parsed
   */
  parsePayload(body: string, signature?: string): AutomationTriggerEvent | null {
    if (!this.secret) {
      return null;
    }

    if (signature !== undefined) {
      if (!verifyHmacSha256(this.secret, body, signature)) {
        return null;
      }
    }

    let payload: Record<string, unknown>;
    try {
      payload = JSON.parse(body) as Record<string, unknown>;
    } catch {
      return null;
    }

    // Linear webhook shape: { type: "Issue", action: "create"|"update", data: { title, ... } }
    const type = payload["type"];
    const action = payload["action"];

    const isIssueCreated = type === "Issue" && action === "create";
    const isIssueAssigned =
      type === "Issue" &&
      action === "update" &&
      payload["updatedFrom"] !== undefined &&
      typeof payload["data"] === "object" &&
      payload["data"] !== null &&
      (payload["data"] as Record<string, unknown>)["assignee"] !== undefined;

    if (!isIssueCreated && !isIssueAssigned) {
      return null;
    }

    const data =
      typeof payload["data"] === "object" && payload["data"] !== null
        ? (payload["data"] as Record<string, unknown>)
        : {};

    const title = typeof data["title"] === "string" ? data["title"] : "";
    const description = typeof data["description"] === "string" ? data["description"] : "";

    if (!title) {
      return null;
    }

    const taskDescription = description ? `${title}\n\n${description}` : title;

    return {
      source: "linear",
      taskDescription,
      metadata: {
        issueId: data["id"] ?? null,
        issueNumber: data["number"] ?? null,
        teamId: data["teamId"] ?? null,
        stateId: data["stateId"] ?? null,
        assigneeId:
          typeof data["assignee"] === "object" && data["assignee"] !== null
            ? (data["assignee"] as Record<string, unknown>)["id"]
            : null,
        action: isIssueCreated ? "created" : "assigned",
        url: data["url"] ?? null,
      },
      timestamp:
        typeof payload["createdAt"] === "string"
          ? payload["createdAt"]
          : new Date().toISOString(),
    };
  }
}
