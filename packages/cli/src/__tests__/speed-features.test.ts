// ============================================================================
// @dantecode/cli — Speed-to-Verified-Completion Feature Tests
// Proves:
//   1. Hot context from repo memory injected into system prompt when available
//   2. Hot context absent when loadRepoMemory returns null
//   3. BoundedRepairLoop.attemptRepair called when a Bash tool returns isError
//   4. executionLedger.toolCallRecords populated after tool use
// ============================================================================

import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Mock providers (hoisted before module init) ─────────────────────────────

const { mockGenerateText, mockExecuteTool, mockLoadRepoMemory, mockAttemptRepair } =
  vi.hoisted(() => ({
    mockGenerateText: vi.fn(),
    mockExecuteTool: vi.fn().mockResolvedValue({ content: "processed", isError: false }),
    mockLoadRepoMemory: vi.fn().mockResolvedValue(null),
    mockAttemptRepair: vi.fn().mockResolvedValue(null),
  }));

vi.mock("ai", () => ({
  generateText: mockGenerateText,
  streamText: vi.fn(),
}));

vi.mock("node:fs/promises", () => ({
  readFile: vi.fn().mockRejectedValue(Object.assign(new Error("ENOENT"), { code: "ENOENT" })),
  writeFile: vi.fn().mockResolvedValue(undefined),
  mkdir: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@dantecode/core", () => {
  class MockModelRouterImpl {
    constructor(_config: unknown, _root: string, _sid: string) {}
    async generate(messages: Array<{ role: string; content: string }>, options?: { system?: string }) {
      const result = await mockGenerateText({ messages, system: options?.system });
      return result.text;
    }
    async stream(messages: Array<{ role: string; content: string }>, options?: { system?: string }) {
      const result = await mockGenerateText({ messages, system: options?.system });
      return {
        textStream: (async function* () {
          yield result.text;
        })(),
      };
    }
    extractModelComplexityRating() { return 0.3; }
    getModelRatedComplexity() { return null; }
    analyzeComplexity() { return 0.3; }
    forceCapable() {}
    escalateTier() {}
    selectTier() { return "fast"; }
    recordRequestCost() {}
    resetSessionCost() {}
  }

  class MockSessionStore {
    constructor(_root: string) {}
    async getRecentSummaries() { return []; }
    async list() { return []; }
    async load() { return null; }
    async save() {}
  }

  return {
    ModelRouterImpl: MockModelRouterImpl,
    SessionStore: MockSessionStore,
    appendAuditEvent: vi.fn().mockResolvedValue(undefined),
    shouldContinueLoop: vi.fn(() => true),
    estimateTokens: vi.fn((t: string) => Math.ceil(t.length / 4)),
    estimateMessageTokens: vi.fn((msgs: Array<{ content: string }>) =>
      msgs.reduce((sum, m) => sum + Math.ceil(m.content.length / 4), 0),
    ),
    promptRequestsToolExecution: vi.fn(() => false),
    responseNeedsToolExecutionNudge: vi.fn(() => false),
    parseVerificationErrors: vi.fn(() => []),
    formatErrorsForFixPrompt: vi.fn(() => ""),
    computeErrorSignature: vi.fn(() => ""),
    getContextUtilization: vi.fn(() => ({ tokens: 100, maxTokens: 128000, percent: 0, tier: "green" })),
    compactTextTranscript: vi.fn((messages: unknown[]) => ({ messages, strategy: "none", droppedMessages: 0 })),
    truncateToolOutput: vi.fn((c: string) => c),
    getProviderPromptSupplement: vi.fn().mockReturnValue(""),
    isProtectedWriteTarget: vi.fn(() => false),
    runStartupHealthCheck: vi.fn().mockResolvedValue({ healthy: true }),
    getCurrentWave: vi.fn(() => null),
    advanceWave: vi.fn(() => false),
    recordWaveFailure: vi.fn(() => true),
    buildWavePrompt: vi.fn(() => "All waves complete."),
    isWaveComplete: vi.fn(() => false),
    CLAUDE_WORKFLOW_MODE: "",
    ApproachMemory: class {
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
    generateRepoMemory: vi.fn().mockResolvedValue(""),
    loadRepoMemory: mockLoadRepoMemory,
    BoundedRepairLoop: class {
      constructor(_maxRetries?: number, _policy?: string) {}
      async attemptRepair(errorOutput: string, projectRoot: string) {
        return mockAttemptRepair(errorOutput, projectRoot);
      }
    },
    evaluationLab: { runBenchmark: vi.fn().mockResolvedValue({ results: [] }) },
    runSecurityAudit: vi.fn().mockResolvedValue({ vulnerabilities: [], complianceScore: 100, lastAudit: "" }),
    chaosTester: { runChaosTest: vi.fn().mockResolvedValue({ overallSuccess: true, results: [] }) },
    recordToolCall: vi.fn().mockResolvedValue(undefined),
    recordMutation: vi.fn().mockResolvedValue(undefined),
    recordValidation: vi.fn().mockResolvedValue(undefined),
    recordCompletionGate: vi.fn().mockResolvedValue(undefined),
    UndoStack: class MockUndoStack {
      push(_op: unknown) {}
      pop() { return null; }
      get size() { return 0; }
      clear() {}
    },
    decomposeTask: vi.fn().mockResolvedValue({ tasks: [], parallelGroups: [], strategy: "default" }),
    buildParallelGroups: vi.fn().mockReturnValue([]),
    hasFileConflict: vi.fn().mockReturnValue(false),
    getCoChangeFiles: vi.fn().mockResolvedValue([]),
    createFileSnapshot: vi.fn().mockResolvedValue({ filePath: "", content: "", hash: "" }),
    ProjectKnowledgeStore: class MockProjectKnowledgeStore {
      constructor(_root: string) {}
      async load() { return null; }
      async save() {}
      async addDocument() {}
      async search() { return []; }
      async getAll() { return []; }
    },
    classifyRisk: vi.fn().mockReturnValue({ level: "low", reasons: [] }),
    buildApprovalRequest: vi.fn().mockReturnValue({ id: "mock-id", description: "", riskLevel: "low", changes: [] }),
    AutonomyMetricsTracker: class MockAutonomyMetricsTracker {
      constructor(_projectRoot: string) {}
      start() {}
      recordToolCall(_toolName: string) {}
      recordCompletion(_status: string) {}
      getMetrics() { return { toolCalls: 0, duration: 0, status: "complete" }; }
    },
    AutonomyOrchestrator: class MockAutonomyOrchestrator {
      constructor(_opts?: unknown) {}
      async run(_session: unknown) { return { verified: true, rounds: 0 }; }
    },
    LoopDetector: class MockLoopDetector {
      constructor(_opts?: unknown) {}
      recordAction(_type: string, _content: string) { return { stuck: false, iterationCount: 1 }; }
    },
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

vi.mock("../tools.js", () => ({
  executeTool: mockExecuteTool,
  getToolDefinitions: vi.fn(() => [
    { name: "Bash", description: "Run command", parameters: {} },
  ]),
}));

vi.mock("../tool-schemas.js", () => ({
  getAISDKTools: vi.fn(() => ({})),
}));

// ─── Imports ─────────────────────────────────────────────────────────────────

import { runAgentLoop, type AgentLoopConfig } from "../agent-loop.js";
import type { Session, DanteCodeState } from "@dantecode/config-types";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeSession(): Session {
  return {
    id: "speed-test-session",
    projectRoot: "/tmp/speed-test",
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

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("Speed-to-Verified-Completion Features", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockExecuteTool.mockResolvedValue({ content: "processed", isError: false });
    mockLoadRepoMemory.mockResolvedValue(null);
    mockAttemptRepair.mockResolvedValue(null);
  });

  // ─── Hot Context from Repo Memory ──────────────────────────────────

  it("injects hot context from repo memory into system prompt", async () => {
    mockLoadRepoMemory.mockResolvedValue({
      hotspots: [
        { file: "src/main.ts", changeCount: 15 },
        { file: "src/utils.ts", changeCount: 8 },
      ],
      symbolGraph: [],
      testMap: [],
    });

    mockGenerateText.mockResolvedValue({
      text: "The analysis has been processed.",
      usage: { promptTokens: 100, completionTokens: 20, totalTokens: 120 },
    });

    await runAgentLoop("analyze the codebase", makeSession(), makeConfig());

    // The system prompt is passed as options.system to router.generate()
    const calls = mockGenerateText.mock.calls;
    expect(calls.length).toBeGreaterThan(0);
    const systemPrompt = calls[0]![0]!.system as string;
    expect(systemPrompt).toBeDefined();
    expect(systemPrompt).toContain("Hot Context from Repo Memory");
    expect(systemPrompt).toContain("src/main.ts");
  }, 15000);

  it("skips hot context injection when repo memory is null", async () => {
    // mockLoadRepoMemory already returns null from beforeEach

    mockGenerateText.mockResolvedValue({
      text: "The analysis has been processed.",
      usage: { promptTokens: 100, completionTokens: 20, totalTokens: 120 },
    });

    await runAgentLoop("analyze the codebase", makeSession(), makeConfig());

    const calls = mockGenerateText.mock.calls;
    expect(calls.length).toBeGreaterThan(0);
    const systemPrompt = calls[0]![0]!.system as string | undefined;
    // systemPrompt may be undefined or not contain the hot context section
    if (systemPrompt) {
      expect(systemPrompt).not.toContain("Hot Context from Repo Memory");
    }
  });

  // ─── Automatic Bounded Repair ───────────────────────────────────────

  it("calls BoundedRepairLoop.attemptRepair when a Bash tool returns isError", async () => {
    // Round 1: model returns a Bash tool call
    mockGenerateText.mockResolvedValueOnce({
      text: 'Running typecheck.\n<tool_use>\n{"name":"Bash","input":{"command":"npm run typecheck"}}\n</tool_use>',
      usage: { promptTokens: 50, completionTokens: 50, totalTokens: 100 },
    });
    // Round 2: final response after repair
    mockGenerateText.mockResolvedValueOnce({
      text: "The typecheck has been processed.",
      usage: { promptTokens: 80, completionTokens: 20, totalTokens: 100 },
    });

    // Bash tool returns an error — triggers repair loop
    mockExecuteTool.mockResolvedValueOnce({
      content: "error TS2322: Type 'string' is not assignable to type 'number'",
      isError: true,
    });

    await runAgentLoop("fix typecheck errors", makeSession(), makeConfig());

    expect(mockAttemptRepair).toHaveBeenCalledWith(
      expect.stringContaining("TS2322"),
      expect.any(String),
    );
  });

  // ─── Execution Ledger Tracking ─────────────────────────────────────

  it("executionLedger.toolCallRecords populated after tool use", async () => {
    // Round 1: model calls a Bash tool
    mockGenerateText.mockResolvedValueOnce({
      text: 'Checking files.\n<tool_use>\n{"name":"Bash","input":{"command":"ls src/"}}\n</tool_use>',
      usage: { promptTokens: 50, completionTokens: 50, totalTokens: 100 },
    });
    // Round 2: final response
    mockGenerateText.mockResolvedValueOnce({
      text: "The listing has been processed.",
      usage: { promptTokens: 80, completionTokens: 20, totalTokens: 100 },
    });

    const session = makeSession();
    await runAgentLoop("list source files", session, makeConfig());

    expect(session.executionLedger).toBeDefined();
    expect(session.executionLedger!.toolCallRecords.length).toBeGreaterThanOrEqual(1);
    const bashRecord = session.executionLedger!.toolCallRecords.find(
      (r) => r.toolName === "Bash",
    );
    expect(bashRecord).toBeDefined();
  });

  // ─── Pending / Future Tests ─────────────────────────────────────────

  // ─── Parallel Safe-Tool Batching ───────────────────────────────────
  // Covers both: "executes multiple safe tools in parallel" AND
  //              "maintains deterministic result ordering for concurrent tool calls"

  it("executes multiple safe tools in parallel and preserves result ordering", async () => {
    // Round 1: two SAFE_TOOLS calls (Read + Glob) in the same model turn
    mockGenerateText.mockResolvedValueOnce({
      text: [
        "Checking files.",
        "<tool_use>",
        '{"name":"Read","input":{"file_path":"/tmp/speed-test/src/a.ts"}}',
        "</tool_use>",
        "<tool_use>",
        '{"name":"Glob","input":{"pattern":"**/*.ts"}}',
        "</tool_use>",
      ].join("\n"),
      usage: { promptTokens: 50, completionTokens: 50, totalTokens: 100 },
    });
    // Round 2: final response
    mockGenerateText.mockResolvedValueOnce({
      text: "Both files processed.",
      usage: { promptTokens: 80, completionTokens: 20, totalTokens: 100 },
    });

    // Different content per call so we can distinguish them in the ledger
    mockExecuteTool
      .mockResolvedValueOnce({ content: "content-of-a-ts", isError: false })
      .mockResolvedValueOnce({ content: "glob-results-list", isError: false });

    const session = makeSession();
    await runAgentLoop("read files", session, makeConfig());

    const records = session.executionLedger?.toolCallRecords ?? [];
    expect(records.length).toBeGreaterThanOrEqual(2);

    const names = records.map((r) => r.toolName);
    expect(names).toContain("Read");
    expect(names).toContain("Glob");

    // Order preserved: Read before Glob (mirrors order in model response)
    expect(names.indexOf("Read")).toBeLessThan(names.indexOf("Glob"));
  });

  // ─── Symbol Injection ───────────────────────────────────────────────

  it("includes symbols from active files in system prompt context", async () => {
    mockLoadRepoMemory.mockResolvedValue({
      hotspots: [],
      symbolGraph: [{ name: "AuthService", kind: "class", file: "src/auth.ts" }],
      testMap: [],
    });

    mockGenerateText.mockResolvedValue({
      text: "Symbol analysis complete.",
      usage: { promptTokens: 100, completionTokens: 20, totalTokens: 120 },
    });

    const session = makeSession();
    session.activeFiles = ["src/auth.ts"];

    await runAgentLoop("inspect symbols", session, makeConfig());

    const systemPrompt = mockGenerateText.mock.calls[0]![0]!.system as string;
    expect(systemPrompt).toBeDefined();
    expect(systemPrompt).toContain("Symbols in active files:");
    expect(systemPrompt).toContain("AuthService");
  });

  // ─── Repair Loop Success Path ───────────────────────────────────────

  it("marks tool as successful when repair succeeds", async () => {
    // Round 1: Bash typecheck — triggers repair loop
    mockGenerateText.mockResolvedValueOnce({
      text: '<tool_use>\n{"name":"Bash","input":{"command":"npm run typecheck"}}\n</tool_use>',
      usage: { promptTokens: 50, completionTokens: 50, totalTokens: 100 },
    });
    // Round 2: final response after repair
    mockGenerateText.mockResolvedValueOnce({
      text: "Typecheck fixed.",
      usage: { promptTokens: 80, completionTokens: 20, totalTokens: 100 },
    });

    // Bash returns error — repair loop activates
    mockExecuteTool.mockResolvedValueOnce({
      content: "error TS2322: Type mismatch",
      isError: true,
    });

    // Repair succeeds — agent-loop sets result.isError = false before persisting the record
    mockAttemptRepair.mockResolvedValueOnce({
      result: "success",
      attemptNumber: 1,
      plan: { strategy: "direct-fix" },
    });

    const session = makeSession();
    await runAgentLoop("fix type errors", session, makeConfig());

    const bashRecord = session.executionLedger?.toolCallRecords.find(
      (r) => r.toolName === "Bash",
    );
    expect(bashRecord).toBeDefined();
    // Repair succeeded → isError must be false in the persisted record
    expect(bashRecord!.result.isError).toBe(false);
  });

  // ─── Timing Metric ──────────────────────────────────────────────────

  it("records time to first mutation in speedMetrics", async () => {
    // Round 1: Write tool call (produces a mutationRecord)
    mockGenerateText.mockResolvedValueOnce({
      text: '<tool_use>\n{"name":"Write","input":{"file_path":"/tmp/speed-test/out.ts","content":"export {}"}}\n</tool_use>',
      usage: { promptTokens: 50, completionTokens: 50, totalTokens: 100 },
    });
    // Round 2: final response
    mockGenerateText.mockResolvedValueOnce({
      text: "File written.",
      usage: { promptTokens: 80, completionTokens: 20, totalTokens: 100 },
    });

    // Write tool returns a mutation record — firstMutationTime must be captured
    mockExecuteTool.mockResolvedValueOnce({
      content: "File written successfully.",
      isError: false,
      mutationRecords: [
        { path: "/tmp/speed-test/out.ts", type: "write", before: null, after: "export {}" },
      ],
    });

    const session = makeSession();
    await runAgentLoop("write output file", session, makeConfig());

    const metrics = session.executionLedger?.speedMetrics;
    expect(metrics).toBeDefined();
    // firstMutationTime was assigned when the mutation was recorded
    expect(metrics!.timeToFirstMutation).not.toBeNull();
    expect(typeof metrics!.timeToFirstMutation).toBe("number");
    expect(metrics!.timeToFirstMutation).toBeGreaterThanOrEqual(0);
  });
});
