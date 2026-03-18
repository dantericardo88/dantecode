// ============================================================================
// @dantecode/core — Event Triggers
// Unified trigger system: GitHub webhooks, Slack messages, cron schedules,
// and manual CLI commands all produce normalized AgentTask objects.
// ============================================================================

import { randomUUID, timingSafeEqual, createHmac } from "node:crypto";

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export type TriggerSource = "github" | "slack" | "cron" | "manual" | "api";

export interface AgentTask {
  id: string;
  source: TriggerSource;
  prompt: string;
  repository?: string;
  metadata: Record<string, unknown>;
  createdAt: string;
  priority: "low" | "normal" | "high" | "critical";
}

export interface TriggerConfig {
  /** Enabled trigger sources */
  enabledSources: TriggerSource[];
  /** Cron expressions for scheduled triggers */
  cronSchedules?: CronSchedule[];
  /** Slack webhook URL for incoming triggers */
  slackWebhookUrl?: string;
  /** GitHub webhook secret for signature verification */
  githubSecret?: string;
  /** Default priority for tasks */
  defaultPriority?: "low" | "normal" | "high" | "critical";
}

export interface CronSchedule {
  id: string;
  expression: string;
  prompt: string;
  repository?: string;
  enabled: boolean;
}

export interface SlackTriggerPayload {
  text: string;
  channel: string;
  user: string;
  timestamp: string;
}

export type TaskHandler = (task: AgentTask) => Promise<void>;

/**
 * Registry for event triggers. Routes events from various sources
 * into a unified AgentTask format and dispatches to handlers.
 */
export class EventTriggerRegistry {
  private readonly config: TriggerConfig;
  private handlers: TaskHandler[] = [];
  private cronTimers: Map<string, ReturnType<typeof setInterval>> = new Map();

  constructor(config: TriggerConfig) {
    this.config = {
      enabledSources: config.enabledSources,
      cronSchedules: config.cronSchedules ?? [],
      slackWebhookUrl: config.slackWebhookUrl,
      githubSecret: config.githubSecret,
      defaultPriority: config.defaultPriority ?? "normal",
    };
  }

  /** Register a handler for incoming tasks */
  onTask(handler: TaskHandler): void {
    this.handlers.push(handler);
  }

  /**
   * Verify a GitHub webhook signature (X-Hub-Signature-256 header).
   * Returns true if the HMAC-SHA256 digest matches. Uses timing-safe
   * comparison to prevent timing attacks.
   */
  verifyGitHubSignature(rawBody: string | Buffer, signatureHeader: string): boolean {
    const secret = this.config.githubSecret;
    if (!secret) return false;

    const body = typeof rawBody === "string" ? rawBody : rawBody.toString("utf-8");
    const expected = "sha256=" + createHmac("sha256", secret).update(body).digest("hex");

    if (expected.length !== signatureHeader.length) return false;

    return timingSafeEqual(
      Buffer.from(expected, "utf-8"),
      Buffer.from(signatureHeader, "utf-8"),
    );
  }

  /**
   * Verify a Slack request signature (X-Slack-Signature header).
   * Uses the Slack signing secret with the v0 signature scheme.
   */
  verifySlackSignature(
    rawBody: string,
    timestamp: string,
    signatureHeader: string,
    signingSecret: string,
  ): boolean {
    // Reject requests older than 5 minutes to prevent replay attacks
    const age = Math.abs(Date.now() / 1000 - parseInt(timestamp, 10));
    if (age > 300) return false;

    const baseString = `v0:${timestamp}:${rawBody}`;
    const expected = "v0=" + createHmac("sha256", signingSecret).update(baseString).digest("hex");

    if (expected.length !== signatureHeader.length) return false;

    return timingSafeEqual(
      Buffer.from(expected, "utf-8"),
      Buffer.from(signatureHeader, "utf-8"),
    );
  }

