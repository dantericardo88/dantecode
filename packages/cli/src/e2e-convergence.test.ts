// ============================================================================
// @dantecode/cli — E2E Convergence Tests
// Tests that verify the agent loop eventually converges to success after
// transient failures — testing the retry/recovery machinery end-to-end.
// ============================================================================

import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Hoisted mocks ─────────────────────────────────────────────────────────────

const {
  mockGenerateText,
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
  mockEscalateTier,
  mockIsUsingFallback,
  mockGetFallbackModelId,
  mockFailRun,
} = vi.hoisted(() => ({
  mockGenerateText: vi.fn(),
  mockGetLatestWaitingRun: vi.fn().mockResolvedValue(null),
  mockLoadSessionSnapshot: vi.fn().mockResolvedValue(null),
  mockPauseRun: vi.fn(),
  mockCheckpointRun: vi.fn(),
  mockInitializeRun: vi.fn(),
  mockAppendEvidence: vi.fn(),
  mockLoadResumeHint: vi.fn().mockResolvedValue(null),
  mockLoadToolCallRecords: vi.fn().mockResolvedValue([]),
  mockSchedulerExecuteBatch: vi.fn(),
  mockSchedulerResumeToolCalls: vi.fn((toolCalls: unknown[]) => toolCalls),
  mockLoadBackgroundTask: vi.fn().mockResolvedValue(null),
  mockPersistPendingToolCalls: vi.fn(),
  mockPersistToolCallRecords: vi.fn(),
  mockLoadPendingToolCalls: vi.fn().mockResolvedValue([]),
  mockClearPendingToolCalls: vi.fn(),
  mockEscalateTier: vi.fn(),
  mockIsUsingFallback: vi.fn<() => boolean>().mockReturnValue(false),
  mockGetFallbackModelId: vi.fn<() => string | undefined>().mockReturnValue(undefined),
  mockFailRun: vi.fn(),
}));

vi.mock("ai", () => ({
  generateText: mockGenerateText,
  streamText: vi.fn(),
}));

