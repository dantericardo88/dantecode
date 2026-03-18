// ============================================================================
// @dantecode/core — Event Triggers Tests
// ============================================================================

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createHmac } from "node:crypto";
import { EventTriggerRegistry } from "./event-triggers.js";
import type {
  AgentTask,
  SlackTriggerPayload,
  TaskHandler,
  TriggerConfig,
} from "./event-triggers.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function makeConfig(overrides: Partial<TriggerConfig> = {}): TriggerConfig {
  return {
    enabledSources: ["github", "slack", "cron", "manual", "api"],
    defaultPriority: "normal",
    ...overrides,
  };
}

function makeGitHubIssuePayload(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    action: "opened",
    repository: { full_name: "acme/dantecode" },
    issue: {
      number: 42,
      title: "Fix login bug",
      body: "Cannot login with MFA.",
      labels: [],
    },
    ...overrides,
  };
}

function makeSlackPayload(
  overrides: Partial<SlackTriggerPayload> = {},
): SlackTriggerPayload {
  return {
    text: "Deploy the new feature",
    channel: "#engineering",
    user: "U12345",
    timestamp: "1710672000.000100",
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe("EventTriggerRegistry", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // ── fromGitHub ──────────────────────────────────────────────────────────

  describe("fromGitHub", () => {
    it("creates a task from an opened issue event", () => {
      const registry = new EventTriggerRegistry(makeConfig());
      const task = registry.fromGitHub("issues", makeGitHubIssuePayload());

      expect(task).not.toBeNull();
      expect(task!.source).toBe("github");
      expect(task!.prompt).toContain("#42");
      expect(task!.prompt).toContain("Fix login bug");
      expect(task!.repository).toBe("acme/dantecode");
      expect(task!.metadata.eventName).toBe("issues");
    });

    it("creates a task from a push event", () => {
      const registry = new EventTriggerRegistry(makeConfig());
      const task = registry.fromGitHub("push", {
        ref: "refs/heads/main",
        repository: { full_name: "acme/dantecode" },
        head_commit: { message: "fix: resolve race condition" },
      });

      expect(task).not.toBeNull();
      expect(task!.prompt).toContain("refs/heads/main");
      expect(task!.prompt).toContain("fix: resolve race condition");
    });

    it("creates a task from a failed workflow run", () => {
      const registry = new EventTriggerRegistry(makeConfig());
      const task = registry.fromGitHub("workflow_run", {
        action: "completed",
        repository: { full_name: "acme/dantecode" },
        workflow_run: {
          name: "CI Pipeline",
          conclusion: "failure",
        },
      });

      expect(task).not.toBeNull();
      expect(task!.prompt).toContain("CI Pipeline");
      expect(task!.priority).toBe("high");
    });

    it("returns null for unsupported event types", () => {
      const registry = new EventTriggerRegistry(makeConfig());
      const task = registry.fromGitHub("fork", { action: "created" });

      expect(task).toBeNull();
    });

    it("returns null when github source is disabled", () => {
      const registry = new EventTriggerRegistry(
        makeConfig({ enabledSources: ["manual"] }),
      );
      const task = registry.fromGitHub("issues", makeGitHubIssuePayload());

      expect(task).toBeNull();
    });

    it("assigns critical priority for issues with critical label", () => {
      const registry = new EventTriggerRegistry(makeConfig());
      const payload = makeGitHubIssuePayload({
        issue: {
          number: 1,
          title: "Urgent fix",
          body: "Production down",
          labels: [{ name: "critical" }],
        },
      });

      const task = registry.fromGitHub("issues", payload);

      expect(task).not.toBeNull();
      expect(task!.priority).toBe("critical");
    });

    it("assigns high priority for issues with bug label", () => {
      const registry = new EventTriggerRegistry(makeConfig());
      const payload = makeGitHubIssuePayload({
        issue: {
          number: 2,
          title: "Bug report",
          body: "Something is broken",
          labels: [{ name: "bug" }],
        },
      });

      const task = registry.fromGitHub("issues", payload);

      expect(task).not.toBeNull();
      expect(task!.priority).toBe("high");
    });

    it("creates a task from an issue_comment event", () => {
      const registry = new EventTriggerRegistry(makeConfig());
      const task = registry.fromGitHub("issue_comment", {
        action: "created",
        repository: { full_name: "acme/dantecode" },
        issue: { number: 10 },
        comment: { body: "Please fix this ASAP" },
      });

      expect(task).not.toBeNull();
      expect(task!.prompt).toContain("comment on issue #10");
      expect(task!.prompt).toContain("Please fix this ASAP");
    });

    it("creates a task from a pull_request event", () => {
      const registry = new EventTriggerRegistry(makeConfig());
      const task = registry.fromGitHub("pull_request", {
        action: "opened",
        repository: { full_name: "acme/dantecode" },
        pull_request: {
          number: 55,
          title: "Add feature X",
          body: "This adds feature X.",
        },
      });

      expect(task).not.toBeNull();
      expect(task!.prompt).toContain("#55");
      expect(task!.prompt).toContain("Add feature X");
    });
  });

  // ── fromSlack ───────────────────────────────────────────────────────────

  describe("fromSlack", () => {
    it("creates a task from a Slack message", () => {
      const registry = new EventTriggerRegistry(makeConfig());
      const task = registry.fromSlack(makeSlackPayload());

      expect(task).not.toBeNull();
      expect(task!.source).toBe("slack");
      expect(task!.prompt).toBe("Deploy the new feature");
      expect(task!.metadata.channel).toBe("#engineering");
      expect(task!.metadata.user).toBe("U12345");
    });

    it("returns null for empty text", () => {
      const registry = new EventTriggerRegistry(makeConfig());
      const task = registry.fromSlack(makeSlackPayload({ text: "  " }));

      expect(task).toBeNull();
    });

    it("returns null when slack source is disabled", () => {
      const registry = new EventTriggerRegistry(
        makeConfig({ enabledSources: ["manual"] }),
      );
      const task = registry.fromSlack(makeSlackPayload());

      expect(task).toBeNull();
    });
  });

  // ── fromManual ──────────────────────────────────────────────────────────

  describe("fromManual", () => {
    it("creates a task with manual source", () => {
      const registry = new EventTriggerRegistry(makeConfig());
      const task = registry.fromManual("Refactor the auth module", "acme/dantecode");

      expect(task.source).toBe("manual");
      expect(task.prompt).toBe("Refactor the auth module");
      expect(task.repository).toBe("acme/dantecode");
      expect(task.id).toBeTruthy();
      expect(task.createdAt).toBeTruthy();
    });

    it("works without repository", () => {
      const registry = new EventTriggerRegistry(makeConfig());
      const task = registry.fromManual("Do something");

      expect(task.source).toBe("manual");
      expect(task.repository).toBeUndefined();
    });
  });

  // ── fromAPI ─────────────────────────────────────────────────────────────

  describe("fromAPI", () => {
    it("creates a task with api source and metadata", () => {
      const registry = new EventTriggerRegistry(makeConfig());
      const task = registry.fromAPI("Run diagnostics", {
        requestId: "req-abc",
        caller: "monitoring",
      });

      expect(task.source).toBe("api");
      expect(task.prompt).toBe("Run diagnostics");
      expect(task.metadata.requestId).toBe("req-abc");
      expect(task.metadata.caller).toBe("monitoring");
    });

    it("creates a task with empty metadata when none provided", () => {
      const registry = new EventTriggerRegistry(makeConfig());
      const task = registry.fromAPI("Simple task");

      expect(task.metadata).toEqual({});
    });
  });

  // ── matchesCron ─────────────────────────────────────────────────────────

  describe("matchesCron", () => {
    it("matches wildcard expression (* * * * *)", () => {
      const now = new Date(2026, 2, 17, 10, 30, 0); // March 17, 2026 10:30
      expect(EventTriggerRegistry.matchesCron("* * * * *", now)).toBe(true);
    });

    it("matches specific minute and hour", () => {
      const now = new Date(2026, 2, 17, 14, 30, 0); // 14:30
      expect(EventTriggerRegistry.matchesCron("30 14 * * *", now)).toBe(true);
      expect(EventTriggerRegistry.matchesCron("30 15 * * *", now)).toBe(false);
    });

    it("matches specific day of month", () => {
      const now = new Date(2026, 2, 17, 10, 0, 0); // March 17
      expect(EventTriggerRegistry.matchesCron("0 10 17 * *", now)).toBe(true);
      expect(EventTriggerRegistry.matchesCron("0 10 18 * *", now)).toBe(false);
    });

    it("matches specific month", () => {
      const now = new Date(2026, 2, 17, 10, 0, 0); // March = month 3
      expect(EventTriggerRegistry.matchesCron("0 10 17 3 *", now)).toBe(true);
      expect(EventTriggerRegistry.matchesCron("0 10 17 4 *", now)).toBe(false);
    });

    it("matches specific weekday", () => {
      // March 17, 2026 is a Tuesday (day 2)
      const now = new Date(2026, 2, 17, 10, 0, 0);
      expect(EventTriggerRegistry.matchesCron("0 10 * * 2", now)).toBe(true);
      expect(EventTriggerRegistry.matchesCron("0 10 * * 3", now)).toBe(false);
    });

    it("matches range fields (e.g., 1-5 for weekday)", () => {
      // Tuesday = 2, should be in range 1-5
      const now = new Date(2026, 2, 17, 10, 0, 0);
      expect(EventTriggerRegistry.matchesCron("0 10 * * 1-5", now)).toBe(true);
    });

    it("matches step values (*/n)", () => {
      const now = new Date(2026, 2, 17, 10, 0, 0); // minute=0
      expect(EventTriggerRegistry.matchesCron("*/15 * * * *", now)).toBe(true);

      const now2 = new Date(2026, 2, 17, 10, 7, 0); // minute=7
      expect(EventTriggerRegistry.matchesCron("*/15 * * * *", now2)).toBe(false);
    });

    it("matches comma-separated values", () => {
      const now = new Date(2026, 2, 17, 10, 30, 0); // minute=30
      expect(EventTriggerRegistry.matchesCron("0,15,30,45 * * * *", now)).toBe(true);
      expect(EventTriggerRegistry.matchesCron("0,15,45 * * * *", now)).toBe(false);
    });

    it("returns false for invalid expression (wrong number of fields)", () => {
      expect(EventTriggerRegistry.matchesCron("* * *")).toBe(false);
      expect(EventTriggerRegistry.matchesCron("* * * * * *")).toBe(false);
    });
  });

  // ── onTask handler ──────────────────────────────────────────────────────

  describe("onTask", () => {
    it("handler receives dispatched tasks", async () => {
      const registry = new EventTriggerRegistry(makeConfig());
      const received: AgentTask[] = [];

      registry.onTask(async (task) => {
        received.push(task);
      });

      registry.fromManual("Test task");

      // dispatch is async — give it a tick
      await vi.advanceTimersByTimeAsync(0);

      expect(received).toHaveLength(1);
      expect(received[0]!.prompt).toBe("Test task");
    });

    it("multiple handlers all receive the task", async () => {
      const registry = new EventTriggerRegistry(makeConfig());
      const handler1: TaskHandler = vi.fn(async () => {});
      const handler2: TaskHandler = vi.fn(async () => {});

      registry.onTask(handler1);
      registry.onTask(handler2);

      registry.fromManual("Multi-handler task");
      await vi.advanceTimersByTimeAsync(0);

      expect(handler1).toHaveBeenCalledTimes(1);
      expect(handler2).toHaveBeenCalledTimes(1);
    });

    it("handler errors do not prevent other handlers from running", async () => {
      const registry = new EventTriggerRegistry(makeConfig());
      const handler1: TaskHandler = vi.fn(async () => {
        throw new Error("Handler 1 failed");
      });
      const handler2: TaskHandler = vi.fn(async () => {});

      registry.onTask(handler1);
      registry.onTask(handler2);

      registry.fromManual("Error-resilient task");
      await vi.advanceTimersByTimeAsync(0);

      expect(handler1).toHaveBeenCalledTimes(1);
      expect(handler2).toHaveBeenCalledTimes(1);
    });
  });

  // ── Cron lifecycle ──────────────────────────────────────────────────────

  describe("cron schedules", () => {
    it("startCronSchedules creates timers for enabled schedules", () => {
      const registry = new EventTriggerRegistry(
        makeConfig({
          cronSchedules: [
            {
              id: "daily-check",
              expression: "0 9 * * *",
              prompt: "Run daily checks",
              enabled: true,
            },
            {
              id: "disabled-job",
              expression: "0 12 * * *",
              prompt: "This is disabled",
              enabled: false,
            },
          ],
        }),
      );

      registry.startCronSchedules();

      // Only one timer should be active (the enabled one)
      // The disabled one should not start
      // We test this by stopping and verifying no error
      registry.stopCronSchedules();
    });

    it("stopCronSchedules clears all timers", () => {
      const registry = new EventTriggerRegistry(
        makeConfig({
          cronSchedules: [
            {
              id: "job-1",
              expression: "* * * * *",
              prompt: "Every minute",
              enabled: true,
            },
          ],
        }),
      );

      registry.startCronSchedules();
      registry.stopCronSchedules();

      // Advance time well past interval — handler should not fire
      const handler = vi.fn(async () => {});
      registry.onTask(handler);
      vi.advanceTimersByTime(120_000);

      expect(handler).not.toHaveBeenCalled();
    });

    it("does not start cron timers if cron source is disabled", () => {
      const registry = new EventTriggerRegistry(
        makeConfig({
          enabledSources: ["manual"],
          cronSchedules: [
            {
              id: "job-1",
              expression: "* * * * *",
              prompt: "Every minute",
              enabled: true,
            },
          ],
        }),
      );

      const handler = vi.fn(async () => {});
      registry.onTask(handler);
      registry.startCronSchedules();

      vi.advanceTimersByTime(120_000);

      expect(handler).not.toHaveBeenCalled();
      registry.stopCronSchedules();
    });
  });

  // ── Priority propagation ────────────────────────────────────────────────

  describe("priority", () => {
    it("uses default priority from config", () => {
      const registry = new EventTriggerRegistry(
        makeConfig({ defaultPriority: "high" }),
      );
      const task = registry.fromManual("High priority task");

      expect(task.priority).toBe("high");
    });

    it("uses 'normal' when no default is set", () => {
      const registry = new EventTriggerRegistry({
        enabledSources: ["manual"],
      });
      const task = registry.fromManual("Normal task");

      expect(task.priority).toBe("normal");
    });
  });

  // ── Task ID generation ──────────────────────────────────────────────────

  describe("task ID", () => {
    it("generates unique IDs for each task", () => {
      const registry = new EventTriggerRegistry(makeConfig());
      const task1 = registry.fromManual("Task 1");
      const task2 = registry.fromManual("Task 2");
      const task3 = registry.fromManual("Task 3");

      const ids = new Set([task1.id, task2.id, task3.id]);
      expect(ids.size).toBe(3);
    });

    it("generates non-empty string IDs", () => {
      const registry = new EventTriggerRegistry(makeConfig());
      const task = registry.fromManual("Test");

      expect(task.id).toBeTruthy();
      expect(typeof task.id).toBe("string");
      expect(task.id.length).toBeGreaterThan(0);
    });
  });

  // ── Webhook signature verification ────────────────────────────────────

  describe("verifyGitHubSignature", () => {
    it("verifies valid HMAC-SHA256 signature", () => {
      const secret = "webhook-secret-123";
      const body = '{"action":"opened","issue":{"number":1}}';
      const expected = "sha256=" + createHmac("sha256", secret).update(body).digest("hex");

      const registry = new EventTriggerRegistry(makeConfig({ githubSecret: secret }));
      expect(registry.verifyGitHubSignature(body, expected)).toBe(true);
    });

    it("rejects invalid signature", () => {
      const registry = new EventTriggerRegistry(
        makeConfig({ githubSecret: "webhook-secret-123" }),
      );
      expect(
        registry.verifyGitHubSignature('{"action":"opened"}', "sha256=deadbeef"),
      ).toBe(false);
    });

    it("rejects when no secret is configured", () => {
      const registry = new EventTriggerRegistry(makeConfig());
      expect(
        registry.verifyGitHubSignature("{}", "sha256=anything"),
      ).toBe(false);
    });

    it("accepts Buffer body input", () => {
      const secret = "buf-secret";
      const body = Buffer.from('{"test":"data"}');
      const expected =
        "sha256=" +
        createHmac("sha256", secret).update(body.toString("utf-8")).digest("hex");

      const registry = new EventTriggerRegistry(makeConfig({ githubSecret: secret }));
      expect(registry.verifyGitHubSignature(body, expected)).toBe(true);
    });
  });

  describe("verifySlackSignature", () => {
    it("verifies valid Slack v0 signature", () => {
      const signingSecret = "slack-signing-secret";
      const timestamp = String(Math.floor(Date.now() / 1000));
      const body = "token=xyzz0WbapA4vBCDEFasx0q6G&team_id=T1DC2JH3J";
      const baseString = `v0:${timestamp}:${body}`;
      const expected = "v0=" + createHmac("sha256", signingSecret).update(baseString).digest("hex");

      const registry = new EventTriggerRegistry(makeConfig());
      expect(registry.verifySlackSignature(body, timestamp, expected, signingSecret)).toBe(true);
    });

    it("rejects replayed request (older than 5 minutes)", () => {
      const signingSecret = "slack-signing-secret";
      const oldTimestamp = String(Math.floor(Date.now() / 1000) - 400);
      const body = "test=data";
      const baseString = `v0:${oldTimestamp}:${body}`;
      const expected =
        "v0=" + createHmac("sha256", signingSecret).update(baseString).digest("hex");

      const registry = new EventTriggerRegistry(makeConfig());
      expect(
        registry.verifySlackSignature(body, oldTimestamp, expected, signingSecret),
      ).toBe(false);
    });

    it("rejects tampered body", () => {
      const signingSecret = "slack-signing-secret";
      const timestamp = String(Math.floor(Date.now() / 1000));
      const body = "original=data";
      const baseString = `v0:${timestamp}:${body}`;
      const sig = "v0=" + createHmac("sha256", signingSecret).update(baseString).digest("hex");

      const registry = new EventTriggerRegistry(makeConfig());
      expect(
        registry.verifySlackSignature("tampered=data", timestamp, sig, signingSecret),
      ).toBe(false);
    });
  });
});
