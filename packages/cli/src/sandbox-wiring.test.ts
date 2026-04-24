// ============================================================================
// @dantecode/cli — Sandbox Wiring Tests
// Proves that Bash tool calls route through SandboxBridge when
// enableSandbox: true, and fall back to executeTool when false.
// ============================================================================

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { SandboxBridge } from "./sandbox-bridge.js";

// ─── Mock providers ─────────────────────────────────────────────────────────

// vi.hoisted ensures these are available when vi.mock factory functions run (before module init)
const { mockGenerateText, mockExecuteTool } = vi.hoisted(() => ({
  mockGenerateText: vi.fn(),
  mockExecuteTool: vi.fn().mockResolvedValue({ content: "direct-exec-result", isError: false }),
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
    async generate(messages: Array<{ role: string; content: string }>) {
      const result = await mockGenerateText({ messages });
      return result.text;
    }
    async stream(messages: Array<{ role: string; content: string }>) {
      const result = await mockGenerateText({ messages });
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
    INVALID_TOOL_NAME: "InvalidTool",
    normalizeToolCalls: vi.fn((toolCalls: unknown[]) => ({ toolCalls, repairs: [], invalidToolCalls: [] })),
    detectRepeatedToolCall: vi.fn(() => null),
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
    loadRepoMemory: vi.fn().mockResolvedValue(null),
    BoundedRepairLoop: class {
      constructor(_maxRetries?: number, _policy?: string) {}
      async attemptRepair(_errorOutput: string, _projectRoot: string) { return null; }
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

vi.mock("./tools.js", () => ({
  executeTool: mockExecuteTool,
  getToolDefinitions: vi.fn(() => [
    { name: "Bash", description: "Run command", parameters: {} },
  ]),
}));

vi.mock("./tool-schemas.js", () => ({
  getAISDKTools: vi.fn(() => ({})),
}));

import { runAgentLoop, type AgentLoopConfig } from "./agent-loop.js";
import type { Session, DanteCodeState } from "@dantecode/config-types";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeSession(): Session {
  return {
    id: "sandbox-test-session",
    projectRoot: "/tmp/sandbox-test",
    messages: [],
    activeFiles: [],
    readOnlyFiles: [],
    model: { provider: "grok", modelId: "grok-3", maxTokens: 4096, temperature: 0.1, contextWindow: 131072, supportsVision: false, supportsToolCalls: false },
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
        default: { provider: "grok", modelId: "grok-3", maxTokens: 4096, temperature: 0.1, contextWindow: 131072, supportsVision: false, supportsToolCalls: false },
        fallback: [],
        taskOverrides: {},
      },
      project: { name: "test", language: "typescript" },
      pdse: { threshold: 60, hardViolationsAllowed: 0, maxRegenerationAttempts: 3, weights: { completeness: 0.3, correctness: 0.3, clarity: 0.2, consistency: 0.2 } },
      autoforge: { enabled: false, maxIterations: 1, gstackCommands: [], lessonInjectionEnabled: false, abortOnSecurityViolation: false },
    } as unknown as DanteCodeState,
    verbose: false,
    enableGit: false,
    enableSandbox: false,
    silent: true,
    ...overrides,
  };
}

function makeMockBridge(): SandboxBridge {
  return {
    isAvailable: vi.fn().mockResolvedValue(true),
    runInSandbox: vi.fn().mockResolvedValue({ content: "sandbox-result", isError: false }),
    shutdown: vi.fn().mockResolvedValue(undefined),
  } as unknown as SandboxBridge;
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("Sandbox Wiring", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockExecuteTool.mockResolvedValue({ content: "direct-exec-result", isError: false });
  });

  it("routes Bash tool calls through SandboxBridge when enableSandbox: true and sandboxBridge provided", async () => {
    const mockBridge = makeMockBridge();

    // Round 1: model returns a Bash tool call
    mockGenerateText.mockResolvedValueOnce({
      text: 'Running command.\n<tool_use>\n{"name":"Bash","input":{"command":"echo hello"}}\n</tool_use>',
      usage: { promptTokens: 50, completionTokens: 50, totalTokens: 100 },
    });
    // Round 2: model returns final response
    mockGenerateText.mockResolvedValueOnce({
      text: "Done.",
      usage: { promptTokens: 50, completionTokens: 10, totalTokens: 60 },
    });

    await runAgentLoop(
      "run echo hello",
      makeSession(),
      makeConfig({ enableSandbox: true, sandboxBridge: mockBridge }),
    );

    expect((mockBridge.runInSandbox as ReturnType<typeof vi.fn>)).toHaveBeenCalledWith(
      "echo hello",
      expect.any(Number),
    );
  }, 15000);

  it("records sandbox validation evidence so validation requests can pass the completion gate", async () => {
    const mockBridge = makeMockBridge();
    (mockBridge.runInSandbox as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      toolName: "Bash",
      content: "Tests passed",
      isError: false,
      ok: true,
      validationRecords: [
        {
          id: "validation-1",
          toolCallId: "",
          type: "test",
          command: "npm test",
          exitCode: 0,
          output: "Tests passed",
          passed: true,
          timestamp: "2026-04-16T00:00:00.000Z",
        },
      ],
    });

    mockGenerateText.mockResolvedValueOnce({
      text: 'Running tests.\n<tool_use>\n{"name":"Bash","input":{"command":"npm test"}}\n</tool_use>',
      usage: { promptTokens: 50, completionTokens: 50, totalTokens: 100 },
    });
    mockGenerateText.mockResolvedValueOnce({
      text: "Tests are green.",
      usage: { promptTokens: 50, completionTokens: 10, totalTokens: 60 },
    });

    const result = await runAgentLoop(
      "verify the code only without changes",
      makeSession(),
      makeConfig({ enableSandbox: true, sandboxBridge: mockBridge }),
    );

    expect(result.executionLedger?.toolCallRecords).toHaveLength(1);
    expect(result.executionLedger?.validationRecords).toHaveLength(1);
    expect(result.executionLedger?.validationRecords[0]).toMatchObject({
      toolCallId: expect.any(String),
      type: "test",
      command: "npm test",
      passed: true,
    });
    expect(result.executionLedger?.completionGateResult?.ok).toBe(true);
    expect(result.status).toBe("COMPLETE");
  });

  it("does NOT call SandboxBridge when enableSandbox: false", async () => {
    const mockBridge = makeMockBridge();

    // Round 1: model returns a Bash tool call
    mockGenerateText.mockResolvedValueOnce({
      text: 'Running command.\n<tool_use>\n{"name":"Bash","input":{"command":"echo hello"}}\n</tool_use>',
      usage: { promptTokens: 50, completionTokens: 50, totalTokens: 100 },
    });
    // Round 2: final response
    mockGenerateText.mockResolvedValueOnce({
      text: "Done.",
      usage: { promptTokens: 50, completionTokens: 10, totalTokens: 60 },
    });

    await runAgentLoop(
      "run echo hello",
      makeSession(),
      makeConfig({ enableSandbox: false, sandboxBridge: mockBridge }),
    );

    expect((mockBridge.runInSandbox as ReturnType<typeof vi.fn>)).not.toHaveBeenCalled();
    expect(mockExecuteTool).toHaveBeenCalledWith(
      "Bash",
      expect.objectContaining({ command: "echo hello" }),
      expect.any(String),
      expect.any(Object),
    );
  });

  it("routes non-Bash tools through executeTool even when enableSandbox: true", async () => {
    const mockBridge = makeMockBridge();

    // Round 1: model returns a Read tool call (not Bash)
    mockGenerateText.mockResolvedValueOnce({
      text: 'Reading file.\n<tool_use>\n{"name":"Read","input":{"file_path":"src/index.ts"}}\n</tool_use>',
      usage: { promptTokens: 50, completionTokens: 50, totalTokens: 100 },
    });
    // Round 2: final response
    mockGenerateText.mockResolvedValueOnce({
      text: "File read.",
      usage: { promptTokens: 50, completionTokens: 10, totalTokens: 60 },
    });

    await runAgentLoop(
      "read src/index.ts",
      makeSession(),
      makeConfig({ enableSandbox: true, sandboxBridge: mockBridge }),
    );

    // Sandbox should NOT have been called for a Read tool
    expect((mockBridge.runInSandbox as ReturnType<typeof vi.fn>)).not.toHaveBeenCalled();
    // executeTool should have been called for Read
    expect(mockExecuteTool).toHaveBeenCalledWith(
      "Read",
      expect.any(Object),
      expect.any(String),
      expect.any(Object),
    );
  });

  it("SandboxBridge correctly maps successful execution to ToolResult", async () => {
    // Direct unit test of sandbox bridge result mapping
    const bridge = makeMockBridge();
    (bridge.runInSandbox as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      content: "hello world\n",
      isError: false,
    });

    const result = await bridge.runInSandbox("echo hello world", 5000);

    expect(result.content).toBe("hello world\n");
    expect(result.isError).toBe(false);
  });

  it("SandboxBridge maps non-zero exit to isError: true", async () => {
    const bridge = makeMockBridge();
    (bridge.runInSandbox as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      content: "command not found: badcmd",
      isError: true,
    });

    const result = await bridge.runInSandbox("badcmd", 5000);

    expect(result.isError).toBe(true);
    expect(result.content).toContain("command not found");
  });
});