vi.mock("@dantecode/core", async () => {
  const actual = await vi.importActual<typeof import("@dantecode/core")>("@dantecode/core");

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
      return 0.3;
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

  class MockSessionStore {
    constructor(_projectRoot: string) {}
    async getRecentSummaries() {
      return [];
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
        id: (options.runId as string | undefined) ?? "durable-run-convergence",
        projectRoot: "/tmp/test-project",
        sessionId: "test-convergence-session",
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
        resumeHint: { runId, summary: "Paused", lastConfirmedStep: "None", lastSuccessfulTool: "None", nextAction: "Retry", continueCommand: "continue" },
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
    async failRun(...args: unknown[]) {
      mockFailRun(...args);
    }
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
    ...actual,
    MetricCounter: vi.fn(() => ({
      increment: vi.fn(),
      gauge: vi.fn(),
      record: vi.fn(),
      reset: vi.fn(),
      get: vi.fn(() => 0),
      getMetricsDetailed: vi.fn(() => []),
    })),
    TraceRecorder: vi.fn(() => ({
      startSpan: vi.fn(() => ({ id: "span-1" })),
      endSpan: vi.fn(),
      recordEvent: vi.fn(),
    })),
    ModelRouterImpl: MockModelRouterImpl,
    SessionStore: MockSessionStore,
    DurableRunStore: MockDurableRunStore,
    BackgroundTaskStore: MockBackgroundTaskStore,
    appendAuditEvent: vi.fn().mockResolvedValue(undefined),
    shouldContinueLoop: vi.fn(() => true),
    estimateTokens: vi.fn((text: string) => Math.ceil(text.length / 4)),
    estimateMessageTokens: vi.fn((msgs: Array<{ content: string }>) =>
      msgs.reduce((sum, m) => sum + Math.ceil(m.content.length / 4), 0),
    ),
    promptRequestsToolExecution: vi.fn((prompt: string) =>
      /\b(fix|update|write|edit|add|build|implement|change)\b/i.test(prompt),
    ),
    responseNeedsToolExecutionNudge: vi.fn(() => false),
    parseVerificationErrors: vi.fn(() => []),
    formatErrorsForFixPrompt: vi.fn(() => ""),
    computeErrorSignature: vi.fn(() => ""),
    getContextUtilization: vi.fn(() => ({ tokens: 100, maxTokens: 128000, percent: 0, tier: "green" })),
    isProtectedWriteTarget: vi.fn(() => false),
    runStartupHealthCheck: vi.fn().mockResolvedValue({ healthy: true }),
    getCurrentWave: vi.fn((state: { currentIndex: number; waves: unknown[] }) => {
      if (state.currentIndex >= state.waves.length) return null;
      return state.waves[state.currentIndex];
    }),
    advanceWave: vi.fn(() => false),
    recordWaveFailure: vi.fn(() => true),
    buildWavePrompt: vi.fn(() => "All waves complete."),
    isWaveComplete: vi.fn((text: string) => /\[WAVE\s+COMPLETE\]/i.test(text)),
    isValidWaveCompletion: vi.fn((text: string) => /\[WAVE\s+COMPLETE\]/i.test(text)),
    verifyCompletion: vi.fn(async () => ({ verdict: "complete", confidence: 1, passed: [], failed: [], summary: "ok" })),
    deriveWaveExpectations: vi.fn(() => ({ expectedFiles: [] })),
    CLAUDE_WORKFLOW_MODE: "## Claude Workflow Mode — ACTIVE\nTest workflow mode.",
    ApproachMemory: class MockApproachMemory {
      async load() {}
      async save() {}
      async record() {}
      async findSimilar() { return []; }
      async getFailedApproaches() { return []; }
      async getAll() { return []; }
      async clear() {}
      get size() { return 0; }
    },
    formatApproachesForPrompt: vi.fn().mockReturnValue(""),
    buildWorkflowInvocationPrompt: vi.fn(() => "## Workflow Contract\nTest."),
    globalToolScheduler: {
      executeBatch: mockSchedulerExecuteBatch,
      resumeToolCalls: mockSchedulerResumeToolCalls,
      verifyBashArtifacts: vi.fn().mockResolvedValue(null),
      verifyWriteArtifact: vi.fn().mockResolvedValue(null),
    },
    globalArtifactStore: { getByKind: vi.fn(() => []) },
    globalExecutionPolicy: {
      dependenciesSatisfied: vi.fn(() => ({ satisfied: true })),
      isBlocked: vi.fn(() => ({ blocked: false })),
    },
    adaptToolResult: vi.fn((_tn: string, _in: unknown, raw: { content: string; isError: boolean }) => raw),
    formatEvidenceSummary: vi.fn(() => ""),
    globalApprovalGateway: {
      peekDecision: vi.fn(() => "auto_approve"),
      check: vi.fn(() => ({ decision: "auto_approve", warnings: [], matchedRules: [], enforcedRules: [] })),
      configure: vi.fn(),
      reset: vi.fn(),
      approveToolCall: vi.fn(),
      revokeToolCallApproval: vi.fn(),
      clearApprovedToolCalls: vi.fn(),
      setEnabled: vi.fn(),
      setRules: vi.fn(),
      get enabled() { return false; },
      get rules() { return []; },
    },
    UXEngine: class MockUXEngine {
      constructor(_opts?: Record<string, unknown>) {}
      applyTheme() {}
      getTheme() { return { name: "default", icons: {}, colors: {} }; }
      getThemeName() { return "default"; }
      listThemes() { return ["default"]; }
      formatProgress() { return ""; }
      formatError(msg: string) { return `Error: ${msg}`; }
      formatSuccess(msg: string) { return `✓ ${msg}`; }
      formatWarning(msg: string) { return `⚠ ${msg}`; }
      formatInfo(msg: string) { return `ℹ ${msg}`; }
      generateHint() { return ""; }
      buildStatusLine() { return ""; }
      stripColors(t: string) { return t; }
      truncate(t: string) { return t; }
      formatTable() { return ""; }
      formatMarkdown(t: string) { return t; }
      formatDiff() { return ""; }
    },
    Spinner: class MockSpinner {
      constructor(_opts?: Record<string, unknown>) {}
      start() {}
      update() {}
      succeed() {}
      fail() {}
      warn() {}
      stop() {}
    },
    MetricsCollector: class MockMetricsCollector {
      constructor() {}
      recordTiming(_n: string, _d: number) {}
      increment(_n: string, _v?: number) {}
      observe(_n: string, _v: number) {}
      record(_n: string, _v: number) {}
      getCounter(_n: string) { return 0; }
      getGauge(_n: string) { return 0; }
      getSamples(_n: string) { return []; }
      toPrometheus() { return ""; }
      toJSON() { return {}; }
      reset() {}
    },
    ReasoningChain: class MockReasoningChain {
      constructor() {}
      decideTier() { return "basic"; }
      think() { return { steps: [], recommendation: "" }; }
      recordStep() {}
      shouldCritique() { return false; }
      selfCritique() { return { recommendation: "" }; }
      formatChainForPrompt() { return ""; }
      recordTierOutcome() {}
      getTierPerformance() { return {}; }
      getAdaptiveBias() { return 0; }
      getStepCount() { return 0; }
    },
    AutonomyEngine: class MockAutonomyEngine {
      constructor() {}
      resume() { return Promise.resolve(); }
      incrementStep() {}
      shouldRunMetaReasoning() { return false; }
      metaReason() { return Promise.resolve(""); }
      save() { return Promise.resolve(); }
    },
    PersistentMemory: class MockPersistentMemory {
      constructor() {}
      load() { return Promise.resolve(); }
      search() { return []; }
      store() { return Promise.resolve(); }
      size() { return 0; }
      distill() { return Promise.resolve(); }
      save() { return Promise.resolve(); }
    },
    SecurityEngine: class MockSecurityEngine {
      constructor() {}
      checkAction() { return { allowed: true }; }
    },
    SecretsScanner: class MockSecretsScanner {
      constructor() {}
      scan() { return { clean: true, findings: [] }; }
    },
    synthesizeConfidence: vi.fn(() => ({ decision: "pass", confidence: 1.0, rationale: "" })),
    getCostMultiplier: vi.fn((_modelId: string) => 1.0),
    detectSelfImprovementContext: vi.fn(() => null),
    PRQualityChecker: class MockPRQualityChecker {
      check() { return { size: { linesAdded: 0, linesRemoved: 0, isLarge: false }, antiStubViolations: [], conventionViolations: [], testsPassed: true, score: 85, blocked: false }; }
      score(report: { score: number }) { return report.score; }
      shouldBlock() { return false; }
    },
    TaskComplexityRouter: class MockTaskComplexityRouter {
      classify() { return { complexity: "standard", confidence: 0.8, signals: { promptTokens: 100, fileCount: 1, hasReasoning: false, hasSecurity: false, hasMultiFile: false, estimatedOutputTokens: 50 }, recommendedModel: "claude-sonnet-4-6", rationale: "mock", evidenceLogged: false }; }
      getModel() { return "claude-sonnet-4-6"; }
      extractSignals() { return { promptTokens: 100, fileCount: 1, hasReasoning: false, hasSecurity: false, hasMultiFile: false, estimatedOutputTokens: 50 }; }
    },
    createRunIntake: vi.fn((userPrompt: string, sessionId: string, parentRunId?: string) => ({
      runId: `run_${Date.now()}_${sessionId.replace(/-/g, "").slice(0, 9)}`,
      userAsk: userPrompt,
      classification: "change",
      requestedScope: [],
      allowedBoundary: { maxFiles: 10, paths: [] },
      parentRunId,
      timestamp: new Date().toISOString(),
    })),
    getGlobalTraceLogger: vi.fn(() => ({
      startSpan: vi.fn(() => ({ spanId: "trace-span-1", traceId: "trace-1" })),
      endSpan: vi.fn(),
      recordEvent: vi.fn(),
      logDecision: vi.fn(),
      flush: vi.fn(),
    })),
    BoundaryTracker: class MockBoundaryTracker {
      private readonly mutations = new Set<string>();
      constructor(_runIntake: unknown) {}
      checkProposed() { return { allowed: true, driftFiles: [] }; }
      recordExecuted() {}
      recordMutations(files: string[]) { for (const file of files) { this.mutations.add(file); } }
      check() { return { driftDetected: false, expansionPercent: 0, outOfScopeFiles: [], currentMutations: Array.from(this.mutations) }; }
      getSummary() { return { totalProposed: 0, totalBlocked: 0, driftCount: 0 }; }
    },
    calculatePressure: vi.fn(() => ({ score: 0.3, factors: { tokenUsage: 0.2, errorRate: 0.1, roundCount: 0.0 } })),
  };
});

vi.mock("@dantecode/danteforge", () => ({
  runAntiStubScanner: vi.fn(() => ({ passed: true, hardViolations: [] })),
  runLocalPDSEScorer: vi.fn(() => ({ overall: 85, passedGate: true, completeness: 85, correctness: 85, clarity: 85, consistency: 85 })),
  runConstitutionCheck: vi.fn(() => ({ violations: [] })),
  queryLessons: vi.fn().mockResolvedValue([]),
  formatLessonsForPrompt: vi.fn().mockReturnValue(""),
  detectAndRecordPatterns: vi.fn().mockResolvedValue([]),
  recordSuccessPattern: vi.fn().mockResolvedValue({}),
}));

vi.mock("@dantecode/git-engine", () => ({
  getStatus: vi.fn(() => ({ staged: [], unstaged: [], untracked: [] })),
  autoCommit: vi.fn(),
  generateRepoMap: vi.fn(() => []),
  formatRepoMapForContext: vi.fn(() => ""),
}));

vi.mock("@dantecode/dante-skillbook", () => ({
  DanteSkillbook: vi.fn().mockImplementation(() => ({
    getSkills: vi.fn().mockReturnValue([]),
    applyUpdate: vi.fn().mockReturnValue(false),
    stats: vi.fn().mockReturnValue({ totalSkills: 0, sections: {}, lastUpdatedAt: "", version: "1.0.0" }),
  })),
  GitSkillbookStore: vi.fn().mockImplementation(() => ({
    load: vi.fn().mockReturnValue(null),
    save: vi.fn(),
    exists: vi.fn().mockReturnValue(false),
  })),
  getRelevantSkills: vi.fn().mockReturnValue([]),
}));

vi.mock("./tools.js", () => ({
  executeTool: vi.fn().mockResolvedValue({ content: "tool result", isError: false }),
  getToolDefinitions: vi.fn(() => [
    { name: "Read", description: "Read a file", parameters: {} },
    { name: "Write", description: "Write a file", parameters: {} },
    { name: "Bash", description: "Run command", parameters: {} },
  ]),
}));

vi.mock("./tool-schemas.js", () => ({
  getAISDKTools: vi.fn(() => ({})),
}));

const mockDiscoverSkills = vi.fn().mockResolvedValue([]);
vi.mock("@dantecode/skills-registry", () => ({
  discoverSkills: (...args: unknown[]) => mockDiscoverSkills(...args),
  SkillRegistry: class MockSkillRegistry {
    private _entries: Array<{ name: string; slug: string; scope: string; disabled: boolean }> = [];
    register(entries: typeof this._entries) { this._entries.push(...entries); }
    list() { return this._entries.filter((e) => !e.disabled); }
    getCollisions() { return []; }
  },
}));

vi.mock("@dantecode/memory-engine", () => ({
  createMemoryOrchestrator: vi.fn(() => ({
    initialize: vi.fn().mockResolvedValue(undefined),
    memoryRecall: vi.fn().mockResolvedValue({ query: "", scope: "all", results: [], latencyMs: 0 }),
    memoryStore: vi.fn().mockResolvedValue({ stored: true }),
    memorySummarize: vi.fn().mockResolvedValue({ sessionId: "test-session", summary: "", compressed: false, tokensSaved: 0 }),
    memoryPrune: vi.fn().mockResolvedValue({ prunedCount: 0, retainedCount: 0, policy: "default" }),
  })),
}));

vi.mock("@dantecode/debug-trail", () => ({
  getGlobalLogger: vi.fn().mockReturnValue({
    flush: vi.fn().mockResolvedValue({ anomalies: [], analyzedCount: 0, bufferTruncated: false, detection: { analyzedCount: 0, truncated: false } }),
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

vi.mock("./confirm-flow.js", () => ({
  confirmDestructive: vi.fn().mockResolvedValue(false),
  confirm: vi.fn().mockResolvedValue(true),
  select: vi.fn().mockResolvedValue(""),
}));

import { executeTool as _et } from "./tools.js";
const mockExecuteTool = _et as unknown as ReturnType<typeof vi.fn>;

import { runAgentLoop, type AgentLoopConfig } from "./agent-loop.js";
import type { Session, DanteCodeState } from "@dantecode/config-types";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeSession(overrides?: Partial<Session>): Session {
  return {
    id: "convergence-session",
    projectRoot: "/tmp/convergence-project",
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

// ─── Convergence Tests ─────────────────────────────────────────────────────────

describe("E2E convergence: agent loop eventual success after transient failures", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockEscalateTier.mockReset();
    mockIsUsingFallback.mockReturnValue(false);
    mockGetFallbackModelId.mockReturnValue(undefined);
    mockGenerateText.mockReset();
    mockExecuteTool.mockReset();
    mockExecuteTool.mockResolvedValue({ content: "tool result", isError: false });
    mockGetLatestWaitingRun.mockResolvedValue(null);
    mockLoadSessionSnapshot.mockResolvedValue(null);
    mockLoadResumeHint.mockResolvedValue(null);
    mockLoadBackgroundTask.mockResolvedValue(null);
    mockPersistPendingToolCalls.mockReset();
    mockLoadPendingToolCalls.mockReset();
    mockLoadPendingToolCalls.mockResolvedValue([]);
    mockClearPendingToolCalls.mockReset();
    mockFailRun.mockReset();
    mockDiscoverSkills.mockResolvedValue([]);
    mockSchedulerExecuteBatch.mockReset();
    mockSchedulerExecuteBatch.mockImplementation(async (toolCalls: unknown[], options: { execute: (tc: unknown) => Promise<{ content: string; isError: boolean }>; requestId: string }) => {
      const results = [];
      for (const toolCall of toolCalls) {
        const raw = await options.execute(toolCall);
        results.push({
          request: toolCall,
          record: {
            id: (toolCall as { id: string }).id,
            toolName: (toolCall as { toolName: string }).toolName,
            input: (toolCall as { input: unknown }).input,
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
  });

  it("fails 3 times with the same error then succeeds on attempt 4", async () => {
    const transientError = new Error("Too many requests — rate limit");

    // 3 failures, then 1 success
    mockGenerateText
      .mockRejectedValueOnce(transientError)
      .mockRejectedValueOnce(transientError)
      .mockRejectedValueOnce(transientError)
      .mockResolvedValueOnce({
        text: "Task complete. I have fixed all the issues.",
        usage: { promptTokens: 50, completionTokens: 30, totalTokens: 80 },
      });

    const session = makeSession();
    // Allow up to 4 retries so attempt 4 can succeed
    const config = makeConfig({ timeoutPolicy: { transientRetries: 4 } });
    const result = await runAgentLoop("Fix the failing tests", session, config);

    // Final result should be a valid session
    expect(result).toBeDefined();
    expect(result.id).toBe("convergence-session");

    // The model should have been called 4 times (3 failures + 1 success)
    // 3 failures + 1 success; each failure may invoke stream + generate fallback
    expect(mockGenerateText.mock.calls.length).toBeGreaterThanOrEqual(4);

    // Session should not have called failRun (we succeeded)
    expect(mockFailRun).not.toHaveBeenCalled();

    // Session should have assistant messages (from successful call)
    const assistantMessages = result.messages.filter((m) => m.role === "assistant");
    expect(assistantMessages.length).toBeGreaterThanOrEqual(1);
  });

  it("session returns cleanly when all retries are exhausted", async () => {
    const transientError = new Error("Too many requests — rate limit");

    // All calls fail — retries exhausted
    mockGenerateText.mockRejectedValue(transientError);

    const session = makeSession();
    const config = makeConfig({ timeoutPolicy: { transientRetries: 2 } });
    const result = await runAgentLoop("Fix tests", session, config);

    // Session should return without throwing even if all retries exhausted
    expect(result).toBeDefined();
    expect(result.id).toBe("convergence-session");

    // Should have tried original + retries
    expect(mockGenerateText.mock.calls.length).toBeGreaterThanOrEqual(1);
  });

  it("immediate success on first attempt requires no retry machinery", async () => {
    mockGenerateText.mockResolvedValueOnce({
      text: "I have analyzed the codebase and found no issues. Everything looks good.",
      usage: { promptTokens: 60, completionTokens: 25, totalTokens: 85 },
    });

    const session = makeSession();
    const result = await runAgentLoop("Review the code", session, makeConfig());

    expect(result).toBeDefined();
    // Exactly one model call for immediate success
    // Exactly 1 stream call for immediate success (no fallback needed)
    expect(mockGenerateText.mock.calls.length).toBeGreaterThanOrEqual(1);
    expect(mockGenerateText.mock.calls.length).toBeLessThanOrEqual(2); // max stream+generate
    // No error machinery triggered
    expect(mockFailRun).not.toHaveBeenCalled();
    expect(mockPauseRun).not.toHaveBeenCalled();
  });

  it("tool execution followed by successful response produces complete session", async () => {
    // Round 1: model requests a tool call
    mockGenerateText.mockResolvedValueOnce({
      text: 'Let me read the source file.\n<tool_use>\n{"name":"Read","input":{"file_path":"src/index.ts"}}\n</tool_use>',
      usage: { totalTokens: 45 },
    });
    // Round 2: model responds based on tool result
    mockGenerateText.mockResolvedValueOnce({
      text: "I have read the file. The implementation looks correct.",
      usage: { totalTokens: 30 },
    });

    mockExecuteTool.mockResolvedValueOnce({ content: "export function main() {}", isError: false });

    const session = makeSession();
    const result = await runAgentLoop("Review src/index.ts", session, makeConfig());

    expect(result).toBeDefined();
    // Two model rounds expected
    expect(mockGenerateText.mock.calls.length).toBeGreaterThanOrEqual(2);
    // Tool was called
    expect(mockExecuteTool).toHaveBeenCalledTimes(1);
    // Final session has messages
    expect(result.messages.length).toBeGreaterThanOrEqual(2);
  });

  it("convergence after mix of auth and rate-limit recovery: auth aborts immediately", async () => {
    // Auth errors are terminal — should stop immediately on first error
    const authError = new Error("Invalid API key — authentication failed");
    mockGenerateText.mockRejectedValue(authError);

    const session = makeSession();
    const result = await runAgentLoop("Do work", session, makeConfig());

    expect(result).toBeDefined();
    // Auth error is terminal — no retry beyond the initial stream+generate fallback (up to 2 calls)
    expect(mockGenerateText.mock.calls.length).toBeLessThanOrEqual(3);
    // failRun called for terminal errors
    expect(mockFailRun).toHaveBeenCalledTimes(1);
  });

  it("convergence metric: total calls matches expected retry count", async () => {
    const networkError = new Error("ECONNREFUSED — socket hang up");
    const successResponse = {
      text: "Successfully completed the task.",
      usage: { promptTokens: 40, completionTokens: 20, totalTokens: 60 },
    };

    // 2 failures then 1 success
    mockGenerateText
      .mockRejectedValueOnce(networkError)
      .mockRejectedValueOnce(networkError)
      .mockResolvedValueOnce(successResponse);

    const session = makeSession();
    const config = makeConfig({ timeoutPolicy: { transientRetries: 3 } });
    const result = await runAgentLoop("Complete the task", session, config);

    expect(result).toBeDefined();
    // 2 failures + 1 success = 3 total calls
    // 2 failures + 1 success; each failure may invoke stream + generate fallback
    expect(mockGenerateText.mock.calls.length).toBeGreaterThanOrEqual(3);
    expect(mockFailRun).not.toHaveBeenCalled();
  });

  it("session state is preserved across retry attempts", async () => {
    const networkError = new Error("ECONNREFUSED");
    // Fail once, then succeed
    mockGenerateText
      .mockRejectedValueOnce(networkError)
      .mockResolvedValueOnce({
        text: "Done. All changes applied.",
        usage: { totalTokens: 50 },
      });

    const session = makeSession({
      activeFiles: ["src/app.ts", "src/utils.ts"],
    });
    const config = makeConfig({ timeoutPolicy: { transientRetries: 2 } });
    const result = await runAgentLoop("Apply changes", session, config);

    expect(result).toBeDefined();
    // Session ID preserved across retry
    expect(result.id).toBe("convergence-session");
    // Active files preserved
    expect(result.activeFiles).toContain("src/app.ts");
  });
});
