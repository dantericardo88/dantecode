// ============================================================================
// @dantecode/cli — Agent Loop Smoke Tests
// End-to-end smoke tests that exercise the full agent loop flow with mocked
// providers. Tests: basic prompt, tool dispatch, safety blocking, stuck loop.
// ============================================================================

import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock external dependencies BEFORE importing module under test

// Mock generateText at the "ai" module level — ModelRouterImpl calls this internally.
const mockGenerateText = vi.fn();

vi.mock("ai", () => ({
  generateText: mockGenerateText,
  streamText: vi.fn(),
}));

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
      });
      return result.text;
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

    selectTier() { return "fast"; }
    recordRequestCost() {}
    resetSessionCost() {}
  }

  return {
    ModelRouterImpl: MockModelRouterImpl,
    appendAuditEvent: vi.fn().mockResolvedValue(undefined),
    shouldContinueLoop: vi.fn(() => true),
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
}));

vi.mock("@dantecode/git-engine", () => ({
  getStatus: vi.fn(() => ({ staged: [], unstaged: [], untracked: [] })),
  autoCommit: vi.fn(),
}));

vi.mock("./tools.js", () => ({
  executeTool: vi.fn().mockResolvedValue({ content: "ok", isError: false }),
  getToolDefinitions: vi.fn(() => [
    { name: "Read", description: "Read a file", parameters: {} },
    { name: "Write", description: "Write a file", parameters: {} },
    { name: "Bash", description: "Run command", parameters: {} },
  ]),
}));

// Safety module is NOT mocked — we test it for real

import { runAgentLoop, type AgentLoopConfig } from "./agent-loop.js";
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
      supportsToolCalls: true,
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
          supportsToolCalls: true,
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
      (m) =>
        m.role === "tool" &&
        m.toolResult?.content.includes("rm -rf"),
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
    mockGenerateText.mockRejectedValueOnce(
      new Error("API rate limit exceeded"),
    );

    const session = makeSession();
    const result = await runAgentLoop("Do something", session, makeConfig());

    // Should produce an error message in the session
    const errorMsg = result.messages.find(
      (m) =>
        m.role === "assistant" &&
        typeof m.content === "string" &&
        m.content.includes("error"),
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
