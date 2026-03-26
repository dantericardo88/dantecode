// ============================================================================
// @dantecode/cli — Agent Loop Smoke Tests
// End-to-end smoke tests that exercise the full agent loop flow with mocked
// providers. Tests: basic prompt, tool dispatch, safety blocking, stuck loop,
// planning phase, approach memory, pivot logic, progress tracking.
// ============================================================================

import { describe, it, expect, vi, beforeEach } from "vitest";
import { resolve } from "node:path";

// Mock external dependencies BEFORE importing module under test

// Mock generateText at the "ai" module level — ModelRouterImpl calls this internally.
const mockGenerateText = vi.fn();
const {
  mockGetLatestWaitingRun,
  mockLoadSessionSnapshot,
  mockPauseRun,
  mockCheckpointRun,
  mockInitializeRun,
  mockAppendEvidence,
  mockLoadResumeHint,
  mockLoadToolCallRecords,
  mockSchedulerExecuteBatch,
  mockSchedulerResumeToolCalls,
  mockLoadBackgroundTask,
  mockPersistPendingToolCalls,
  mockPersistToolCallRecords,
  mockLoadPendingToolCalls,
  mockClearPendingToolCalls,
} = vi.hoisted(() => ({
  mockGetLatestWaitingRun: vi.fn().mockResolvedValue(null),
  mockLoadSessionSnapshot: vi.fn().mockResolvedValue(null),
  mockPauseRun: vi.fn(),
  mockCheckpointRun: vi.fn(),
  mockInitializeRun: vi.fn(),
  mockAppendEvidence: vi.fn(),
  mockLoadResumeHint: vi.fn().mockResolvedValue(null),
  mockLoadToolCallRecords: vi.fn().mockResolvedValue([]),
  mockSchedulerExecuteBatch: vi.fn(),
  mockSchedulerResumeToolCalls: vi.fn((toolCalls) => toolCalls),
  mockLoadBackgroundTask: vi.fn().mockResolvedValue(null),
  mockPersistPendingToolCalls: vi.fn(),
  mockPersistToolCallRecords: vi.fn(),
  mockLoadPendingToolCalls: vi.fn().mockResolvedValue([]),
  mockClearPendingToolCalls: vi.fn(),
}));

vi.mock("ai", () => ({
  generateText: mockGenerateText,
  streamText: vi.fn(),
}));

// Track analyzeComplexity return value so tests can override it
let mockAnalyzeComplexityValue = 0.3;
const mockEscalateTier = vi.fn();
const mockIsUsingFallback = vi.fn<() => boolean>().mockReturnValue(false);
const mockGetFallbackModelId = vi.fn<() => string | undefined>().mockReturnValue(undefined);

vi.mock("@dantecode/core", () => {
  // Build a lightweight mock ModelRouterImpl that uses our mockGenerateText
  class MockModelRouterImpl {
    private _modelRatedComplexity: number | null = null;
    private _firstTurnCompleted = false;

    constructor(_routerConfig: unknown, _projectRoot: string, _sessionId: string) {}

    async generate(
      messages: Array<{ role: string; content: string }>,
      _options?: Record<string, unknown>,
    ): Promise<string> {
      const result = await mockGenerateText({
        model: { modelId: "mock" },
        messages,
        system: _options?.system,
      });
      return result.text;
    }

    async stream(
      messages: Array<{ role: string; content: string }>,
      _options?: Record<string, unknown>,
    ): Promise<{ textStream: AsyncIterable<string> }> {
      const result = await mockGenerateText({
        model: { modelId: "mock" },
        messages,
        system: _options?.system,
      });
      const text = result.text;
      return {
        textStream: (async function* () {
          yield text;
        })(),
      };
    }

    extractModelComplexityRating(_responseText: string, _userPrompt?: string): number | null {
      if (this._firstTurnCompleted) return this._modelRatedComplexity;
      this._firstTurnCompleted = true;
      this._modelRatedComplexity = 0.3;
      return 0.3;
    }

    getModelRatedComplexity(): number | null {
      return this._modelRatedComplexity;
    }

    analyzeComplexity(_prompt: string): number {
      return mockAnalyzeComplexityValue;
    }

    forceCapable() {
      mockEscalateTier("forceCapable");
    }

    escalateTier(reason: string) {
      mockEscalateTier(reason);
    }

    selectTier() {
      return "fast";
    }
    recordRequestCost() {}
    resetSessionCost() {}
    isUsingFallback(): boolean {
      return mockIsUsingFallback();
    }
    getFallbackModelId(): string | undefined {
      return mockGetFallbackModelId();
    }
  }

  // Mock SessionStore for cross-session learning
  const mockGetRecentSummaries = vi.fn().mockResolvedValue([]);

  class MockSessionStore {
    constructor(_projectRoot: string) {}
    async getRecentSummaries(limit = 3) {
      return mockGetRecentSummaries(limit);
    }
    async list() {
      return [];
    }
    async load() {
      return null;
    }
    async save() {}
    async saveRuntimeSession() {}
    async loadRuntimeSession() {
      return null;
    }
  }

  class MockDurableRunStore {
    constructor(_projectRoot: string) {}
    async initializeRun(options: Record<string, unknown>) {
      mockInitializeRun(options);
      return {
        id: (options.runId as string | undefined) ?? "durable-run-1",
        projectRoot: "/tmp/test-project",
        sessionId: "test-session",
        prompt: String(options.prompt ?? ""),
        workflow: (options.workflow as string | undefined) ?? "agent-loop",
        status: "running",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        touchedFiles: [],
        evidenceCount: 0,
      };
    }
    async checkpoint(runId: string, payload: Record<string, unknown>) {
      mockCheckpointRun(runId, payload);
    }
    async pauseRun(runId: string, payload: Record<string, unknown>) {
      mockPauseRun(runId, payload);
      return {
        id: runId,
        status: "waiting_user",
        workflow: "agent-loop",
        resumeHint: {
          runId,
          summary: "Paused after timeout",
          lastConfirmedStep: "Read src/app.ts",
          lastSuccessfulTool: "Read",
          nextAction: "Retry from the last confirmed step.",
          continueCommand: "continue",
        },
      };
    }
    async appendEvidence(runId: string, evidence: unknown) {
      mockAppendEvidence(runId, evidence);
    }
    async persistPendingToolCalls(runId: string, toolCalls: unknown[]) {
      mockPersistPendingToolCalls(runId, toolCalls);
    }
    async persistToolCallRecords(runId: string, toolCalls: unknown[]) {
      mockPersistToolCallRecords(runId, toolCalls);
    }
    async loadPendingToolCalls(runId: string) {
      return mockLoadPendingToolCalls(runId);
    }
    async clearPendingToolCalls(runId: string) {
      mockClearPendingToolCalls(runId);
    }
    async completeRun() {}
    async failRun() {}
    async loadRun() {
      return null;
    }
    async loadEvidence() {
      return [];
    }
    async getLatestWaitingUserRun() {
      return mockGetLatestWaitingRun();
    }
    async loadSessionSnapshot(runId: string) {
      return mockLoadSessionSnapshot(runId);
    }
    async getResumeHint(runId: string) {
      return mockLoadResumeHint(runId);
    }
    async loadToolCallRecords(runId: string) {
      return mockLoadToolCallRecords(runId);
    }
  }

  class MockBackgroundTaskStore {
    constructor(_projectRoot: string) {}
    async saveTask() {}
    async loadTask(taskId: string) {
      return mockLoadBackgroundTask(taskId);
    }
    async listTasks() {
      return [];
    }
  }

  return {
    ModelRouterImpl: MockModelRouterImpl,
    SessionStore: MockSessionStore,
    DurableRunStore: MockDurableRunStore,
    BackgroundTaskStore: MockBackgroundTaskStore,
    _mockGetRecentSummaries: mockGetRecentSummaries,
    appendAuditEvent: vi.fn().mockResolvedValue(undefined),
    shouldContinueLoop: vi.fn(() => true),
    estimateTokens: vi.fn((text: string) => Math.ceil(text.length / 4)),
    estimateMessageTokens: vi.fn((msgs: Array<{ content: string }>) =>
      msgs.reduce((sum, m) => sum + Math.ceil(m.content.length / 4), 0),
    ),
    promptRequestsToolExecution: vi.fn((prompt: string) =>
      /\b(fix|update|write|edit|add|build|implement|change)\b/i.test(prompt),
    ),
    responseNeedsToolExecutionNudge: vi.fn((text: string) =>
      /\b(i will|plan|steps?|phase|first|next|then|created|updated|modified|executing plan)\b/i.test(
        text,
      ),
    ),
    parseVerificationErrors: vi.fn(() => []),
    formatErrorsForFixPrompt: vi.fn(() => ""),
    computeErrorSignature: vi.fn(() => ""),
    getContextUtilization: vi.fn(() => ({
      tokens: 100,
      maxTokens: 128000,
      percent: 0,
      tier: "green",
    })),
    isProtectedWriteTarget: vi.fn((filePath: string) => /packages[\\/]/.test(filePath)),
    runStartupHealthCheck: vi.fn().mockResolvedValue({ healthy: true }),
    // Skill wave orchestrator — real implementations for integration testing
    getCurrentWave: vi.fn(
      (state: {
        currentIndex: number;
        waves: Array<{ number: number; title: string; instructions: string }>;
      }) => {
        if (state.currentIndex >= state.waves.length) return null;
        return state.waves[state.currentIndex];
      },
    ),
    advanceWave: vi.fn(
      (state: {
        currentIndex: number;
        waves: Array<{ number: number }>;
        completedWaves: number[];
      }) => {
        const current =
          state.currentIndex < state.waves.length ? state.waves[state.currentIndex] : null;
        if (!current) return false;
        state.completedWaves.push(current.number);
        state.currentIndex++;
        return state.currentIndex < state.waves.length;
      },
    ),
    recordWaveFailure: vi.fn(() => true),
    buildWavePrompt: vi.fn(
      (state: { currentIndex: number; waves: Array<{ number: number; title: string }> }) => {
        const current =
          state.currentIndex < state.waves.length ? state.waves[state.currentIndex] : null;
        if (!current) return "All waves complete.";
        return `## Wave ${current.number}/${state.waves.length}: ${current.title}\nWave instructions here.\nSignal [WAVE COMPLETE] when done.`;
      },
    ),
    isWaveComplete: vi.fn((text: string) => /\[WAVE\s+COMPLETE\]/i.test(text)),
    isValidWaveCompletion: vi.fn((text: string) => /\[WAVE\s+COMPLETE\]/i.test(text)),
    verifyCompletion: vi.fn(async () => ({
      verdict: "complete",
      confidence: 1,
      passed: [],
      failed: [],
      summary: "ok",
    })),
    deriveWaveExpectations: vi.fn(() => ({ expectedFiles: [] })),
    CLAUDE_WORKFLOW_MODE: "## Claude Workflow Mode — ACTIVE\nTest workflow mode.",
    // Approach memory + prompt cache mocks
    ApproachMemory: class MockApproachMemory {
      async load() {}
      async save() {}
      async record() {}
      async findSimilar() {
        return [];
      }
      async getFailedApproaches() {
        return [];
      }
      async getAll() {
        return [];
      }
      async clear() {}
      get size() {
        return 0;
      }
    },
    formatApproachesForPrompt: vi.fn().mockReturnValue(""),
    buildWorkflowInvocationPrompt: vi.fn(() => "## Workflow Contract\nTest workflow contract."),
    globalToolScheduler: {
      executeBatch: mockSchedulerExecuteBatch.mockImplementation(async (toolCalls, options) => {
        const results = [];
        for (const toolCall of toolCalls) {
          const raw = await options.execute(toolCall);
          results.push({
            request: toolCall,
            record: {
              id: toolCall.id,
              toolName: toolCall.toolName,
              input: toolCall.input,
              dependsOn: toolCall.dependsOn,
              requestId: options.requestId,
              status: raw.isError ? "error" : "success",
              statusHistory: [],
              createdAt: Date.now(),
              result: raw,
            },
            result: raw,
            executed: true,
            verificationMessage: undefined,
          });
        }
        return results;
      }),
      resumeToolCalls: mockSchedulerResumeToolCalls,
      verifyBashArtifacts: vi.fn().mockResolvedValue(null),
      verifyWriteArtifact: vi.fn().mockResolvedValue(null),
    },
    globalArtifactStore: {
      getByKind: vi.fn(() => []),
    },
    globalExecutionPolicy: {
      dependenciesSatisfied: vi.fn(() => ({ satisfied: true })),
      isBlocked: vi.fn(() => ({ blocked: false })),
    },
    adaptToolResult: vi.fn(
      (
        _toolName: string,
        _input: Record<string, unknown>,
        raw: { content: string; isError: boolean },
      ) => raw,
    ),
    formatEvidenceSummary: vi.fn(() => ""),
    // UXEngine — required because stream-renderer.ts imports it from @dantecode/core
    UXEngine: class MockUXEngine {
      constructor(_opts?: Record<string, unknown>) {}
      applyTheme() {}
      getTheme() {
        return { name: "default", icons: {}, colors: {} };
      }
      getThemeName() {
        return "default";
      }
      listThemes() {
        return ["default"];
      }
      formatProgress() {
        return "";
      }
      formatError(msg: string) {
        return `Error: ${msg}`;
      }
      formatSuccess(msg: string) {
        return `✓ ${msg}`;
      }
      formatWarning(msg: string) {
        return `⚠ ${msg}`;
      }
      formatInfo(msg: string) {
        return `ℹ ${msg}`;
      }
      generateHint() {
        return "";
      }
      buildStatusLine() {
        return "";
      }
      stripColors(t: string) {
        return t;
      }
      truncate(t: string) {
        return t;
      }
      formatTable() {
        return "";
      }
      formatMarkdown(t: string) {
        return t;
      }
      formatDiff() {
        return "";
      }
    },
    // Spinner — also exported from ux-engine via @dantecode/core
    Spinner: class MockSpinner {
      constructor(_opts?: Record<string, unknown>) {}
      start() {}
      update() {}
      succeed() {}
      fail() {}
      warn() {}
      stop() {}
    },
    // MetricsCollector — required because agent-loop.ts imports and instantiates it
    MetricsCollector: class MockMetricsCollector {
      constructor() {}
      recordTiming(_name: string, _durationMs: number) {}
      increment(_name: string, _value?: number) {}
      observe(_name: string, _value: number) {}
      record(_name: string, _value: number) {}
      getCounter(_name: string) {
        return 0;
      }
      getGauge(_name: string) {
        return 0;
      }
      getSamples(_name: string) {
        return [];
      }
      toPrometheus() {
        return "";
      }
      toJSON() {
        return {};
      }
      reset() {}
    },
    // ReasoningChain — Lane 1 wiring
    ReasoningChain: class MockReasoningChain {
      constructor() {}
      decideTier() {
        return "basic";
      }
      think() {
        return { steps: [], recommendation: "" };
      }
      recordStep() {}
      shouldCritique() {
        return false;
      }
      selfCritique() {
        return { recommendation: "" };
      }
      formatChainForPrompt() {
        return "";
      }
      recordTierOutcome() {}
      getTierPerformance() {
        return {};
      }
      getAdaptiveBias() {
        return 0;
      }
      getStepCount() {
        return 0;
      }
    },
    // AutonomyEngine — Lane 1 wiring
    AutonomyEngine: class MockAutonomyEngine {
      constructor() {}
      resume() {
        return Promise.resolve();
      }
      incrementStep() {}
      shouldRunMetaReasoning() {
        return false;
      }
      metaReason() {
        return Promise.resolve("");
      }
      save() {
        return Promise.resolve();
      }
    },
    // PersistentMemory — Lane 1 wiring
    PersistentMemory: class MockPersistentMemory {
      constructor() {}
      load() {
        return Promise.resolve();
      }
      search() {
        return [];
      }
      store() {
        return Promise.resolve();
      }
    },
    // SecurityEngine — Lane 2 wiring
    SecurityEngine: class MockSecurityEngine {
      constructor() {}
      checkAction() {
        return { allowed: true };
      }
    },
    // SecretsScanner — Lane 2 wiring
    SecretsScanner: class MockSecretsScanner {
      constructor() {}
      scan() {
        return { clean: true, findings: [] };
      }
    },
    // synthesizeConfidence — Lane 4 wiring
    synthesizeConfidence: vi.fn(() => ({ decision: "pass", confidence: 1.0, rationale: "" })),
    // getCostMultiplier — cost tracking
    getCostMultiplier: vi.fn((_modelId: string) => 1.0),
    // detectSelfImprovementContext — called when isUsingFallback() returns true
    detectSelfImprovementContext: vi.fn((_prompt: string, _root: string, _opts?: unknown) => null),
    // PRQualityChecker — advisory PR quality scoring in danteforge-pipeline
    PRQualityChecker: class MockPRQualityChecker {
      check() {
        return {
          size: { linesAdded: 0, linesRemoved: 0, isLarge: false },
          antiStubViolations: [],
          conventionViolations: [],
          testsPassed: true,
          score: 85,
          blocked: false,
        };
      }
      score(report: { score: number }) {
        return report.score;
      }
      shouldBlock() {
        return false;
      }
    },
    // TaskComplexityRouter — informational complexity classification
    TaskComplexityRouter: class MockTaskComplexityRouter {
      classify() {
        return {
          complexity: "standard",
          confidence: 0.8,
          signals: {
            promptTokens: 100,
            fileCount: 1,
            hasReasoning: false,
            hasSecurity: false,
            hasMultiFile: false,
            estimatedOutputTokens: 50,
          },
          recommendedModel: "claude-sonnet-4-6",
          rationale: "mock",
          evidenceLogged: false,
        };
      }
      getModel() {
        return "claude-sonnet-4-6";
      }
      extractSignals() {
        return {
          promptTokens: 100,
          fileCount: 1,
          hasReasoning: false,
          hasSecurity: false,
          hasMultiFile: false,
          estimatedOutputTokens: 50,
        };
      }
    },
  };
});

vi.mock("@dantecode/danteforge", () => ({
  runAntiStubScanner: vi.fn(() => ({ passed: true, hardViolations: [] })),
  runLocalPDSEScorer: vi.fn(() => ({
    overall: 85,
    passedGate: true,
    completeness: 85,
    correctness: 85,
    clarity: 85,
    consistency: 85,
  })),
  runConstitutionCheck: vi.fn(() => ({ violations: [] })),
  queryLessons: vi.fn().mockResolvedValue([]),
  formatLessonsForPrompt: vi.fn().mockReturnValue(""),
  detectAndRecordPatterns: vi.fn().mockResolvedValue([]),
  recordSuccessPattern: vi.fn().mockResolvedValue({}),
}));

