// ============================================================================
// @dantecode/cli — /automate command tests
// ============================================================================

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@dantecode/git-engine", () => ({
  listWebhookListeners: vi.fn(),
  stopWebhookListener: vi.fn(),
  WebhookListener: vi.fn().mockImplementation(() => ({
    id: "wh-mock-id",
    port: 3000,
    on: vi.fn(),
    start: vi.fn().mockResolvedValue(undefined),
  })),
  listScheduledGitTasks: vi.fn(),
  stopScheduledGitTask: vi.fn(),
  scheduleGitTask: vi.fn().mockReturnValue({ id: "sched-mock-id", schedule: "0 9 * * *" }),
  listGitWatchers: vi.fn(),
  stopGitWatcher: vi.fn(),
  GitAutomationOrchestrator: vi.fn().mockImplementation(() => ({
    listExecutions: vi.fn().mockResolvedValue([]),
    runWorkflowInBackground: vi.fn().mockResolvedValue({ executionId: "exec-1", backgroundTaskId: "bg-1" }),
  })),
  getTemplate: vi.fn(),
  listTemplates: vi.fn(),
}));

import {
  listWebhookListeners,
  stopWebhookListener,
  listScheduledGitTasks,
  stopScheduledGitTask,
  listGitWatchers,
  stopGitWatcher,
  getTemplate,
  listTemplates,
  GitAutomationOrchestrator,
} from "@dantecode/git-engine";

import { automateCommand } from "./automate.js";

const mockListWebhook = vi.mocked(listWebhookListeners);
const mockStopWebhook = vi.mocked(stopWebhookListener);
const mockListSchedules = vi.mocked(listScheduledGitTasks);
const mockStopSchedule = vi.mocked(stopScheduledGitTask);
const mockListWatchers = vi.mocked(listGitWatchers);
const mockStopWatcher = vi.mocked(stopGitWatcher);
const mockGetTemplate = vi.mocked(getTemplate);
const mockListTemplates = vi.mocked(listTemplates);
const MockOrchestrator = vi.mocked(GitAutomationOrchestrator);

const mockState = {
  projectRoot: "/test/project",
  session: { id: "test-session", model: { provider: "anthropic", modelId: "claude-sonnet" } },
};

beforeEach(() => {
  vi.clearAllMocks();
  // Default: no automations
  mockListWebhook.mockResolvedValue([]);
  mockListSchedules.mockResolvedValue([]);
  mockListWatchers.mockResolvedValue([]);
  MockOrchestrator.mockImplementation(() => ({
    listExecutions: vi.fn().mockResolvedValue([]),
    runWorkflowInBackground: vi.fn().mockResolvedValue({ executionId: "exec-1", backgroundTaskId: "bg-1" }),
  }));
});

// ─── Test 1: Dashboard with no automations ────────────────────────────────

describe("/automate dashboard", () => {
  it("shows empty state message when no automations are active", async () => {
    const result = await automateCommand("dashboard", mockState);
    expect(result).toMatch(/No active automations/i);
  });
});

// ─── Test 2: Dashboard with mixed types ───────────────────────────────────

describe("/automate dashboard mixed types", () => {
  it("shows type indicators for webhooks and schedules", async () => {
    mockListWebhook.mockResolvedValue([
      {
        id: "wh-abc",
        provider: "github",
        port: 3000,
        path: "/webhook",
        status: "active",
        startedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        receivedCount: 3,
        recentEvents: [],
        lastEventAt: new Date(Date.now() - 120_000).toISOString(),
      },
    ]);
    mockListSchedules.mockResolvedValue([
      {
        id: "sched-xyz",
        taskName: "daily-verify",
        schedule: "0 9 * * *",
        cwd: "/test/project",
        status: "active",
        startedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        runCount: 12,
        recentRuns: [],
        lastRunAt: new Date(Date.now() - 8 * 3600_000).toISOString(),
      },
    ]);

    const result = await automateCommand("", mockState);
    // Should contain both webhook and schedule indicators
    expect(result).toMatch(/\[webhook\]/);
    expect(result).toMatch(/\[schedule\]/);
    expect(result).toMatch(/wh-abc/);
    expect(result).toMatch(/sched-xyz/);
  });
});

// ─── Test 3: Create webhook ───────────────────────────────────────────────

describe("/automate create webhook", () => {
  it("returns an id or success message for a webhook creation", async () => {
    const result = await automateCommand("create webhook github --port 3001", mockState);
    // Should mention the created id and type
    expect(result).toMatch(/webhook/i);
    expect(result).toMatch(/wh-mock-id|Created|Started/i);
  });
});

