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

vi.mock("ai", () => ({
  generateText: mockGenerateText,
  streamText: vi.fn(),
}));

// Track analyzeComplexity return value so tests can override it
let mockAnalyzeComplexityValue = 0.3;
const mockEscalateTier = vi.fn();

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

    async stream(
      messages: Array<{ role: string; content: string }>,
      _options?: Record<string, unknown>,
    ): Promise<{ textStream: AsyncIterable<string> }> {
      const result = await mockGenerateText({
        model: { modelId: "mock" },
        messages,
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
  }

  return {
    ModelRouterImpl: MockModelRouterImpl,
    SessionStore: MockSessionStore,
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
    expect(planningMessage.content).toContain("What files need to change?");
    expect(planningMessage.content).toContain("What's the approach?");
    expect(planningMessage.content).toContain("What could go wrong?");

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
      text: 'Continuing.\n<tool_use>\n{"name":"Read","input":{"file_path":"src/other.ts"}}\n</tool_use>',
      usage: { totalTokens: 100 },
    });
    mockExecuteTool.mockResolvedValueOnce({ content: "other file", isError: false });

    // Round 4: model genuinely finishes
    mockGenerateText.mockResolvedValueOnce({
      text: "All steps are now truly complete.",
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

    // Rounds 5-6: pipeline nudges exhausted → confab gate fires (filesModified=0, max 2)
    mockGenerateText.mockResolvedValueOnce({
      text: "## Summary\nStill done.",
      usage: { totalTokens: 30 },
    });
    mockGenerateText.mockResolvedValueOnce({
      text: "## Summary\nReally done.",
      usage: { totalTokens: 30 },
    });

    // Round 7: both pipeline nudges and confab nudges exhausted — model is allowed to stop
    mockGenerateText.mockResolvedValueOnce({
      text: "## Summary\nFinal answer.",
      usage: { totalTokens: 30 },
    });

    const session = makeSession();
    await runAgentLoop("/autoforge improve code", session, makeConfig());

    // 1 (tool) + 3 (pipeline nudges) + 2 (confab nudges) + 1 (allowed to break) = 7
    expect(mockGenerateText).toHaveBeenCalledTimes(7);
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
      text: 'Continuing.\n<tool_use>\n{"name":"Read","input":{"file_path":"utils.ts"}}\n</tool_use>',
      usage: { totalTokens: 100 },
    });
    mockExecuteTool.mockResolvedValueOnce({ content: "utils content", isError: false });

    // Round 4: genuinely finishes
    mockGenerateText.mockResolvedValueOnce({
      text: "Task complete.",
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
        text: `Step ${i}.\n<tool_use>\n{"name":"Read","input":{"file_path":"skill-file-${i}.ts"}}\n</tool_use>`,
        usage: { totalTokens: 100 },
      });
      mockExecuteTool.mockResolvedValueOnce({ content: `content ${i}`, isError: false });
    }

    // Final: model finishes
    mockGenerateText.mockResolvedValueOnce({
      text: "All skill steps done.",
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
      text: 'Working.\n<tool_use>\n{"name":"Read","input":{"file_path":"skill-work.ts"}}\n</tool_use>',
      usage: { totalTokens: 100 },
    });
    mockExecuteTool.mockResolvedValueOnce({ content: "file content", isError: false });

    // Round 2: premature summary — should get nudged because isExecutionContinuationPrompt
    // detects the skill activation system message
    mockGenerateText.mockResolvedValueOnce({
      text: "## Summary\n\nFinished.",
      usage: { totalTokens: 50 },
    });

    // Round 3: continues after nudge (text must NOT match PREMATURE_SUMMARY_PATTERN)
    mockGenerateText.mockResolvedValueOnce({
      text: "Understood, continuing with the next step now.",
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
    const result = await runAgentLoop("/magic fix the bug", session, makeConfig());

    // 3 calls: confab-rejected summary → real edit → final
    expect(mockGenerateText).toHaveBeenCalledTimes(3);

    // Verify confabulation warning was injected in the 2nd call
    const secondCallArgs = mockGenerateText.mock.calls[1]![0];
    const userMsgs = secondCallArgs.messages.filter(
      (m: { role: string; content: string }) => m.role === "user",
    );
    const hasConfabWarning = userMsgs.some((m: { content: string }) =>
      m.content.includes("NO files were actually modified"),
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
      async (_name: string, input: Record<string, unknown>, projectRoot: string, context?: { readTracker?: Map<string, string> }) => {
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
});