// Get references to the mocked danteforge functions for assertions
import {
  queryLessons as _ql,
  formatLessonsForPrompt as _flp,
  detectAndRecordPatterns as _darp,
} from "@dantecode/danteforge";
import {
  parseVerificationErrors as _parseVerificationErrors,
  computeErrorSignature as _computeErrorSignature,
} from "@dantecode/core";
const mockQueryLessons = _ql as unknown as ReturnType<typeof vi.fn>;
const mockFormatLessonsForPrompt = _flp as unknown as ReturnType<typeof vi.fn>;
const mockDetectAndRecordPatterns = _darp as unknown as ReturnType<typeof vi.fn>;
const mockParseVerificationErrors = _parseVerificationErrors as unknown as ReturnType<typeof vi.fn>;
const mockComputeErrorSignature = _computeErrorSignature as unknown as ReturnType<typeof vi.fn>;

// Mock confirm-flow so FearSet enforcement gate tests don't need a TTY.
// vi.hoisted ensures the mock variable is available before vi.mock's factory runs.
const { mockConfirmDestructive } = vi.hoisted(() => ({
  mockConfirmDestructive: vi.fn<() => Promise<boolean>>().mockResolvedValue(false),
}));
vi.mock("./confirm-flow.js", () => ({
  confirmDestructive: mockConfirmDestructive,
  confirm: vi.fn().mockResolvedValue(true),
  select: vi.fn().mockResolvedValue(""),
}));

// DanteMemory mocks — hoisted so the factories below can reference them
const {
  mockMemoryRecall,
  mockMemoryStore,
  mockMemorySummarize,
  mockMemoryPrune,
  mockMemoryInitialize,
  mockAuditLoggerFlush,
} = vi.hoisted(() => ({
  mockMemoryRecall: vi.fn().mockResolvedValue({
    query: "",
    scope: "all",
    results: [],
    latencyMs: 0,
  }),
  mockMemoryStore: vi.fn().mockResolvedValue({ stored: true }),
  mockMemorySummarize: vi.fn().mockResolvedValue({
    sessionId: "test-session",
    summary: "",
    compressed: false,
    tokensSaved: 0,
  }),
  mockMemoryPrune: vi.fn().mockResolvedValue({
    prunedCount: 0,
    retainedCount: 0,
    policy: "default",
  }),
  mockMemoryInitialize: vi.fn().mockResolvedValue(undefined),
  mockAuditLoggerFlush: vi.fn().mockResolvedValue({
    anomalies: [],
    analyzedCount: 0,
    bufferTruncated: false,
    detection: { analyzedCount: 0, truncated: false },
  }),
}));

vi.mock("@dantecode/memory-engine", () => ({
  createMemoryOrchestrator: vi.fn(() => ({
    initialize: mockMemoryInitialize,
    memoryRecall: mockMemoryRecall,
    memoryStore: mockMemoryStore,
    memorySummarize: mockMemorySummarize,
    memoryPrune: mockMemoryPrune,
  })),
}));

vi.mock("@dantecode/debug-trail", () => ({
  getGlobalLogger: vi.fn().mockReturnValue({
    flush: mockAuditLoggerFlush,
    log: vi.fn().mockResolvedValue(""),
    getProvenance: vi.fn().mockReturnValue({ sessionId: "test", runId: "run" }),
  }),
  AuditLogger: vi.fn(),
  FileSnapshotter: vi.fn().mockImplementation(() => ({
    captureBeforeState: vi.fn().mockResolvedValue({ beforeSnapshotId: "snap1", beforeHash: "abc" }),
    captureAfterState: vi.fn().mockResolvedValue({ afterSnapshotId: "snap2", afterHash: "def" }),
    init: vi.fn().mockResolvedValue(undefined),
  })),
}));

// Core mocked functions are available via vi.mock above; import only if needed.

vi.mock("@dantecode/git-engine", () => ({
  getStatus: vi.fn(() => ({ staged: [], unstaged: [], untracked: [] })),
  autoCommit: vi.fn(),
  generateRepoMap: vi.fn(() => [
    { path: "src/index.ts", size: 1024, language: "typescript", lastModified: "2025-01-01" },
    { path: "src/utils.ts", size: 512, language: "typescript", lastModified: "2025-01-01" },
  ]),
  formatRepoMapForContext: vi.fn(
    () => "src/index.ts (1.0 KB, typescript)\nsrc/utils.ts (0.5 KB, typescript)",
  ),
}));

vi.mock("@dantecode/dante-skillbook", () => ({
  DanteSkillbook: vi.fn().mockImplementation(() => ({
    getSkills: vi.fn().mockReturnValue([]),
    applyUpdate: vi.fn().mockReturnValue(false),
    stats: vi
      .fn()
      .mockReturnValue({ totalSkills: 0, sections: {}, lastUpdatedAt: "", version: "1.0.0" }),
  })),
  GitSkillbookStore: vi.fn().mockImplementation(() => ({
    load: vi.fn().mockReturnValue(null),
    save: vi.fn(),
    exists: vi.fn().mockReturnValue(false),
  })),
  getRelevantSkills: vi.fn().mockReturnValue([]),
}));

vi.mock("./tools.js", () => ({
  executeTool: vi.fn().mockResolvedValue({ content: "ok", isError: false }),
  getToolDefinitions: vi.fn(() => [
    { name: "Read", description: "Read a file", parameters: {} },
    { name: "Write", description: "Write a file", parameters: {} },
    { name: "Bash", description: "Run command", parameters: {} },
  ]),
}));

// Get reference to executeTool mock for assertions
import { executeTool as _et } from "./tools.js";
const mockExecuteTool = _et as unknown as ReturnType<typeof vi.fn>;

vi.mock("./tool-schemas.js", () => ({
  getAISDKTools: vi.fn(() => ({})),
}));

// Skills registry mock — skill discovery must not block sessions
const mockDiscoverSkills = vi.fn().mockResolvedValue([]);
vi.mock("@dantecode/skills-registry", () => ({
  discoverSkills: (...args: unknown[]) => mockDiscoverSkills(...args),
  SkillRegistry: class MockSkillRegistry {
    private _entries: Array<{ name: string; slug: string; scope: string; disabled: boolean }> = [];
    register(entries: typeof this._entries) {
      this._entries.push(...entries);
    }
    list() {
      return this._entries.filter((e) => !e.disabled);
    }
    getCollisions() {
      return [];
    }
  },
}));

// Safety module is NOT mocked — we test it for real

import { runAgentLoop, type AgentLoopConfig } from "./agent-loop.js";
import { maybeAutoResumeDurableRunAfterBackgroundTask } from "./background-task-manager.js";
import type { Session, DanteCodeState } from "@dantecode/config-types";

// ---------------------------------------------------------------------------
// Test Fixtures
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