// ─── Test 4: Template pr-review ──────────────────────────────────────────

describe("/automate template pr-review", () => {
  it("calls getTemplate('pr-review') and returns automation info", async () => {
    const fakeCreate = vi.fn().mockReturnValue({
      id: "tmpl-001",
      name: "pr-review",
      type: "webhook",
      config: { port: 3000, path: "/webhook/pr-review", provider: "github", secret: "" },
      agentMode: { prompt: "Review PR", sandboxMode: "docker", verifyOutput: true },
      workflowPath: ".github/workflows/pr-review.yml",
      createdAt: new Date().toISOString(),
      status: "active",
      runCount: 0,
    });
    mockGetTemplate.mockReturnValue({
      name: "pr-review",
      description: "Auto-review PRs",
      type: "webhook",
      create: fakeCreate,
    });

    const result = await automateCommand("template pr-review", mockState);

    expect(mockGetTemplate).toHaveBeenCalledWith("pr-review");
    expect(result).toMatch(/pr-review|activated|Created/i);
  });
});

// ─── Test 5: List all automations ────────────────────────────────────────

describe("/automate list", () => {
  it("shows all automation types when no filter is given", async () => {
    mockListWebhook.mockResolvedValue([
      {
        id: "wh-111",
        provider: "github",
        port: 3000,
        path: "/webhook",
        status: "active",
        startedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        receivedCount: 1,
        recentEvents: [],
      },
    ]);
    mockListSchedules.mockResolvedValue([
      {
        id: "sched-222",
        taskName: "daily-check",
        schedule: "0 0 * * *",
        cwd: "/test/project",
        status: "active",
        startedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        runCount: 5,
        recentRuns: [],
      },
    ]);

    const result = await automateCommand("list", mockState);
    expect(result).toMatch(/wh-111/);
    expect(result).toMatch(/sched-222/);
  });
});

// ─── Test 6: List --type schedule ────────────────────────────────────────

describe("/automate list --type schedule", () => {
  it("filters output to only show schedule automations", async () => {
    mockListWebhook.mockResolvedValue([
      {
        id: "wh-333",
        provider: "github",
        port: 3000,
        path: "/webhook",
        status: "active",
        startedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        receivedCount: 0,
        recentEvents: [],
      },
    ]);
    mockListSchedules.mockResolvedValue([
      {
        id: "sched-444",
        taskName: "nightly-scan",
        schedule: "0 2 * * *",
        cwd: "/test/project",
        status: "active",
        startedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        runCount: 2,
        recentRuns: [],
      },
    ]);

    const result = await automateCommand("list --type schedule", mockState);
    // schedule should appear, webhook should NOT
    expect(result).toMatch(/sched-444/);
    expect(result).not.toMatch(/wh-333/);
  });
});

// ─── Test 7: Stop automation ──────────────────────────────────────────────

describe("/automate stop <id>", () => {
  it("tries stopWebhookListener, stopScheduledGitTask, and stopGitWatcher in order", async () => {
    mockStopWebhook.mockResolvedValue(false);
    mockStopSchedule.mockResolvedValue(false);
    mockStopWatcher.mockResolvedValue(false);

    const result = await automateCommand("stop some-id", mockState);

    expect(mockStopWebhook).toHaveBeenCalledWith("some-id", "/test/project");
    expect(mockStopSchedule).toHaveBeenCalledWith("some-id", "/test/project");
    expect(mockStopWatcher).toHaveBeenCalledWith("some-id", "/test/project");
    expect(result).toMatch(/not found|some-id/i);
  });

  it("returns success when webhook listener is stopped", async () => {
    mockStopWebhook.mockResolvedValue(true);

    const result = await automateCommand("stop wh-found", mockState);
    expect(result).toMatch(/Stopped webhook listener wh-found/i);
    // Should not try schedule/watcher after webhook success
    expect(mockStopSchedule).not.toHaveBeenCalled();
  });
});

// ─── Test 8: Templates list ───────────────────────────────────────────────

describe("/automate templates", () => {
  it("calls listTemplates() and displays all templates", async () => {
    mockListTemplates.mockReturnValue([
      { name: "pr-review", description: "Auto-review PRs", type: "webhook", create: vi.fn() },
      { name: "daily-verify", description: "Daily codebase verification", type: "schedule", create: vi.fn() },
    ]);

    const result = await automateCommand("templates", mockState);

    expect(mockListTemplates).toHaveBeenCalled();
    expect(result).toMatch(/pr-review/);
    expect(result).toMatch(/daily-verify/);
    expect(result).toMatch(/\[webhook\]/);
    expect(result).toMatch(/\[schedule\]/);
  });
});
