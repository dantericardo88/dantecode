// ============================================================================
// @dantecode/cli — OpenHands Action Wiring Tests
// Proves that OpenHands-style action tool names normalize into native CLI tools
// so the standard execution ledger and completion gate still apply.
// ============================================================================

import { resolve } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockGenerateText, mockExecuteTool, mockFileContents } = vi.hoisted(() => ({
  mockGenerateText: vi.fn(),
  mockExecuteTool: vi.fn(),
  mockFileContents: new Map<string, string>(),
}));

vi.mock("ai", () => ({
  generateText: mockGenerateText,
  streamText: vi.fn(),
}));

vi.mock("node:fs/promises", () => ({
  readFile: vi.fn((path: string) => {
    const normalized = String(path).replace(/\\/g, "/");
    if (mockFileContents.has(normalized)) {
      return Promise.resolve(mockFileContents.get(normalized)!);
    }
    return Promise.reject(Object.assign(new Error("ENOENT"), { code: "ENOENT" }));
  }),
  writeFile: vi.fn((path: string, content: string) => {
    const normalized = String(path).replace(/\\/g, "/");
    mockFileContents.set(normalized, content);
    return Promise.resolve(undefined);
  }),
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
    appendAuditEvent: vi.fn().mockResolvedValue(undefined),
    shouldContinueLoop: vi.fn(() => true),
    estimateTokens: vi.fn((text: string) => Math.ceil(text.length / 4)),
    estimateMessageTokens: vi.fn((msgs: Array<{ content: string }>) =>
      msgs.reduce((sum, msg) => sum + Math.ceil(msg.content.length / 4), 0),
    ),
    promptRequestsToolExecution: vi.fn((prompt: string) =>
      /\b(create|write|implement|fix|change|verify|test)\b/i.test(prompt),
    ),
    responseNeedsToolExecutionNudge: vi.fn(() => false),
    parseVerificationErrors: vi.fn(() => []),
    formatErrorsForFixPrompt: vi.fn(() => ""),
    computeErrorSignature: vi.fn(() => ""),
    getContextUtilization: vi.fn(() => ({ tokens: 100, maxTokens: 128000, percent: 0, tier: "green" })),
    compactTextTranscript: vi.fn((messages: unknown[]) => ({ messages, strategy: "none", droppedMessages: 0 })),
    truncateToolOutput: vi.fn((content: string) => content),
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
      formatForPrompt() { return ""; }
    },
    classifyRisk: vi.fn().mockReturnValue("low"),
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

vi.mock("@dantecode/git-engine", () => ({
  getStatus: vi.fn(() => ({ staged: [], unstaged: [], untracked: [] })),
  autoCommit: vi.fn(),
  generateRepoMap: vi.fn(() => []),
  formatRepoMapForContext: vi.fn(() => ""),
  getDiff: vi.fn(() => ""),
}));

vi.mock("./tools.js", () => ({
  executeTool: mockExecuteTool,
  getToolDefinitions: vi.fn(() => [
    { name: "Read", description: "Read a file", parameters: {} },
    { name: "Write", description: "Write a file", parameters: {} },
    { name: "Edit", description: "Edit a file", parameters: {} },
    { name: "Bash", description: "Run a command", parameters: {} },
  ]),
}));

vi.mock("./tool-schemas.js", () => ({
  getAISDKTools: vi.fn(() => ({})),
}));

import type { DanteCodeState, Session } from "@dantecode/config-types";
import { runAgentLoop, type AgentLoopConfig } from "./agent-loop.js";

function makeSession(): Session {
  return {
    id: "action-wiring-session",
    projectRoot: "/tmp/action-wiring",
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

describe("Action dispatcher wiring", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFileContents.clear();
    mockExecuteTool.mockResolvedValue({
      toolName: "Read",
      content: "default",
      isError: false,
      ok: true,
    });
  });

  it("normalizes create actions into native Write calls and records mutation proof", async () => {
    mockExecuteTool.mockImplementationOnce(async (name, input) => {
      expect(name).toBe("Write");
      const filePath = String(input.file_path);
      const normalizedPath = resolve("/tmp/action-wiring", filePath).replace(/\\/g, "/");
      mockFileContents.set(normalizedPath, String(input.content));
      return {
        toolName: "Write",
        content: `Successfully wrote 1 lines to ${normalizedPath}`,
        isError: false,
        ok: true,
        mutationRecords: [
          {
            id: "mutation-1",
            toolCallId: "",
            path: "openhands.txt",
            beforeHash: "",
            afterHash: "after-hash",
            diffSummary: "+1 -0",
            lineCount: 1,
            additions: 1,
            deletions: 0,
            timestamp: "2026-04-16T00:00:00.000Z",
          },
        ],
      };
    });

    mockGenerateText.mockResolvedValueOnce({
      text: '<tool_use>\n{"name":"str_replace_based_edit_tool","input":{"command":"create","path":"openhands.txt","file_text":"hello from action dispatcher"}}\n</tool_use>',
      usage: { promptTokens: 50, completionTokens: 50, totalTokens: 100 },
    });
    mockGenerateText.mockResolvedValueOnce({
      text: "The file has been created.",
      usage: { promptTokens: 50, completionTokens: 10, totalTokens: 60 },
    });
    mockGenerateText.mockResolvedValueOnce({
      text: "The requested file exists with the new contents.",
      usage: { promptTokens: 50, completionTokens: 10, totalTokens: 60 },
    });

    const result = await runAgentLoop("create openhands.txt", makeSession(), makeConfig());

    expect(mockExecuteTool).toHaveBeenCalledWith(
      "Write",
      expect.objectContaining({
        file_path: "openhands.txt",
        content: "hello from action dispatcher",
      }),
      expect.any(String),
      expect.any(Object),
    );
    expect(result.status).toBe("COMPLETE");
    expect(result.executionLedger?.toolCallRecords).toHaveLength(1);
    expect(result.executionLedger?.toolCallRecords[0]).toMatchObject({
      toolName: "Write",
      input: expect.objectContaining({ file_path: "openhands.txt" }),
    });
    expect(result.executionLedger?.mutationRecords).toHaveLength(1);
    expect(result.executionLedger?.mutationRecords[0]).toMatchObject({
      toolCallId: result.executionLedger?.toolCallRecords[0]!.id,
      path: "openhands.txt",
      afterHash: "after-hash",
    });
    expect(result.executionLedger?.completionGateResult?.ok).toBe(true);
  });

  it("normalizes execute_bash actions into native Bash calls and records validation proof", async () => {
    mockExecuteTool.mockResolvedValueOnce({
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
      text: '<tool_use>\n{"name":"execute_bash","input":{"command":"npm test"}}\n</tool_use>',
      usage: { promptTokens: 50, completionTokens: 50, totalTokens: 100 },
    });
    mockGenerateText.mockResolvedValueOnce({
      text: "Tests are green.",
      usage: { promptTokens: 50, completionTokens: 10, totalTokens: 60 },
    });

    const result = await runAgentLoop(
      "verify the code only without changes",
      makeSession(),
      makeConfig(),
    );

    expect(mockExecuteTool).toHaveBeenCalledWith(
      "Bash",
      expect.objectContaining({ command: "npm test" }),
      expect.any(String),
      expect.any(Object),
    );
    expect(result.status).toBe("COMPLETE");
    expect(result.executionLedger?.toolCallRecords).toHaveLength(1);
    expect(result.executionLedger?.toolCallRecords[0]).toMatchObject({
      toolName: "Bash",
      input: expect.objectContaining({ command: "npm test" }),
    });
    expect(result.executionLedger?.validationRecords).toHaveLength(1);
    expect(result.executionLedger?.validationRecords[0]).toMatchObject({
      toolCallId: result.executionLedger?.toolCallRecords[0]!.id,
      type: "test",
      command: "npm test",
      passed: true,
    });
    expect(result.executionLedger?.completionGateResult?.ok).toBe(true);
  });
});
