// ============================================================================
// @dantecode/cli — /automate command tests
// ============================================================================

import { describe, it, expect, vi, beforeEach } from "vitest";

// Storage for captured callbacks used by the new tests
let _capturedListenerCallbacks: Map<string, ((rawEvent: unknown) => void)[]> = new Map();
let _capturedScheduleCallback: (() => void) | null = null;
let _mockWatcherStart: ReturnType<typeof vi.fn>;
let _mockWatcherSnapshot: ReturnType<typeof vi.fn>;
let _mockWatcherOn: ReturnType<typeof vi.fn>;

vi.mock("@dantecode/git-engine", () => ({
  listWebhookListeners: vi.fn(),
  stopWebhookListener: vi.fn(),
  WebhookListener: vi.fn().mockImplementation(() => {
    const callbacks: Map<string, ((rawEvent: unknown) => void)[]> = new Map();
    return {
      id: "wh-mock-id",
      port: 3000,
      on: vi.fn().mockImplementation((event: string, cb: (rawEvent: unknown) => void) => {
        const existing = callbacks.get(event) ?? [];
        existing.push(cb);
        callbacks.set(event, existing);
        // Also store in module-level map for test access
        const mExisting = _capturedListenerCallbacks.get(event) ?? [];
        mExisting.push(cb);
        _capturedListenerCallbacks.set(event, mExisting);
      }),
      start: vi.fn().mockResolvedValue(undefined),
      _getCallbacks: () => callbacks,
    };
  }),
  listScheduledGitTasks: vi.fn(),
  stopScheduledGitTask: vi.fn(),
  scheduleGitTask: vi.fn().mockImplementation((_schedule: unknown, cb: () => void) => {
    _capturedScheduleCallback = cb;
    return { id: "sched-mock-id", schedule: "0 9 * * *" };
  }),
  listGitWatchers: vi.fn(),
  stopGitWatcher: vi.fn(),
  GitAutomationOrchestrator: vi.fn().mockImplementation(() => ({
    listExecutions: vi.fn().mockResolvedValue([]),
    runWorkflowInBackground: vi
      .fn()
      .mockResolvedValue({ executionId: "exec-1", backgroundTaskId: "bg-1" }),
  })),
  FilePatternWatcher: vi.fn().mockImplementation(() => {
    _mockWatcherStart = vi.fn();
    _mockWatcherSnapshot = vi.fn().mockReturnValue({ watcherId: "fpw-mock-id" });
    _mockWatcherOn = vi.fn();
    return {
      start: _mockWatcherStart,
      stop: vi.fn(),
      snapshot: _mockWatcherSnapshot,
      on: _mockWatcherOn,
    };
  }),
  getTemplate: vi.fn(),
  listTemplates: vi.fn(),
  runAutomationAgent: vi.fn().mockResolvedValue({
    sessionId: "agent-1",
    success: true,
    output: "",
    tokensUsed: 0,
    durationMs: 0,
    filesChanged: [],
  }),
  substitutePromptVars: vi.fn().mockImplementation((template: string) => template),
}));

import {
  listWebhookListeners,
  stopWebhookListener,
  listScheduledGitTasks,
  stopScheduledGitTask,
  listGitWatchers,
  stopGitWatcher,
  // getTemplate,
  // listTemplates,
  // GitAutomationOrchestrator,
  // FilePatternWatcher,
} from "@dantecode/git-engine";

// Import from correct packages
import { GitAutomationOrchestrator } from "@dantecode/automation-engine";

// Mock-only exports (not in real packages yet)
const getTemplate = vi.fn();
const listTemplates = vi.fn();
const FilePatternWatcher = vi.fn();

import { automateCommand, _resetForTesting } from "./automate.js";

const mockListWebhook = vi.mocked(listWebhookListeners);
const mockStopWebhook = vi.mocked(stopWebhookListener);
const mockListSchedules = vi.mocked(listScheduledGitTasks);
const mockStopSchedule = vi.mocked(stopScheduledGitTask);
const mockListWatchers = vi.mocked(listGitWatchers);
const mockStopWatcher = vi.mocked(stopGitWatcher);
const mockGetTemplate = vi.mocked(getTemplate);
const mockListTemplates = vi.mocked(listTemplates);
const MockOrchestrator = vi.mocked(GitAutomationOrchestrator);
const MockFilePatternWatcher = vi.mocked(FilePatternWatcher);

const mockState = {
  projectRoot: "/test/project",
  session: { id: "test-session", model: { provider: "anthropic", modelId: "claude-sonnet" } },
};

beforeEach(() => {
  vi.clearAllMocks();
  _resetForTesting();
  // Reset captured callbacks
  _capturedListenerCallbacks = new Map();
  _capturedScheduleCallback = null;
  // Default: no automations
  mockListWebhook.mockResolvedValue([]);
  mockListSchedules.mockResolvedValue([]);
  mockListWatchers.mockResolvedValue([]);
  MockOrchestrator.mockImplementation(
    () =>
      ({
        listExecutions: vi.fn().mockResolvedValue([]),
        runWorkflowInBackground: vi
          .fn()
          .mockResolvedValue({ executionId: "exec-1", backgroundTaskId: "bg-1" }),
      }) as unknown as GitAutomationOrchestrator,
  );
  MockFilePatternWatcher.mockImplementation((): any => {
    _mockWatcherStart = vi.fn();
    _mockWatcherSnapshot = vi.fn().mockReturnValue({ watcherId: "fpw-mock-id" });
    _mockWatcherOn = vi.fn();
    return {
      start: _mockWatcherStart,
      stop: vi.fn(),
      snapshot: _mockWatcherSnapshot,
      on: _mockWatcherOn,
    } as unknown as any;
  });
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
      {
        name: "daily-verify",
        description: "Daily codebase verification",
        type: "schedule",
        create: vi.fn(),
      },
    ]);

    const result = await automateCommand("templates", mockState);

    expect(mockListTemplates).toHaveBeenCalled();
    expect(result).toMatch(/pr-review/);
    expect(result).toMatch(/daily-verify/);
    expect(result).toMatch(/\[webhook\]/);
    expect(result).toMatch(/\[schedule\]/);
  });
});

