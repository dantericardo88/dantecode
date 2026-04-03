// ============================================================================
// @dantecode/cli — maybeAutoResumeDurableRunAfterBackgroundTask
// Tests the bridge function that resumes a durable run after a background task
// completes. This lives in the cli/tests/mcp/ directory because it exercises
// the post-background-task resumption path that MCP callers trigger.
// ============================================================================

import { describe, it, expect, vi } from "vitest";

// Heavy mocking is required because agent-loop.ts has many top-level imports.
// We hoist all mock factories before any imports.
const { mockRunAgentLoop } = vi.hoisted(() => ({
  mockRunAgentLoop: vi.fn().mockResolvedValue({
    id: "resumed-session",
    projectRoot: "/tmp/test",
    messages: [],
  }),
}));

vi.mock("ai", () => ({
  generateText: vi.fn(),
  streamText: vi.fn(),
}));

vi.mock("@dantecode/core", () => ({
  ModelRouterImpl: vi.fn().mockImplementation(() => ({
    generate: vi.fn().mockResolvedValue(""),
    stream: vi.fn(),
    analyzeComplexity: vi.fn().mockReturnValue(0.3),
    escalateTier: vi.fn(),
    isUsingFallback: vi.fn().mockReturnValue(false),
    getFallbackModelId: vi.fn().mockReturnValue(undefined),
    currentTier: vi.fn().mockReturnValue("standard"),
    getUsage: vi.fn().mockReturnValue({ promptTokens: 0, completionTokens: 0 }),
    recordTierOutcome: vi.fn(),
  })),
  ApproachMemory: vi.fn().mockImplementation(() => ({
    findSimilar: vi.fn().mockReturnValue([]),
    record: vi.fn(),
  })),
  PromptCache: vi.fn().mockImplementation(() => ({
    get: vi.fn().mockReturnValue(undefined),
    set: vi.fn(),
  })),
  CircuitBreaker: vi.fn().mockImplementation(() => ({
    execute: vi.fn().mockImplementation((id: string, fn: () => Promise<unknown>) => fn()),
    getState: vi.fn().mockReturnValue("closed"),
    getFailureThreshold: vi.fn().mockReturnValue(5),
    getResetTimeoutMs: vi.fn().mockReturnValue(60000),
  })),
  LoopDetector: vi.fn().mockImplementation(() => ({
    recordAction: vi
      .fn()
      .mockReturnValue({ stuck: false, iterationCount: 1, consecutiveRepeats: 0 }),
    reset: vi.fn(),
  })),
  BackgroundTaskStore: vi.fn().mockImplementation(() => ({
    saveTask: vi.fn().mockResolvedValue(undefined),
    loadTask: vi.fn().mockResolvedValue(null),
    listTasks: vi.fn().mockResolvedValue([]),
    deleteTask: vi.fn().mockResolvedValue(undefined),
    cleanupExpired: vi.fn().mockResolvedValue(undefined),
  })),
  BackgroundAgentRunner: vi.fn().mockImplementation(() => ({
    setWorkFn: vi.fn(),
    enqueue: vi.fn().mockReturnValue("mock-task-id"),
    getTask: vi.fn().mockReturnValue(null),
    listTasks: vi.fn().mockReturnValue([]),
    cancel: vi.fn().mockReturnValue(false),
    getStatusCounts: vi
      .fn()
      .mockReturnValue({ queued: 0, running: 0, paused: 0, completed: 0, failed: 0, cancelled: 0 }),
    hasWorkFn: vi.fn().mockReturnValue(false),
  })),
  appendAuditEvent: vi.fn(),
  readOrInitializeState: vi.fn().mockResolvedValue({
    model: {
      default: {
        provider: "grok",
        modelId: "grok-3",
        maxTokens: 4096,
        temperature: 0.1,
        contextWindow: 131072,
        supportsVision: false,
        supportsToolCalls: false,
      },
      fallback: [],
      taskOverrides: {},
    },
    project: { name: "test", language: "typescript" },
    pdse: {
      threshold: 60,
      hardViolationsAllowed: 0,
      maxRegenerationAttempts: 3,
      weights: { completeness: 0.3, correctness: 0.3, clarity: 0.2, consistency: 0.2 },
    },
    autoforge: {
      enabled: false,
      maxIterations: 1,
      gstackCommands: [],
      lessonInjectionEnabled: false,
      abortOnSecurityViolation: false,
    },
  }),
  DurableRunStore: vi.fn().mockImplementation(() => ({
    getLatestWaiting: vi.fn().mockResolvedValue(null),
    loadSessionSnapshot: vi.fn().mockResolvedValue(null),
    pauseRun: vi.fn(),
    checkpointRun: vi.fn(),
    initializeRun: vi.fn(),
    appendEvidence: vi.fn(),
    loadResumeHint: vi.fn().mockResolvedValue(null),
    loadToolCallRecords: vi.fn().mockResolvedValue([]),
    persistPendingToolCalls: vi.fn(),
    persistToolCallRecords: vi.fn(),
    loadPendingToolCalls: vi.fn().mockResolvedValue([]),
    clearPendingToolCalls: vi.fn(),
  })),
  ToolScheduler: vi.fn().mockImplementation(() => ({
    executeBatch: vi.fn(),
    resumeToolCalls: vi.fn((tc: unknown) => tc),
  })),
  SecurityEngine: vi.fn().mockImplementation(() => ({
    audit: vi.fn().mockReturnValue({ safe: true }),
    scanContent: vi.fn().mockReturnValue({ violations: [] }),
  })),
  SelfImprovementPolicy: vi.fn().mockImplementation(() => ({
    isEnabled: vi.fn().mockReturnValue(false),
    canEditPath: vi.fn().mockReturnValue(true),
  })),
  RecoveryEngine: vi.fn().mockImplementation(() => ({
    runRepoRootVerification: vi.fn().mockReturnValue({ passed: true, failedSteps: [] }),
  })),
  CodeIndex: vi.fn().mockImplementation(() => ({
    load: vi.fn().mockResolvedValue(false),
    buildIndex: vi.fn().mockResolvedValue(undefined),
    save: vi.fn().mockResolvedValue(undefined),
    search: vi.fn().mockReturnValue([]),
  })),
  createMemoryOrchestrator: vi.fn().mockReturnValue({
    initialize: vi.fn().mockResolvedValue(undefined),
    recall: vi.fn().mockResolvedValue([]),
    store: vi.fn().mockResolvedValue(undefined),
    summarize: vi.fn().mockResolvedValue(""),
    prune: vi.fn().mockResolvedValue(undefined),
    getUtilization: vi.fn().mockReturnValue({ percent: 0 }),
  }),
  createEmbeddingProvider: vi.fn(),
  globalVerificationRailRegistry: { addRail: vi.fn(), listRails: vi.fn().mockReturnValue([]) },
  verifyOutput: vi.fn().mockReturnValue({ passed: true }),
  runQaSuite: vi.fn().mockReturnValue({ passed: true }),
  criticDebate: vi.fn().mockReturnValue({ consensus: "pass" }),
  BrowserAgent: vi.fn().mockImplementation(() => ({})),
  PersistentMemory: vi.fn().mockImplementation(() => ({
    load: vi.fn().mockResolvedValue(undefined),
    store: vi.fn().mockResolvedValue({}),
    search: vi.fn().mockReturnValue([]),
    getAll: vi.fn().mockReturnValue([]),
    distill: vi.fn().mockResolvedValue({}),
  })),
  SessionStore: vi.fn().mockImplementation(() => ({
    load: vi.fn().mockResolvedValue(null),
    summarize: vi.fn().mockResolvedValue(""),
  })),
}));