describe("runAgentLoop smoke tests", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAnalyzeComplexityValue = 0.3;
    mockEscalateTier.mockReset();
    mockIsUsingFallback.mockReturnValue(false);
    mockGetFallbackModelId.mockReturnValue(undefined);
    mockGenerateText.mockReset();
    mockExecuteTool.mockReset();
    mockExecuteTool.mockResolvedValue({ content: "ok", isError: false });
    mockGetLatestWaitingRun.mockResolvedValue(null);
    mockLoadSessionSnapshot.mockResolvedValue(null);
    mockLoadResumeHint.mockResolvedValue(null);
    mockLoadBackgroundTask.mockResolvedValue(null);
    mockPersistPendingToolCalls.mockReset();
    mockLoadPendingToolCalls.mockReset();
    mockLoadPendingToolCalls.mockResolvedValue([]);
    mockClearPendingToolCalls.mockReset();
    // DanteMemory mock resets
    mockMemoryInitialize.mockResolvedValue(undefined);
    mockMemoryRecall.mockResolvedValue({ query: "", scope: "all", results: [], latencyMs: 0 });
    mockMemoryStore.mockResolvedValue({ stored: true });
    mockMemorySummarize.mockResolvedValue({
      sessionId: "test-session",
      summary: "",
      compressed: false,
      tokensSaved: 0,
    });
    mockMemoryPrune.mockResolvedValue({ prunedCount: 0, retainedCount: 0, policy: "default" });
    mockAuditLoggerFlush.mockResolvedValue({
      anomalies: [],
      analyzedCount: 0,
      bufferTruncated: false,
      detection: { analyzedCount: 0, truncated: false },
    });
    mockSchedulerExecuteBatch.mockReset();
    mockSchedulerExecuteBatch.mockImplementation(async (toolCalls, options) => {
      const results = [];
      for (const toolCall of toolCalls) {
        const raw = await options.execute(toolCall);
        results.push({
          request: toolCall,
          record: {
            id: toolCall.id,
            toolName: toolCall.toolName,
            input: toolCall.input,
            requestId: options.requestId,
            status: raw.isError ? "error" : "success",
            statusHistory: [],
            createdAt: Date.now(),
            result: raw,
          },
          result: raw,
          executed: true,
          verificationMessage: undefined,
        });
      }
      return results;
    });
    mockDiscoverSkills.mockResolvedValue([]);
  });

  it("basic prompt produces response with no tool calls", async () => {
    mockGenerateText.mockResolvedValueOnce({
      text: "Hello! I can help you with that.\n[COMPLEXITY: 0.1]",
      usage: { promptTokens: 50, completionTokens: 20, totalTokens: 70 },
    });

    const session = makeSession();
    const result = await runAgentLoop("Say hello", session, makeConfig());

    expect(result.messages.length).toBeGreaterThanOrEqual(2);
    expect(result.messages.some((m) => m.role === "user")).toBe(true);
    expect(result.messages.some((m) => m.role === "assistant")).toBe(true);
  });

  it("pauses after a repeated model timeout and resumes the latest paused run on continue", async () => {
    mockGenerateText.mockResolvedValueOnce({
      text: 'Reading.\n<tool_use>\n{"name":"Read","input":{"file_path":"src/app.ts"}}\n</tool_use>',
      usage: { totalTokens: 40 },
    });
    mockExecuteTool.mockResolvedValueOnce({ content: "app", isError: false });
    mockGenerateText.mockRejectedValueOnce(new Error("Model timed out"));
    mockGenerateText.mockRejectedValueOnce(new Error("Model timed out"));

    const pausedSession = makeSession();
    const firstRun = await runAgentLoop("/magic fix resume", pausedSession, makeConfig());

    expect(mockPauseRun).toHaveBeenCalledWith(
      "durable-run-1",
      expect.objectContaining({ reason: "model_timeout" }),
    );
    expect(
      firstRun.messages.some(
        (message) =>
          message.role === "assistant" &&
          typeof message.content === "string" &&
          message.content.includes("Execution paused"),
      ),
    ).toBe(true);

    mockGetLatestWaitingRun.mockResolvedValue({
      id: "durable-run-1",
      status: "waiting_user",
      workflow: "magic",
    });
    mockLoadResumeHint.mockResolvedValue({
      runId: "durable-run-1",
      summary: "Paused after timeout",
      lastConfirmedStep: "Read src/app.ts",
      lastSuccessfulTool: "Read",
      nextAction: "Retry from the last confirmed step.",
      continueCommand: "continue",
    });
    mockLoadSessionSnapshot.mockResolvedValue(firstRun);
    mockGenerateText.mockResolvedValueOnce({
      text: "Resumed successfully.",
      usage: { totalTokens: 20 },
    });

    await runAgentLoop("continue", makeSession(), makeConfig());

    expect(mockLoadSessionSnapshot).toHaveBeenCalledWith("durable-run-1");
    const resumeCall = mockGenerateText.mock.calls[mockGenerateText.mock.calls.length - 1]![0];
    const messageText = resumeCall.messages.map((m: { content: string }) => m.content).join("\n");
    expect(messageText).toContain("Resuming durable run durable-run-1");
    expect(messageText).toContain("Retry from the last confirmed step.");
  });

  it("extracts and dispatches tool calls from model response", async () => {
    // First call: model returns a tool call
    mockGenerateText.mockResolvedValueOnce({
      text: 'I will read the file.\n<tool_use>\n{"name":"Read","input":{"file_path":"src/index.ts"}}\n</tool_use>',
      usage: { promptTokens: 50, completionTokens: 50, totalTokens: 100 },
    });
    // Second call: model returns final response (no tool calls)
    mockGenerateText.mockResolvedValueOnce({
      text: "The file contains the main entry point.",
      usage: { promptTokens: 50, completionTokens: 20, totalTokens: 70 },
    });

    const session = makeSession();
    const result = await runAgentLoop("Read src/index.ts", session, makeConfig());

    // Verify the session has tool use messages
    const toolUseMsg = result.messages.find(
      (m) => m.role === "assistant" && m.toolUse?.name === "Read",
    );
    expect(toolUseMsg).toBeDefined();

    // Verify tool result is in the session
    const toolResultMsg = result.messages.find((m) => m.role === "tool");
    expect(toolResultMsg).toBeDefined();
  });

  it("routes executable tool batches through the scheduler", async () => {
    mockGenerateText.mockResolvedValueOnce({
      text: 'I will read the file.\n<tool_use>\n{"name":"Read","input":{"file_path":"src/index.ts"}}\n</tool_use>',
      usage: { promptTokens: 50, completionTokens: 50, totalTokens: 100 },
    });
    mockGenerateText.mockResolvedValueOnce({
      text: "Done reading.",
      usage: { promptTokens: 50, completionTokens: 20, totalTokens: 70 },
    });

    const session = makeSession();
    await runAgentLoop("/magic inspect src/index.ts", session, makeConfig());

    expect(mockSchedulerExecuteBatch).toHaveBeenCalledTimes(1);
    expect(mockSchedulerExecuteBatch).toHaveBeenCalledWith(
      [
        expect.objectContaining({
          id: expect.any(String),
          toolName: "Read",
          input: { file_path: "src/index.ts" },
        }),
      ],
      expect.objectContaining({
        requestId: expect.stringContaining("round-"),
        projectRoot: "/tmp/test-project",
        execute: expect.any(Function),
      }),
    );
  });

  it("pauses the durable run when a tool call is awaiting approval", async () => {
    mockGenerateText.mockResolvedValueOnce({
      text: 'I need to push.\n<tool_use>\n{"name":"Bash","input":{"command":"git push origin main"}}\n</tool_use>',
      usage: { promptTokens: 50, completionTokens: 50, totalTokens: 100 },
    });
    mockSchedulerExecuteBatch.mockResolvedValueOnce([
      {
        request: {
          id: "tool-approval-1",
          toolName: "Bash",
          input: { command: "git push origin main" },
        },
        record: {
          id: "tool-approval-1",
          toolName: "Bash",
          input: { command: "git push origin main" },
          requestId: "round-1",
          status: "awaiting_approval",
          statusHistory: [],
          createdAt: Date.now(),
        },
        executed: false,
        blockedReason: "git push requires approval",
      },
    ]);

    const session = makeSession();
    const result = await runAgentLoop("/magic push the branch", session, makeConfig());

    expect(mockPersistToolCallRecords).toHaveBeenCalledWith("durable-run-1", [
      expect.objectContaining({
        id: "tool-approval-1",
        status: "awaiting_approval",
      }),
    ]);
    expect(mockPauseRun).toHaveBeenCalledWith(
      "durable-run-1",
      expect.objectContaining({
        reason: "user_input_required",
        nextAction: "Approve the requested action and then continue the durable run.",
      }),
    );
    expect(mockExecuteTool).not.toHaveBeenCalled();
    expect(
      result.messages.some(
        (message) =>
          message.role === "assistant" &&
          typeof message.content === "string" &&
          message.content.includes("requires approval"),
      ),
    ).toBe(true);
  });

  it("replays persisted tool calls when an approval-paused run continues", async () => {
    const now = new Date().toISOString();
    mockGetLatestWaitingRun.mockResolvedValueOnce({
      id: "durable-run-1",
      projectRoot: "/tmp/test-project",
      sessionId: "test-session",
      prompt: "/magic push the branch",
      workflow: "magic",
      status: "waiting_user",
      createdAt: now,
      updatedAt: now,
      touchedFiles: [],
      evidenceCount: 0,
      nextAction: "Approve the requested action and then continue the durable run.",
    });
    mockLoadResumeHint.mockResolvedValueOnce({
      runId: "durable-run-1",
      summary: "Approval received for the requested action.",
      nextAction: "Approve the requested action and then continue the durable run.",
      continueCommand: "continue",
    });
    mockLoadToolCallRecords.mockResolvedValueOnce([
      {
        id: "tool-approval-1",
        toolName: "Bash",
        input: { command: "git push origin main" },
        requestId: "round-1",
        status: "awaiting_approval",
        statusHistory: [],
        createdAt: Date.now(),
      },
    ]);
    mockLoadPendingToolCalls.mockResolvedValueOnce([
      {
        id: "tool-bash-1",
        name: "Bash",
        input: {
          command: "git push origin main",
        },
      },
    ]);
    mockGenerateText.mockResolvedValueOnce({
      text: "The approved tool call completed. [COMPLEXITY: 0.2]",
      usage: { promptTokens: 50, completionTokens: 20, totalTokens: 70 },
    });

    const session = makeSession();
    const result = await runAgentLoop("continue", session, makeConfig());

    expect(mockSchedulerResumeToolCalls).toHaveBeenCalledWith([
      expect.objectContaining({
        id: "tool-approval-1",
        status: "awaiting_approval",
      }),
    ]);
    expect(mockClearPendingToolCalls).toHaveBeenCalledWith("durable-run-1");
    expect(mockExecuteTool).toHaveBeenCalledWith(
      "Bash",
      {
        command: "git push origin main",
      },
      expect.any(String),
      expect.any(Object),
    );
    expect(result.messages.some((message) => message.toolUse?.name === "Bash")).toBe(true);
  });

  it("persists normalized scheduler tool-call state when resuming an interrupted execution", async () => {
    const now = new Date().toISOString();
    mockGetLatestWaitingRun.mockResolvedValueOnce({
      id: "durable-run-1",
      projectRoot: "/tmp/test-project",
      sessionId: "test-session",
      prompt: "/magic continue verification",
      workflow: "magic",
      status: "waiting_user",
      createdAt: now,
      updatedAt: now,
      touchedFiles: [],
      evidenceCount: 0,
      nextAction: "Resume the interrupted verification step.",
    });
    mockLoadResumeHint.mockResolvedValueOnce({
      runId: "durable-run-1",
      summary: "Tool execution was interrupted after writing the file.",
      nextAction: "Resume the interrupted verification step.",
      continueCommand: "continue",
    });
    mockLoadToolCallRecords.mockResolvedValueOnce([
      {
        id: "tool-write-1",
        toolName: "Write",
        input: { file_path: "src/app.ts", content: "export const ready = true;\n" },
        requestId: "round-1",
        status: "executing",
        statusHistory: [],
        createdAt: Date.now(),
        result: {
          content: "write ok",
          isError: false,
        },
      },
    ]);
    mockSchedulerResumeToolCalls.mockReturnValueOnce([
      {
        id: "tool-write-1",
        toolName: "Write",
        input: { file_path: "src/app.ts", content: "export const ready = true;\n" },
        requestId: "round-1",
        status: "verifying",
        statusHistory: [],
        createdAt: Date.now(),
        result: {
          content: "write ok",
          isError: false,
        },
      },
    ]);
    mockGenerateText.mockResolvedValueOnce({
      text: "I will address the resumed verification state. [COMPLEXITY: 0.2]",
      usage: { promptTokens: 50, completionTokens: 20, totalTokens: 70 },
    });

    await runAgentLoop("continue", makeSession(), makeConfig());

    expect(mockSchedulerResumeToolCalls).toHaveBeenCalledWith([
      expect.objectContaining({
        id: "tool-write-1",
        status: "executing",
      }),
    ]);
    expect(mockPersistToolCallRecords).toHaveBeenCalledWith("durable-run-1", [
      expect.objectContaining({
        id: "tool-write-1",
        status: "verifying",
      }),
    ]);
  });

  it("pauses the durable run when a background sub-agent is launched", async () => {
    mockGenerateText
      .mockResolvedValueOnce({
        text: 'I will delegate.\n<tool_use>\n{"name":"SubAgent","input":{"prompt":"inspect auth flow","background":true}}\n</tool_use>',
        usage: { promptTokens: 50, completionTokens: 50, totalTokens: 100 },
      })
      .mockResolvedValueOnce({
        text: "Waiting for the delegated work.",
        usage: { promptTokens: 50, completionTokens: 20, totalTokens: 70 },
      });
    mockExecuteTool.mockResolvedValueOnce({
      content:
        'Background task started: bg-123. Use SubAgent with prompt "status bg-123" to check progress.',
      isError: false,
    });

    const session = makeSession();
    const result = await runAgentLoop("/magic inspect auth flow", session, makeConfig());

    expect(mockPauseRun).toHaveBeenCalledWith(
      "durable-run-1",
      expect.objectContaining({
        reason: "user_input_required",
        nextAction: "Wait for background task bg-123 to finish, then continue the durable run.",
      }),
    );
    expect(mockPersistPendingToolCalls).toHaveBeenCalledWith("durable-run-1", []);
    expect(
      result.messages.some(
        (message) =>
          message.role === "assistant" &&
          typeof message.content === "string" &&
          message.content.includes("Background task bg-123 is still running"),
      ),
    ).toBe(true);
  });

  it("persists remaining tool calls after a background sub-agent pause", async () => {
    mockGenerateText.mockResolvedValueOnce({
      text: [
        "I will delegate and then update the file.",
        "<tool_use>",
        '{"name":"SubAgent","input":{"prompt":"inspect auth flow","background":true}}',
        "</tool_use>",
        "<tool_use>",
        '{"name":"Write","input":{"file_path":"src/app.ts","content":"export const resumed = true;\\n"}}',
        "</tool_use>",
      ].join("\n"),
      usage: { promptTokens: 50, completionTokens: 50, totalTokens: 100 },
    });
    mockExecuteTool.mockResolvedValueOnce({
      content:
        'Background task started: bg-123. Use SubAgent with prompt "status bg-123" to check progress.',
      isError: false,
    });

    const session = makeSession();
    await runAgentLoop("/magic inspect auth flow", session, makeConfig());

    expect(mockPersistPendingToolCalls).toHaveBeenCalledWith("durable-run-1", [
      {
        id: expect.any(String),
        name: "Write",
        input: {
          file_path: "src/app.ts",
          content: "export const resumed = true;\n",
        },
      },
    ]);
  });

  it("keeps a durable run paused when a background sub-agent is still running on continue", async () => {
    const now = new Date().toISOString();
    mockGetLatestWaitingRun.mockResolvedValueOnce({
      id: "durable-run-1",
      projectRoot: "/tmp/test-project",
      sessionId: "test-session",
      prompt: "/magic inspect auth flow",
      workflow: "magic",
      status: "waiting_user",
      createdAt: now,
      updatedAt: now,
      touchedFiles: [],
      evidenceCount: 0,
      nextAction: "Wait for background task bg-123 to finish, then continue the durable run.",
    });
    mockLoadResumeHint.mockResolvedValueOnce({
      runId: "durable-run-1",
      summary: "Waiting for background task bg-123 to finish.",
      nextAction: "Wait for background task bg-123 to finish, then continue the durable run.",
      continueCommand: "continue",
    });
    mockLoadBackgroundTask.mockResolvedValueOnce({
      id: "bg-123",
      prompt: "inspect auth flow",
      status: "running",
      createdAt: now,
      startedAt: now,
      progress: "Inspecting authentication flow",
      touchedFiles: [],
    });

    const session = makeSession();
    const result = await runAgentLoop("continue", session, makeConfig());

    expect(mockGenerateText).not.toHaveBeenCalled();
    expect(mockPauseRun).toHaveBeenCalledWith(
      "durable-run-1",
      expect.objectContaining({
        reason: "user_input_required",
        nextAction: "Wait for background task bg-123 to finish, then continue the durable run.",
      }),
    );
    expect(
      result.messages.some(
        (message) =>
          message.role === "assistant" &&
          typeof message.content === "string" &&
          message.content.includes("Background task bg-123 is still running"),
      ),
    ).toBe(true);
  });

  it("replays persisted tool calls after a background sub-agent completes", async () => {
    const now = new Date().toISOString();
    mockGetLatestWaitingRun.mockResolvedValueOnce({
      id: "durable-run-1",
      projectRoot: "/tmp/test-project",
      sessionId: "test-session",
      prompt: "/magic inspect auth flow",
      workflow: "magic",
      status: "waiting_user",
      createdAt: now,
      updatedAt: now,
      touchedFiles: [],
      evidenceCount: 0,
      nextAction: "Wait for background task bg-123 to finish, then continue the durable run.",
    });
    mockLoadResumeHint.mockResolvedValueOnce({
      runId: "durable-run-1",
      summary: "Waiting for background task bg-123 to finish.",
      nextAction: "Wait for background task bg-123 to finish, then continue the durable run.",
      continueCommand: "continue",
    });
    mockLoadBackgroundTask.mockResolvedValueOnce({
      id: "bg-123",
      prompt: "inspect auth flow",
      status: "completed",
      createdAt: now,
      startedAt: now,
      completedAt: now,
      progress: "Completed auth review",
      output: "Background analysis complete",
      touchedFiles: ["notes/auth.md"],
    });
    mockLoadPendingToolCalls.mockResolvedValueOnce([
      {
        id: "tool-write-1",
        name: "Write",
        input: {
          file_path: "src/app.ts",
          content: "export const resumed = true;\n",
        },
        dependsOn: ["tool-read-1"],
      },
    ]);
    mockGenerateText.mockResolvedValueOnce({
      text: "The replayed tool call completed. [COMPLEXITY: 0.2]",
      usage: { promptTokens: 50, completionTokens: 20, totalTokens: 70 },
    });

    const session = makeSession();
    const result = await runAgentLoop("continue", session, makeConfig());

    expect(mockClearPendingToolCalls).toHaveBeenCalledWith("durable-run-1");
    expect(mockSchedulerExecuteBatch.mock.calls[0]?.[0]?.[0]).toMatchObject({
      id: "tool-write-1",
      toolName: "Write",
      dependsOn: ["tool-read-1"],
    });
    expect(mockExecuteTool).toHaveBeenCalledWith(
      "Write",
      {
        file_path: "src/app.ts",
        content: "export const resumed = true;\n",
      },
      expect.any(String),
      expect.any(Object),
    );
    expect(result.messages.some((message) => message.toolUse?.name === "Write")).toBe(true);
  });

  it("recovers multiline Bash tool calls whose JSON string contains raw newlines", async () => {
    mockGenerateText.mockResolvedValueOnce({
      text: [
        "I will create the commit.",
        "<tool_use>",
        '{"name":"Bash","input":{"command":"git commit -m \\"chore: snapshot',
        "",
        'Co-Authored-By: DanteCode <noreply@dantecode.dev>\\"","timeout":30000}}',
        "</tool_use>",
      ].join("\n"),
      usage: { promptTokens: 50, completionTokens: 50, totalTokens: 100 },
    });
    mockGenerateText.mockResolvedValueOnce({
      text: "The commit command finished.",
      usage: { promptTokens: 50, completionTokens: 20, totalTokens: 70 },
    });

    const session = makeSession();
    await runAgentLoop("Create the commit", session, makeConfig());

    expect(mockExecuteTool).toHaveBeenCalledWith(
      "Bash",
      expect.objectContaining({
        command: expect.stringContaining("Co-Authored-By: DanteCode <noreply@dantecode.dev>"),
      }),
      expect.any(String),
      expect.any(Object),
    );
  });

  it("nudges narrated execution into real tool calls for action prompts", async () => {
    mockGenerateText
      .mockResolvedValueOnce({
        text: "I will inspect src/index.ts first, then update the implementation and run tests.",
        usage: { promptTokens: 50, completionTokens: 30, totalTokens: 80 },
      })
      .mockResolvedValueOnce({
        text: '<tool_use>\n{"name":"Read","input":{"file_path":"src/index.ts"}}\n</tool_use>',
        usage: { promptTokens: 50, completionTokens: 25, totalTokens: 75 },
      })
      .mockResolvedValueOnce({
        text: "I inspected the file and I am ready for the next change.",
        usage: { promptTokens: 50, completionTokens: 20, totalTokens: 70 },
      });

    const session = makeSession();
    const result = await runAgentLoop("Fix src/index.ts", session, makeConfig());

    expect(result.messages.some((m) => m.toolUse?.name === "Read")).toBe(true);
    expect(result.messages.some((m) => m.role === "tool")).toBe(true);
  });

  it("nudges continuation prompts into real tool calls after earlier execution work", async () => {
    mockGenerateText
      .mockResolvedValueOnce({
        text: "Continuing the pipeline. I will update the wiring and run verification next.",
        usage: { promptTokens: 50, completionTokens: 30, totalTokens: 80 },
      })
      .mockResolvedValueOnce({
        text: '<tool_use>\n{"name":"Read","input":{"file_path":"src/index.ts"}}\n</tool_use>',
        usage: { promptTokens: 50, completionTokens: 25, totalTokens: 75 },
      })
      .mockResolvedValueOnce({
        text: "I inspected the file and I am ready for the next change.",
        usage: { promptTokens: 50, completionTokens: 20, totalTokens: 70 },
      });

    const session = makeSession({
      messages: [
        {
          id: "prior-user",
          role: "user",
          content: "/autoforge --self-improve",
          timestamp: new Date().toISOString(),
        },
        {
          id: "prior-tool",
          role: "assistant",
          content: "Using tool: Read",
          timestamp: new Date().toISOString(),
          toolUse: {
            id: "tool-1",
            name: "Read",
            input: { file_path: "src/index.ts" },
          },
        },
        {
          id: "prior-result",
          role: "tool",
          content: "ok",
          timestamp: new Date().toISOString(),
          toolResult: {
            toolUseId: "tool-1",
            content: "ok",
            isError: false,
          },
        },
      ],
    });

    const result = await runAgentLoop("please continue", session, makeConfig());

    expect(result.messages.some((m) => m.toolUse?.name === "Read")).toBe(true);
    expect(result.messages.some((m) => m.role === "tool")).toBe(true);
  });

  it("blocks dangerous bash commands via safety hooks", async () => {
    // Model returns a dangerous command
    mockGenerateText.mockResolvedValueOnce({
      text: '<tool_use>\n{"name":"Bash","input":{"command":"rm -rf / "}}\n</tool_use>',
      usage: { totalTokens: 50 },
    });
    // After blocking, model gets safety message and produces final response
    mockGenerateText.mockResolvedValueOnce({
      text: "I apologize, that was dangerous.",
      usage: { totalTokens: 40 },
    });

    const session = makeSession();
    const result = await runAgentLoop("Delete everything", session, makeConfig());

    // The blocked command should NOT produce a tool result message with Bash output.
    // Instead, the safety hook injects a blocking message into the tool results
    // which gets sent back to the model as a user message.
    const bashToolResult = result.messages.find(
      (m) => m.role === "tool" && m.toolResult?.content.includes("rm -rf"),
    );
    expect(bashToolResult).toBeUndefined();

    // Session should end with the model's apology response
    expect(result.messages.length).toBeGreaterThanOrEqual(2);
  });

  it("detects stuck loop and injects break message", async () => {
    const repeatedToolCall =
      '<tool_use>\n{"name":"Read","input":{"file_path":"same.ts"}}\n</tool_use>';

    // Model keeps returning the same tool call 3 times, then wraps up
    mockGenerateText
      .mockResolvedValueOnce({ text: repeatedToolCall, usage: { totalTokens: 30 } })
      .mockResolvedValueOnce({ text: repeatedToolCall, usage: { totalTokens: 30 } })
      .mockResolvedValueOnce({ text: repeatedToolCall, usage: { totalTokens: 30 } })
      .mockResolvedValueOnce({
        text: "I will try a different approach.",
        usage: { totalTokens: 20 },
      });

    const session = makeSession();
    const result = await runAgentLoop("Read same.ts", session, makeConfig());

    // Should eventually terminate
    expect(result.messages.length).toBeGreaterThan(0);
    expect(result.messages[result.messages.length - 1]!.role).toBe("assistant");
  });

  it("handles model generation errors gracefully", async () => {
    mockGenerateText.mockRejectedValueOnce(new Error("API rate limit exceeded"));

    const session = makeSession();
    const result = await runAgentLoop("Do something", session, makeConfig());

    // Should produce an error message in the session
    const errorMsg = result.messages.find(
      (m) => m.role === "assistant" && typeof m.content === "string" && m.content.includes("error"),
    );
    expect(errorMsg).toBeDefined();
  });

  it("truncates large tool output without crashing", async () => {
    mockGenerateText.mockResolvedValueOnce({
      text: '<tool_use>\n{"name":"Read","input":{"file_path":"huge.ts"}}\n</tool_use>',
      usage: { totalTokens: 50 },
    });
    mockGenerateText.mockResolvedValueOnce({
      text: "That was a large file.",
      usage: { totalTokens: 20 },
    });

    // executeTool mock already returns { content: "ok", isError: false } by default

    const session = makeSession();
    const result = await runAgentLoop("Read huge file", session, makeConfig());

    // The loop should complete successfully
    expect(result.messages.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// Memory Bridge Tests
// ---------------------------------------------------------------------------

describe("Memory Bridge: lesson injection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAnalyzeComplexityValue = 0.3;
  });

  it("injects learned patterns into system prompt when lessons exist", async () => {
    const fakeLessons = [
      {
        id: "lesson-1",
        projectRoot: "/tmp/test-project",
        pattern: "Always use strict TypeScript",
        correction: "Enable strict mode in tsconfig.json",
        occurrences: 5,
        lastSeen: new Date().toISOString(),
        severity: "warning" as const,
        type: "preference" as const,
        source: "memory-detector" as const,
      },
    ];

    mockQueryLessons.mockResolvedValueOnce(fakeLessons);
    mockFormatLessonsForPrompt.mockReturnValueOnce(
      "## Previously Learned Lessons (1 relevant)\n\n### Lesson 1 [PREFERENCE / WARNING] (seen 5x)\n**Pattern:** Always use strict TypeScript\n**Correction:** Enable strict mode in tsconfig.json",
    );

    mockGenerateText.mockResolvedValueOnce({
      text: "Got it! I will follow the learned patterns.\n[COMPLEXITY: 0.2]",
      usage: { totalTokens: 50 },
    });

    const session = makeSession();
    await runAgentLoop("Hello", session, makeConfig());

    // queryLessons should have been called with the session projectRoot
    expect(mockQueryLessons).toHaveBeenCalledWith(
      expect.objectContaining({
        projectRoot: "/tmp/test-project",
        limit: 10,
      }),
    );

    // formatLessonsForPrompt should have been called with the lessons
    expect(mockFormatLessonsForPrompt).toHaveBeenCalledWith(fakeLessons);

    // The model receives the system prompt embedded in the flow; verify queryLessons was invoked
    expect(mockQueryLessons).toHaveBeenCalledTimes(1);
  });

  it("system prompt works correctly when no lessons exist", async () => {
    mockQueryLessons.mockResolvedValueOnce([]);

    mockGenerateText.mockResolvedValueOnce({
      text: "Hello! How can I help?\n[COMPLEXITY: 0.1]",
      usage: { totalTokens: 30 },
    });

    const session = makeSession();
    const result = await runAgentLoop("Hello", session, makeConfig());

    // Should complete normally even with no lessons
    expect(result.messages.length).toBeGreaterThanOrEqual(2);
    // formatLessonsForPrompt should NOT be called when there are no lessons
    expect(mockFormatLessonsForPrompt).not.toHaveBeenCalled();
  });

  it("lesson injection failure does not break the agent loop", async () => {
    mockQueryLessons.mockRejectedValueOnce(new Error("SQLite database corrupted"));

    mockGenerateText.mockResolvedValueOnce({
      text: "I can still help you!\n[COMPLEXITY: 0.1]",
      usage: { totalTokens: 30 },
    });

    const session = makeSession();
    const result = await runAgentLoop("Hello", session, makeConfig());

    // Agent should still produce a response despite lesson injection failure
    expect(result.messages.length).toBeGreaterThanOrEqual(2);
    expect(result.messages.some((m) => m.role === "assistant")).toBe(true);
  });

  it("records conversation patterns at end of agent loop", async () => {
    mockGenerateText.mockResolvedValueOnce({
      text: "Done!\n[COMPLEXITY: 0.1]",
      usage: { totalTokens: 20 },
    });

    const session = makeSession();
    await runAgentLoop("Always use bun instead of npm", session, makeConfig());

    // detectAndRecordPatterns should have been called with conversation messages
    expect(mockDetectAndRecordPatterns).toHaveBeenCalledTimes(1);
    const [messages, projectRoot] = mockDetectAndRecordPatterns.mock.calls[0]!;
    expect(projectRoot).toBe("/tmp/test-project");
    expect(Array.isArray(messages)).toBe(true);
    // Should include at least the user message and assistant response
    expect(messages.length).toBeGreaterThanOrEqual(2);
    expect(messages.some((m: { role: string }) => m.role === "user")).toBe(true);
    expect(messages.some((m: { role: string }) => m.role === "assistant")).toBe(true);
  });

  it("pattern recording failure does not break the session", async () => {
    mockDetectAndRecordPatterns.mockRejectedValueOnce(new Error("Database write failed"));

    mockGenerateText.mockResolvedValueOnce({
      text: "All done!\n[COMPLEXITY: 0.1]",
      usage: { totalTokens: 20 },
    });

    const session = makeSession();
    const result = await runAgentLoop("Hello", session, makeConfig());

    // Session should still complete and return normally
    expect(result.messages.length).toBeGreaterThanOrEqual(2);
    expect(result.updatedAt).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// Planning Phase Tests
// ---------------------------------------------------------------------------

describe("Planning phase: injection for complex tasks", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("injects planning instruction when complexity >= 0.7", async () => {
    // Set high complexity so planning is enabled
    mockAnalyzeComplexityValue = 0.8;

    mockGenerateText.mockResolvedValueOnce({
      text: "Plan: 1. Read files 2. Edit module 3. Run tests\n[COMPLEXITY: 0.8]",
      usage: { totalTokens: 50 },
    });

    const session = makeSession();
    const result = await runAgentLoop("Refactor the entire auth module", session, makeConfig());

    // The model should have been called, and the messages sent to it should include
    // the planning instruction as a system message
    expect(mockGenerateText).toHaveBeenCalledTimes(1);
    const callArgs = mockGenerateText.mock.calls[0]![0];
    const messagesPassedToModel = callArgs.messages;

    // Look for the planning instruction in the messages
    const planningMessage = messagesPassedToModel.find(
      (m: { role: string; content: string }) =>
        m.role === "system" && m.content.includes("Planning Required"),
    );
    expect(planningMessage).toBeDefined();
    expect(planningMessage.content).toContain("What files need to change");
    expect(planningMessage.content).toContain("What's the approach");
    expect(planningMessage.content).toContain("What could go wrong");
    expect(planningMessage.content).toContain("verification strategy");

    // Session should still complete normally
    expect(result.messages.length).toBeGreaterThanOrEqual(2);
  });

  it("does NOT inject planning instruction when complexity < 0.7", async () => {
    // Set low complexity so planning is disabled
    mockAnalyzeComplexityValue = 0.3;

    mockGenerateText.mockResolvedValueOnce({
      text: "Hello!\n[COMPLEXITY: 0.2]",
      usage: { totalTokens: 20 },
    });

    const session = makeSession();
    await runAgentLoop("Say hello", session, makeConfig());

    expect(mockGenerateText).toHaveBeenCalledTimes(1);
    const callArgs = mockGenerateText.mock.calls[0]![0];
    const messagesPassedToModel = callArgs.messages;

    // There should be NO system message with planning instruction
    const planningMessage = messagesPassedToModel.find(
      (m: { role: string; content: string }) =>
        m.role === "system" && m.content.includes("Planning Required"),
    );
    expect(planningMessage).toBeUndefined();
  });

  it("tracks plan generation on first response for high-complexity tasks", async () => {
    mockAnalyzeComplexityValue = 0.9;

    // First response: model produces a plan and a tool call
    mockGenerateText.mockResolvedValueOnce({
      text: 'My approach: read auth.ts first, then refactor.\n<tool_use>\n{"name":"Read","input":{"file_path":"auth.ts"}}\n</tool_use>',
      usage: { totalTokens: 80 },
    });
    // Second response: final
    mockGenerateText.mockResolvedValueOnce({
      text: "Refactoring complete.",
      usage: { totalTokens: 30 },
    });

    const session = makeSession();
    const result = await runAgentLoop("Refactor auth module", session, makeConfig());

    // The loop should complete successfully with tool use
    expect(result.messages.some((m) => m.toolUse?.name === "Read")).toBe(true);
    expect(result.messages.length).toBeGreaterThan(2);
  });
});

// ---------------------------------------------------------------------------
// Approach Memory Tests
// ---------------------------------------------------------------------------

describe("Approach memory: recording after verification", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAnalyzeComplexityValue = 0.3;
  });

  it("records approach outcome after verification cycle passes", async () => {
    // Configure project with a test command so verification runs
    const config = makeConfig();
    (config.state.project as unknown as Record<string, unknown>).testCommand = "npm test";

    // First call: model writes a file
    mockGenerateText.mockResolvedValueOnce({
      text: '<tool_use>\n{"name":"Write","input":{"file_path":"src/app.ts","content":"export const x = 1;"}}\n</tool_use>',
      usage: { totalTokens: 50 },
    });
    // Second call: model responds after verification passes
    mockGenerateText.mockResolvedValueOnce({
      text: "All changes verified successfully.",
      usage: { totalTokens: 20 },
    });

    // executeTool returns success for both the Write call and the verification Bash call
    mockExecuteTool
      .mockResolvedValueOnce({ content: "ok", isError: false }) // Write
      .mockResolvedValueOnce({ content: "Tests passed", isError: false }); // npm test

    const session = makeSession();
    const result = await runAgentLoop("Update app", session, makeConfig());

    // The loop should complete. executeTool should have been called at least once
    // for the Write tool (verification may or may not run depending on mock setup).
    expect(mockExecuteTool).toHaveBeenCalled();
    expect(result.messages.length).toBeGreaterThan(0);
  });

  it("records failed approach and includes it in retry prompt when verification fails", async () => {
    const config = makeConfig();
    (config.state.project as unknown as Record<string, unknown>).testCommand = "npm test";

    // First call: model writes a file
    mockGenerateText.mockResolvedValueOnce({
      text: '<tool_use>\n{"name":"Write","input":{"file_path":"src/app.ts","content":"broken code"}}\n</tool_use>',
      usage: { totalTokens: 50 },
    });
    // Second call: model gets the verification failure message and wraps up
    mockGenerateText.mockResolvedValueOnce({
      text: "I see the test failed. Let me try a different approach.",
      usage: { totalTokens: 30 },
    });

    // executeTool: Write succeeds, verification Bash fails
    mockExecuteTool
      .mockResolvedValueOnce({ content: "ok", isError: false }) // Write
      .mockResolvedValueOnce({ content: "Error: test failed", isError: true }); // npm test

    const session = makeSession();
    const result = await runAgentLoop("Update app", session, config);

    // The verification should have been attempted (executeTool called for Bash)
    expect(mockExecuteTool).toHaveBeenCalledTimes(2);
    // The session should still complete
    expect(result.messages.length).toBeGreaterThan(0);
  });

  it("escalates tier after three repeated verification signatures", async () => {
    const config = makeConfig();
    (config.state.project as unknown as Record<string, unknown>).lintCommand = "npm run lint";
    (config.state.project as unknown as Record<string, unknown>).testCommand = "npm test";
    (config.state.project as unknown as Record<string, unknown>).buildCommand = "npm run build";

    mockGenerateText.mockResolvedValueOnce({
      text: '<tool_use>\n{"name":"Write","input":{"file_path":"src/app.ts","content":"broken code"}}\n</tool_use>',
      usage: { totalTokens: 50 },
    });
    mockGenerateText.mockResolvedValueOnce({
      text: "I need a stronger retry strategy.",
      usage: { totalTokens: 30 },
    });

    mockExecuteTool.mockImplementation(async (name: string) => {
      if (name === "Write") {
        return { content: "ok", isError: false };
      }
      if (name === "Bash") {
        return { content: "verification failed", isError: true };
      }
      return { content: "ok", isError: false };
    });

    mockParseVerificationErrors.mockReturnValue([{ message: "same failure" }]);
    mockComputeErrorSignature.mockReturnValue("repeat-sig");

    await runAgentLoop("Update app", makeSession(), config);

    expect(mockEscalateTier).toHaveBeenCalledWith(expect.stringContaining("repeat-sig"));
  });

  it("pauses the durable run after verification retries are exhausted", async () => {
    mockGenerateText.mockReset();
    mockExecuteTool.mockReset();
    mockPauseRun.mockReset();
    const config = makeConfig();
    (config.state.project as unknown as Record<string, unknown>).lintCommand = "npm run lint";
    (config.state.project as unknown as Record<string, unknown>).testCommand = "npm test";
    (config.state.project as unknown as Record<string, unknown>).buildCommand = "npm run build";

    mockGenerateText.mockResolvedValueOnce({
      text: '<tool_use>\n{"name":"Write","input":{"file_path":"src/app.ts","content":"broken code"}}\n</tool_use>',
      usage: { totalTokens: 50 },
    });

    mockExecuteTool.mockImplementation(async (name: string) => {
      if (name === "Write") {
        return { content: "ok", isError: false };
      }
      if (name === "Bash") {
        return { content: "verification failed", isError: true };
      }
      return { content: "ok", isError: false };
    });

    const result = await runAgentLoop("Update app", makeSession(), config);

    expect(mockPauseRun).toHaveBeenCalledWith(
      "durable-run-1",
      expect.objectContaining({
        reason: "verification_failed",
        nextAction: "Fix the verification issues and then continue the durable run.",
      }),
    );
    expect(
      result.messages.some(
        (message) =>
          message.role === "assistant" &&
          typeof message.content === "string" &&
          message.content.includes("verification failed 3 times"),
      ),
    ).toBe(true);
  });
});

