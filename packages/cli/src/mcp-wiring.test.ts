// ============================================================================
// @dantecode/cli — MCP Wiring Tests
// Proves that:
//   1. Agent loop routes mcp_-prefixed tool calls to mcpClient.callToolByName
//   2. Non-MCP tool calls do NOT touch mcpClient
//   3. mcpToolsToAISDKTools produces correctly prefixed keys
//   4. Empty tool list leaves agentConfig.mcpTools undefined (no pollution)
//   5. loadMCPConfig returns safe default when .dantecode/mcp.json is absent
// ============================================================================

import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Mock providers (hoisted before module init) ─────────────────────────────

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

vi.mock("./tools.js", () => ({
  executeTool: mockExecuteTool,
  getToolDefinitions: vi.fn(() => [
    { name: "Bash", description: "Run command", parameters: {} },
  ]),
}));

vi.mock("./tool-schemas.js", () => ({
  getAISDKTools: vi.fn(() => ({})),
}));

// ─── Imports ──────────────────────────────────────────────────────────────────

import { runAgentLoop, type AgentLoopConfig } from "./agent-loop.js";
import { mcpToolsToAISDKTools, loadMCPConfig } from "@dantecode/mcp";
import type { Session, DanteCodeState } from "@dantecode/config-types";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeSession(): Session {
  return {
    id: "mcp-test-session",
    projectRoot: "/tmp/mcp-test",
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

function makeMockMcpClient() {
  return {
    callToolByName: vi.fn().mockResolvedValue("mcp-tool-result"),
  };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("MCP Wiring", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockExecuteTool.mockResolvedValue({ content: "direct-exec-result", isError: false });
  });

  it("routes mcp_-prefixed tool calls to mcpClient.callToolByName", async () => {
    const mockMcpClient = makeMockMcpClient();

    // Round 1: model returns an MCP tool call
    mockGenerateText.mockResolvedValueOnce({
      text: 'Checking quality.\n<tool_use>\n{"name":"mcp_myserver_pdse_score","input":{"code":"const x = 1;","filePath":"test.ts"}}\n</tool_use>',
      usage: { promptTokens: 50, completionTokens: 50, totalTokens: 100 },
    });
    // Round 2: model returns final response
    mockGenerateText.mockResolvedValueOnce({
      text: "Quality check complete.",
      usage: { promptTokens: 50, completionTokens: 10, totalTokens: 60 },
    });

    await runAgentLoop(
      "check code quality",
      makeSession(),
      makeConfig({ mcpClient: mockMcpClient }),
    );

    expect(mockMcpClient.callToolByName).toHaveBeenCalledWith(
      "mcp_myserver_pdse_score",
      expect.objectContaining({ code: "const x = 1;" }),
    );
    // executeTool should NOT have been called for the MCP tool
    expect(mockExecuteTool).not.toHaveBeenCalledWith(
      "mcp_myserver_pdse_score",
      expect.any(Object),
      expect.any(String),
      expect.any(Object),
    );
  }, 15000);

  it("records MCP tool calls in the execution ledger", async () => {
    const mockMcpClient = makeMockMcpClient();

    mockGenerateText.mockResolvedValueOnce({
      text: 'Checking quality.\n<tool_use>\n{"name":"mcp_myserver_pdse_score","input":{"code":"const x = 1;","filePath":"test.ts"}}\n</tool_use>',
      usage: { promptTokens: 50, completionTokens: 50, totalTokens: 100 },
    });
    mockGenerateText.mockResolvedValueOnce({
      text: "Quality check complete.",
      usage: { promptTokens: 50, completionTokens: 10, totalTokens: 60 },
    });

    const result = await runAgentLoop(
      "check code quality",
      makeSession(),
      makeConfig({ mcpClient: mockMcpClient }),
    );

    expect(result.executionLedger?.toolCallRecords).toHaveLength(1);
    expect(result.executionLedger?.toolCallRecords[0]).toMatchObject({
      toolName: "mcp_myserver_pdse_score",
      input: expect.objectContaining({ code: "const x = 1;" }),
      result: {
        toolUseId: expect.any(String),
        content: "mcp-tool-result",
        isError: false,
      },
    });
  });

  it("does NOT call mcpClient for non-mcp tool calls", async () => {
    const mockMcpClient = makeMockMcpClient();

    // Round 1: model returns a native Read tool call
    mockGenerateText.mockResolvedValueOnce({
      text: 'Reading file.\n<tool_use>\n{"name":"Read","input":{"file_path":"src/index.ts"}}\n</tool_use>',
      usage: { promptTokens: 50, completionTokens: 50, totalTokens: 100 },
    });
    // Round 2: final response
    mockGenerateText.mockResolvedValueOnce({
      text: "The file has been read.",
      usage: { promptTokens: 50, completionTokens: 10, totalTokens: 60 },
    });

    await runAgentLoop(
      "read the index file",
      makeSession(),
      makeConfig({ mcpClient: mockMcpClient }),
    );

    expect(mockMcpClient.callToolByName).not.toHaveBeenCalled();
    expect(mockExecuteTool).toHaveBeenCalledWith(
      "Read",
      expect.any(Object),
      expect.any(String),
      expect.any(Object),
    );
  });

  it("mcpToolsToAISDKTools produces mcp_serverName_toolName prefixed keys", () => {
    const tools = [
      { name: "pdse_score", description: "PDSE scoring", inputSchema: { type: "object", properties: { code: { type: "string" } } }, serverName: "dantecode" },
      { name: "anti_stub_scan", description: "Anti-stub scan", inputSchema: { type: "object", properties: {} }, serverName: "dantecode" },
    ];

    const result = mcpToolsToAISDKTools(tools);

    expect(Object.keys(result)).toContain("mcp_dantecode_pdse_score");
    expect(Object.keys(result)).toContain("mcp_dantecode_anti_stub_scan");
    expect(result["mcp_dantecode_pdse_score"]).toBeDefined();
    expect(result["mcp_dantecode_pdse_score"]!.description).toBe("PDSE scoring");
  });

  it("empty tool list produces empty record (no mcpTools pollution in agentConfig)", () => {
    const result = mcpToolsToAISDKTools([]);

    expect(Object.keys(result)).toHaveLength(0);
    // The wiring in repl.ts only sets agentConfig.mcpTools when connectedTools.length > 0,
    // so an empty result means mcpTools stays undefined in agentConfig
    expect(result).toEqual({});
  });

  it("loadMCPConfig returns safe default when .dantecode/mcp.json is absent", async () => {
    // The node:fs/promises mock rejects with ENOENT for all readFile calls
    const config = await loadMCPConfig("/nonexistent/project/root");

    expect(config).toEqual({ servers: [] });
    // No crash, no throw — fresh projects just get an empty server list
  });
});