  /** Create a task from a GitHub webhook event */
  fromGitHub(
    eventName: string,
    payload: Record<string, unknown>,
  ): AgentTask | null {
    if (!this.config.enabledSources.includes("github")) {
      return null;
    }

    const action = payload.action as string | undefined;
    const repo = payload.repository as Record<string, unknown> | undefined;
    const repoName = repo?.full_name as string | undefined;

    let prompt: string;
    let priority: AgentTask["priority"] = this.config.defaultPriority ?? "normal";
    let extraMetadata: Record<string, unknown> = {};

    switch (eventName) {
      case "issues": {
        const issue = payload.issue as Record<string, unknown> | undefined;
        if (action !== "opened" || !issue) return null;
        prompt = `Resolve GitHub issue #${issue.number}: ${issue.title}\n\n${issue.body ?? "(no body)"}`;
        const labels = issue.labels as Array<Record<string, unknown>> | undefined;
        if (labels?.some((l) => l.name === "critical" || l.name === "urgent")) {
          priority = "critical";
        } else if (labels?.some((l) => l.name === "bug")) {
          priority = "high";
        }
        // Mark as an issue-to-PR candidate so the background runner can
        // trigger the IssueToPRPipeline when wired up.
        extraMetadata = {
          type: "issue-to-pr",
          issueNumber: issue.number,
          issueTitle: issue.title,
          issueBody: issue.body ?? "",
          issueUrl: issue.html_url ?? "",
          issueLabels: (labels ?? []).map((l) => l.name as string),
        };
        break;
      }
      case "issue_comment": {
        const issue = payload.issue as Record<string, unknown> | undefined;
        const comment = payload.comment as Record<string, unknown> | undefined;
        if (action !== "created" || !comment || !issue) return null;
        prompt = `Respond to comment on issue #${issue.number}: ${comment.body}`;
        break;
      }
      case "pull_request": {
        const pr = payload.pull_request as Record<string, unknown> | undefined;
        if (action !== "opened" || !pr) return null;
        prompt = `Review pull request #${pr.number}: ${pr.title}\n\n${pr.body ?? "(no body)"}`;
        break;
      }
      case "push": {
        const ref = payload.ref as string | undefined;
        const headCommit = payload.head_commit as Record<string, unknown> | undefined;
        if (!ref) return null;
        prompt = `Handle push to ${ref}: ${headCommit?.message ?? "(no commit message)"}`;
        break;
      }
      case "workflow_run": {
        const workflowRun = payload.workflow_run as Record<string, unknown> | undefined;
        if (action !== "completed" || !workflowRun) return null;
        if (workflowRun.conclusion !== "failure") return null;
        prompt = `Investigate failed workflow "${workflowRun.name}": conclusion=${workflowRun.conclusion}`;
        priority = "high";
        break;
      }
      default:
        return null;
    }

    const task: AgentTask = {
      id: this.generateId(),
      source: "github",
      prompt,
      repository: repoName,
      metadata: {
        eventName,
        action: action ?? null,
        ...extraMetadata,
      },
      createdAt: new Date().toISOString(),
      priority,
    };

    this.dispatch(task);
    return task;
  }

  /** Create a task from a Slack message */
  fromSlack(payload: SlackTriggerPayload): AgentTask | null {
    if (!this.config.enabledSources.includes("slack")) {
      return null;
    }

    if (!payload.text || payload.text.trim().length === 0) {
      return null;
    }

    const task: AgentTask = {
      id: this.generateId(),
      source: "slack",
      prompt: payload.text,
      metadata: {
        channel: payload.channel,
        user: payload.user,
        slackTimestamp: payload.timestamp,
      },
      createdAt: new Date().toISOString(),
      priority: this.config.defaultPriority ?? "normal",
    };

    this.dispatch(task);
    return task;
  }

  /** Create a task from a manual CLI command */
  fromManual(prompt: string, repository?: string): AgentTask {
    const task: AgentTask = {
      id: this.generateId(),
      source: "manual",
      prompt,
      repository,
      metadata: {},
      createdAt: new Date().toISOString(),
      priority: this.config.defaultPriority ?? "normal",
    };

    this.dispatch(task);
    return task;
  }