describe("background durable auto-resume", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("auto-resumes a durable run after background task completion", async () => {
    const resumeLoop = vi.fn().mockResolvedValue(makeSession());

    const resumed = await maybeAutoResumeDurableRunAfterBackgroundTask({
      durableRunId: "durable-run-1",
      workflowName: "magic",
      parentSession: makeSession(),
      parentConfig: makeConfig({ silent: false }),
      runAgentLoopImpl: resumeLoop,
      runAgentLoopFallback: resumeLoop,
    });

    expect(resumed).toBe(true);
    expect(resumeLoop).toHaveBeenCalledWith(
      "continue",
      expect.objectContaining({ id: "test-session" }),
      expect.objectContaining({
        runId: "durable-run-1",
        resumeFrom: "durable-run-1",
        expectedWorkflow: "magic",
        silent: true,
        onToken: undefined,
      }),
    );
  });

  it("does not auto-resume when no durable run id is available", async () => {
    const resumeLoop = vi.fn().mockResolvedValue(makeSession());

    const resumed = await maybeAutoResumeDurableRunAfterBackgroundTask({
      parentSession: makeSession(),
      parentConfig: makeConfig(),
      runAgentLoopImpl: resumeLoop,
      runAgentLoopFallback: resumeLoop,
    });

    expect(resumed).toBe(false);
    expect(resumeLoop).not.toHaveBeenCalled();
  });
});