vi.mock("@dantecode/git-engine", () => ({
  getStatus: vi.fn().mockResolvedValue({ clean: true, files: [] }),
  autoCommit: vi.fn().mockResolvedValue(undefined),
  generateRepoMap: vi.fn().mockResolvedValue({ files: [], totalFiles: 0 }),
  formatRepoMapForContext: vi.fn().mockReturnValue(""),
  DurableRunStore: vi.fn().mockImplementation(() => ({
    getLatestWaiting: vi.fn().mockResolvedValue(null),
    loadSessionSnapshot: vi.fn().mockResolvedValue(null),
    pauseRun: vi.fn(),
    checkpointRun: vi.fn(),
    initializeRun: vi.fn(),
    appendEvidence: vi.fn(),
    loadResumeHint: vi.fn().mockResolvedValue(null),
    loadToolCallRecords: vi.fn().mockResolvedValue([]),
    persistPendingToolCalls: vi.fn(),
    persistToolCallRecords: vi.fn(),
    loadPendingToolCalls: vi.fn().mockResolvedValue([]),
    clearPendingToolCalls: vi.fn(),
  })),
}));

vi.mock("@dantecode/danteforge", () => ({
  formatLessonsForPrompt: vi.fn().mockReturnValue(""),
  queryLessons: vi.fn().mockResolvedValue([]),
  recordLesson: vi.fn().mockResolvedValue({}),
  recordPreference: vi.fn().mockResolvedValue({}),
  recordSuccessPattern: vi.fn().mockResolvedValue({}),
  runAntiStubScanner: vi
    .fn()
    .mockReturnValue({ passed: true, hardViolations: [], softViolations: [] }),
  runConstitutionCheck: vi.fn().mockReturnValue({ passed: true, violations: [] }),
  runLocalPDSEScorer: vi.fn().mockReturnValue({ passedGate: true, overall: 80 }),
}));