  /** Create a task from an API call */
  fromAPI(prompt: string, metadata?: Record<string, unknown>): AgentTask {
    const task: AgentTask = {
      id: this.generateId(),
      source: "api",
      prompt,
      metadata: metadata ?? {},
      createdAt: new Date().toISOString(),
      priority: this.config.defaultPriority ?? "normal",
    };

    this.dispatch(task);
    return task;
  }

  /** Start all enabled cron schedules */
  startCronSchedules(): void {
    if (!this.config.enabledSources.includes("cron")) {
      return;
    }

    const schedules = this.config.cronSchedules ?? [];

    for (const schedule of schedules) {
      if (!schedule.enabled) continue;

      // Check every 60 seconds if the cron expression matches
      const timer = setInterval(() => {
        const now = new Date();
        if (EventTriggerRegistry.matchesCron(schedule.expression, now)) {
          const task: AgentTask = {
            id: this.generateId(),
            source: "cron",
            prompt: schedule.prompt,
            repository: schedule.repository,
            metadata: {
              cronId: schedule.id,
              cronExpression: schedule.expression,
            },
            createdAt: new Date().toISOString(),
            priority: this.config.defaultPriority ?? "normal",
          };
          this.dispatch(task);
        }
      }, 60_000);

      this.cronTimers.set(schedule.id, timer);
    }
  }

  /** Stop all cron schedules */
  stopCronSchedules(): void {
    for (const [id, timer] of this.cronTimers) {
      clearInterval(timer);
      this.cronTimers.delete(id);
    }
  }

  /**
   * Check if a cron expression matches the current time (simple pattern match).
   * Format: "minute hour day month weekday"
   *   - `*` matches any value
   *   - A specific number matches exactly
   *   - `a-b` matches a range (inclusive)
   *   - `* /n` (no space) matches every n-th value (step)
   */
  static matchesCron(expression: string, now?: Date): boolean {
    const date = now ?? new Date();
    const parts = expression.trim().split(/\s+/);

    if (parts.length !== 5) return false;

    const values = [
      date.getMinutes(),   // minute (0-59)
      date.getHours(),     // hour (0-23)
      date.getDate(),      // day of month (1-31)
      date.getMonth() + 1, // month (1-12)
      date.getDay(),       // day of week (0-6, Sunday=0)
    ];

    for (let i = 0; i < 5; i++) {
      const part = parts[i]!;
      const value = values[i]!;

      if (!EventTriggerRegistry.matchesCronField(part, value)) {
        return false;
      }
    }

    return true;
  }

  private static matchesCronField(field: string, value: number): boolean {
    // Wildcard matches everything
    if (field === "*") return true;

    // Step values: */n
    if (field.startsWith("*/")) {
      const step = parseInt(field.slice(2), 10);
      if (isNaN(step) || step <= 0) return false;
      return value % step === 0;
    }

    // Range: a-b
    if (field.includes("-")) {
      const [startStr, endStr] = field.split("-");
      const start = parseInt(startStr!, 10);
      const end = parseInt(endStr!, 10);
      if (isNaN(start) || isNaN(end)) return false;
      return value >= start && value <= end;
    }

    // Comma-separated list
    if (field.includes(",")) {
      const values = field.split(",").map((v) => parseInt(v.trim(), 10));
      return values.includes(value);
    }

    // Exact value
    const exact = parseInt(field, 10);
    if (isNaN(exact)) return false;
    return value === exact;
  }

  /** Dispatch a task to all registered handlers */
  private async dispatch(task: AgentTask): Promise<void> {
    for (const handler of this.handlers) {
      try {
        await handler(task);
      } catch (err: unknown) {
        // Log but do not propagate handler errors so other handlers still run
        // In production this would go to a proper logger
        void errorMessage(err);
      }
    }
  }

  /** Generate a unique task ID */
  private generateId(): string {
    return randomUUID().slice(0, 12);
  }
}