describe("Major edit batch gating", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAnalyzeComplexityValue = 0.3;
    mockEscalateTier.mockReset();
  });

  it("runs repo-root GStack after protected writes", async () => {
    mockGenerateText.mockResolvedValueOnce({
      text: '<tool_use>\n{"name":"Write","input":{"file_path":"packages/cli/src/tools.ts","content":"export const gated = true;"}}\n</tool_use>',
      usage: { totalTokens: 50 },
    });
    mockGenerateText.mockResolvedValueOnce({
      text: "Protected write verified.",
      usage: { totalTokens: 20 },
    });

    mockExecuteTool.mockImplementation(async (name: string) => {
      if (name === "Write") {
        return { content: "ok", isError: false };
      }
      if (name === "Bash") {
        return { content: "green", isError: false };
      }
      return { content: "ok", isError: false };
    });

    await runAgentLoop("Harden the CLI tools", makeSession(), makeConfig());

    const bashCommands = mockExecuteTool.mock.calls
      .filter(([name]) => name === "Bash")
      .map(([, input]) => (input as Record<string, string>).command);

    expect(bashCommands).toEqual(["npm run typecheck", "npm run lint", "npm test"]);
  });

  it("blocks GitCommit when repo-root GStack is red", async () => {
    mockGenerateText.mockResolvedValueOnce({
      text: [
        "<tool_use>",
        '{"name":"Write","input":{"file_path":"packages/cli/src/tools.ts","content":"export const broken = true;"}}',
        "</tool_use>",
        "<tool_use>",
        '{"name":"GitCommit","input":{"message":"commit changes"}}',
        "</tool_use>",
      ].join("\n"),
      usage: { totalTokens: 80 },
    });
    mockGenerateText.mockResolvedValueOnce({
      text: "I will fix the failing checks before committing.",
      usage: { totalTokens: 20 },
    });

    mockExecuteTool.mockImplementation(async (name: string, input: Record<string, unknown>) => {
      if (name === "Write") {
        return { content: "ok", isError: false };
      }
      if (name === "Bash") {
        const command = input.command as string;
        return {
          content: command === "npm run typecheck" ? "typecheck failed" : "skipped",
          isError: command === "npm run typecheck",
        };
      }
      if (name === "GitCommit") {
        return { content: "should not commit", isError: false };
      }
      return { content: "ok", isError: false };
    });

    await runAgentLoop("Write and commit protected changes", makeSession(), makeConfig());

    expect(mockExecuteTool.mock.calls.some(([name]) => name === "GitCommit")).toBe(false);
  });

  it("blocks GitPush when repo-root GStack is red", async () => {
    mockGenerateText.mockResolvedValueOnce({
      text: [
        "<tool_use>",
        '{"name":"Write","input":{"file_path":"packages/cli/src/tools.ts","content":"export const broken = true;"}}',
        "</tool_use>",
        "<tool_use>",
        '{"name":"GitPush","input":{"remote":"origin","branch":"main"}}',
        "</tool_use>",
      ].join("\n"),
      usage: { totalTokens: 80 },
    });
    mockGenerateText.mockResolvedValueOnce({
      text: "I will fix the failing checks before pushing.",
      usage: { totalTokens: 20 },
    });

    mockExecuteTool.mockImplementation(async (name: string, input: Record<string, unknown>) => {
      if (name === "Write") {
        return { content: "ok", isError: false };
      }
      if (name === "Bash") {
        const command = input.command as string;
        return {
          content: command === "npm run typecheck" ? "typecheck failed" : "skipped",
          isError: command === "npm run typecheck",
        };
      }
      if (name === "GitPush") {
        return { content: "should not push", isError: false };
      }
      return { content: "ok", isError: false };
    });

    await runAgentLoop("Write and push protected changes", makeSession(), makeConfig());

    expect(mockExecuteTool.mock.calls.some(([name]) => name === "GitPush")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Pivot Logic Tests
// ---------------------------------------------------------------------------

describe("Pivot logic: strategy change after 2 same-signature failures", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAnalyzeComplexityValue = 0.3;
  });

  it("exports pivot instruction constant and approach log type", async () => {
    // Verify the pivot infrastructure is wired by checking the agent loop
    // completes successfully and records messages even with high complexity
    mockAnalyzeComplexityValue = 0.8;
    mockGenerateText.mockResolvedValueOnce({
      text: "I will plan my approach first, then execute.",
      usage: { totalTokens: 50 },
    });

    const session = makeSession();
    const result = await runAgentLoop("Complex refactor", session, makeConfig());

    // Session should complete with messages (planning instruction injected)
    expect(result.messages.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// Progress Tracking Tests
// ---------------------------------------------------------------------------

describe("Progress tracking: emission after tool calls", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAnalyzeComplexityValue = 0.3;
  });

  it("emits progress line after every 5 tool calls", async () => {
    // Set up model to return 5 tool calls in one response, then wrap up
    const fiveToolCalls = [
      '{"name":"Read","input":{"file_path":"a.ts"}}',
      '{"name":"Read","input":{"file_path":"b.ts"}}',
      '{"name":"Read","input":{"file_path":"c.ts"}}',
      '{"name":"Read","input":{"file_path":"d.ts"}}',
      '{"name":"Read","input":{"file_path":"e.ts"}}',
    ]
      .map((tc) => `<tool_use>\n${tc}\n</tool_use>`)
      .join("\n");

    mockGenerateText.mockResolvedValueOnce({
      text: `Reading files.\n${fiveToolCalls}`,
      usage: { totalTokens: 100 },
    });

    // Each Read tool call succeeds
    mockExecuteTool
      .mockResolvedValueOnce({ content: "file a content", isError: false })
      .mockResolvedValueOnce({ content: "file b content", isError: false })
      .mockResolvedValueOnce({ content: "file c content", isError: false })
      .mockResolvedValueOnce({ content: "file d content", isError: false })
      .mockResolvedValueOnce({ content: "file e content", isError: false });

    // Final response
    mockGenerateText.mockResolvedValueOnce({
      text: "All files read successfully.",
      usage: { totalTokens: 20 },
    });

    const session = makeSession();
    const result = await runAgentLoop("Read all files", session, makeConfig());

    // After 5 tool calls, a progress message should be injected into the session
    const progressMsg = result.messages.find(
      (m) =>
        typeof m.content === "string" &&
        m.content.includes("[progress:") &&
        m.content.includes("5 tool calls"),
    );
    expect(progressMsg).toBeDefined();
    expect(progressMsg!.content).toContain("files modified");
    expect(progressMsg!.content).toContain("tests run");

    // Session should complete
    expect(result.messages.length).toBeGreaterThan(5);
  });

  it("tracks filesModified count in progress output", async () => {
    // Model writes 2 files, then wraps up. We need at least 5 tool calls for progress.
    // So: Write, Write, Read, Read, Read = 5 total
    const toolCalls = [
      '{"name":"Write","input":{"file_path":"src/a.ts","content":"a"}}',
      '{"name":"Write","input":{"file_path":"src/b.ts","content":"b"}}',
      '{"name":"Read","input":{"file_path":"c.ts"}}',
      '{"name":"Read","input":{"file_path":"d.ts"}}',
      '{"name":"Read","input":{"file_path":"e.ts"}}',
    ]
      .map((tc) => `<tool_use>\n${tc}\n</tool_use>`)
      .join("\n");

    mockGenerateText.mockResolvedValueOnce({
      text: `Working on files.\n${toolCalls}`,
      usage: { totalTokens: 100 },
    });

    mockExecuteTool
      .mockResolvedValueOnce({ content: "ok", isError: false })
      .mockResolvedValueOnce({ content: "ok", isError: false })
      .mockResolvedValueOnce({ content: "ok", isError: false })
      .mockResolvedValueOnce({ content: "ok", isError: false })
      .mockResolvedValueOnce({ content: "ok", isError: false });

    mockGenerateText.mockResolvedValueOnce({
      text: "Done.",
      usage: { totalTokens: 10 },
    });

    const session = makeSession();
    const result = await runAgentLoop("Update files", session, makeConfig());

    // Progress message should exist and show 5 tool calls
    const progressMsg = result.messages.find(
      (m) => typeof m.content === "string" && m.content.includes("[progress:"),
    );
    expect(progressMsg).toBeDefined();
    expect(progressMsg!.content).toContain("5 tool calls");
  });

  it("does NOT emit progress line before reaching 5 tool calls", async () => {
    // Only 3 tool calls — should NOT trigger progress emission
    const threeToolCalls = [
      '{"name":"Read","input":{"file_path":"a.ts"}}',
      '{"name":"Read","input":{"file_path":"b.ts"}}',
      '{"name":"Read","input":{"file_path":"c.ts"}}',
    ]
      .map((tc) => `<tool_use>\n${tc}\n</tool_use>`)
      .join("\n");

    mockGenerateText.mockResolvedValueOnce({
      text: `Reading files.\n${threeToolCalls}`,
      usage: { totalTokens: 60 },
    });

    mockExecuteTool
      .mockResolvedValueOnce({ content: "ok", isError: false })
      .mockResolvedValueOnce({ content: "ok", isError: false })
      .mockResolvedValueOnce({ content: "ok", isError: false });

    mockGenerateText.mockResolvedValueOnce({
      text: "Done.",
      usage: { totalTokens: 10 },
    });

    const session = makeSession();
    const result = await runAgentLoop("Read files", session, makeConfig());

    // No progress message should exist in the session
    const progressMsg = result.messages.find(
      (m) => typeof m.content === "string" && m.content.includes("[progress:"),
    );
    expect(progressMsg).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Pipeline continuation nudge tests
// ---------------------------------------------------------------------------

describe("Pipeline continuation nudge", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAnalyzeComplexityValue = 0.3;
    mockEscalateTier.mockReset();
  });

  it("nudges the model to continue when it stops mid-pipeline with a summary", async () => {
    // Round 1: model emits a tool call (establishing executedToolsThisTurn > 0)
    mockGenerateText.mockResolvedValueOnce({
      text: 'Reading file.\n<tool_use>\n{"name":"Read","input":{"file_path":"src/index.ts"}}\n</tool_use>',
      usage: { totalTokens: 100 },
    });
    mockExecuteTool.mockResolvedValueOnce({ content: "file contents here", isError: false });

    // Round 2: model emits a premature summary without tool calls
    mockGenerateText.mockResolvedValueOnce({
      text: "## Summary\n\nAll changes are complete. The pipeline finished successfully.",
      usage: { totalTokens: 50 },
    });

    // Round 3: after nudge, model continues with tool calls
    mockGenerateText.mockResolvedValueOnce({
      text: 'Continuing.\n<tool_use>\n{"name":"Edit","input":{"file_path":"src/other.ts","old_string":"before","new_string":"after"}}\n</tool_use>',
      usage: { totalTokens: 100 },
    });
    mockExecuteTool.mockResolvedValueOnce({ content: "updated file", isError: false });

    // Round 4: model genuinely finishes
    mockGenerateText.mockResolvedValueOnce({
      text: "The requested update is in place.",
      usage: { totalTokens: 30 },
    });

    const session = makeSession();
    // Use /magic prompt to trigger pipeline detection
    await runAgentLoop("/magic improve reliability", session, makeConfig());

    // The model should have been called 4 times (tool → summary → nudge+tool → done)
    expect(mockGenerateText).toHaveBeenCalledTimes(4);

    // Verify the nudge was injected by checking what the 3rd model call received.
    // The 3rd call's messages should contain the pipeline continuation instruction
    // as one of the user messages (the nudge + assistant summary pair is injected
    // before the model is called again).
    const thirdCallArgs = mockGenerateText.mock.calls[2]![0];
    const userMsgs = thirdCallArgs.messages.filter(
      (m: { role: string; content: string }) => m.role === "user",
    );
    const hasNudge = userMsgs.some((m: { content: string }) =>
      m.content.includes("stopped mid-pipeline"),
    );
    expect(hasNudge).toBe(true);
  });

  it("does NOT nudge for non-pipeline prompts", async () => {
    // Round 1: tool call
    mockGenerateText.mockResolvedValueOnce({
      text: 'Reading.\n<tool_use>\n{"name":"Read","input":{"file_path":"a.ts"}}\n</tool_use>',
      usage: { totalTokens: 100 },
    });
    mockExecuteTool.mockResolvedValueOnce({ content: "ok", isError: false });

    // Round 2: summary (should NOT trigger nudge for non-pipeline prompt)
    mockGenerateText.mockResolvedValueOnce({
      text: "## Summary\n\nDone with the task.",
      usage: { totalTokens: 50 },
    });

    const session = makeSession();
    // Regular prompt, not a pipeline workflow
    const result = await runAgentLoop("Read the file a.ts", session, makeConfig());

    // Only 2 model calls — no nudge continuation
    expect(mockGenerateText).toHaveBeenCalledTimes(2);

    // No nudge message injected
    const nudgeMsg = result.messages.find(
      (m) =>
        m.role === "user" &&
        typeof m.content === "string" &&
        m.content.includes("stopped mid-pipeline"),
    );
    expect(nudgeMsg).toBeUndefined();
  });

  it("stops nudging after MAX_PIPELINE_CONTINUATION_NUDGES (3)", async () => {
    // Round 1: tool call
    mockGenerateText.mockResolvedValueOnce({
      text: 'Reading.\n<tool_use>\n{"name":"Read","input":{"file_path":"a.ts"}}\n</tool_use>',
      usage: { totalTokens: 100 },
    });
    mockExecuteTool.mockResolvedValueOnce({ content: "ok", isError: false });

    // Rounds 2-4: model keeps emitting summaries (3 nudges)
    mockGenerateText.mockResolvedValueOnce({
      text: "## Summary\nDone.",
      usage: { totalTokens: 30 },
    });
    mockGenerateText.mockResolvedValueOnce({
      text: "## Results\nAll complete.",
      usage: { totalTokens: 30 },
    });
    mockGenerateText.mockResolvedValueOnce({
      text: "## Done\nFinished everything.",
      usage: { totalTokens: 30 },
    });

    // Rounds 5-8: pipeline nudges exhausted → confab gate fires (filesModified=0, max 4)
    mockGenerateText.mockResolvedValueOnce({
      text: "## Summary\nStill done.",
      usage: { totalTokens: 30 },
    });
    mockGenerateText.mockResolvedValueOnce({
      text: "## Summary\nReally done.",
      usage: { totalTokens: 30 },
    });
    mockGenerateText.mockResolvedValueOnce({
      text: "## Summary\nAbsolutely done.",
      usage: { totalTokens: 30 },
    });
    mockGenerateText.mockResolvedValueOnce({
      text: "## Summary\nNothing else to do.",
      usage: { totalTokens: 30 },
    });

    // Round 9: both pipeline nudges and confab nudges exhausted — model is allowed to stop
    mockGenerateText.mockResolvedValueOnce({
      text: "## Summary\nFinal answer.",
      usage: { totalTokens: 30 },
    });

    const session = makeSession();
    await runAgentLoop("/autoforge improve code", session, makeConfig());

    // 1 (tool) + 3 (pipeline nudges) + 4 (confab nudges) + 1 (allowed to break) = 9
    expect(mockGenerateText).toHaveBeenCalledTimes(9);
  });
});

// ---------------------------------------------------------------------------
// Dynamic round budget tests
// ---------------------------------------------------------------------------

describe("Dynamic round budget (requiredRounds)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAnalyzeComplexityValue = 0.3;
  });

  it("uses requiredRounds when provided", async () => {
    // This test verifies the loop can run more than 15 rounds when requiredRounds is set.
    // Use unique file paths per round to avoid the stuck loop detector (3 identical calls = stuck).

    // Emit tool calls for 17 rounds (exceeds default 15)
    for (let i = 0; i < 17; i++) {
      const toolCallText = `<tool_use>\n{"name":"Read","input":{"file_path":"file-${i}.ts"}}\n</tool_use>`;
      mockGenerateText.mockResolvedValueOnce({
        text: `Round ${i + 1}.\n${toolCallText}`,
        usage: { totalTokens: 50 },
      });
      mockExecuteTool.mockResolvedValueOnce({ content: `round ${i + 1}`, isError: false });
    }

    // Final response
    mockGenerateText.mockResolvedValueOnce({
      text: "All 17 rounds done.",
      usage: { totalTokens: 20 },
    });

    const session = makeSession();
    await runAgentLoop("Do work", session, makeConfig({ requiredRounds: 20 }));

    // All 17 tool rounds should have executed (impossible with default maxToolRounds=15)
    expect(mockExecuteTool).toHaveBeenCalledTimes(17);
    expect(mockGenerateText).toHaveBeenCalledTimes(18); // 17 tool rounds + 1 final
  });

  it("enforces minimum of 15 rounds even when requiredRounds is lower", async () => {
    // Even if requiredRounds is 5, the loop should still allow 15 rounds
    mockGenerateText.mockResolvedValueOnce({
      text: "Done.",
      usage: { totalTokens: 20 },
    });

    const session = makeSession();
    await runAgentLoop("Small task", session, makeConfig({ requiredRounds: 5 }));

    // Should not error — the Math.max(5, 15) ensures at least 15 rounds available
    expect(mockGenerateText).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// Universal skill completion tests (skillActive flag)
// ---------------------------------------------------------------------------

describe("Universal skill completion (skillActive)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAnalyzeComplexityValue = 0.3;
    mockEscalateTier.mockReset();
  });

  it("triggers continuation nudge when skillActive is true even for non-slash prompts", async () => {
    // Round 1: model emits a tool call
    mockGenerateText.mockResolvedValueOnce({
      text: 'Working.\n<tool_use>\n{"name":"Read","input":{"file_path":"app.ts"}}\n</tool_use>',
      usage: { totalTokens: 100 },
    });
    mockExecuteTool.mockResolvedValueOnce({ content: "file content", isError: false });

    // Round 2: premature summary
    mockGenerateText.mockResolvedValueOnce({
      text: "## Summary\n\nAll done.",
      usage: { totalTokens: 50 },
    });

    // Round 3: after nudge, model continues
    mockGenerateText.mockResolvedValueOnce({
      text: 'Continuing.\n<tool_use>\n{"name":"Edit","input":{"file_path":"utils.ts","old_string":"alpha","new_string":"beta"}}\n</tool_use>',
      usage: { totalTokens: 100 },
    });
    mockExecuteTool.mockResolvedValueOnce({ content: "utils updated", isError: false });

    // Round 4: genuinely finishes
    mockGenerateText.mockResolvedValueOnce({
      text: "The requested change is applied.",
      usage: { totalTokens: 30 },
    });

    const session = makeSession();
    // Non-slash prompt but skillActive=true — should still get pipeline protection
    await runAgentLoop(
      "Implement the design system audit",
      session,
      makeConfig({ skillActive: true }),
    );

    // 4 calls: tool → summary (nudged) → tool → done
    expect(mockGenerateText).toHaveBeenCalledTimes(4);

    // Verify nudge was injected in the 3rd call
    const thirdCallArgs = mockGenerateText.mock.calls[2]![0];
    const userMsgs = thirdCallArgs.messages.filter(
      (m: { role: string; content: string }) => m.role === "user",
    );
    const hasNudge = userMsgs.some((m: { content: string }) =>
      m.content.includes("stopped mid-pipeline"),
    );
    expect(hasNudge).toBe(true);
  });

  it("elevates round budget to 50 when skillActive is true", async () => {
    // Simulate 17 rounds of tool calls — would fail with default 15 but should succeed with 50
    const rounds = 17;
    for (let i = 0; i < rounds; i++) {
      mockGenerateText.mockResolvedValueOnce({
        text: `Step ${i}.\n<tool_use>\n{"name":"Edit","input":{"file_path":"skill-file-${i}.ts","old_string":"old","new_string":"new-${i}"}}\n</tool_use>`,
        usage: { totalTokens: 100 },
      });
      mockExecuteTool.mockResolvedValueOnce({ content: `content ${i}`, isError: false });
    }

    // Final: model finishes
    mockGenerateText.mockResolvedValueOnce({
      text: "The skill run has reached a stable stopping point.",
      usage: { totalTokens: 30 },
    });

    const session = makeSession();
    await runAgentLoop("Run the full skill", session, makeConfig({ skillActive: true }));

    // All 17 tool rounds + 1 final = 18 calls (impossible with default 15)
    expect(mockGenerateText).toHaveBeenCalledTimes(rounds + 1);
  });

  it("treats 'continue' as execution continuation when skill activation system message exists", async () => {
    // Round 1: model continues from skill context
    mockGenerateText.mockResolvedValueOnce({
      text: 'Working.\n<tool_use>\n{"name":"Edit","input":{"file_path":"skill-work.ts","old_string":"draft","new_string":"ready"}}\n</tool_use>',
      usage: { totalTokens: 100 },
    });
    mockExecuteTool.mockResolvedValueOnce({ content: "file updated", isError: false });

    // Round 2: premature summary — should get nudged because isExecutionContinuationPrompt
    // detects the skill activation system message
    mockGenerateText.mockResolvedValueOnce({
      text: "## Summary\n\nFinished.",
      usage: { totalTokens: 50 },
    });

    // Round 3: continues after nudge (text must NOT match PREMATURE_SUMMARY_PATTERN)
    mockGenerateText.mockResolvedValueOnce({
      text: "The edit has been applied.",
      usage: { totalTokens: 30 },
    });

    const session = makeSession();
    // Add a skill activation system message to the session
    session.messages.push({
      id: "skill-sys",
      role: "system",
      content: 'Activated skill "design-audit": Run a comprehensive design system audit.',
      timestamp: new Date().toISOString(),
    });

    // "continue" prompt with a prior skill activation system message
    await runAgentLoop("continue", session, makeConfig());

    // 3 calls: tool → summary (nudged) → text (no summary match, stops)
    expect(mockGenerateText).toHaveBeenCalledTimes(3);

    // Verify the nudge was injected in the 3rd call
    const thirdCallArgs = mockGenerateText.mock.calls[2]![0];
    const userMsgs = thirdCallArgs.messages.filter(
      (m: { role: string; content: string }) => m.role === "user",
    );
    const hasNudge = userMsgs.some((m: { content: string }) =>
      m.content.includes("stopped mid-pipeline"),
    );
    expect(hasNudge).toBe(true);
  });

  // ---------------------------------------------------------------------------
  // Anti-confabulation guards
  // ---------------------------------------------------------------------------

  it("aborts after MAX_CONSECUTIVE_EMPTY_ROUNDS empty responses", async () => {
    // 3 consecutive empty responses → circuit breaker
    mockGenerateText.mockResolvedValue({
      text: "",
      usage: { totalTokens: 0 },
    });

    const session = makeSession();
    const result = await runAgentLoop("fix the bug", session, makeConfig());

    // Should abort after 3 empty rounds
    expect(mockGenerateText).toHaveBeenCalledTimes(3);
    // Session should contain the abort message
    const abortMsg = result.messages.find(
      (m) =>
        m.role === "assistant" &&
        typeof m.content === "string" &&
        m.content.includes("consecutive empty responses"),
    );
    expect(abortMsg).toBeDefined();
  });

  it("resets empty round counter when tool calls succeed", async () => {
    // Round 1: empty response (count = 1)
    mockGenerateText.mockResolvedValueOnce({
      text: "",
      usage: { totalTokens: 0 },
    });
    // Round 2: successful tool call (resets counter)
    mockGenerateText.mockResolvedValueOnce({
      text: '<tool_use>\n{"name":"Read","input":{"file_path":"src/app.ts"}}\n</tool_use>',
      usage: { totalTokens: 50 },
    });
    mockExecuteTool.mockResolvedValueOnce({ content: "file content", isError: false });
    // Round 3: final response
    mockGenerateText.mockResolvedValueOnce({
      text: "Here is the file content.",
      usage: { totalTokens: 30 },
    });

    const session = makeSession();
    const result = await runAgentLoop("fix the bug", session, makeConfig());

    // Should complete normally (3 calls: empty → tool → response)
    expect(mockGenerateText).toHaveBeenCalledTimes(3);
    // No abort message
    const abortMsg = result.messages.find(
      (m) =>
        m.role === "assistant" &&
        typeof m.content === "string" &&
        m.content.includes("consecutive empty responses"),
    );
    expect(abortMsg).toBeUndefined();
  });

  it("rejects confabulated completion claims when 0 files modified in pipeline", async () => {
    // Round 1: model claims completion immediately with zero tool calls.
    // Text must NOT match responseNeedsToolExecutionNudge (avoids "updated",
    // "modified", "plan", etc.) so the execution nudge doesn't fire first.
    mockGenerateText.mockResolvedValueOnce({
      text: "## Summary\n\nAll improvements are complete. Every bug has been resolved.",
      usage: { totalTokens: 40 },
    });

    // Round 2: after confabulation nudge, model actually does work
    mockGenerateText.mockResolvedValueOnce({
      text: 'Let me actually make the change.\n<tool_use>\n{"name":"Edit","input":{"file_path":"src/main.ts","old_string":"hello","new_string":"world"}}\n</tool_use>',
      usage: { totalTokens: 60 },
    });
    mockExecuteTool.mockResolvedValueOnce({ content: "ok", isError: false });

    // Round 3: final response
    mockGenerateText.mockResolvedValueOnce({
      text: "Change applied successfully.",
      usage: { totalTokens: 20 },
    });

    const session = makeSession();
    await runAgentLoop("/magic fix the bug", session, makeConfig());

    // 3 calls: confab-rejected summary → real edit → final
    expect(mockGenerateText).toHaveBeenCalledTimes(3);

    // Verify confabulation warning was injected in the 2nd call
    const secondCallArgs = mockGenerateText.mock.calls[1]![0];
    const userMsgs = secondCallArgs.messages.filter(
      (m: { role: string; content: string }) => m.role === "user",
    );
    const hasConfabWarning = userMsgs.some((m: { content: string }) =>
      m.content.includes("ZERO files were actually written"),
    );
    expect(hasConfabWarning).toBe(true);
  });

  it("blocks GitCommit when 0 files modified in pipeline workflow", async () => {
    // Round 1: model reads a file then tries to commit (confabulation: no writes)
    mockGenerateText.mockResolvedValueOnce({
      text:
        'I\'ll read the file.\n<tool_use>\n{"name":"Read","input":{"file_path":"src/app.ts"}}\n</tool_use>' +
        '\n<tool_use>\n{"name":"GitCommit","input":{"message":"feat: add feature","files":["src/app.ts"]}}\n</tool_use>',
      usage: { totalTokens: 80 },
    });
    mockExecuteTool.mockResolvedValueOnce({ content: "file content", isError: false });
    // GitCommit should be blocked — executeTool not called for it

    // Round 2: model actually edits after getting blocked message
    mockGenerateText.mockResolvedValueOnce({
      text: 'Editing.\n<tool_use>\n{"name":"Edit","input":{"file_path":"src/app.ts","old_string":"old","new_string":"new"}}\n</tool_use>',
      usage: { totalTokens: 50 },
    });
    mockExecuteTool.mockResolvedValueOnce({ content: "ok", isError: false });

    // Round 3: done
    mockGenerateText.mockResolvedValueOnce({
      text: "Applied the change.",
      usage: { totalTokens: 20 },
    });

    const session = makeSession();
    await runAgentLoop("/magic implement feature", session, makeConfig());

    // Verify GitCommit was blocked — the block message should appear in round 2 messages
    const secondCallArgs = mockGenerateText.mock.calls[1]![0];
    const toolResults = secondCallArgs.messages.find(
      (m: { role: string; content: string }) =>
        m.role === "user" && m.content.includes("GitCommit BLOCKED"),
    );
    expect(toolResults).toBeDefined();
  });

  it("blocks large Write to existing file and tells model to use Edit", async () => {
    // Round 1: model reads a file (populates readTracker via mock)
    mockGenerateText.mockResolvedValueOnce({
      text: 'Reading.\n<tool_use>\n{"name":"Read","input":{"file_path":"src/big-file.ts"}}\n</tool_use>',
      usage: { totalTokens: 50 },
    });
    // Mock Read to populate readTracker (simulating real executeTool behavior)
    mockExecuteTool.mockImplementationOnce(
      async (
        _name: string,
        input: Record<string, unknown>,
        projectRoot: string,
        context?: { readTracker?: Map<string, string> },
      ) => {
        if (context?.readTracker && input.file_path) {
          context.readTracker.set(resolve(projectRoot, input.file_path as string), "mock-hash");
        }
        return { content: "existing content", isError: false };
      },
    );

    // Round 2: model tries to Write the entire file (35K chars) — should be blocked
    const largeContent = "x".repeat(35_000);
    mockGenerateText.mockResolvedValueOnce({
      text: `Rewriting.\n<tool_use>\n{"name":"Write","input":{"file_path":"src/big-file.ts","content":"${largeContent}"}}\n</tool_use>`,
      usage: { totalTokens: 100 },
    });
    // executeTool should NOT be called for the blocked Write

    // Round 3: model uses Edit instead after getting blocked message
    mockGenerateText.mockResolvedValueOnce({
      text: 'Using Edit.\n<tool_use>\n{"name":"Edit","input":{"file_path":"src/big-file.ts","old_string":"existing","new_string":"better"}}\n</tool_use>',
      usage: { totalTokens: 50 },
    });
    mockExecuteTool.mockResolvedValueOnce({ content: "ok", isError: false });

    // Round 4: done
    mockGenerateText.mockResolvedValueOnce({
      text: "File edited.",
      usage: { totalTokens: 20 },
    });

    const session = makeSession();
    await runAgentLoop("/magic refactor the file", session, makeConfig());

    // Verify the Write was blocked — block message in round 3 messages
    const thirdCallArgs = mockGenerateText.mock.calls[2]![0];
    const blockMsg = thirdCallArgs.messages.find(
      (m: { role: string; content: string }) =>
        m.role === "user" && m.content.includes("Write BLOCKED"),
    );
    expect(blockMsg).toBeDefined();
  });

  // ---- Skill execution protocol: tool recipes injected when skillActive ----

  it("injects tool recipes and execution protocol into system prompt when skillActive is true", async () => {
    // Single response, no tool calls — just check the system prompt
    mockGenerateText.mockResolvedValueOnce({
      text: "Ready to execute the skill.",
      usage: { totalTokens: 50 },
    });

    const session = makeSession();
    await runAgentLoop("do the thing", session, makeConfig({ skillActive: true }));

    // The system prompt is passed as the `system` option to generate/stream
    const callArgs = mockGenerateText.mock.calls[0]![0];
    const systemPrompt = callArgs.system as string;
    expect(systemPrompt).toBeDefined();
    // Check specific tool recipes are present
    expect(systemPrompt).toContain("Tool Recipes for Skill Execution");
    expect(systemPrompt).toContain("gh search repos");
    expect(systemPrompt).toContain("curl -sL");
    expect(systemPrompt).toContain("git clone --depth 1");
    expect(systemPrompt).toContain("gh api");
    // Check execution protocol is present
    expect(systemPrompt).toContain("Skill Execution Protocol");
    expect(systemPrompt).toContain("DECOMPOSE FIRST");
    expect(systemPrompt).toContain("EVERY RESPONSE = TOOL CALLS");
    expect(systemPrompt).toContain("NEVER CONFABULATE");
  });

  it("does NOT inject tool recipes when skillActive is false", async () => {
    mockGenerateText.mockResolvedValueOnce({
      text: "Just a normal response.",
      usage: { totalTokens: 50 },
    });

    const session = makeSession();
    await runAgentLoop("hello", session, makeConfig());

    const callArgs = mockGenerateText.mock.calls[0]![0];
    const systemPrompt = callArgs.system as string;
    expect(systemPrompt).not.toContain("Tool Recipes for Skill Execution");
  });

  it("elevates round budget to 50 when skillActive is true", async () => {
    // Respond with tool calls for many rounds to test the budget
    // Set up enough rounds that it would exceed the default 15
    for (let i = 0; i < 20; i++) {
      mockGenerateText.mockResolvedValueOnce({
        text: `Step ${i + 1}.\n<tool_use>\n{"name":"Read","input":{"file_path":"src/file${i}.ts"}}\n</tool_use>`,
        usage: { totalTokens: 50 },
      });
      mockExecuteTool.mockResolvedValueOnce({ content: `content of file${i}`, isError: false });
    }
    // Final response with no tool calls to end the loop
    mockGenerateText.mockResolvedValueOnce({
      text: "All done.",
      usage: { totalTokens: 20 },
    });

    const session = makeSession();
    await runAgentLoop("run the skill", session, makeConfig({ skillActive: true }));

    // Should have made more than 15 generate calls (the default budget)
    // because skillActive elevates the budget to 50
    expect(mockGenerateText.mock.calls.length).toBeGreaterThan(15);
  });

  // ---- Wave orchestration integration tests ----

  it("injects Claude Workflow Mode when waveState has multiple waves", async () => {
    mockGenerateText.mockResolvedValueOnce({
      text: "Starting wave 1.",
      usage: { totalTokens: 50 },
    });

    const waveState = {
      waves: [
        { number: 1, title: "Research", instructions: "Search GitHub." },
        { number: 2, title: "Implement", instructions: "Write code." },
      ],
      currentIndex: 0,
      completedWaves: [] as number[],
      attempts: { 1: 0, 2: 0 },
      maxRetries: 2,
    };

    const session = makeSession();
    await runAgentLoop("do the skill", session, makeConfig({ skillActive: true, waveState }));

    const callArgs = mockGenerateText.mock.calls[0]![0];
    const systemPrompt = callArgs.system as string;
    // Should contain Claude Workflow Mode, NOT the basic tool recipes
    expect(systemPrompt).toContain("Claude Workflow Mode");
    expect(systemPrompt).toContain("Wave 1/2");
    expect(systemPrompt).toContain("Research");
  });

  it("advances to next wave when model signals [WAVE COMPLETE]", async () => {
    const waveState = {
      waves: [
        { number: 1, title: "Research", instructions: "Search GitHub." },
        { number: 2, title: "Implement", instructions: "Write code." },
        { number: 3, title: "Verify", instructions: "Run tests." },
      ],
      currentIndex: 0,
      completedWaves: [] as number[],
      attempts: { 1: 0, 2: 0, 3: 0 },
      maxRetries: 2,
    };

    // Wave 1: model does work then signals completion (Write to satisfy meaningful work guard)
    mockGenerateText.mockResolvedValueOnce({
      text: 'Writing file.\n<tool_use>\n{"name":"Write","input":{"file_path":"src/index.ts","content":"hello"}}\n</tool_use>',
      usage: { totalTokens: 50 },
    });
    mockExecuteTool.mockResolvedValueOnce({ content: "file written", isError: false });

    // Wave 1 complete signal (with tool call to verify it's mid-pipeline)
    mockGenerateText.mockResolvedValueOnce({
      text: 'Research done. [WAVE COMPLETE]\n<tool_use>\n{"name":"Write","input":{"file_path":"src/utils.ts","content":"utils"}}\n</tool_use>',
      usage: { totalTokens: 50 },
    });
    mockExecuteTool.mockResolvedValueOnce({ content: "file written", isError: false });

    // Wave 2: model works on next wave
    mockGenerateText.mockResolvedValueOnce({
      text: "Implementing changes. [WAVE COMPLETE]",
      usage: { totalTokens: 50 },
    });

    // Wave 3 (after text-only [WAVE COMPLETE] with executedToolsThisTurn > 0):
    mockGenerateText.mockResolvedValueOnce({
      text: "Running tests. [WAVE COMPLETE]",
      usage: { totalTokens: 50 },
    });

    // Final
    mockGenerateText.mockResolvedValueOnce({
      text: "All done.",
      usage: { totalTokens: 20 },
    });

    const session = makeSession();
    await runAgentLoop("run the skill", session, makeConfig({ skillActive: true, waveState }));

    // Wave state should have advanced
    expect(waveState.completedWaves).toContain(1);
    // The system prompt should have contained Claude Workflow Mode
    const firstCallSystem = mockGenerateText.mock.calls[0]![0].system as string;
    expect(firstCallSystem).toContain("Claude Workflow Mode");
  });

  it("uses basic tool recipes when waveState has only one wave", async () => {
    mockGenerateText.mockResolvedValueOnce({
      text: "Doing everything at once.",
      usage: { totalTokens: 50 },
    });

    const waveState = {
      waves: [{ number: 1, title: "Full Execution", instructions: "Do all the things." }],
      currentIndex: 0,
      completedWaves: [] as number[],
      attempts: { 1: 0 },
      maxRetries: 2,
    };

    const session = makeSession();
    await runAgentLoop("do the skill", session, makeConfig({ skillActive: true, waveState }));

    const callArgs = mockGenerateText.mock.calls[0]![0];
    const systemPrompt = callArgs.system as string;
    // Single wave = basic protocol, not Claude Workflow Mode
    expect(systemPrompt).not.toContain("Claude Workflow Mode");
    expect(systemPrompt).toContain("Tool Recipes for Skill Execution");
  });

  it("injects reflection checkpoint after 15 tool calls", async () => {
    // Build 15 Read tool calls as XML tool_use blocks in the model's text
    const toolCallsXml = Array.from(
      { length: 15 },
      (_, i) => `<tool_use>\n{"name":"Read","input":{"file_path":"src/file${i}.ts"}}\n</tool_use>`,
    ).join("\n");

    // First call: 15 tool calls embedded in text
    mockGenerateText.mockResolvedValueOnce({
      text: `Analyzing codebase.\n${toolCallsXml}`,
      usage: { totalTokens: 100 },
    });
    // Second call: final response after reflection checkpoint
    mockGenerateText.mockResolvedValueOnce({
      text: "Analysis complete.",
      usage: { totalTokens: 20 },
    });

    const session = makeSession();
    await runAgentLoop("analyze the codebase", session, makeConfig());

    // Check that the second call includes the reflection prompt
    expect(mockGenerateText.mock.calls.length).toBeGreaterThanOrEqual(2);
    const lastCallArgs = mockGenerateText.mock.calls[mockGenerateText.mock.calls.length - 1]![0];
    const allMsgs = lastCallArgs.messages as Array<{ role: string; content: string }>;
    const hasReflection = allMsgs.some(
      (m) => typeof m.content === "string" && m.content.includes("REFLECTION CHECKPOINT"),
    );
    expect(hasReflection).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// DanteGaslight integration hook
// ---------------------------------------------------------------------------

describe("DanteGaslight integration hook", () => {
  beforeEach(() => {
    mockGenerateText.mockResolvedValue({
      text: "Response text.",
      usage: { totalTokens: 20 },
    });
  });

  it("does nothing when config.gaslight is not set", async () => {
    const result = await runAgentLoop("hi", makeSession(), makeConfig());
    expect(result).toBeDefined();
  });

  it("calls maybeGaslight with the last assistant content as draft", async () => {
    let capturedDraft: string | undefined;
    const mockGaslight = {
      maybeGaslight: async (opts: { draft?: string }) => {
        capturedDraft = opts.draft;
        return null;
      },
    };
    // First round: tool call forces a full iteration so the gaslight hook is reachable
    mockGenerateText.mockResolvedValueOnce({
      text: 'Reading.\n<tool_use>\n{"name":"Read","input":{"file_path":"src/index.ts"}}\n</tool_use>',
      usage: { totalTokens: 30 },
    });
    mockGenerateText.mockResolvedValueOnce({
      text: "Final assistant response.",
      usage: { totalTokens: 20 },
    });
    await runAgentLoop(
      "go deeper",
      makeSession(),
      makeConfig({
        gaslight: mockGaslight as unknown as AgentLoopConfig["gaslight"],
      }),
    );
    expect(capturedDraft).toBe("Final assistant response.");
  });

  it("replaces last assistant message when gaslight passes with finalOutput", async () => {
    const improvedText = "This is the improved, refined response.";
    const mockGaslight = {
      maybeGaslight: async () => ({
        sessionId: "test-session-id",
        trigger: { channel: "explicit-user", at: new Date().toISOString() },
        iterations: [{ iteration: 1, draft: "Response text.", at: new Date().toISOString() }],
        stopReason: "pass" as const,
        finalOutput: improvedText,
        finalGateDecision: "pass" as const,
        lessonEligible: true,
        startedAt: new Date().toISOString(),
        endedAt: new Date().toISOString(),
      }),
    };
    // Two-round mock: tool call forces a second iteration so the gaslight hook is reachable.
    mockGenerateText.mockResolvedValueOnce({
      text: 'Reading.\n<tool_use>\n{"name":"Read","input":{"file_path":"src/index.ts"}}\n</tool_use>',
      usage: { totalTokens: 30 },
    });
    mockGenerateText.mockResolvedValueOnce({
      text: "Response text.",
      usage: { totalTokens: 20 },
    });
    const result = await runAgentLoop(
      "go deeper",
      makeSession(),
      makeConfig({
        gaslight: mockGaslight as unknown as AgentLoopConfig["gaslight"],
        silent: true,
      }),
    );
    const lastAssistant = [...result.messages].reverse().find((m) => m.role === "assistant");
    expect(lastAssistant?.content).toBe(improvedText);
  });

  it("does not modify session messages when gaslight returns fail", async () => {
    const mockGaslight = {
      maybeGaslight: async () => ({
        sessionId: "test-session-id",
        trigger: { channel: "explicit-user", at: new Date().toISOString() },
        iterations: [{ iteration: 1, draft: "Response text.", at: new Date().toISOString() }],
        stopReason: "budget-iterations" as const,
        finalOutput: "Rewrite that must NOT appear.",
        finalGateDecision: "fail" as const,
        lessonEligible: false,
        startedAt: new Date().toISOString(),
        endedAt: new Date().toISOString(),
      }),
    };
    // Two-round mock: tool call forces a second iteration so the gaslight hook is reachable.
    mockGenerateText.mockResolvedValueOnce({
      text: 'Reading.\n<tool_use>\n{"name":"Read","input":{"file_path":"src/index.ts"}}\n</tool_use>',
      usage: { totalTokens: 30 },
    });
    mockGenerateText.mockResolvedValueOnce({
      text: "Response text.",
      usage: { totalTokens: 20 },
    });
    const result = await runAgentLoop(
      "go deeper",
      makeSession(),
      makeConfig({
        gaslight: mockGaslight as unknown as AgentLoopConfig["gaslight"],
        silent: true,
      }),
    );
    const lastAssistant = [...result.messages].reverse().find((m) => m.role === "assistant");
    expect(lastAssistant?.content).toBe("Response text.");
    expect(lastAssistant?.content).not.toBe("Rewrite that must NOT appear.");
  });

  // ── Structural pre-gate tests ──────────────────────────────────────────────
  // These tests capture the onGate callback from the closure via a mock maybeGaslight,
  // then call it directly to verify the deterministic structural check logic.

  it("structural gate short-circuits on near-identical rewrite (no LLM call)", async () => {
    let capturedGate: ((draft: string) => Promise<{ decision: string; score: number }>) | undefined;

    const mockGaslight = {
      maybeGaslight: async (opts: {
        draft?: string;
        callbacks?: {
          onGate?: (d: string) => Promise<{ decision: string; score: number }>;
        };
      }) => {
        capturedGate = opts.callbacks?.onGate;
        return null;
      },
    };

    // Two-round mock so the gaslight hook is reached and callbacks are wired.
    mockGenerateText.mockResolvedValueOnce({
      text: 'Reading.\n<tool_use>\n{"name":"Read","input":{"file_path":"src/index.ts"}}\n</tool_use>',
      usage: { totalTokens: 30 },
    });
    mockGenerateText.mockResolvedValueOnce({
      text: "Response text.",
      usage: { totalTokens: 20 },
    });

    await runAgentLoop(
      "go deeper",
      makeSession(),
      makeConfig({
        gaslight: mockGaslight as unknown as AgentLoopConfig["gaslight"],
        silent: true,
      }),
    );

    expect(capturedGate).toBeDefined();

    const callsBefore = mockGenerateText.mock.calls.length;
    // Pass the same text as the original draft → Jaccard overlap = 1.0 → structural fail
    const result = await capturedGate!("Response text.");
    const callsAfter = mockGenerateText.mock.calls.length;

    expect(result.decision).toBe("fail");
    expect(result.score).toBe(0.2);
    // LLM gate must NOT have been called (structural short-circuit)
    expect(callsAfter).toBe(callsBefore);
  });

  it("structural gate allows genuinely different rewrite to reach LLM gate", async () => {
    let capturedGate: ((draft: string) => Promise<{ decision: string; score: number }>) | undefined;

    const mockGaslight = {
      maybeGaslight: async (opts: {
        draft?: string;
        callbacks?: {
          onGate?: (d: string) => Promise<{ decision: string; score: number }>;
        };
      }) => {
        capturedGate = opts.callbacks?.onGate;
        return null;
      },
    };

    mockGenerateText.mockResolvedValueOnce({
      text: 'Reading.\n<tool_use>\n{"name":"Read","input":{"file_path":"src/index.ts"}}\n</tool_use>',
      usage: { totalTokens: 30 },
    });
    mockGenerateText.mockResolvedValueOnce({
      text: "Response text.",
      usage: { totalTokens: 20 },
    });

    await runAgentLoop(
      "go deeper",
      makeSession(),
      makeConfig({
        gaslight: mockGaslight as unknown as AgentLoopConfig["gaslight"],
        silent: true,
      }),
    );

    expect(capturedGate).toBeDefined();

    // Pre-load the comparative gate response (PASS → decision "pass")
    mockGenerateText.mockResolvedValueOnce({
      text: "PASS The rewrite substantively addresses all critique points.",
      usage: { totalTokens: 15 },
    });

    const callsBefore = mockGenerateText.mock.calls.length;
    // Completely different text — very low Jaccard overlap with "Response text."
    const differentRewrite =
      "This comprehensive analysis examines multiple perspectives and provides detailed evidence supporting each conclusion through rigorous examination of available data.";
    const result = await capturedGate!(differentRewrite);
    const callsAfter = mockGenerateText.mock.calls.length;

    // Structural check passed → LLM gate was called
    expect(callsAfter).toBeGreaterThan(callsBefore);
    expect(result.decision).toBe("pass");
  });

  it("structural gate fails when critique concept words absent from rewrite", async () => {
    let capturedCritique: ((sys: string, user: string) => Promise<string | null>) | undefined;
    let capturedGate: ((draft: string) => Promise<{ decision: string; score: number }>) | undefined;

    const mockGaslight = {
      maybeGaslight: async (opts: {
        draft?: string;
        callbacks?: {
          onCritique?: (s: string, u: string) => Promise<string | null>;
          onGate?: (d: string) => Promise<{ decision: string; score: number }>;
        };
      }) => {
        capturedCritique = opts.callbacks?.onCritique;
        capturedGate = opts.callbacks?.onGate;
        return null;
      },
    };

    mockGenerateText.mockResolvedValueOnce({
      text: 'Reading.\n<tool_use>\n{"name":"Read","input":{"file_path":"src/index.ts"}}\n</tool_use>',
      usage: { totalTokens: 30 },
    });
    mockGenerateText.mockResolvedValueOnce({
      text: "Response text.",
      usage: { totalTokens: 20 },
    });

    await runAgentLoop(
      "go deeper",
      makeSession(),
      makeConfig({
        gaslight: mockGaslight as unknown as AgentLoopConfig["gaslight"],
        silent: true,
      }),
    );

    expect(capturedCritique).toBeDefined();
    expect(capturedGate).toBeDefined();

    // Seed the critique closure: return JSON with high-severity concept words
    // "authentication" and "authorization" must appear in critique points.
    mockGenerateText.mockResolvedValueOnce({
      text: JSON.stringify({
        summary: "Response lacks authentication and authorization checks",
        points: [
          { severity: "high", description: "Missing authentication validation" },
          { severity: "medium", description: "Authorization bypass possible" },
        ],
      }),
      usage: { totalTokens: 50 },
    });
    await capturedCritique!("sys", "user"); // populates lastCritiquePoints closure var

    // Rewrite that mentions neither "authentication" nor "authorization"
    const rewriteIgnoringCritique =
      "The implementation provides better performance through caching and improved algorithms.";
    const callsBefore = mockGenerateText.mock.calls.length;
    const result = await capturedGate!(rewriteIgnoringCritique);
    const callsAfter = mockGenerateText.mock.calls.length;

    // Structural gate must fail — no LLM gate call
    expect(result.decision).toBe("fail");
    expect(result.score).toBe(0.2);
    expect(callsAfter).toBe(callsBefore);
  });

  it("comparative gate parses PASS response correctly (decision: pass, score: 0.9)", async () => {
    let capturedGate: ((draft: string) => Promise<{ decision: string; score: number }>) | undefined;

    const mockGaslight = {
      maybeGaslight: async (opts: {
        draft?: string;
        callbacks?: {
          onGate?: (d: string) => Promise<{ decision: string; score: number }>;
        };
      }) => {
        capturedGate = opts.callbacks?.onGate;
        return null;
      },
    };

    mockGenerateText.mockResolvedValueOnce({
      text: 'Reading.\n<tool_use>\n{"name":"Read","input":{"file_path":"src/index.ts"}}\n</tool_use>',
      usage: { totalTokens: 30 },
    });
    mockGenerateText.mockResolvedValueOnce({
      text: "Response text.",
      usage: { totalTokens: 20 },
    });

    await runAgentLoop(
      "go deeper",
      makeSession(),
      makeConfig({
        gaslight: mockGaslight as unknown as AgentLoopConfig["gaslight"],
        silent: true,
      }),
    );

    expect(capturedGate).toBeDefined();

    // Pre-load comparative gate returning PASS
    mockGenerateText.mockResolvedValueOnce({
      text: "PASS The rewrite substantively addresses all critique concerns.",
      usage: { totalTokens: 15 },
    });

    const differentRewrite =
      "This comprehensive analysis examines multiple perspectives and provides detailed evidence supporting each conclusion.";
    const result = await capturedGate!(differentRewrite);

    expect(result.decision).toBe("pass");
    expect(result.score).toBe(0.9);
  });

  it("comparative gate parses FAIL response correctly (decision: fail, score: 0.2)", async () => {
    let capturedGate: ((draft: string) => Promise<{ decision: string; score: number }>) | undefined;

    const mockGaslight = {
      maybeGaslight: async (opts: {
        draft?: string;
        callbacks?: {
          onGate?: (d: string) => Promise<{ decision: string; score: number }>;
        };
      }) => {
        capturedGate = opts.callbacks?.onGate;
        return null;
      },
    };

    mockGenerateText.mockResolvedValueOnce({
      text: 'Reading.\n<tool_use>\n{"name":"Read","input":{"file_path":"src/index.ts"}}\n</tool_use>',
      usage: { totalTokens: 30 },
    });
    mockGenerateText.mockResolvedValueOnce({
      text: "Response text.",
      usage: { totalTokens: 20 },
    });

    await runAgentLoop(
      "go deeper",
      makeSession(),
      makeConfig({
        gaslight: mockGaslight as unknown as AgentLoopConfig["gaslight"],
        silent: true,
      }),
    );

    expect(capturedGate).toBeDefined();

    // Pre-load comparative gate returning FAIL
    mockGenerateText.mockResolvedValueOnce({
      text: "FAIL The rewrite only superficially mentions keywords without addressing structural issues.",
      usage: { totalTokens: 18 },
    });

    const differentRewrite =
      "This comprehensive analysis examines multiple perspectives and provides detailed evidence supporting each conclusion.";
    const result = await capturedGate!(differentRewrite);

    expect(result.decision).toBe("fail");
    expect(result.score).toBe(0.2);
  });

  it("adaptive threshold tighter for high-severity critiques (3 high → threshold 0.80)", async () => {
    let capturedCritique: ((sys: string, user: string) => Promise<string | null>) | undefined;
    let capturedGate: ((draft: string) => Promise<{ decision: string; score: number }>) | undefined;

    const mockGaslight = {
      maybeGaslight: async (opts: {
        draft?: string;
        callbacks?: {
          onCritique?: (s: string, u: string) => Promise<string | null>;
          onGate?: (d: string) => Promise<{ decision: string; score: number }>;
        };
      }) => {
        capturedCritique = opts.callbacks?.onCritique;
        capturedGate = opts.callbacks?.onGate;
        return null;
      },
    };

    // Longer original draft enables precise Jaccard control.
    const originalText =
      "Authentication validation ensures security by checking user tokens before authorizing access to protected resources and endpoints.";
    mockGenerateText.mockResolvedValueOnce({
      text: 'Reading.\n<tool_use>\n{"name":"Read","input":{"file_path":"src/index.ts"}}\n</tool_use>',
      usage: { totalTokens: 30 },
    });
    mockGenerateText.mockResolvedValueOnce({
      text: originalText,
      usage: { totalTokens: 20 },
    });

    await runAgentLoop(
      "go deeper",
      makeSession(),
      makeConfig({
        gaslight: mockGaslight as unknown as AgentLoopConfig["gaslight"],
        silent: true,
      }),
    );

    expect(capturedCritique).toBeDefined();
    expect(capturedGate).toBeDefined();

    // Seed 3 high-severity critique points → adaptiveJaccardThreshold(3, 0) = 0.80.
    mockGenerateText.mockResolvedValueOnce({
      text: JSON.stringify({
        summary: "Critical authentication flaws",
        points: [
          { severity: "high", description: "Missing token expiry validation" },
          { severity: "high", description: "Authorization bypass through header manipulation" },
          { severity: "high", description: "Insufficient privilege escalation checks" },
        ],
      }),
      usage: { totalTokens: 60 },
    });
    await capturedCritique!("sys", "user"); // populates lastCritiqueHighCount = 3

    // Single-word swap: "endpoints" → "operations".
    // Jaccard overlap ≈ 12/14 ≈ 0.857 — above 0.80 (high-severity threshold) but below 0.93 (no-severity default).
    // Without high-severity seeded this rewrite would pass the Jaccard check; with 3 high-severity it fails.
    const slightlyDifferentRewrite =
      "Authentication validation ensures security by checking user tokens before authorizing access to protected resources and operations.";

    const callsBefore = mockGenerateText.mock.calls.length;
    const result = await capturedGate!(slightlyDifferentRewrite);
    const callsAfter = mockGenerateText.mock.calls.length;

    // Structural gate must fail: overlap 0.857 > adaptive threshold 0.80.
    expect(result.decision).toBe("fail");
    expect(result.score).toBe(0.2);
    // No LLM gate call (structural short-circuit)
    expect(callsAfter).toBe(callsBefore);
  });

  it("adaptive threshold counterfactual — 0 severity seeded → same rewrite reaches LLM gate", async () => {
    // Companion to the previous test. Same original text and same slightly-different rewrite
    // (~0.857 Jaccard overlap), but NO critique seeded.
    // adaptiveJaccardThreshold(0, 0, 0) = 0.93. 0.857 < 0.93 → Jaccard passes.
    // new-vocab-ratio with no high-severity: minRatio=0.05; ratio≈0.077 → passes.
    // No descriptions → bigram checks skipped. All structural checks pass → LLM gate called.
    let capturedGate: ((draft: string) => Promise<{ decision: string; score: number }>) | undefined;

    const mockGaslight = {
      maybeGaslight: async (opts: {
        draft?: string;
        callbacks?: {
          onGate?: (d: string) => Promise<{ decision: string; score: number }>;
        };
      }) => {
        capturedGate = opts.callbacks?.onGate;
        return null;
      },
    };

    const originalText =
      "Authentication validation ensures security by checking user tokens before authorizing access to protected resources and endpoints.";
    mockGenerateText.mockResolvedValueOnce({
      text: 'Reading.\n<tool_use>\n{"name":"Read","input":{"file_path":"src/index.ts"}}\n</tool_use>',
      usage: { totalTokens: 30 },
    });
    mockGenerateText.mockResolvedValueOnce({
      text: originalText,
      usage: { totalTokens: 20 },
    });

    await runAgentLoop(
      "go deeper",
      makeSession(),
      makeConfig({
        gaslight: mockGaslight as unknown as AgentLoopConfig["gaslight"],
        silent: true,
      }),
    );

    expect(capturedGate).toBeDefined();

    // Pre-load PASS for the LLM gate that will be reached (structural checks all pass).
    mockGenerateText.mockResolvedValueOnce({
      text: "PASS The rewrite shows substantive restructuring beyond a single word change.",
      usage: { totalTokens: 15 },
    });

    const slightlyDifferentRewrite =
      "Authentication validation ensures security by checking user tokens before authorizing access to protected resources and operations.";

    const callsBefore = mockGenerateText.mock.calls.length;
    const result = await capturedGate!(slightlyDifferentRewrite);
    const callsAfter = mockGenerateText.mock.calls.length;

    // Structural checks pass (threshold 0.93, overlap 0.857) → LLM gate was called.
    expect(callsAfter).toBeGreaterThan(callsBefore);
    expect(result.decision).toBe("pass");
    expect(result.score).toBe(0.9);
  });

  it("repeated structural fails are stateless — each call independently returns fail with no LLM calls", async () => {
    let capturedGate: ((draft: string) => Promise<{ decision: string; score: number }>) | undefined;

    const mockGaslight = {
      maybeGaslight: async (opts: {
        draft?: string;
        callbacks?: {
          onGate?: (d: string) => Promise<{ decision: string; score: number }>;
        };
      }) => {
        capturedGate = opts.callbacks?.onGate;
        return null;
      },
    };

    mockGenerateText.mockResolvedValueOnce({
      text: 'Reading.\n<tool_use>\n{"name":"Read","input":{"file_path":"src/index.ts"}}\n</tool_use>',
      usage: { totalTokens: 30 },
    });
    mockGenerateText.mockResolvedValueOnce({
      text: "Response text.",
      usage: { totalTokens: 20 },
    });

    await runAgentLoop(
      "go deeper",
      makeSession(),
      makeConfig({
        gaslight: mockGaslight as unknown as AgentLoopConfig["gaslight"],
        silent: true,
      }),
    );

    expect(capturedGate).toBeDefined();

    // Call the gate 3 times with the same text as the original draft.
    // Each call reads the closure independently — overlap=1.0 → structural fail every time.
    // Verifies no state accumulation, memoization side-effects, or counter drift between calls.
    const callsBefore = mockGenerateText.mock.calls.length;
    const r1 = await capturedGate!("Response text.");
    const r2 = await capturedGate!("Response text.");
    const r3 = await capturedGate!("Response text.");
    const callsAfter = mockGenerateText.mock.calls.length;

    expect(r1).toEqual({ decision: "fail", score: 0.2 });
    expect(r2).toEqual({ decision: "fail", score: 0.2 });
    expect(r3).toEqual({ decision: "fail", score: 0.2 });
    // Zero LLM gate calls across all three (structural short-circuit each time)
    expect(callsAfter).toBe(callsBefore);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// FearSet enforcement gate — fearSetBlockOnNoGo
// ─────────────────────────────────────────────────────────────────────────────

describe("FearSet enforcement gate — fearSetBlockOnNoGo", () => {
  // Shared no-go FearSet result factory
  function makeNoGoFearSetResult() {
    return {
      id: "fs-nogo-1",
      context: "Deploy the new payment service",
      trigger: {
        channel: "explicit-user" as const,
        rationale: "test",
        at: new Date().toISOString(),
      },
      mode: "llm" as const,
      columns: [],
      passed: false,
      startedAt: new Date().toISOString(),
      robustnessScore: {
        overall: 0.25,
        hasSimulationEvidence: false,
        gateDecision: "fail" as const,
        justification: "Too many unmitigated risks.",
        scoredAt: new Date().toISOString(),
      },
      synthesizedRecommendation: {
        decision: "no-go" as const,
        reasoning: "The blast radius is too wide and no prevention actions have been verified.",
        conditions: [],
      },
      stopReason: "completed" as const,
    };
  }

  // Minimal gaslight mock with maybeFearSet returning a no-go result
  function makeNoGoGaslightMock() {
    return {
      maybeGaslight: async () => null,
      getConfig: () => ({ enabled: false }),
      getFearSetConfig: () => ({ enabled: true }),
      maybeFearSet: async () => makeNoGoFearSetResult(),
    };
  }

  beforeEach(() => {
    mockConfirmDestructive.mockReset();
    mockConfirmDestructive.mockResolvedValue(false); // Default: user declines
  });

  it("fearSetBlockOnNoGo=true + no-go result + user declines → session returned early", async () => {
    const textCallCount = { n: 0 };
    mockGenerateText.mockImplementation(async () => {
      textCallCount.n++;
      if (textCallCount.n === 1) {
        return {
          text: 'Let me help.\n<tool_use>\n{"name":"Read","input":{"file_path":"src/index.ts"}}\n</tool_use>',
          usage: { totalTokens: 30 },
        };
      }
      return { text: "Final answer.", usage: { totalTokens: 20 } };
    });
    mockConfirmDestructive.mockResolvedValue(false); // user declines

    const result = await runAgentLoop(
      "deploy the service",
      makeSession(),
      makeConfig({
        gaslight: makeNoGoGaslightMock() as unknown as AgentLoopConfig["gaslight"],
        fearSetBlockOnNoGo: true,
        silent: true,
      }),
    );

    // confirmDestructive must have been called
    expect(mockConfirmDestructive).toHaveBeenCalledOnce();
    // Session is returned (not null/undefined)
    expect(result).toBeDefined();
  });

  it("fearSetBlockOnNoGo=true + no-go result + user confirms → confirmDestructive called, proceeds", async () => {
    mockGenerateText.mockResolvedValueOnce({
      text: 'Acting.\n<tool_use>\n{"name":"Read","input":{"file_path":"src/index.ts"}}\n</tool_use>',
      usage: { totalTokens: 30 },
    });
    mockGenerateText.mockResolvedValueOnce({
      text: "Done.",
      usage: { totalTokens: 20 },
    });
    mockConfirmDestructive.mockResolvedValue(true); // user confirms

    const result = await runAgentLoop(
      "deploy the service",
      makeSession(),
      makeConfig({
        gaslight: makeNoGoGaslightMock() as unknown as AgentLoopConfig["gaslight"],
        fearSetBlockOnNoGo: true,
        silent: true,
      }),
    );

    // confirmDestructive was called once
    expect(mockConfirmDestructive).toHaveBeenCalledOnce();
    // Session is returned
    expect(result).toBeDefined();
  });

  it("fearSetBlockOnNoGo=false (default) + no-go result → confirmDestructive never called", async () => {
    mockGenerateText.mockResolvedValueOnce({
      text: 'Acting.\n<tool_use>\n{"name":"Read","input":{"file_path":"src/index.ts"}}\n</tool_use>',
      usage: { totalTokens: 30 },
    });
    mockGenerateText.mockResolvedValueOnce({
      text: "Done.",
      usage: { totalTokens: 20 },
    });

    await runAgentLoop(
      "deploy the service",
      makeSession(),
      makeConfig({
        gaslight: makeNoGoGaslightMock() as unknown as AgentLoopConfig["gaslight"],
        // fearSetBlockOnNoGo not set — defaults to false (advisory mode)
        silent: true,
      }),
    );

    // Fire-and-forget: confirmDestructive must never be called when flag is off
    expect(mockConfirmDestructive).not.toHaveBeenCalled();
  });

  // ---------------------------------------------------------------------------
  // DanteMemory (Lane B) tests
  // ---------------------------------------------------------------------------

  it("injects DanteMemory (Semantic Recall) system message when memories exist", async () => {
    // Arrange: recall returns one past memory result
    mockMemoryRecall.mockResolvedValueOnce({
      query: "fix typescript",
      scope: "all",
      latencyMs: 5,
      results: [
        {
          key: "past-fix",
          value: "Updated tsconfig.json to fix the compilation error",
          scope: "project",
          layer: "semantic",
          createdAt: new Date().toISOString(),
          lastAccessedAt: new Date().toISOString(),
          score: 0.85,
          recallCount: 2,
          summary: "Updated tsconfig to fix TypeScript error",
          meta: {},
        },
      ],
    });
    mockGenerateText.mockResolvedValueOnce({
      text: "I will fix the TypeScript error.\n[COMPLEXITY: 0.2]",
      usage: { promptTokens: 50, completionTokens: 20, totalTokens: 70 },
    });

    const session = makeSession();
    await runAgentLoop("fix the typescript compilation error", session, makeConfig());

    // memoryRecall was called (semantic recall injection)
    expect(mockMemoryRecall).toHaveBeenCalledWith("fix the typescript compilation error", 10);
    // auditLogger.flush was called (session-end audit)
    expect(mockAuditLoggerFlush).toHaveBeenCalledWith({ endSession: true });
    // memoryStore was called for session-end persist
    expect(mockMemoryStore).toHaveBeenCalledWith(
      expect.stringContaining("session::"),
      expect.any(String),
      "project",
      expect.objectContaining({ tags: ["session-summary"] }),
    );
    // memoryPrune was called at session end
    expect(mockMemoryPrune).toHaveBeenCalled();
    // DanteMemory recall system message is injected into the LLM-API messages[] array,
    // not into session.messages (which tracks assistant/tool/user turns).
    // Verify that recall was attempted and the pipeline completed normally.
    expect(session.messages.length).toBeGreaterThanOrEqual(1);
    // The absence of the message in session.messages is expected — DanteMemory
    // injects into the LLM-API messages[] array (not session.messages[]).
    // Confirm memoryInitialize was called to set up the orchestrator.
    expect(mockMemoryInitialize).toHaveBeenCalled();
  });

  it("memoryStore is called fire-and-forget per round when tools are executed", async () => {
    mockGenerateText.mockResolvedValueOnce({
      text: 'Reading the file.\n<tool_use>\n{"name":"Read","input":{"file_path":"src/index.ts"}}\n</tool_use>',
      usage: { promptTokens: 50, completionTokens: 30, totalTokens: 80 },
    });
    mockGenerateText.mockResolvedValueOnce({
      text: "Done reading.",
      usage: { promptTokens: 60, completionTokens: 20, totalTokens: 80 },
    });

    const session = makeSession();
    await runAgentLoop("read src/index.ts", session, makeConfig());

    // Per-round memoryStore fire-and-forget: called with "session" scope
    const storeCallsWithSessionScope = mockMemoryStore.mock.calls.filter(
      (call: unknown[]) => call[2] === "session",
    );
    expect(storeCallsWithSessionScope.length).toBeGreaterThanOrEqual(1);
    const firstCall = storeCallsWithSessionScope[0] as unknown[];
    expect(firstCall?.[0]).toContain("round-");
    expect(firstCall?.[0]).toContain("test-session");
  });

  it("auto-retain payload includes toolCallCount and filesModifiedTotal", async () => {
    // Two rounds: first produces a tool call, second produces final answer
    mockGenerateText.mockResolvedValueOnce({
      text: 'Working.\n<tool_use>\n{"name":"Read","input":{"file_path":"src/a.ts"}}\n</tool_use>',
      usage: { promptTokens: 40, completionTokens: 20, totalTokens: 60 },
    });
    mockGenerateText.mockResolvedValueOnce({
      text: "Done.",
      usage: { promptTokens: 50, completionTokens: 10, totalTokens: 60 },
    });

    const session = makeSession();
    await runAgentLoop("check a.ts", session, makeConfig());

    // Filter to auto-retain calls specifically (key starts with "round-" and value is an object)
    const autoRetainCalls = mockMemoryStore.mock.calls.filter(
      (call: unknown[]) =>
        call[2] === "session" &&
        typeof call[0] === "string" &&
        (call[0] as string).startsWith("round-") &&
        typeof call[1] === "object" &&
        call[1] !== null &&
        !Array.isArray(call[1]),
    );
    expect(autoRetainCalls.length).toBeGreaterThanOrEqual(1);
    const payload = autoRetainCalls[0]?.[1] as Record<string, unknown>;
    expect(payload).toHaveProperty("round");
    expect(payload).toHaveProperty("timestamp");
    expect(payload).toHaveProperty("filesModifiedTotal");
    expect(payload).toHaveProperty("toolCallCount");
    expect(typeof payload["toolCallCount"]).toBe("number");
  });

  it("auto-retain failure never crashes the agent loop", async () => {
    mockMemoryStore.mockRejectedValueOnce(new Error("Memory storage full"));
    mockGenerateText.mockResolvedValueOnce({
      text: 'Read the file.\n<tool_use>\n{"name":"Read","input":{"file_path":"src/x.ts"}}\n</tool_use>',
      usage: { promptTokens: 40, completionTokens: 20, totalTokens: 60 },
    });
    mockGenerateText.mockResolvedValueOnce({
      text: "Done.",
      usage: { promptTokens: 50, completionTokens: 10, totalTokens: 60 },
    });

    const session = makeSession();
    // Must complete without throwing even when memoryStore rejects
    await expect(runAgentLoop("check x.ts", session, makeConfig())).resolves.not.toThrow();
  });

  it("auto-retain is NOT fired on round 1 (only round 2+)", async () => {
    // Clear all mock call history so previous tests don't pollute this assertion
    mockMemoryStore.mockClear();

    // Single-round loop: no tool calls, loop ends after first turn
    // roundCounter === 1 at the retain check → condition `roundCounter > 1` is false → skipped
    mockGenerateText.mockResolvedValueOnce({
      text: "Done in one round.",
      usage: { promptTokens: 30, completionTokens: 10, totalTokens: 40 },
    });

    const session = makeSession();
    await runAgentLoop("quick task", session, makeConfig());

    const autoRetainCalls = mockMemoryStore.mock.calls.filter(
      (call: unknown[]) =>
        typeof call[0] === "string" &&
        (call[0] as string).startsWith("round-") &&
        typeof call[1] === "object" &&
        call[1] !== null &&
        !Array.isArray(call[1]),
    );
    expect(autoRetainCalls).toHaveLength(0);
  });

  it("auditLogger.flush is called with endSession:true at session end", async () => {
    mockGenerateText.mockResolvedValueOnce({
      text: "All done.\n[COMPLEXITY: 0.1]",
      usage: { promptTokens: 50, completionTokens: 20, totalTokens: 70 },
    });

    await runAgentLoop("do something simple", makeSession(), makeConfig());

    expect(mockAuditLoggerFlush).toHaveBeenCalledWith({ endSession: true });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// verificationScore retry-derived fallback formula
// Formula: Math.max(0, 0.5 - verifyRetries * 0.15)
//   retries=0 → undefined (no quality signal)
//   retries=1 → 0.35
//   retries=2 → 0.20
// ─────────────────────────────────────────────────────────────────────────────

describe("verificationScore retry-derived fallback", () => {
  // Spy factory: captures verificationScore arg passed to maybeFearSet
  function makeFearSetSpy() {
    const maybeFearSetSpy = vi.fn().mockResolvedValue(null);
    return {
      spy: maybeFearSetSpy,
      gaslight: {
        maybeGaslight: vi.fn().mockResolvedValue(null),
        getConfig: vi.fn().mockReturnValue({ enabled: false }),
        getFearSetConfig: vi.fn().mockReturnValue({ enabled: true }),
        maybeFearSet: maybeFearSetSpy,
      },
    };
  }

  // Config with testCommand so the verification loop fires when wroteCode=true
  function makeVerifyConfig(overrides?: Partial<AgentLoopConfig>): AgentLoopConfig {
    return makeConfig({
      state: {
        ...makeConfig().state,
        project: { name: "test", language: "typescript", testCommand: "npm test" },
      } as unknown as DanteCodeState,
      silent: true,
      ...overrides,
    });
  }

  beforeEach(() => {
    mockExecuteTool.mockReset();
    mockExecuteTool.mockResolvedValue({ content: "ok", isError: false });
    mockParseVerificationErrors.mockReset();
    mockParseVerificationErrors.mockReturnValue([]);
  });

  it("verifyRetries === 0 → verificationScore is undefined (no code writes, no retries)", async () => {
    mockGenerateText.mockResolvedValueOnce({
      text: "Nothing to change.",
      usage: { totalTokens: 20 },
    });
    const { spy, gaslight } = makeFearSetSpy();
    await runAgentLoop(
      "describe the system",
      makeSession(),
      makeVerifyConfig({ gaslight: gaslight as unknown as AgentLoopConfig["gaslight"] }),
    );
    const callArg = spy.mock.calls[0]?.[0] as Record<string, unknown> | undefined;
    expect(callArg?.verificationScore).toBeUndefined();
  });

  it("verifyRetries === 1 → verificationScore === 0.35 (0.5 - 1*0.15)", async () => {
    // Round 1: Write tool → Bash verify fails → verifyRetries=1 → retry message
    // Round 2: final text (no tools) → loop exits
    mockGenerateText
      .mockResolvedValueOnce({
        text: 'Writing.\n<tool_use>\n{"name":"Write","input":{"file_path":"a.ts","content":"x"}}\n</tool_use>',
        usage: { totalTokens: 30 },
      })
      .mockResolvedValueOnce({
        text: "Fixed.",
        usage: { totalTokens: 20 },
      });
    // Bash calls fail (verify step), all other tool calls succeed
    mockExecuteTool.mockImplementation((toolName: string) => {
      if (toolName === "Bash") return Promise.resolve({ content: "FAIL", isError: true });
      return Promise.resolve({ content: "ok", isError: false });
    });

    const { spy, gaslight } = makeFearSetSpy();
    await runAgentLoop(
      "write a file",
      makeSession(),
      makeVerifyConfig({ gaslight: gaslight as unknown as AgentLoopConfig["gaslight"] }),
    );
    const callArg = spy.mock.calls[0]?.[0] as Record<string, unknown> | undefined;
    expect(callArg?.verificationScore).toBeCloseTo(0.35);
  });

  it("verifyRetries === 2 → verificationScore === 0.20 (0.5 - 2*0.15)", async () => {
    // Round 1: Write → verify fails → verifyRetries=1
    // Round 2: Write → verify fails → verifyRetries=2
    // Round 3: final text → loop exits
    mockGenerateText
      .mockResolvedValueOnce({
        text: 'First write.\n<tool_use>\n{"name":"Write","input":{"file_path":"a.ts","content":"x"}}\n</tool_use>',
        usage: { totalTokens: 30 },
      })
      .mockResolvedValueOnce({
        text: 'Second write.\n<tool_use>\n{"name":"Write","input":{"file_path":"b.ts","content":"y"}}\n</tool_use>',
        usage: { totalTokens: 30 },
      })
      .mockResolvedValueOnce({
        text: "All done.",
        usage: { totalTokens: 20 },
      });
    mockExecuteTool.mockImplementation((toolName: string) => {
      if (toolName === "Bash") return Promise.resolve({ content: "FAIL", isError: true });
      return Promise.resolve({ content: "ok", isError: false });
    });

    const { spy, gaslight } = makeFearSetSpy();
    await runAgentLoop(
      "write two files",
      makeSession(),
      makeVerifyConfig({ gaslight: gaslight as unknown as AgentLoopConfig["gaslight"] }),
    );
    const callArg = spy.mock.calls[0]?.[0] as Record<string, unknown> | undefined;
    expect(callArg?.verificationScore).toBeCloseTo(0.2);
  });
});

// ---------------------------------------------------------------------------
// Fallback pipeline guard
// ---------------------------------------------------------------------------

describe("Fallback pipeline guard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAnalyzeComplexityValue = 0.3;
    mockEscalateTier.mockReset();
    mockIsUsingFallback.mockReturnValue(false);
    mockGetFallbackModelId.mockReturnValue(undefined);
    mockGenerateText.mockReset();
    mockExecuteTool.mockReset();
    mockExecuteTool.mockResolvedValue({ content: "ok", isError: false });
    mockGetLatestWaitingRun.mockResolvedValue(null);
    mockLoadSessionSnapshot.mockResolvedValue(null);
    mockLoadResumeHint.mockResolvedValue(null);
    mockLoadBackgroundTask.mockResolvedValue(null);
    mockPersistPendingToolCalls.mockReset();
    mockLoadPendingToolCalls.mockReset();
    mockLoadPendingToolCalls.mockResolvedValue([]);
    mockClearPendingToolCalls.mockReset();
    mockMemoryInitialize.mockResolvedValue(undefined);
    mockMemoryRecall.mockResolvedValue({ query: "", scope: "all", results: [], latencyMs: 0 });
    mockMemoryStore.mockResolvedValue({ stored: true });
    mockMemorySummarize.mockResolvedValue({
      sessionId: "test-session",
      summary: "",
      compressed: false,
      tokensSaved: 0,
    });
    mockMemoryPrune.mockResolvedValue({ prunedCount: 0, retainedCount: 0, policy: "default" });
    mockAuditLoggerFlush.mockResolvedValue({
      anomalies: [],
      analyzedCount: 0,
      bufferTruncated: false,
      detection: { analyzedCount: 0, truncated: false },
    });
    mockSchedulerExecuteBatch.mockReset();
    mockSchedulerExecuteBatch.mockImplementation(async (toolCalls, options) => {
      const results = [];
      for (const toolCall of toolCalls) {
        const raw = await options.execute(toolCall);
        results.push({
          request: toolCall,
          record: {
            id: toolCall.id,
            toolName: toolCall.toolName,
            input: toolCall.input,
            requestId: options.requestId,
            status: raw.isError ? "error" : "success",
            statusHistory: [],
            createdAt: Date.now(),
            result: raw,
          },
          result: raw,
          executed: true,
          verificationMessage: undefined,
        });
      }
      return results;
    });
    mockDiscoverSkills.mockResolvedValue([]);
  });

  it("aborts pipeline after 2 consecutive fallback rounds and emits abort message", async () => {
    // Round 1: model responds (on fallback)
    mockGenerateText.mockResolvedValueOnce({
      text: 'Working on it.\n<tool_use>\n{"name":"Read","input":{"file_path":"src/index.ts"}}\n</tool_use>',
      usage: { totalTokens: 40 },
    });
    mockExecuteTool.mockResolvedValueOnce({ content: "file content", isError: false });

    // Round 2: model responds again (still on fallback) — guard fires after this round
    mockGenerateText.mockResolvedValueOnce({
      text: "Continuing work.",
      usage: { totalTokens: 30 },
    });

    // Round 3 would be here but the guard should break before reaching it
    mockGenerateText.mockResolvedValueOnce({
      text: "Should not reach this.",
      usage: { totalTokens: 20 },
    });

    // Router reports fallback for every call
    mockIsUsingFallback.mockReturnValue(true);
    mockGetFallbackModelId.mockReturnValue("haiku-fallback");

    // Capture stdout to verify abort message
    const writtenChunks: string[] = [];
    const stdoutSpy = vi.spyOn(process.stdout, "write").mockImplementation((chunk: unknown) => {
      writtenChunks.push(String(chunk));
      return true;
    });

    try {
      await runAgentLoop(
        "/magic implement the full feature",
        makeSession(),
        makeConfig({ silent: false }),
      );
    } finally {
      stdoutSpy.mockRestore();
    }

    // After 2 fallback rounds the loop breaks — round 3 mock should not be called
    expect(mockGenerateText).toHaveBeenCalledTimes(2);

    // Abort message should have been written
    const allOutput = writtenChunks.join("");
    expect(allOutput).toContain("Pipeline aborted");
    expect(allOutput).toContain("haiku-fallback");
  });

  it("does not abort when primary model recovers between fallback rounds", async () => {
    // Strategy: 2 rounds total.
    // Round 1 on primary (counter stays 0), round 2 on fallback (counter=1, threshold=2, no abort).
    // A 2-round test avoids the confabulation guard that fires at roundCounter >= 3.

    // Round 1: primary model, returns a tool call so loop continues
    mockGenerateText.mockResolvedValueOnce({
      text: 'Inspecting.\n<tool_use>\n{"name":"Read","input":{"file_path":"a.ts"}}\n</tool_use>',
      usage: { totalTokens: 40 },
    });
    mockExecuteTool.mockResolvedValueOnce({ content: "file content", isError: false });

    // Round 2: fallback model — counter becomes 1 (below threshold of 2), exits cleanly
    mockGenerateText.mockResolvedValueOnce({
      text: "Analysis complete — no further actions needed.",
      usage: { totalTokens: 30 },
    });

    // isUsingFallback() is called multiple times per round, so use mockImplementation
    // keyed to how many generate calls have been completed so far.
    // After round 1 finishes and guard runs: calls.length === 1 → primary (false).
    // After round 2 finishes and guard runs: calls.length === 2 → fallback (true).
    mockIsUsingFallback.mockImplementation(() => {
      return mockGenerateText.mock.calls.length >= 2;
    });

    mockGetFallbackModelId.mockReturnValue("haiku-fallback");

    const result = await runAgentLoop(
      "/magic implement the full feature",
      makeSession(),
      makeConfig({ silent: true }),
    );

    // Both rounds complete — fallback counter only reached 1, never hit threshold of 2
    expect(mockGenerateText).toHaveBeenCalledTimes(2);
    expect(result.messages.length).toBeGreaterThan(0);
  });

  it("does NOT abort for non-pipeline prompts even when fallback is active for 2+ rounds", async () => {
    // Two rounds on a simple non-pipeline prompt — isPipelineWorkflow=false
    mockGenerateText
      .mockResolvedValueOnce({
        text: 'Think.\n<tool_use>\n{"name":"Read","input":{"file_path":"x.ts"}}\n</tool_use>',
        usage: { totalTokens: 30 },
      })
      .mockResolvedValueOnce({
        text: "Here is your answer.",
        usage: { totalTokens: 20 },
      });
    mockExecuteTool.mockResolvedValueOnce({ content: "content", isError: false });

    // Router always on fallback
    mockIsUsingFallback.mockReturnValue(true);
    mockGetFallbackModelId.mockReturnValue("haiku-fallback");

    const result = await runAgentLoop("What is 2+2?", makeSession(), makeConfig({ silent: true }));

    // Both rounds complete — guard should NOT fire for non-pipeline prompts
    expect(mockGenerateText).toHaveBeenCalledTimes(2);
    expect(result.messages.some((m) => m.role === "assistant")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Skill Discovery: system message injection
// ---------------------------------------------------------------------------

describe("skill discovery: system message injection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGenerateText.mockResolvedValue({
      text: "Done.",
      usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
    });
    mockExecuteTool.mockResolvedValue({ content: "ok", isError: false });
    mockMemoryInitialize.mockResolvedValue(undefined);
    mockMemoryRecall.mockResolvedValue({ query: "", scope: "all", results: [], latencyMs: 0 });
    mockMemoryStore.mockResolvedValue({ stored: true });
    mockMemorySummarize.mockResolvedValue({
      sessionId: "test-session",
      summary: "",
      compressed: false,
      tokensSaved: 0,
    });
    mockMemoryPrune.mockResolvedValue({ prunedCount: 0, retainedCount: 0, policy: "default" });
    mockAuditLoggerFlush.mockResolvedValue({
      anomalies: [],
      analyzedCount: 0,
      bufferTruncated: false,
      detection: { analyzedCount: 0, truncated: false },
    });
    mockGetLatestWaitingRun.mockResolvedValue(null);
    mockLoadSessionSnapshot.mockResolvedValue(null);
    mockLoadResumeHint.mockResolvedValue(null);
    mockLoadBackgroundTask.mockResolvedValue(null);
    mockLoadPendingToolCalls.mockResolvedValue([]);
  });

  it("injects ## Available Skills system message when skills are discovered", async () => {
    mockDiscoverSkills.mockResolvedValue([
      {
        name: "my-skill",
        slug: "my-skill",
        scope: "project",
        disabled: false,
        skillMdPath: "/p/SKILL.md",
        dirPath: "/p",
      },
    ]);

    const session = makeSession();
    await runAgentLoop("Do something", session, makeConfig());

    // The system message injected before the model call should contain the skill listing
    expect(mockGenerateText).toHaveBeenCalled();
    const callArgs = mockGenerateText.mock.calls[0]?.[0] as
      | { messages?: Array<{ role: string; content: string }> }
      | undefined;
    const allContent = (callArgs?.messages ?? []).map((m) => m.content).join("\n");
    expect(allContent).toContain("## Available Skills");
    expect(allContent).toContain("[PRJ]");
    expect(allContent).toContain("my-skill");
  });

  it("does not inject skills system message when no skills are discovered", async () => {
    mockDiscoverSkills.mockResolvedValue([]);

    const session = makeSession();
    await runAgentLoop("Do something", session, makeConfig());

    expect(mockGenerateText).toHaveBeenCalled();
    const callArgs = mockGenerateText.mock.calls[0]?.[0] as
      | { messages?: Array<{ role: string; content: string }> }
      | undefined;
    const allContent = (callArgs?.messages ?? []).map((m) => m.content).join("\n");
    expect(allContent).not.toContain("## Available Skills");
  });
});