vi.mock("@dantecode/memory-engine", () => ({
  createMemoryOrchestrator: vi.fn().mockReturnValue({
    initialize: vi.fn().mockResolvedValue(undefined),
    recall: vi.fn().mockResolvedValue([]),
    store: vi.fn().mockResolvedValue(undefined),
    summarize: vi.fn().mockResolvedValue(""),
    prune: vi.fn().mockResolvedValue(undefined),
    getUtilization: vi.fn().mockReturnValue({ percent: 0 }),
  }),
}));

vi.mock("@dantecode/debug-trail", () => ({
  getGlobalLogger: vi.fn().mockReturnValue({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    flush: vi.fn().mockResolvedValue(undefined),
  }),
}));

vi.mock("../../src/safety.js", () => ({
  normalizeAndCheckBash: vi.fn().mockReturnValue({ safe: true, normalized: "" }),
}));

vi.mock("../../src/stream-renderer.js", () => ({
  StreamRenderer: vi.fn().mockImplementation(() => ({
    renderToken: vi.fn(),
    finish: vi.fn(),
  })),
}));

vi.mock("../../src/sandbox-bridge.js", () => ({
  SandboxBridge: vi.fn(),
}));

vi.mock("../../src/confirm-flow.js", () => ({
  confirmDestructive: vi.fn().mockResolvedValue(true),
}));

vi.mock("../../src/tool-schemas.js", () => ({
  getAISDKTools: vi.fn().mockReturnValue({}),
}));

vi.mock("../../src/tools.js", () => ({
  executeTool: vi.fn().mockResolvedValue({ output: "ok", isError: false }),
  getToolDefinitions: vi.fn().mockReturnValue([]),
}));

// Now import the function under test
import { maybeAutoResumeDurableRunAfterBackgroundTask } from "../../src/background-task-manager.js";
import type { AgentLoopConfig } from "../../src/agent-loop.js";
import type { Session, DanteCodeState } from "@dantecode/config-types";

// ---------------------------------------------------------------------------
// Shared test fixtures
// ---------------------------------------------------------------------------

function makeSession(overrides?: Partial<Session>): Session {
  return {
    id: "test-session",
    projectRoot: "/tmp/test-project",
    messages: [],
    activeFiles: [],
    readOnlyFiles: [],
    model: {
      provider: "grok",
      modelId: "grok-3",
      maxTokens: 4096,
      temperature: 0.1,
      contextWindow: 131072,
      supportsVision: false,
      supportsToolCalls: false,
    },
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    agentStack: [],
    todoList: [],
    ...overrides,
  };
}

function makeConfig(overrides?: Partial<AgentLoopConfig>): AgentLoopConfig {
  return {
    state: {
      model: {
        default: {
          provider: "grok",
          modelId: "grok-3",
          maxTokens: 4096,
          temperature: 0.1,
          contextWindow: 131072,
          supportsVision: false,
          supportsToolCalls: false,
        },
        fallback: [],
        taskOverrides: {},
      },
      project: { name: "test", language: "typescript" },
      pdse: {
        threshold: 60,
        hardViolationsAllowed: 0,
        maxRegenerationAttempts: 3,
        weights: { completeness: 0.3, correctness: 0.3, clarity: 0.2, consistency: 0.2 },
      },
      autoforge: {
        enabled: false,
        maxIterations: 1,
        gstackCommands: [],
        lessonInjectionEnabled: false,
        abortOnSecurityViolation: false,
      },
    } as unknown as DanteCodeState,
    verbose: false,
    enableGit: false,
    enableSandbox: false,
    silent: true,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("maybeAutoResumeDurableRunAfterBackgroundTask", () => {
  it("returns false immediately when durableRunId is undefined", async () => {
    const result = await maybeAutoResumeDurableRunAfterBackgroundTask({
      durableRunId: undefined,
      parentSession: makeSession(),
      parentConfig: makeConfig(),
    });

    expect(result).toBe(false);
  });

  it("calls runAgentLoopImpl with 'continue' and config.runId set to durableRunId", async () => {
    const result = await maybeAutoResumeDurableRunAfterBackgroundTask({
      durableRunId: "run-abc123",
      parentSession: makeSession(),
      parentConfig: makeConfig(),
      runAgentLoopImpl: mockRunAgentLoop,
    });

    expect(result).toBe(true);
    expect(mockRunAgentLoop).toHaveBeenCalledOnce();

    const [prompt, , config] = mockRunAgentLoop.mock.calls[0] as [string, Session, AgentLoopConfig];
    expect(prompt).toBe("continue");
    expect(config.runId).toBe("run-abc123");
    expect(config.resumeFrom).toBe("run-abc123");
  });
});