// ─── Test 10: agentMode flows through template webhook activation ─────────

describe("/automate template pr-review — agentMode webhook", () => {
  it("agentMode flows through template webhook activation", async () => {
    const agentMode = {
      prompt: "Review this pull request for quality and correctness",
      sandboxMode: "docker",
      verifyOutput: true,
    };

    const fakeCreate = vi.fn().mockReturnValue({
      id: "tmpl-webhook-001",
      name: "pr-review",
      type: "webhook",
      config: { port: 3001, path: "/webhook/pr-review", provider: "github", secret: "" },
      agentMode,
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

    // Create a fresh orchestrator mock instance to capture runWorkflowInBackground calls
    const mockRunWorkflow = vi
      .fn()
      .mockResolvedValue({ executionId: "exec-wh-1", backgroundTaskId: "bg-wh-1" });
    MockOrchestrator.mockImplementation(
      () =>
        ({
          listExecutions: vi.fn().mockResolvedValue([]),
          runWorkflowInBackground: mockRunWorkflow,
        }) as unknown as GitAutomationOrchestrator,
    );

    // Reset state so a new orchestrator is created
    const freshState = {
      projectRoot: "/test/project",
      session: {
        id: "test-session-wh",
        model: { provider: "anthropic", modelId: "claude-sonnet" },
      },
    };

    await automateCommand("template pr-review", freshState);

    // Simulate an incoming webhook event by triggering the any-event callback
    const anyEventCallbacks = _capturedListenerCallbacks.get("any-event") ?? [];
    expect(anyEventCallbacks.length).toBeGreaterThan(0);

    const fakeEvent = {
      event: "pull_request",
      provider: "github",
      payload: { action: "opened", number: 42 },
    };
    anyEventCallbacks[0]!(fakeEvent);

    // Allow async operations to settle
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(mockRunWorkflow).toHaveBeenCalledWith(expect.objectContaining({ agentMode }));
  });
});

// ─── Test 11: agentMode flows through template schedule activation ────────

describe("/automate template daily-verify — agentMode schedule", () => {
  it("agentMode flows through template schedule activation", async () => {
    const agentMode = {
      prompt: "Run the full verification suite and report any regressions",
      sandboxMode: "host",
      verifyOutput: true,
    };

    const fakeCreate = vi.fn().mockReturnValue({
      id: "tmpl-sched-001",
      name: "daily-verify",
      type: "schedule",
      config: { cron: "0 9 * * *" },
      agentMode,
      workflowPath: ".github/workflows/daily-verify.yml",
      createdAt: new Date().toISOString(),
      status: "active",
      runCount: 0,
    });

    mockGetTemplate.mockReturnValue({
      name: "daily-verify",
      description: "Daily codebase verification",
      type: "schedule",
      create: fakeCreate,
    });

    const mockRunWorkflow = vi
      .fn()
      .mockResolvedValue({ executionId: "exec-sc-1", backgroundTaskId: "bg-sc-1" });
    MockOrchestrator.mockImplementation(
      () =>
        ({
          listExecutions: vi.fn().mockResolvedValue([]),
          runWorkflowInBackground: mockRunWorkflow,
        }) as unknown as GitAutomationOrchestrator,
    );

    const freshState = {
      projectRoot: "/test/project",
      session: {
        id: "test-session-sc",
        model: { provider: "anthropic", modelId: "claude-sonnet" },
      },
    };

    await automateCommand("template daily-verify", freshState);

    // Trigger the captured cron callback
    expect(_capturedScheduleCallback).not.toBeNull();
    await _capturedScheduleCallback!();

    // Allow async operations to settle
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(mockRunWorkflow).toHaveBeenCalledWith(expect.objectContaining({ agentMode }));
  });
});

// ─── Test 12: watch template starts FilePatternWatcher ───────────────────

describe("/automate template test-on-change — watch", () => {
  it("watch template starts FilePatternWatcher with correct pattern", async () => {
    const fakeCreate = vi.fn().mockReturnValue({
      id: "tmpl-watch-001",
      name: "test-on-change",
      type: "watch",
      config: { pattern: "src/**/*.ts", debounceMs: 500 },
      agentMode: {
        prompt: "A source file changed: ${changedFile}. Run tests.",
        sandboxMode: "host",
        verifyOutput: false,
      },
      workflowPath: ".github/workflows/test-on-change.yml",
      createdAt: new Date().toISOString(),
      status: "active",
      runCount: 0,
    });

    mockGetTemplate.mockReturnValue({
      name: "test-on-change",
      description: "Run tests on source change",
      type: "watch",
      create: fakeCreate,
    });

    const freshState = {
      projectRoot: "/test/project",
      session: { id: "test-session-w", model: { provider: "anthropic", modelId: "claude-sonnet" } },
    };

    await automateCommand("template test-on-change", freshState);

    // Assert FilePatternWatcher constructor was called with pattern
    expect(MockFilePatternWatcher).toHaveBeenCalledWith(
      expect.objectContaining({ pattern: "src/**/*.ts" }),
    );

    // Assert .start() was called on the watcher instance
    expect(_mockWatcherStart).toHaveBeenCalled();
  });
});
